// ============================================================
// CombatSystem — 경로 기반 타워디펜스 전투
//
// 맵: 7×4 직사각형
// 몬스터 경로: 테두리 반시계 방향
//   좌상→좌하→우하→우상→좌상 (루프)
//
// 유닛: 보드 내부에 배치, 사거리 내 몬스터 공격
// ============================================================

import { Monster, CombatState, CombatEffect, UnitInstance, PathPoint, PlayerState, GameState, CCDebuff } from '../types';
import { UNIT_MAP, STAR_MULTIPLIER, getStage, isBossRound, STAGE_DEFENSE } from '../config';
import { EventBus } from '../EventBus';
import { SynergyBuffs } from './SynergySystem';

// ─── 상수 ───────────────────────────────────────────────────

const BOARD_W = 7;
const BOARD_H = 4;
const TICK_RATE = 1 / 60;             // 60fps 시뮬레이션
const DEFAULT_RANGE = 2.5;
const DEFAULT_ATTACK_SPEED = 1.0;
const SPAWN_INTERVAL = 0.6;           // 몬스터 스폰 간격 (초)
const MONSTER_BASE_SPEED = 1.2;       // 초당 이동 칸
const LAP_DAMAGE = 1;                 // 몬스터 1바퀴당 플레이어 HP 피해


/** 오버킬 방지 + 유닛별 실제 데미지 추적 */
function applyDamage(monster: Monster, rawDmg: number, attacker?: UnitInstance): number {
    const actual = Math.min(rawDmg, Math.max(0, monster.hp));
    monster.hp -= actual;
    if (attacker && actual > 0) {
        attacker.totalDamageDealt = (attacker.totalDamageDealt ?? 0) + actual;
    }
    return actual;
}

// ─── 경로 계산 (9×6 외곽 트랙, 반시계 방향) ─────────────────
//
// 전체 그리드: 9×6 (중앙 7×4 보드 + 1칸 두께 외곽 트랙)
// 반시계: 좌상(0,0) → 좌하(0,5) → 우하(8,5) → 우상(8,0) → 좌상(0,0)
//
// 렌더 시: pos를 외곽 그리드 셀 좌표로 사용,
// 타일 정중앙까지 +0.5 오프셋은 렌더 코드에서 처리
//

/** 반시계 방향 4코너 웨이포인트 (외곽 트랙 셀 좌표) */
function buildPerimeterPath(): PathPoint[] {
    const path: PathPoint[] = [];
    // 좌상 → 좌하 (좌측변, x=0, 아래로)
    for (let y = 0; y <= 5; y++) path.push({ px: 0, py: y });
    // 좌하 → 우하 (하단변, y=5, 오른쪽)
    for (let x = 1; x <= 8; x++) path.push({ px: x, py: 5 });
    // 우하 → 우상 (우측변, x=8, 위로)
    for (let y = 4; y >= 0; y--) path.push({ px: 8, py: y });
    // 우상 → 좌상 (상단변, y=0, 왼쪽)
    for (let x = 7; x >= 1; x--) path.push({ px: x, py: 0 });
    return path;
}

export const PERIMETER_PATH = buildPerimeterPath();
export const PATH_LENGTH = PERIMETER_PATH.length; // 전체 경로 길이 (마지막→첫 웨이포인트 보간 포함)

/** 경로 진행률(0~1)로 월드 좌표 구하기 */
export function getPositionOnPath(progress: number): PathPoint {
    // progress를 0~1 범위로 wrap
    const p = ((progress % 1) + 1) % 1;
    const idx = p * PATH_LENGTH;
    const i = Math.floor(idx);
    const t = idx - i;
    const a = PERIMETER_PATH[i % PERIMETER_PATH.length];
    const b = PERIMETER_PATH[(i + 1) % PERIMETER_PATH.length];
    return {
        px: a.px + (b.px - a.px) * t,
        py: a.py + (b.py - a.py) * t,
    };
}

// ─── CombatSystem ───────────────────────────────────────────

export class CombatSystem {
    private combat: CombatState;
    private monsterIdCounter = 0;
    private effectIdCounter = 0;
    private animationId: number | null = null;
    private lastTime = 0;
    private onRender: ((combat: CombatState) => void) | null = null;
    private buffs: SynergyBuffs | null = null;
    private _paused = false;
    private _gameSpeed = 1;
    private _augments: Set<string> = new Set();
    private _adaptiveDmg = false;
    private _bailoutUsed = false;

    // 픽셀 기반 거리 계산용 레이아웃 파라미터
    private _layout = {
        gridOffsetX: 0, gridOffsetY: 0,
        cellW: 1, cellH: 1,
        trackLeft: 0, trackTop: 0,
        trackW: 1, trackH: 1,
        avgCell: 1,
    };

    /** 렌더링 레이아웃 설정 (startCombat 시 호출) */
    setLayout(params: {
        gridOffsetX: number; gridOffsetY: number;
        cellW: number; cellH: number;
        trackLeft: number; trackTop: number;
        trackW: number; trackH: number;
    }): void {
        this._layout = {
            ...params,
            avgCell: (params.cellW + params.cellH) / 2,
        };
    }

    /** 유닛(보드좌표) ↔ 몬스터(경로좌표) 픽셀 거리 / avgCellSize
     *  시각적 범위원(range * avgCellSize)과 정확히 일치 */
    private distToMonster(boardX: number, boardY: number, pathX: number, pathY: number): number {
        const L = this._layout;
        // 유닛 픽셀 좌표 (보드 셀 중심)
        const uPx = L.gridOffsetX + (boardX + 0.5) * L.cellW;
        const uPy = L.gridOffsetY + (boardY + 0.5) * L.cellH;
        // 몬스터 픽셀 좌표 (트랙 위)
        const mPx = L.trackLeft + (pathX / 8) * L.trackW;
        const mPy = L.trackTop + (pathY / 5) * L.trackH;
        // 픽셀 거리 / avgCellSize = range 단위
        const dx = uPx - mPx;
        const dy = uPy - mPy;
        return Math.sqrt(dx * dx + dy * dy) / L.avgCell;
    }

    /** 게임 속도 (1x, 2x, 3x) */
    get gameSpeed(): number { return this._gameSpeed; }
    set gameSpeed(v: number) { this._gameSpeed = Math.max(1, Math.min(3, v)); }

    /** 게임 속도 토글: 1x → 2x → 3x → 1x */
    toggleSpeed(): number {
        this._gameSpeed = this._gameSpeed >= 3 ? 1 : this._gameSpeed + 1;
        return this._gameSpeed;
    }

    /** 전투 일시정지 */
    pause(): void {
        this._paused = true;
    }

    /** 전투 재개 */
    resume(): void {
        if (this._paused) {
            this._paused = false;
            this.lastTime = performance.now(); // 시간 점프 방지
        }
    }

    get isPaused(): boolean {
        return this._paused;
    }

    constructor(private events: EventBus) {
        this.combat = this.createCombatState();
    }

    private createCombatState(): CombatState {
        return {
            active: false,
            monsters: [],
            projectiles: [],
            effects: [],
            spawnQueue: 0,
            spawnTimer: 0,
            elapsedTime: 0,
            totalKills: 0,
            totalGoldEarned: 0,
            leakedDamage: 0,
        };
    }

    /** 전투 시작 */
    startCombat(
        state: GameState,
        player: PlayerState,
        synergyBuffs: SynergyBuffs,
        onRender: (combat: CombatState) => void,
        onComplete: (result: CombatResult) => void,
    ): void {
        this.combat = this.createCombatState();
        this.combat.active = true;
        this.onRender = onRender;
        this.buffs = synergyBuffs;

        // 몬스터 수/스펙 결정
        const round = state.round;
        const isBoss = isBossRound(round);
        // Monster count
        let monsterCount: number;
        if (isBoss) {
            monsterCount = 1;
        } else if (getStage(round) === 1) {
            monsterCount = round === 1 ? 1 : round === 2 ? 3 : 5;
        } else {
            monsterCount = 10;
        }
        // Boss HP: 벽 느낌 — 높은 HP + 높은 방어 + 빠른 이속
        // Normal: 기본 공식
        const baseHp = isBoss
            ? Math.floor(round * round * 12 + round * 150 + 300)      // Boss HP (큰 벽)
            : Math.floor(round * round * 0.52 + round * 7.8 + 5);    // Normal HP
        const baseSpeed = MONSTER_BASE_SPEED + round * 0.012;
        // 보스 이속 30% 빠르게 + 시너지 슬로우 적용
        const speed = (isBoss ? baseSpeed * 1.3 : baseSpeed) * (1 - (synergyBuffs.slowPercent ?? 0));
        const goldPer = 0; // 킬 골드 없음 (보스는 아이템 드랍)

        // ── DEF/MDEF 계산 ──
        const stage = getStage(round);
        const stageDefData = STAGE_DEFENSE[stage] ?? { def: 0, mdef: 0 };
        const monsterDef = isBoss ? Math.floor(stageDefData.def * 2.5) : stageDefData.def;
        const monsterMdef = isBoss ? Math.floor(stageDefData.mdef * 2.5) : stageDefData.mdef;

        this.combat.spawnQueue = monsterCount;

        // 유닛 쿨다운 초기화 + 스킬 상태 리셋
        for (const u of player.board) {
            u.attackCooldown = 0;
            u.skillTimer = 0;
            u.skillStacks = 0;
            u.skillActive = false;
            u.attackCount = 0;
            u.totalDamageDealt = 0;  // 웨이브별 DPS 초기화
        }

        // onCombatStart 스킬 처리
        const combatStartBuffs = { teamDmgPct: 0, teamAtkSpd: 0 };
        for (const u of player.board) {
            const def = UNIT_MAP[u.unitId];
            if (!def?.skill || def.skill.type !== 'onCombatStart') continue;
            const s = def.skill;
            u.skillActive = true;
            combatStartBuffs.teamDmgPct += s.params.teamDmgPct ?? 0;
            combatStartBuffs.teamAtkSpd += s.params.teamAtkSpd ?? 0;
        }
        // 전투시작 버프를 synergyBuffs에 합산
        if (combatStartBuffs.teamDmgPct > 0) {
            synergyBuffs.dmgMultiplier *= (1 + combatStartBuffs.teamDmgPct);
        }
        if (combatStartBuffs.teamAtkSpd > 0) {
            synergyBuffs.atkSpeedMultiplier *= (1 + combatStartBuffs.teamAtkSpd);
        }

        // ── 증강 효과 적용 ──
        const augs = new Set(player.augments);

        // 👁️ 영지식 증명: 크리가 스킬에도 적용 (크리확률을 synergyBuffs에 유지)
        if (augs.has('aug_zk_proof')) {
            synergyBuffs.critChance += 0.10;
            synergyBuffs.critDmgMultiplier += 0.5;
        }
        // 🩸 연쇄 청산: 스킬 킬 시 폭발+마나50% (processActiveSkills에서 처리)
        // → flag만 저장, 실제 로직은 스킬 핸들러 이후에 처리
        if (augs.has('aug_chain_liquidation')) {
            // 플래그 저장 (combat state에서 참조)
        }
        // 📉 마진 콜: 최대마나 50% 감소, 스킬 시전 시 HP-1
        // → processActiveSkills에서 maxMana 계산 시 적용
        if (augs.has('aug_margin_call')) {
            // 플래그 저장
        }
        // 🐈 데드캣 바운스: 관통 반사
        // → 관통 스킬 핸들러에서 처리
        if (augs.has('aug_dead_cat')) {
            // 플래그 저장
        }
        // 📈 숏 스퀴즈: 보스 마나2배 + 30%이하 즉사
        if (augs.has('aug_short_squeeze')) {
            synergyBuffs.bossDmgMultiplier *= 1.5;
        }
        // 🌩️ 라이트닝 네트워크: 체인→단일집중
        // → 체인 스킬 핸들러에서 처리
        if (augs.has('aug_lightning_network')) {
            // 플래그 저장
        }
        // 🤖 MEV 샌드위치: 킬 골드 +1
        if (augs.has('aug_mev')) {
            synergyBuffs.bonusKillGold += 1;
        }
        // ❄️ 크립토 윈터: 몰스터 이속 -20%
        if (augs.has('aug_crypto_winter')) {
            synergyBuffs.slowPercent = Math.min(0.8, (synergyBuffs.slowPercent ?? 0) + 0.20);
        }
        // 🔊 시너지 증폭기: 시너지 유닛 수+1 (SynergySystem에서 처리 필요 — 여기선 DMG 보너스로 근사)
        // 🌉 크로스체인 브릿지: 시너지 카운트 +1
        if (augs.has('aug_crosschain')) {
            synergyBuffs.dmgMultiplier *= 1.15;
            synergyBuffs.atkSpeedMultiplier *= 1.10;
        }
        // 🔮 적응형 관통: 물방/마방 중 낮은 값으로 적용 (flag 저장)
        // (실제 적용은 데미지 계산 루프에서 this._adaptiveDmg 참조)
        // ⛽ 가스비 페이백 + 하드포크: processActiveSkills에서 처리
        this._adaptiveDmg = augs.has('aug_adaptive');

        // 📋 스마트 컨트랙트 복제: 보유 7/10코 유닛 1마리 복제 → 벤치
        if (augs.has('aug_clone')) {
            const highCostUnits = [...player.board, ...player.bench].filter(
                u => (UNIT_MAP[u.unitId]?.cost ?? 0) >= 7
            );
            if (highCostUnits.length > 0 && player.bench.length < 9) {
                const pick = highCostUnits[Math.floor(Math.random() * highCostUnits.length)];
                const clone: UnitInstance = {
                    instanceId: `clone_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    unitId: pick.unitId,
                    star: 1,
                    position: null,
                };
                player.bench.push(clone);
                this.events.emit('unit:bought', { unit: clone });
            }
        }
        // 증강 적용한 후 몬스터 속도 재계산에 반영하기 위해 저장
        this._augments = augs;

        // 💧 마나 초기화: active 스킬 유닛의 currentMana = startingMana
        for (const unit of player.board) {
            const udef = UNIT_MAP[unit.unitId];
            if (udef?.skill?.type === 'active') {
                unit.currentMana = udef.startingMana ?? 0;
            }
        }

        // 🪂 기습 에어드랍: 무작위 3명 마나 100% 충전
        if (augs.has('aug_airdrop')) {
            const activeUnits = player.board.filter(u => {
                const ud = UNIT_MAP[u.unitId];
                return ud?.skill?.type === 'active' && u.position;
            });
            // 셔플 후 3명 선택
            for (let i = activeUnits.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [activeUnits[i], activeUnits[j]] = [activeUnits[j], activeUnits[i]];
            }
            for (let i = 0; i < Math.min(3, activeUnits.length); i++) {
                const ud = UNIT_MAP[activeUnits[i].unitId];
                activeUnits[i].currentMana = ud?.maxMana ?? 100;
            }
        }

        // 🚑 구제 금융 플래그 초기화
        this._bailoutUsed = this._bailoutUsed ?? false;

        this.events.emit('combat:start', { round });

        // 시뮬레이션 루프
        this.lastTime = performance.now();
        const tick = (now: number) => {
            // 일시정지 시 렌더만 유지
            if (this._paused) {
                this.onRender?.(this.combat);
                this.animationId = requestAnimationFrame(tick);
                return;
            }
            const rawDt = Math.min((now - this.lastTime) / 1000, 0.05); // cap delta
            const dt = rawDt * this._gameSpeed;
            this.lastTime = now;

            // 1) 스폰
            if (this.combat.spawnQueue > 0) {
                this.combat.spawnTimer -= dt;
                if (this.combat.spawnTimer <= 0) {
                    this.spawnMonster(baseHp, speed, goldPer, isBoss, monsterDef, monsterMdef);
                    this.combat.spawnTimer = SPAWN_INTERVAL;
                }
            }

            // 2) CC 디버프 틱 + 이속 재계산
            for (const m of this.combat.monsters) {
                if (!m.alive) continue;
                // 디버프 카운트다운 + 만료 제거
                if (m.debuffs && m.debuffs.length > 0) {
                    for (let i = m.debuffs.length - 1; i >= 0; i--) {
                        m.debuffs[i].remaining -= dt;
                        if (m.debuffs[i].remaining <= 0) m.debuffs.splice(i, 1);
                    }
                }
                // 유효 이속 = baseSpeed * (1 - 가장 강한 슬로우)
                if (m.debuffs && m.debuffs.length > 0) {
                    const maxSlow = Math.max(...m.debuffs.map(d => d.slowPct));
                    m.speed = m.baseSpeed * (1 - Math.min(maxSlow, 0.95));
                } else {
                    m.speed = m.baseSpeed;
                }
                m.pathProgress += m.speed * dt / PATH_LENGTH;

                // 1바퀴 완주 → 재순환 (피해 없음, 타이머로 처리)
                if (m.pathProgress >= 1.0) {
                    m.pathProgress -= 1.0;
                    m.laps++;
                }
            }

            // 3) 유닛 공격 (시너지 버프 + 스킬 적용)
            this.processAttacks(player.board, dt);

            // 3.5) DoT 틱 처리
            for (const m of this.combat.monsters) {
                if (!m.alive || !m.dots || m.dots.length === 0) continue;
                for (let i = m.dots.length - 1; i >= 0; i--) {
                    const dot = m.dots[i];
                    m.hp -= dot.dps * dt;
                    dot.remaining -= dt;
                    if (dot.remaining <= 0) m.dots.splice(i, 1);
                }
            }

            // 4) active 스킬 처리 (3초 쿨 자동 시전)
            this.processActiveSkills(player.board, dt, player);

            // 5) 죽은 몬스터 정리 + 사망 이펙트 + DoT 전이
            for (const m of this.combat.monsters) {
                if (m.alive && m.hp <= 0) {
                    m.alive = false;
                    this.combat.totalKills++;
                    this.combat.totalGoldEarned += m.goldReward + (this.buffs?.bonusKillGold ?? 0);

                    // 🔥 DoT 전이: 죽은 몬스터의 DoT를 인근 적에게 전파
                    if (m.dots && m.dots.length > 0) {
                        const deathP = getPositionOnPath(m.pathProgress);
                        const nearAlive = this.combat.monsters
                            .filter(n => n.alive && n !== m)
                            .map(n => ({ n, d: Math.sqrt((getPositionOnPath(n.pathProgress).px - deathP.px) ** 2 + (getPositionOnPath(n.pathProgress).py - deathP.py) ** 2) }))
                            .sort((a, b) => a.d - b.d);
                        // 전이 대상 수: 기본 1명(★1), 더 많은 전이는 ★2/3에서 처리(config params)
                        const spreadCount = Math.min(nearAlive.length, 3);
                        for (let i = 0; i < spreadCount; i++) {
                            const target = nearAlive[i].n;
                            if (!target.dots) target.dots = [];
                            for (const dot of m.dots) {
                                target.dots.push({ dps: dot.dps, remaining: dot.remaining });
                            }
                        }
                    }

                    // 사망 이펙트 (Unity: DeathParticleSystem)
                    const deathPos = getPositionOnPath(m.pathProgress);
                    this.combat.effects.push({
                        id: this.effectIdCounter++,
                        type: 'death',
                        x: deathPos.px,
                        y: deathPos.py,
                        startTime: performance.now(),
                        duration: m.isBoss ? 1200 : 500,
                        frameIndex: m.isBoss ? 7 : Math.floor(Math.random() * 4),
                    });
                }
            }

            this.combat.elapsedTime += dt;

            // 타임아웃 처리
            if (isBoss) {
                // 보스: 60초 돌파 시 HP-5, 이후 5초마다 HP-3
                if (this.combat.elapsedTime >= 60) {
                    const overtime = this.combat.elapsedTime - 60;
                    const prevOvertime = overtime - dt;
                    // 60초 돌파 순간: HP -5
                    if (prevOvertime < 0) {
                        this.combat.leakedDamage += 5;
                    }
                    // 이후 5초마다 HP -3
                    const prevTicks = Math.floor(Math.max(0, prevOvertime) / 5);
                    const curTicks = Math.floor(overtime / 5);
                    if (curTicks > prevTicks) {
                        this.combat.leakedDamage += 3 * (curTicks - prevTicks);
                    }
                }
            } else {
                // 일반: 40초 돌파 시 HP-1, 이후 5초마다 HP-1
                if (this.combat.elapsedTime >= 40) {
                    const overtime = this.combat.elapsedTime - 40;
                    const prevOvertime = overtime - dt;
                    // 40초 돌파 순간: HP -1
                    if (prevOvertime < 0) {
                        this.combat.leakedDamage += 1;
                    }
                    // 이후 5초마다 HP -1
                    const prevTicks = Math.floor(Math.max(0, prevOvertime) / 5);
                    const curTicks = Math.floor(overtime / 5);
                    if (curTicks > prevTicks) {
                        this.combat.leakedDamage += (curTicks - prevTicks);
                    }
                }
            }

            // 6) 만료된 투사체 + 이펙트 제거
            const projNow = performance.now();
            this.combat.projectiles = this.combat.projectiles.filter(
                p => projNow - p.startTime < p.duration
            );
            this.combat.effects = this.combat.effects.filter(
                e => projNow - e.startTime < e.duration
            );

            // 7) 렌더 콜백
            this.onRender?.(this.combat);

            // 7) 종료 체크
            const allSpawned = this.combat.spawnQueue <= 0;
            const allDead = this.combat.monsters.every(m => !m.alive);

            if (allSpawned && allDead) {
                this.combat.active = false;
                const won = this.combat.leakedDamage === 0;

                // ── 등급 판정 ──
                const t = this.combat.elapsedTime;
                let grade: 'S' | 'A' | 'B' | 'F';
                let bonusGold = 0;
                if (isBoss) {
                    if (t <= 10) { grade = 'S'; bonusGold = 5; }
                    else if (t <= 20) { grade = 'A'; bonusGold = 3; }
                    else if (t <= 35) { grade = 'B'; bonusGold = 2; }
                    else { grade = 'F'; bonusGold = 0; }
                } else {
                    if (t <= 10) { grade = 'S'; bonusGold = 4; }
                    else if (t <= 20) { grade = 'A'; bonusGold = 2; }
                    else if (t <= 30) { grade = 'B'; bonusGold = 1; }
                    else { grade = 'F'; bonusGold = 0; }
                }

                // 라운드 종료 시 토템 골드 합산
                let totemGold = 0;
                for (const u of player.board) {
                    if (!u.position) continue;
                    const uDef = UNIT_MAP[u.unitId];
                    if (uDef?.skill?.type === 'passive' && uDef.skill.params.roundEndGold) {
                        totemGold += uDef.skill.params.roundEndGold;
                    }
                }
                onComplete({
                    won,
                    kills: this.combat.totalKills,
                    goldEarned: this.combat.totalGoldEarned + (this.buffs?.bonusRoundGold ?? 0) + totemGold,
                    damage: this.combat.leakedDamage,
                    elapsedTime: this.combat.elapsedTime,
                    grade,
                    bonusGold,
                });
                return;
            }

            this.animationId = requestAnimationFrame(tick);
        };

        this.animationId = requestAnimationFrame(tick);
    }

    /** 전투 강제 종료 */
    stopCombat(): void {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.combat.active = false;
    }

    /** 몬스터 스폰 */
    private spawnMonster(hp: number, speed: number, gold: number, isBoss: boolean, def: number = 0, mdef: number = 0): void {
        this.monsterIdCounter++;
        const actualSpeed = speed + (Math.random() * 0.2 - 0.1); // ±10% 속도 변동
        this.combat.monsters.push({
            id: this.monsterIdCounter,
            hp,
            maxHp: hp,
            def,
            mdef,
            speed: actualSpeed,
            baseSpeed: actualSpeed,
            pathProgress: 0,
            laps: 0,
            alive: true,
            isBoss,
            goldReward: gold,
            debuffs: [],
            spawnTime: performance.now(),
        });
        this.combat.spawnQueue--;
    }

    /** active 스킬 마나 처리 (마나 충전 시 발동) */
    private processActiveSkills(boardUnits: UnitInstance[], dt: number, player: PlayerState): void {
        for (const unit of boardUnits) {
            if (!unit.position) continue;
            const def = UNIT_MAP[unit.unitId];
            if (!def?.skill || def.skill.type !== 'active') continue;
            const s = def.skill;
            // permManaReduce: skillStacks만큼 maxMana 축소 (akang ★3)
            const manaReduction = (def.skill.params?.permManaReduce && unit.star >= 3) ? (unit.skillStacks ?? 0) : 0;
            let maxMana = Math.max(10, (def.maxMana ?? 100) - manaReduction);
            // 📉 마진 콜 증강: 최대마나 50% 감소
            const augSet = new Set(player.augments);
            if (augSet.has('aug_margin_call')) {
                maxMana = Math.max(5, Math.floor(maxMana * 0.50));
            }

            // 초당 자연 마나 회복 +5/s
            let manaRegen = 5;
            // 📈 숏 스퀴즈: 보스 공격 시 마나 회복 2배
            if (augSet.has('aug_short_squeeze') && this.combat.monsters.some(m => m.alive && m.isBoss)) {
                manaRegen *= 2;
            }
            // 🌾 디파이 이자농사: 보유 10G당 마나 회복 +1
            if (augSet.has('aug_defi_farm')) {
                manaRegen += Math.floor(player.gold / 10);
            }
            unit.currentMana = (unit.currentMana ?? 0) + manaRegen * dt;

            // 마나 부족 → 스킬 미발동
            if (unit.currentMana < maxMana) continue;

            // 마나 충전 완료 → 사거리 내 적 확인 후 발동
            const unitRange = def.attackRange ?? DEFAULT_RANGE;
            const hasTargetInRange = this.combat.monsters.some(m => {
                if (!m.alive) return false;
                const mPos = getPositionOnPath(m.pathProgress);
                return this.distToMonster(unit.position!.x, unit.position!.y, mPos.px, mPos.py) <= unitRange;
            });
            if (!hasTargetInRange) continue; // 마나 만땅이지만 사거리 내 적 없음 → 대기
            unit.currentMana = 0;
            // 📉 마진 콜: 스킬 시전 시 기지 HP -1
            if (augSet.has('aug_margin_call')) {
                player.hp = Math.max(0, player.hp - 1);
            }
            // 💧 DeFi 시너지: 마나 환급 (manaPayback)
            const payback = this.buffs?.manaPayback ?? 0;
            if (payback > 0) {
                unit.currentMana += maxMana * payback;
            }
            // ⛽ 가스비 페이백: 스킬 후 마나 30%로 시작
            if (augSet.has('aug_gas_payback')) {
                unit.currentMana = Math.max(unit.currentMana ?? 0, maxMana * 0.30);
            }

            const p = s.params;
            const starMult = STAR_MULTIPLIER[unit.star];
            const baseDmg = def.baseDmg * starMult;

            // 타겟 선택 (가장 앞 적, 또는 최대HP 적)
            const alive = this.combat.monsters.filter(m => m.alive);
            if (alive.length === 0) continue;
            const frontTarget = alive.reduce((a, b) => b.pathProgress > a.pathProgress ? b : a);
            const hpTarget = alive.reduce((a, b) => b.hp > a.hp ? b : a);

            // ═══ 스킬 VFX 생성 ═══
            const fxTarget = frontTarget;
            const fxPos = getPositionOnPath(fxTarget.pathProgress);
            const unitPos = unit.position!;
            let skillFxType: CombatEffect['type'] = 'skill_explosion'; // 기본

            // 스킬 파라미터에 따라 이펙트 타입 결정
            if (p.gold || p.goldStatue) skillFxType = 'skill_gold';
            else if (p.splashTargets || p.sniperShots) skillFxType = 'skill_explosion';
            else if (p.chainTargets || p.ampChainTargets) skillFxType = 'skill_chain';
            else if (p.freezeTargets || p.freezeDuration || p.freezeSlow) skillFxType = 'freeze';
            else if (p.stunTargets || p.stunDuration) skillFxType = 'skill_stun';
            else if (p.pierceTargets || p.distancePierce) skillFxType = 'skill_sniper';
            else if (p.knockback || p.hpHalve) skillFxType = 'skill_aoe';
            else if (p.allyPermDmgBuff || p.buffDuration || p.rangeBonus) skillFxType = 'skill_buff';
            else if (p.executeThreshold || p.shatterExplode) skillFxType = 'skill_execute';
            else if (p.summonDmg) skillFxType = 'skill_aoe';
            else if (p.superCycle) skillFxType = 'skill_lightning';
            else if (p.doubleCast) skillFxType = 'skill_chain';
            else if (p.feeHustle || p.hyperCarry) skillFxType = 'skill_sniper';
            else if (p.selfDmgPct) skillFxType = 'skill_buff';

            // 유닛 위치에서 이펙트 생성
            this.combat.effects.push({
                id: this.effectIdCounter++,
                type: skillFxType,
                x: fxPos.px, y: fxPos.py,
                value: Math.round(baseDmg),
                startTime: performance.now(),
                duration: 800,
                frameIndex: 0,
            });
            // 유닛 시전 이펙트 (원형 파동)
            this.combat.effects.push({
                id: this.effectIdCounter++,
                type: 'skill_buff',
                x: unitPos.x + 1, y: unitPos.y + 1,
                value: 0,
                startTime: performance.now(),
                duration: 400,
                frameIndex: 0,
            });

            // 골드 생성 스킬 (PC방 채굴자, Mashinsky)
            if (p.gold) {
                this.combat.totalGoldEarned += p.gold;
            }
            // 자신 영구 DMG 누적 (Saylor 무한매수)
            if (p.selfDmgPct && !p.buffDuration) {
                unit.skillStacks = (unit.skillStacks ?? 0) + 1;
            }
            // 소환 스킬 — 가상 유닛 = 즉시 데미지
            if (p.summonDmg) {
                const sdmg = p.summonDmg * starMult;
                const target = alive[Math.floor(Math.random() * alive.length)];
                target.hp -= sdmg;
            }
            // 슬로우 (Gareth 숏 포지션 — slowPct + slowDuration)
            if (p.slowPct && (p.slowDuration || p.duration)) {
                const target = frontTarget;
                const dur = p.slowDuration ?? p.duration ?? 2;
                if (!target.debuffs) target.debuffs = [];
                target.debuffs.push({ type: 'slow', slowPct: p.slowPct, remaining: dur });
            }
            // 빙결 (Justin Sun, AKang, Hsaka — freezeDuration + freezeSlow)
            // 빙결 = 약한 광역 슬로우 (15%), 모든 생존 적에게 적용
            if (p.freezeDuration) {
                const slowFactor = p.freezeSlow ?? 0.15; // 15% 감속 (광역이라 약하게)
                for (const m of alive) {
                    const dur = m.isBoss ? (p.bossFreezeDuration ?? p.freezeDuration * 0.3) : p.freezeDuration;
                    if (!m.debuffs) m.debuffs = [];
                    m.debuffs.push({ type: 'freeze', slowPct: slowFactor, remaining: dur });
                    // 빙결 이펙트
                    const mPos = getPositionOnPath(m.pathProgress);
                    this.combat.effects.push({
                        id: this.effectIdCounter++,
                        type: 'freeze',
                        x: mPos.px, y: mPos.py,
                        value: 0,
                        startTime: performance.now(),
                        duration: dur * 1000,
                        frameIndex: 0,
                    });
                }
            }
            // DEF 깎기 (SBF 백도어 — defShred + stunDuration)
            if (p.defShred) {
                const target = frontTarget;
                target.def = Math.max(0, target.def - p.defShred);
                // SBF 짧은 스턴 (완전 정지)
                if (p.stunDuration) {
                    const stunDur = target.isBoss ? (p.bossStunDuration ?? p.stunDuration * 0.3) : p.stunDuration;
                    if (!target.debuffs) target.debuffs = [];
                    target.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: stunDur });
                }
            }
            // MDEF 깎기 (Gavin Wood — mdefShred)
            if (p.mdefShred) {
                const target = hpTarget;
                target.mdef = Math.max(0, target.mdef - p.mdefShred);
            }
            // DoT (Craig Wright, FUD유포자 — dotPct + dotDuration)
            if (p.dotPct && p.dotDuration) {
                const target = frontTarget;
                const dotDps = baseDmg * p.dotPct;
                if (!target.dots) target.dots = [];
                target.dots.push({ dps: dotDps, remaining: p.dotDuration });
                // 방어무시 (Do Kwon armorIgnore)
                if (p.armorIgnore) {
                    target.hp -= baseDmg * p.dotPct * p.dotDuration * p.armorIgnore;
                }
            }
            // 광역 폭발 (Zhu Su 3AC 청산 — splashPct + splashTargets)
            if (p.splashPct && !p.dotPct && !p.freezeDuration) {
                const target = hpTarget;
                const splashDmg = baseDmg * p.splashPct;
                const tPos = getPositionOnPath(target.pathProgress);
                let hits = 0;
                for (const m of alive) {
                    if (m === target || hits >= (p.splashTargets ?? 2)) continue;
                    const mPos = getPositionOnPath(m.pathProgress);
                    const d = Math.sqrt((mPos.px - tPos.px) ** 2 + (mPos.py - tPos.py) ** 2);
                    if (d <= 2.0) { m.hp -= splashDmg; hits++; }
                }
                target.hp -= baseDmg;
                // 광역 스턴 (Satoshi — splashPct + stunDuration)
                if (p.stunDuration) {
                    const stunDur = target.isBoss ? (p.bossStunDuration ?? p.stunDuration * 0.3) : p.stunDuration;
                    target.speed *= 0.05;
                    for (const m of alive) {
                        if (m === target) continue;
                        const mPos = getPositionOnPath(m.pathProgress);
                        const d = Math.sqrt((mPos.px - tPos.px) ** 2 + (getPositionOnPath(target.pathProgress).py - mPos.py) ** 2);
                        if (d <= 2.0) m.speed *= 0.05;
                    }
                }
            }
            // 저격 (Balaji 100만불 배팅 — burstMult)
            if (p.burstMult && !p.splashPct && !p.dotPct) {
                const target = hpTarget;
                target.hp -= baseDmg * p.burstMult;
            }
            // ⚡ 체인 라이트닝 (Vitalik, Marc — chainTargets + chainPct)
            // 진짜 연쇄: 맞은 적 기준으로 가장 가까운 미타격 적에게 튕김
            if (p.chainTargets && p.chainPct && !p.pierceTargets) {
                const maxBounces = p.chainTargets;
                const bounceRange = 3.0; // 튕기는 최대 거리 (타일)
                const dmgAmp = 1.2; // 튕길 때마다 20% 증폭

                let currentTarget = frontTarget;
                let currentDmg = baseDmg;
                const hitSet = new Set<Monster>();

                // 첫 타격
                currentTarget.hp -= currentDmg;
                hitSet.add(currentTarget);

                // 연쇄 튕기기
                for (let bounce = 0; bounce < maxBounces - 1; bounce++) {
                    const curPos = getPositionOnPath(currentTarget.pathProgress);
                    let nextTarget: Monster | null = null;
                    let minDist = Infinity;

                    // 현재 타겟 기준 가장 가까운 미타격 적 탐색
                    for (const m of alive) {
                        if (!m.alive || hitSet.has(m)) continue;
                        const mPos = getPositionOnPath(m.pathProgress);
                        const dist = Math.sqrt(
                            (mPos.px - curPos.px) ** 2 + (mPos.py - curPos.py) ** 2
                        );
                        if (dist <= bounceRange && dist < minDist) {
                            minDist = dist;
                            nextTarget = m;
                        }
                    }

                    if (!nextTarget) break; // 주변에 더 튕길 적 없음

                    // 튕길 때마다 데미지 증폭
                    currentDmg *= dmgAmp;
                    nextTarget.hp -= currentDmg;

                    // ⚡ 체인 VFX: 이전 타겟 → 다음 타겟 연결선
                    const nextPos = getPositionOnPath(nextTarget.pathProgress);
                    this.combat.effects.push({
                        id: this.effectIdCounter++,
                        type: 'skill_chain',
                        x: nextPos.px, y: nextPos.py,
                        value: Math.round(currentDmg),
                        startTime: performance.now(),
                        duration: 400,
                        frameIndex: bounce,
                    });

                    hitSet.add(nextTarget);
                    currentTarget = nextTarget;
                }
            }
            // 적 HP-% (Justin Sun)
            if (p.hpPct && p.targets) {
                const targets = alive.sort(() => Math.random() - 0.5).slice(0, p.targets);
                for (const t of targets) {
                    t.hp -= t.maxHp * p.hpPct;
                }
            }
            // 자신 공속↑ (워뇨띠, Elon 버프 — atkSpdBuff + buffDuration, self)
            if (p.atkSpdBuff && p.buffDuration && !p.buffRange && !p.rangeBonus) {
                // 자신 공속 버프: 쿨다운 직접 감소
                unit.attackCooldown = Math.max(0, (unit.attackCooldown ?? 0) * (1 - p.atkSpdBuff * unit.star));
            }
            // 💧 인접 아군 마나 회복 (pcminer 해시레이트 공유 — allyManaHeal)
            if (p.allyManaHeal) {
                const healAmount = p.allyManaHeal * unit.star;  // ★ 스케일링
                const range = p.allyManaHealRange ?? 1;
                const maxTargets = (p.allyManaTargets ?? 1) * unit.star; // ★2=2명, ★3=전체
                let healed = 0;
                for (const ally of boardUnits) {
                    if (ally === unit || !ally.position || !unit.position) continue;
                    const dx = Math.abs(ally.position.x - unit.position.x);
                    const dy = Math.abs(ally.position.y - unit.position.y);
                    // ★3: 주변 8칸 모든 아군 (range 무시)
                    const inRange = unit.star >= 3 ? (dx <= 2 && dy <= 2) : (dx <= range && dy <= range);
                    if (!inRange) continue;
                    ally.currentMana = (ally.currentMana ?? 0) + healAmount;
                    healed++;
                    if (unit.star < 3 && healed >= maxTargets) break;
                }
            }
            // 🦊 자신+인접 공속버프 (metamask 가스비 폭발 — atkSpdBuff + buffRange)
            if (p.atkSpdBuff && p.buffDuration && p.buffRange) {
                const buffMult = p.atkSpdBuff * unit.star;  // ★ 스케일링
                // 자신 공속 버프
                unit.attackCooldown = Math.max(0, (unit.attackCooldown ?? 0) * (1 - buffMult));
                // 인접 아군 공속 버프
                const maxTargets = (p.buffTargets ?? 1) * unit.star;
                let buffed = 0;
                for (const ally of boardUnits) {
                    if (ally === unit || !ally.position || !unit.position) continue;
                    const dx = Math.abs(ally.position.x - unit.position.x);
                    const dy = Math.abs(ally.position.y - unit.position.y);
                    if (dx <= p.buffRange && dy <= p.buffRange) {
                        ally.attackCooldown = Math.max(0, (ally.attackCooldown ?? 0) * (1 - buffMult));
                        buffed++;
                        if (buffed >= maxTargets) break;
                    }
                }
            }
            // 🛡️ 버스트딜 + 킬 골드/마나 (jessepowell 수수료 장사 — burstDmg + killGold + killManaPayback)
            if (p.burstDmg && !p.burstMult && !p.splashPct) {
                const dmg = p.burstDmg * unit.star;  // ★ 스케일링
                const target = frontTarget;
                target.hp -= dmg;
                // 킬 체크: 스킬로 처치 시 골드 + 마나 페이백
                if (target.hp <= 0 && target.alive) {
                    const goldReward = unit.star >= 3 ? 2 : (p.killGold ?? 1);
                    this.combat.totalGoldEarned += goldReward;
                    const manaBack = unit.star >= 3 ? maxMana : (p.killManaPayback ?? 0) * unit.star;
                    unit.currentMana = (unit.currentMana ?? 0) + manaBack;
                }
            }
            // 🥷 최강 아군 공속 버프 (wonyotti 풀시드 롱 — bestAllyAtkSpdBuff)
            if (p.bestAllyAtkSpdBuff) {
                const buffMult = p.bestAllyAtkSpdBuff * unit.star;  // ★ 스케일링
                // 공격력 가장 높은 아군 찾기
                let bestAlly: UnitInstance | null = null;
                let bestDmg = -1;
                for (const ally of boardUnits) {
                    if (ally === unit || !ally.position) continue;
                    const allyDef = UNIT_MAP[ally.unitId];
                    if (!allyDef) continue;
                    const allyDmg = allyDef.baseDmg * STAR_MULTIPLIER[ally.star];
                    if (allyDmg > bestDmg) { bestDmg = allyDmg; bestAlly = ally; }
                }
                if (bestAlly) {
                    bestAlly.attackCooldown = Math.max(0, (bestAlly.attackCooldown ?? 0) * (1 - buffMult));
                }
            }
            // ❄️ 빙결 스킬 (hsaka 크립토 윈터 — freezeTargets + frozenBonusDmg)
            if (p.freezeTargets && p.freezeDuration && p.frozenBonusDmg !== undefined) {
                const targets = p.freezeTargets * unit.star;  // ★ 스케일링
                const dur = p.freezeDuration + (unit.star - 1);  // ★2=3초, ★3=4초
                const slowFactor = p.freezeSlow ?? 0.90;
                const sorted = alive
                    .sort((a, b) => b.pathProgress - a.pathProgress)
                    .slice(0, targets);
                for (const t of sorted) {
                    if (!t.debuffs) t.debuffs = [];
                    const bossDur = t.isBoss ? dur * 0.3 : dur;
                    t.debuffs.push({ type: 'freeze', slowPct: slowFactor, remaining: bossDur });
                    // 빙결 이펙트
                    const fPos = getPositionOnPath(t.pathProgress);
                    this.combat.effects.push({
                        id: this.effectIdCounter++,
                        type: 'freeze',
                        x: fPos.px, y: fPos.py,
                        value: 0,
                        startTime: performance.now(),
                        duration: bossDur * 1000,
                        frameIndex: 0,
                    });
                }
            }
            // 🏦 관통 빔 + 명중당 마나 (perpdex 롱/숏 빔 — pierceManaPer)
            if (p.pierceTargets && p.piercePct && p.pierceManaPer) {
                const target = frontTarget;
                const pierceDmg = baseDmg * p.piercePct;
                const targets = (p.pierceTargets - 1) + unit.star;  // ★ 스케일링
                target.hp -= baseDmg;
                let hitCount = 1;
                const sorted = alive
                    .filter(m => m !== target)
                    .sort((a, b) => b.pathProgress - a.pathProgress)
                    .slice(0, targets);
                for (const m of sorted) { m.hp -= pierceDmg; hitCount++; }
                // 명중당 마나 회복
                unit.currentMana = (unit.currentMana ?? 0) + p.pierceManaPer * hitCount;
            }
            // 🛡️ 확정 크리 + 영구 크리DMG 누적 (hodler 다이아몬드 핸드 — guaranteedCrit + permCritDmgBonus)
            if (p.guaranteedCrit) {
                const critHits = unit.star >= 2 ? 3 : 1;  // ★2=3타, ★1=1타
                const target = frontTarget;
                const critMult = 2.0 + (unit.skillStacks ?? 0) * (p.permCritDmgBonus ?? 0.10);
                for (let i = 0; i < critHits && target.alive; i++) {
                    target.hp -= baseDmg * critMult;
                }
                // 영구 크리DMG 누적 (★3 매 스킬마다)
                if (unit.star >= 3) {
                    unit.skillStacks = (unit.skillStacks ?? 0) + 1;
                }
            }
            // 💀 DoT + 사망 시 마나 구슬 (fudspreader 공포 전염 — dotManaOrb)
            if (p.dotPct && p.dotDuration && p.dotManaOrb) {
                const targets = Math.min(alive.length, unit.star >= 2 ? 3 : 1);
                const dotDps = baseDmg * p.dotPct * unit.star;
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, targets);
                for (const t of selected) {
                    if (!t.dots) t.dots = [];
                    t.dots.push({ dps: dotDps, remaining: p.dotDuration });
                }
            }
            // 📱 다연속 강타 + 즉사 확률 (piuser 폰 채굴 — multiHit + instantKillChance)
            if (p.multiHit) {
                const hits = unit.star >= 2 ? p.multiHit + 1 : p.multiHit;  // ★2=3타
                const target = frontTarget;
                for (let i = 0; i < hits && target.alive; i++) {
                    target.hp -= baseDmg * (p.multiHitMult ?? 1.5);
                }
                // ★3 즉사 확률
                if (unit.star >= 3 && p.instantKillChance && !target.isBoss) {
                    if (Math.random() < p.instantKillChance) {
                        target.hp = 0;
                        this.combat.totalGoldEarned += p.instantKillGold ?? 5;
                    }
                }
            }
            // 🧊 다수 슬로우 + 트루뎀 디버프 (gareth 차트 분석 — slowTargets + trueDmgDebuff)
            if (p.slowPct && (p.slowDuration || p.duration) && p.slowTargets) {
                const targets = (p.slowTargets - 1) + unit.star;  // ★ 스케일링
                const dur = p.slowDuration ?? p.duration ?? 2;
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, targets);
                for (const t of selected) {
                    if (!t.debuffs) t.debuffs = [];
                    t.debuffs.push({ type: 'slow', slowPct: p.slowPct * unit.star * 0.5, remaining: dur + unit.star });
                }
            }
            // ⚙️ 영구 공속 누적 (tradebot 초단타 — permAtkSpdBonus)
            if (p.atkSpdBuff && p.buffDuration && !p.buffRange && !p.rangeBonus && p.permAtkSpdBonus) {
                // 즉시 공속 버프
                unit.attackCooldown = Math.max(0, (unit.attackCooldown ?? 0) * (1 - p.atkSpdBuff * unit.star));
                // ★3: 영구 공속 누적
                if (unit.star >= 3) {
                    unit.skillStacks = (unit.skillStacks ?? 0) + 1;
                }
            }
            // 📢 Social 마나 충전 (kol 선동 — socialManaCharge)
            if (p.socialManaCharge && unit.star >= 3) {
                for (const ally of boardUnits) {
                    if (ally === unit) continue;
                    const allyDef = UNIT_MAP[ally.unitId];
                    if (allyDef?.origin === 'Social' && allyDef?.skill?.type === 'active') {
                        const allyMaxMana = allyDef.maxMana ?? 100;
                        ally.currentMana = allyMaxMana;
                    }
                }
            }
            // 👔 다수 물방 깎기 + 스턴 (a16zintern 리서치 — defShredTargets)
            if (p.defShred && p.defShredTargets) {
                const targets = (p.defShredTargets - 1) + unit.star;  // ★ 스케일링
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, targets);
                for (const t of selected) {
                    t.def = Math.max(0, t.def - p.defShred * unit.star);
                    // ★3 스턴
                    if (unit.star >= 3 && p.stunDuration) {
                        if (!t.debuffs) t.debuffs = [];
                        const sDur = t.isBoss ? p.stunDuration * 0.3 : p.stunDuration;
                        t.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: sDur });
                    }
                }
            }
            // 🐻 HP비례 도트 + 최대HP 삭제 (roubini 둠세이어 — hpPctDot + maxHpShred)
            if (p.hpPctDot) {
                const targets = Math.min(alive.length, unit.star >= 2 ? 3 : 1);
                const selected = alive.sort((a, b) => b.hp - a.hp).slice(0, targets);
                for (const t of selected) {
                    const dotDps = t.maxHp * p.hpPctDot;
                    if (!t.dots) t.dots = [];
                    t.dots.push({ dps: dotDps, remaining: p.dotDuration ?? 3 });
                    // ★3: 최대HP 영구 삭제
                    if (unit.star >= 3 && p.maxHpShred) {
                        t.maxHp = Math.max(1, t.maxHp * (1 - p.maxHpShred));
                    }
                }
            }
            // 🐕 체인 + 킬 마나 페이백 (memecoin 하이프 — chainKillManaPayback)
            if (p.chainTargets && p.chainPct && p.chainKillManaPayback) {
                const target = frontTarget;
                const chainCount = (p.chainTargets - 1) + unit.star;  // ★ 스케일링
                target.hp -= baseDmg;
                const tPos = getPositionOnPath(target.pathProgress);
                const nearby = alive
                    .filter(m => m !== target)
                    .map(m => ({ m, d: Math.sqrt((getPositionOnPath(m.pathProgress).px - tPos.px) ** 2 + (getPositionOnPath(m.pathProgress).py - tPos.py) ** 2) }))
                    .sort((a, b) => a.d - b.d)
                    .slice(0, chainCount);
                for (const { m } of nearby) {
                    m.hp -= baseDmg * p.chainPct;
                    // 킬 시 마나 페이백
                    if (m.hp <= 0 && m.alive) {
                        unit.currentMana = (unit.currentMana ?? 0) + maxMana * p.chainKillManaPayback;
                    }
                }
                if (target.hp <= 0 && target.alive) {
                    unit.currentMana = (unit.currentMana ?? 0) + maxMana * p.chainKillManaPayback;
                }
            }
            // 📺 빙결 + ★3 역주행 (cramer 인버스 — reverseMove)
            if (p.freezeTargets && p.freezeDuration && p.reverseMove !== undefined && p.frozenBonusDmg === undefined) {
                const targets = p.freezeTargets * unit.star;
                const dur = p.freezeDuration + (unit.star - 1) * 0.5;
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, targets);
                for (const t of selected) {
                    if (!t.debuffs) t.debuffs = [];
                    const bossDur = t.isBoss ? dur * 0.3 : dur;
                    t.debuffs.push({ type: 'freeze', slowPct: p.freezeSlow ?? 0.90, remaining: bossDur });
                    // ★3: 역주행 (경로 후퇴)
                    if (unit.star >= 3) {
                        t.pathProgress = Math.max(0, t.pathProgress - 0.15);
                    }
                }
            }
            // ⚡ 체인 + 감전장판 (jackdorsey — electricField)
            if (p.chainTargets && p.chainPct && p.electricField && !p.chainKillManaPayback && !p.defiDmgBuff) {
                const target = frontTarget;
                const chainCount = (p.chainTargets - 1) + unit.star;
                target.hp -= baseDmg;
                const tPos = getPositionOnPath(target.pathProgress);
                const nearby = alive
                    .filter(m => m !== target)
                    .map(m => ({ m, d: Math.sqrt((getPositionOnPath(m.pathProgress).px - tPos.px) ** 2 + (getPositionOnPath(m.pathProgress).py - tPos.py) ** 2) }))
                    .sort((a, b) => a.d - b.d)
                    .slice(0, chainCount);
                for (const { m } of nearby) {
                    m.hp -= baseDmg * p.chainPct;
                    // ★3: 감전 장판 (DoT 부여 + 아군 마나 회복)
                    if (unit.star >= 3) {
                        if (!m.dots) m.dots = [];
                        m.dots.push({ dps: baseDmg * 0.1, remaining: 3 });
                    }
                }
                // ★3: 체인 맞은 수만큼 아군 마나 회복
                if (unit.star >= 3 && nearby.length > 0) {
                    for (const ally of boardUnits) {
                        if (UNIT_MAP[ally.unitId]?.skill?.type === 'active') {
                            ally.currentMana = (ally.currentMana ?? 0) + nearby.length * 3;
                        }
                    }
                }
            }
            // 🌐 체인 + DeFi 공격력 버프 (jessepollak — defiDmgBuff)
            if (p.chainTargets && p.chainPct && p.defiDmgBuff) {
                const target = frontTarget;
                const chainCount = (p.chainTargets - 1) + unit.star;
                target.hp -= baseDmg;
                const tPos = getPositionOnPath(target.pathProgress);
                const nearby = alive
                    .filter(m => m !== target)
                    .map(m => ({ m, d: Math.sqrt((getPositionOnPath(m.pathProgress).px - tPos.px) ** 2 + (getPositionOnPath(m.pathProgress).py - tPos.py) ** 2) }))
                    .sort((a, b) => a.d - b.d)
                    .slice(0, chainCount);
                let hitCount = 1;
                for (const { m } of nearby) { m.hp -= baseDmg * p.chainPct; hitCount++; }
                // DeFi 유닛 공격력 버프 (임시: 공속으로 구현)
                const dmgBuff = p.defiDmgBuff * hitCount * unit.star;
                for (const ally of boardUnits) {
                    const allyDef = UNIT_MAP[ally.unitId];
                    if (allyDef?.origin === 'DeFi' && ally.position) {
                        ally.attackCooldown = Math.max(0, (ally.attackCooldown ?? 0) * (1 - dmgBuff));
                    }
                }
            }
            // 🔍 아군 딜↑ 버프 (opensea NFT 민팅 — allyDmgBuff)
            if (p.allyDmgBuff && p.allyBuffTargets) {
                const targets = (p.allyBuffTargets - 1) + unit.star;
                // 가장 공격력 높은 아군부터 버프
                const allies = boardUnits
                    .filter(a => a !== unit && a.position)
                    .map(a => ({ a, dmg: (UNIT_MAP[a.unitId]?.baseDmg ?? 0) * STAR_MULTIPLIER[a.star] }))
                    .sort((a, b) => b.dmg - a.dmg)
                    .slice(0, targets);
                for (const { a } of allies) {
                    a.attackCooldown = Math.max(0, (a.attackCooldown ?? 0) * (1 - p.allyDmgBuff * unit.star));
                }
            }
            // 💀 디버프 + ★3 스킬 표절 (craigwright 소송 — skillSteal)
            if (p.dotPct && p.dotDuration && p.defShred && p.skillSteal !== undefined && !p.defShredTargets) {
                const targets = Math.min(alive.length, unit.star >= 2 ? 3 : 1);
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, targets);
                for (const t of selected) {
                    if (!t.dots) t.dots = [];
                    t.dots.push({ dps: baseDmg * p.dotPct, remaining: p.dotDuration });
                    t.def = Math.max(0, t.def - p.defShred);
                }
                // ★3: 가장 강한 아군 스킬 복사 (50% 위력으로 추가딜)
                if (unit.star >= 3) {
                    let bestDmg = 0;
                    for (const ally of boardUnits) {
                        if (ally === unit) continue;
                        const ad = UNIT_MAP[ally.unitId];
                        if (ad) bestDmg = Math.max(bestDmg, ad.baseDmg * STAR_MULTIPLIER[ally.star]);
                    }
                    if (bestDmg > 0) { frontTarget.hp -= bestDmg * 0.5; }
                }
            }
            // 👻 관통 + ★3 HP 되감기 (daniele 리베이스 — hpRewind)
            if (p.pierceTargets && p.piercePct && p.hpRewind !== undefined && !p.pierceManaPer) {
                const target = frontTarget;
                const pierceCount = (p.pierceTargets - 1) + unit.star;
                target.hp -= baseDmg;
                const sorted = alive
                    .filter(m => m !== target)
                    .sort((a, b) => b.pathProgress - a.pathProgress)
                    .slice(0, pierceCount);
                for (const m of sorted) { m.hp -= baseDmg * p.piercePct; }
                // ★3: HP 되감기 (타격 대상의 HP를 maxHp 기준 큰 버스트 딜)
                if (unit.star >= 3) {
                    const rewindDmg = target.maxHp * 0.20;
                    target.hp -= rewindDmg;
                }
            }
            // 🔑 ₿ 사거리 버프 (halfinney 최초의 수신자 — btcRangeBuff)
            if (p.btcRangeBuff) {
                // ★3: 모든 ₿ 유닛 사거리 무한 (큰 값으로 설정)
                // 간단 구현: 공속 버프로 대체
                for (const ally of boardUnits) {
                    if (ally === unit) continue;
                    const ad = UNIT_MAP[ally.unitId];
                    if (ad?.origin === 'Bitcoin' && ally.position) {
                        ally.attackCooldown = Math.max(0, (ally.attackCooldown ?? 0) * (1 - 0.15 * unit.star));
                    }
                }
            }
            // 💳 버스트 + 골드 비례 DMG (kris 캐시백 — goldScaleDmg)
            if (p.burstDmg && p.goldScaleDmg && !p.killManaPayback) {
                const target = frontTarget;
                let dmg = p.burstDmg * unit.star;
                // ★3: 플레이어 현재 골든 비례 추가 DMG
                if (unit.star >= 3) {
                    const playerGold = this.combat.totalGoldEarned;
                    dmg += playerGold * 2;
                }
                target.hp -= dmg;
                if (target.hp <= 0 && target.alive) {
                    this.combat.totalGoldEarned += p.killGold ?? 1;
                }
            }
            // 📖 아군 크리 버프 (cdixon Read Write Own — allyCritBuff)
            if (p.allyCritBuff && p.critBuffRange) {
                // 간단 구현: 범위 내 아군 공속 + 크리 효과 (공속 버프로 구현)
                const range = p.critBuffRange ?? 3;
                for (const ally of boardUnits) {
                    if (ally === unit || !ally.position || !unit.position) continue;
                    const dx = Math.abs(ally.position.x - unit.position.x);
                    const dy = Math.abs(ally.position.y - unit.position.y);
                    if (dx <= range && dy <= range) {
                        ally.attackCooldown = Math.max(0, (ally.attackCooldown ?? 0) * (1 - p.allyCritBuff * unit.star));
                    }
                }
            }
            // 🏛️ 광역 슬로우 + ★3 전체 빙결 (kashkari 금리 인상 — fullFreeze)
            if (p.slowPct && p.slowDuration && p.fullFreeze !== undefined && !p.slowTargets) {
                const targets = unit.star >= 2 ? alive.length : Math.min(3, alive.length);
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, targets);
                for (const t of selected) {
                    if (!t.debuffs) t.debuffs = [];
                    t.debuffs.push({ type: 'slow', slowPct: p.slowPct, remaining: p.slowDuration });
                    // ★3: 전체 빙결 + 골드
                    if (unit.star >= 3) {
                        const bossDur = t.isBoss ? 1.0 : 3.0;
                        t.debuffs.push({ type: 'freeze', slowPct: 0.95, remaining: bossDur });
                    }
                }
                if (unit.star >= 3 && p.freezeGold) {
                    this.combat.totalGoldEarned += 1;
                }
            }
            // ⛏️ 관통 + ★3 전체 넉백 (rogerver 빅 블록 — knockback)
            if (p.pierceTargets && p.piercePct && p.knockback !== undefined && !p.pierceManaPer && !p.hpRewind) {
                const target = frontTarget;
                const pierceCount = (p.pierceTargets - 1) + unit.star;
                target.hp -= baseDmg;
                const sorted = alive
                    .filter(m => m !== target)
                    .sort((a, b) => b.pathProgress - a.pathProgress)
                    .slice(0, pierceCount);
                for (const m of sorted) { m.hp -= baseDmg * p.piercePct; }
                // ★3: 경로상 전체 적 넉백 + 기절
                if (unit.star >= 3) {
                    for (const m of alive) {
                        m.pathProgress = Math.max(0, m.pathProgress - 0.25);
                        if (!m.debuffs) m.debuffs = [];
                        const stunDur = m.isBoss ? 0.5 : 1.5;
                        m.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: stunDur });
                    }
                }
            }
            // 🤖 광역 + ★3 HP 절반 (wintermute 마켓 메이킹 — hpHalve)
            if (p.splashPct && p.splashTargets && p.hpHalve !== undefined) {
                const target = frontTarget;
                const splashCount = (p.splashTargets - 1) + unit.star;
                target.hp -= baseDmg;
                const tPos = getPositionOnPath(target.pathProgress);
                const nearby = alive
                    .filter(m => m !== target)
                    .map(m => ({ m, d: Math.sqrt((getPositionOnPath(m.pathProgress).px - tPos.px) ** 2 + (getPositionOnPath(m.pathProgress).py - tPos.py) ** 2) }))
                    .sort((a, b) => a.d - b.d)
                    .slice(0, splashCount);
                for (const { m } of nearby) { m.hp -= baseDmg * p.splashPct; }
                // ★3: 넓은 범위 모든 적 HP 50%
                if (unit.star >= 3) {
                    for (const m of alive) {
                        m.hp = Math.max(1, m.hp * 0.5);
                    }
                }
            }
            // 🎯 확정크리 (높은 배율) + ★3 영구 아군 공↑ (simon 시드 투자 — critMultiplier + allyPermDmgBuff)
            if (p.guaranteedCrit && p.critMultiplier && p.allyPermDmgBuff !== undefined) {
                const target = frontTarget;
                const mult = unit.star >= 2 ? p.critMultiplier * 2 : p.critMultiplier;
                const dmg = baseDmg * mult;
                target.hp -= dmg;
                // ★3: 입힌 피해의 10%만큼 주변 아군 영구 공격력 증가 (공속 영구↑으로 구현)
                if (unit.star >= 3 && p.allyPermDmgBuff > 0) {
                    for (const ally of boardUnits) {
                        if (ally !== unit && ally.position) {
                            ally.skillStacks = (ally.skillStacks ?? 0) + 1;
                        }
                    }
                }
            }
            // 🧊 기절 + ★3 황금동상 (peterschiff 골드 버그 — stunTargets + goldStatue)
            if (p.stunDuration && p.stunTargets && !p.defShredTargets && !p.defShred) {
                const targets = (p.stunTargets - 1) + unit.star;
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, targets);
                for (const t of selected) {
                    if (!t.debuffs) t.debuffs = [];
                    // ★3: 황금동상 = 5초 기절
                    const dur = unit.star >= 3 ? 5.0 : p.stunDuration;
                    const bossDur = t.isBoss ? dur * 0.2 : dur;
                    t.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: bossDur });
                    // 황금동상 처치 시 골드 (간접: 직접 처치 보상 추가)
                    if (unit.star >= 3) {
                        // 스턴된 적에게 표시 (killGold 보상)
                        t.def = Math.max(0, t.def - 10);
                    }
                }
            }
            // 🦈 광역 빙결 + ★3 영구 마나통 축소 (akang 풀 레버리지 숏 — permManaReduce)
            if (p.freezeTargets && p.freezeDuration && p.permManaReduce !== undefined && p.frozenBonusDmg === undefined && p.reverseMove === undefined) {
                const targets = (p.freezeTargets - 1) + unit.star;  // ★1=3, ★2=4, ★3=5
                const dur = p.freezeDuration + unit.star;
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, targets);
                for (const t of selected) {
                    if (!t.debuffs) t.debuffs = [];
                    const bossDur = t.isBoss ? dur * 0.3 : dur;
                    t.debuffs.push({ type: 'freeze', slowPct: p.freezeSlow ?? 0.90, remaining: bossDur });
                }
                // ★3: 영구 maxMana 축소 (최소 10까지)
                if (unit.star >= 3) {
                    const uDef = UNIT_MAP[unit.unitId];
                    const currentMax = uDef?.maxMana ?? 80;
                    // skillStacks로 축소량 추적
                    unit.skillStacks = (unit.skillStacks ?? 0) + 1;
                }
            }
            // 🦄 체인 + ★3 HP 스왑 (hayden AMM 스왑 — hpSwap)
            if (p.chainTargets && p.chainPct && p.hpSwap !== undefined && !p.electricField && !p.defiDmgBuff && !p.chainKillManaPayback && !p.turretSummon) {
                const target = frontTarget;
                const chainCount = (p.chainTargets - 1) + unit.star;
                target.hp -= baseDmg;
                const tPos = getPositionOnPath(target.pathProgress);
                const nearby = alive
                    .filter(m => m !== target)
                    .map(m => ({ m, d: Math.sqrt((getPositionOnPath(m.pathProgress).px - tPos.px) ** 2 + (getPositionOnPath(m.pathProgress).py - tPos.py) ** 2) }))
                    .sort((a, b) => a.d - b.d)
                    .slice(0, chainCount);
                for (const { m } of nearby) { m.hp -= baseDmg * p.chainPct; }
                // ★3: 최고HP 적과 최저HP 적의 HP% 스왑
                if (unit.star >= 3 && alive.length >= 2) {
                    const highest = alive.reduce((a, b) => (b.hp / b.maxHp) > (a.hp / a.maxHp) ? b : a);
                    const lowest = alive.reduce((a, b) => (b.hp / b.maxHp) < (a.hp / a.maxHp) ? b : a);
                    if (highest !== lowest) {
                        const highRatio = highest.hp / highest.maxHp;
                        const lowRatio = lowest.hp / lowest.maxHp;
                        highest.hp = highest.maxHp * lowRatio;
                        lowest.hp = lowest.maxHp * highRatio;
                    }
                }
            }
            // 💰 체인 + ★3 포탑 소환 (marc a16z 펀드 — turretSummon)
            if (p.chainTargets && p.chainPct && p.turretSummon !== undefined) {
                const target = frontTarget;
                const chainCount = (p.chainTargets - 1) + unit.star;
                target.hp -= baseDmg;
                const tPos = getPositionOnPath(target.pathProgress);
                const nearby = alive
                    .filter(m => m !== target)
                    .map(m => ({ m, d: Math.sqrt((getPositionOnPath(m.pathProgress).px - tPos.px) ** 2 + (getPositionOnPath(m.pathProgress).py - tPos.py) ** 2) }))
                    .sort((a, b) => a.d - b.d)
                    .slice(0, chainCount);
                for (const { m } of nearby) { m.hp -= baseDmg * p.chainPct; }
                // ★2: 물방깎
                if (unit.star >= 2) {
                    for (const { m } of nearby) { m.def = Math.max(0, m.def - 5); }
                }
                // ★3: 포탑 = 매 초 랜덤 적에게 baseDmg 50% 피해 (간단: 즉시 3명 버스트)
                if (unit.star >= 3) {
                    const turretTargets = alive.sort(() => Math.random() - 0.5).slice(0, 3);
                    for (const t of turretTargets) { t.hp -= baseDmg * 0.5; }
                    // 마나 5 충전
                    unit.currentMana = (unit.currentMana ?? 0) + 5;
                }
            }
            // 💀 광역 기절+DoT + ★3 넥서스 힐 (lazarus 브릿지 해킹 — nexusHeal)
            if (p.stunDuration && p.stunTargets && p.nexusHeal !== undefined) {
                const targets = (p.stunTargets - 1) + unit.star;
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, targets);
                for (const t of selected) {
                    if (!t.debuffs) t.debuffs = [];
                    const dur = t.isBoss ? p.stunDuration * 0.3 : p.stunDuration;
                    t.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: dur });
                    // DoT
                    if (p.dotPct && p.dotDuration) {
                        if (!t.dots) t.dots = [];
                        t.dots.push({ dps: baseDmg * p.dotPct, remaining: p.dotDuration });
                    }
                }
                // ★3: 넥서스(기지) HP 회복 (최대 2)
                if (unit.star >= 3 && p.nexusHeal) {
                    player.hp = Math.min(player.hp + p.nexusHeal, 100);
                }
            }
            // ⚡ 기절 + ★3 시간 정지 (anatoly 네트워크 지연 — timeStop)
            if (p.stunDuration && p.stunTargets && p.timeStop !== undefined && p.nexusHeal === undefined) {
                const targets = (p.stunTargets - 1) + unit.star;
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, targets);
                for (const t of selected) {
                    if (!t.debuffs) t.debuffs = [];
                    const dur = t.isBoss ? p.stunDuration * 0.3 : p.stunDuration + unit.star;
                    t.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: dur });
                }
                // ★3: 시간 정지 = 모든 적 4초 빙결 (아군만 공격 가능)
                if (unit.star >= 3) {
                    for (const m of alive) {
                        if (!m.debuffs) m.debuffs = [];
                        const dur = m.isBoss ? p.timeStop * 0.3 : p.timeStop;
                        m.debuffs.push({ type: 'freeze', slowPct: 1.0, remaining: dur });
                    }
                }
            }
            // 📈 무한 관통 빔 (etf 기관 빔 — infiniteBeam)
            if (p.pierceTargets && p.piercePct && p.infiniteBeam !== undefined && !p.pierceManaPer && !p.hpRewind && !p.knockback) {
                const target = frontTarget;
                // ★3: 무한 관통 (모든 적)
                const pierceCount = unit.star >= 3 ? alive.length : (p.pierceTargets - 1) + unit.star;
                // ★2: 딜 2배
                const dmgMult = unit.star >= 2 ? 2.0 : 1.0;
                target.hp -= baseDmg * dmgMult;
                const sorted = alive
                    .filter(m => m !== target)
                    .sort((a, b) => b.pathProgress - a.pathProgress)
                    .slice(0, pierceCount);
                for (const m of sorted) { m.hp -= baseDmg * p.piercePct * dmgMult; }
                // ★3: 빔 강도 누적 (스킬 시전마다 +1, 추가 DMG)
                if (unit.star >= 3) {
                    unit.skillStacks = (unit.skillStacks ?? 0) + 1;
                    const stackDmg = baseDmg * 0.05 * unit.skillStacks;
                    for (const m of alive) { m.hp -= stackDmg; }
                    // 주변 아군 마나 흡수 → 즉시 마나 25 회복
                    unit.currentMana = (unit.currentMana ?? 0) + 25;
                }
            }
            // 🏦 방어 흡수 + ★3 원기옥 (aave 플래시 론 — flashLoan)
            if (p.defAbsorb && p.defAbsorbTargets && p.flashLoan !== undefined) {
                const targets = (p.defAbsorbTargets - 1) + unit.star;
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, targets);
                // ★1-2: 방어력 흡수
                for (const t of selected) {
                    const absorbed = t.def * p.defAbsorb * unit.star;
                    t.def = Math.max(0, t.def - absorbed);
                    t.mdef = Math.max(0, (t.mdef ?? 0) - absorbed * 0.5);
                }
                // ★3: 원기옥 — 모든 아군 baseDmg 합산 × 10 → 최고HP 적에게 꽂기
                if (unit.star >= 3) {
                    let totalAllyDmg = 0;
                    for (const ally of boardUnits) {
                        const ad = UNIT_MAP[ally.unitId];
                        if (ad) totalAllyDmg += ad.baseDmg * STAR_MULTIPLIER[ally.star];
                    }
                    const spiritBomb = totalAllyDmg * 10;
                    const bossTarget = alive.reduce((a, b) => b.hp > a.hp ? b : a);
                    bossTarget.hp -= spiritBomb;
                }
            }
            // 🌟 제네시스 블록 (satoshi — genesisBlock: 전적 HP50% + 잡몹 즉사)
            if (p.genesisBlock) {
                // 전체 적 현재 HP의 50% 트루 데미지
                for (const m of alive) {
                    const trueDmg = m.hp * (p.hpCutPct ?? 0.50);
                    m.hp -= trueDmg;
                    // 보스 제외 즉사
                    if (!m.isBoss && p.nonBossKill) {
                        m.hp = 0;
                    }
                }
                // 전체 적 스턴
                for (const m of alive) {
                    if (!m.debuffs) m.debuffs = [];
                    m.debuffs.push({ type: 'stun', slowPct: 1.0, remaining: m.isBoss ? 1.0 : 2.0 });
                }
            }
            // 🔮 더 머지 (vitalik — theMerge: 광역 폭발 + 전아군 마나 100%)
            if (p.splashPct && p.splashTargets && p.theMerge !== undefined && !p.hpHalve) {
                const target = frontTarget;
                const splashCount = (p.splashTargets - 1) + unit.star;
                target.hp -= baseDmg * 2;
                const tPos = getPositionOnPath(target.pathProgress);
                const nearby = alive
                    .filter(m => m !== target)
                    .map(m => ({ m, d: Math.sqrt((getPositionOnPath(m.pathProgress).px - tPos.px) ** 2 + (getPositionOnPath(m.pathProgress).py - tPos.py) ** 2) }))
                    .sort((a, b) => a.d - b.d)
                    .slice(0, splashCount);
                for (const { m } of nearby) { m.hp -= baseDmg * p.splashPct; }
                // ✨ 핵심: 맵 위 모든 아군 마나 100% 충전
                for (const ally of boardUnits) {
                    if (ally === unit) continue;
                    const allyDef = UNIT_MAP[ally.unitId];
                    if (allyDef?.skill?.type === 'active') {
                        ally.currentMana = allyDef.maxMana ?? 100;
                    }
                }
            }
            // 🐋 블랙홀 (cz — blackhole: 적 흡입 + 스턴)
            // 가장 앞 적 위치로 모든 적 흡입 + 랜덤 오프셋으로 겹침 방지
            if (p.blackhole) {
                const centerTarget = frontTarget;
                const centerProgress = centerTarget.pathProgress;
                const pullStr = p.pullStrength ?? 0.60;
                const stunDur = p.stunDuration ?? 3;

                for (const m of alive) {
                    // 흡입: 가장 앞 적 위치로 강제 이동 + 랜덤 오프셋
                    const offset = (Math.random() - 0.5) * 0.03;
                    m.pathProgress = m.pathProgress + (centerProgress - m.pathProgress) * pullStr + offset;
                    // 스턴
                    if (!m.debuffs) m.debuffs = [];
                    const dur = m.isBoss ? stunDur * 0.3 : stunDur;
                    m.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: dur });
                    // 피해
                    m.hp -= baseDmg * 1.5;
                }
                // 흡입 지점 VFX
                const bhPos = getPositionOnPath(centerProgress);
                this.combat.effects.push({
                    id: this.effectIdCounter++,
                    type: 'skill_blackhole',
                    x: bhPos.px, y: bhPos.py,
                    value: Math.round(baseDmg * 1.5),
                    startTime: performance.now(),
                    duration: 1200,
                    frameIndex: 0,
                });
            }
            // 🚀 화성 로켓 (elon — marsRocket: 전체 넉백 + 아군 광분)
            if (p.marsRocket) {
                // 전체 적 넉백 (스폰 지역으로)
                const knockback = p.knockbackAll ?? 0.40;
                for (const m of alive) {
                    m.pathProgress = Math.max(0, m.pathProgress - knockback);
                    if (!m.debuffs) m.debuffs = [];
                    const stunDur = m.isBoss ? 1.0 : 2.0;
                    m.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: stunDur });
                }
                // 아군 전체 광분: 공속 대폭↑
                const frenzyMult = p.allyFrenzyAtkSpd ?? 2.0;
                for (const ally of boardUnits) {
                    ally.attackCooldown = Math.max(0, (ally.attackCooldown ?? 0) * (1 - frenzyMult * 0.3));
                }
            }
            // 📉 몹몰이 블랙홀 + 대폭발 (zhusu 슈퍼사이클 — superCycle)
            if (p.superCycle) {
                // ★ 스케일링: 범위, 딬
                const pullRange = unit.star >= 3 ? alive.length : (unit.star >= 2 ? Math.min(8, alive.length) : Math.min(4, alive.length));
                const burstDmg = unit.star >= 3 ? 3000 : (unit.star >= 2 ? 1000 : (p.burstDmg ?? 400));
                const stunDur = unit.star >= 3 ? 3 : (unit.star >= 2 ? 1.5 : 0);

                // 가장 앞 적 기준 몹몰이
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, pullRange);
                const centerProgress = selected.length > 0 ? selected[0].pathProgress : 0.5;
                for (const m of selected) {
                    // 흡입 + 랜덤 오프셋으로 겹침 방지
                    const offset = (Math.random() - 0.5) * 0.03;
                    m.pathProgress = m.pathProgress + (centerProgress - m.pathProgress) * 0.85 + offset;
                    m.hp -= burstDmg;
                    // 스턴
                    if (stunDur > 0) {
                        if (!m.debuffs) m.debuffs = [];
                        const dur = m.isBoss ? stunDur * 0.3 : stunDur;
                        m.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: dur });
                    }
                }
                // 블랙홀 VFX
                const bhPos = getPositionOnPath(centerProgress);
                this.combat.effects.push({
                    id: this.effectIdCounter++,
                    type: 'skill_blackhole',
                    x: bhPos.px, y: bhPos.py,
                    value: Math.round(burstDmg),
                    startTime: performance.now(),
                    duration: 1000,
                    frameIndex: 0,
                });
            }
            // 🪓 처형 (Rekt 청산 빔 — executeThreshold + executeManaRefund)
            // HP%가 임계 이하면 즉사 + 마나 환급 → 연쇄 살인
            if (p.executeThreshold) {
                const threshold = p.executeThreshold * (1 + (unit.star - 1) * 0.15); // ★2=23%, ★3=26%
                const manaRefund = p.executeManaRefund ?? 0.50;

                if (unit.star >= 3) {
                    // ★3: 연쇄 처형 — 모든 생존 적 스캔
                    let killCount = 0;
                    for (const m of alive) {
                        if (!m.alive) continue;
                        const hpPct = m.hp / m.maxHp;
                        if (hpPct <= threshold && !m.isBoss) {
                            // 즉사!
                            m.hp = 0;
                            killCount++;
                            // 💀 EXECUTED 이펙트
                            const mPos = getPositionOnPath(m.pathProgress);
                            this.combat.effects.push({
                                id: this.effectIdCounter++,
                                type: 'skill_execute',
                                x: mPos.px, y: mPos.py,
                                value: 0,
                                startTime: performance.now(),
                                duration: 600,
                                frameIndex: 0,
                            });
                        }
                    }
                    // 킬 1마리라도 냈으면 마나 100% 환급 (다음 턴 즉시 재시전)
                    if (killCount > 0) {
                        unit.currentMana = maxMana;
                    }
                } else {
                    // ★1~2: 단일 타겟 처형
                    const target = frontTarget;
                    const hpPct = target.hp / target.maxHp;

                    if (hpPct <= threshold && !target.isBoss) {
                        // 즉사!
                        target.hp = 0;
                        // 마나 환급 (★1=50%, ★2=75%)
                        unit.currentMana = (unit.currentMana ?? 0) + maxMana * (manaRefund * unit.star);
                        // 💀 EXECUTED 이펙트
                        const mPos = getPositionOnPath(target.pathProgress);
                        this.combat.effects.push({
                            id: this.effectIdCounter++,
                            type: 'skill_execute',
                            x: mPos.px, y: mPos.py,
                            value: 0,
                            startTime: performance.now(),
                            duration: 600,
                            frameIndex: 0,
                        });
                    } else {
                        // 처형 실패 → 일반 버스트 딜
                        target.hp -= baseDmg * 1.5;
                    }
                }
            }
            // 🎯 보스 저격 (balaji 백만불 베팅 — sniperShots)
            if (p.sniperShots) {
                // 무조건 최고HP 적 타겟
                const bossTarget = alive.reduce((a, b) => b.hp > a.hp ? b : a);
                const shots = p.sniperShots ?? 3;
                // ★ 스케일링: 딜배, 방무시
                const dmgMult = unit.star >= 3 ? 4.0 : (unit.star >= 2 ? 2.0 : (p.sniperMult ?? 1.0));
                const defIgnorePct = unit.star >= 3 ? 1.0 : (unit.star >= 2 ? 0.50 : 0.0);

                for (let i = 0; i < shots; i++) {
                    // 방어 무시 딜
                    const rawDmg = baseDmg * dmgMult;
                    const effectiveDef = bossTarget.def * (1 - defIgnorePct);
                    const finalDmg = rawDmg * (100 / (100 + effectiveDef));
                    bossTarget.hp -= finalDmg;
                }
                // ★3: 처치 시 마나 100% 페이백
                if (unit.star >= 3 && bossTarget.hp <= 0 && bossTarget.alive) {
                    unit.currentMana = maxMana;
                }
            }
            // 🔗 아군 스킬 2연속 (gavin 파라체인 — doubleCast)
            if (p.doubleCast) {
                // ★ 스케일링: 범위
                const dcRange = unit.star >= 3 ? 99 : (unit.star >= 2 ? 2 : (p.doubleCastRange ?? 1));
                const penalty = unit.star >= 3 ? 1.0 : (unit.star >= 2 ? 1.0 : (p.doubleCastPenalty ?? 0.50));

                for (const ally of boardUnits) {
                    if (ally === unit) continue;
                    if (!ally.position || !unit.position) continue;
                    const allyDef = UNIT_MAP[ally.unitId];
                    if (!allyDef?.skill || allyDef.skill.type !== 'active') continue;

                    // 범위 체크
                    const dx = Math.abs(ally.position.x - unit.position.x);
                    const dy = Math.abs(ally.position.y - unit.position.y);
                    if (dx > dcRange || dy > dcRange) continue;

                    // 즉시 마나 100% 충전 (= 다음 프레임에 스킬 발동)
                    const allyMax = allyDef.maxMana ?? 100;
                    ally.currentMana = allyMax;
                }
            }
            // 👤 체력% 이하 즉사 + ★3 연쇄처형 (rekt 청산 빔 — executeThreshold)
            if (p.executeThreshold) {
                const threshold = unit.star >= 3 ? 0.40 : (unit.star >= 2 ? 0.30 : p.executeThreshold);
                const manaRefund = unit.star >= 3 ? 1.0 : (unit.star >= 2 ? 1.0 : (p.executeManaRefund ?? 0.50));
                let killCount = 0;
                for (const m of alive) {
                    if (m.isBoss) continue;
                    if ((m.hp / m.maxHp) <= threshold) {
                        m.hp = 0;
                        killCount++;
                    }
                }
                // 처치 시 마나 회복
                if (killCount > 0) {
                    unit.currentMana = (unit.currentMana ?? 0) + maxMana * manaRefund * Math.min(killCount, 3);
                }
                // 보스에게도 baseDmg 피해  
                frontTarget.hp -= baseDmg * unit.star;
            }
            // 🧙 증폭 체인 (andre 일드 파밍 — ampChain)
            if (p.ampChain) {
                const bounces = unit.star >= 3 ? 6 : (unit.star >= 2 ? 4 : (p.ampChainTargets ?? 3));
                const ampPerBounce = unit.star >= 3 ? 0.50 : (unit.star >= 2 ? 0.30 : (p.ampChainBoost ?? 0.20));
                // 첫 타겟
                let currentTarget = frontTarget;
                let dmg = baseDmg;
                const hitTargets = new Set();
                for (let i = 0; i < bounces; i++) {
                    currentTarget.hp -= dmg;
                    hitTargets.add(currentTarget);
                    dmg *= (1 + ampPerBounce);  // 매 바운스 딜 증폭!
                    // 다음 타겟 (아직 안 맞은 적 중 가장 가까운)
                    const next = alive
                        .filter(m => !hitTargets.has(m) && m.alive)
                        .sort((a, b) => b.pathProgress - a.pathProgress)[0];
                    if (!next) {
                        // 이미 모두 맞았으면 다시 첫 타겟 (보스 잭팟)
                        currentTarget = frontTarget;
                    } else {
                        currentTarget = next;
                    }
                }
            }
            // 🐸 거리비례 관통 + ★3 반사 (gcr 빅 숏 — distancePierce)
            if (p.distancePierce) {
                const dmgPerDist = unit.star >= 3 ? 0.40 : (unit.star >= 2 ? 0.20 : (p.distanceDmgBonus ?? 0.10));
                const pierceCount = (p.pierceTargets ?? 3) + unit.star;
                const unitPos = unit.position ? getPositionOnPath(0) : { px: 0, py: 0 };

                // 뒤쪽 적부터 관통
                const targets = alive.sort((a, b) => a.pathProgress - b.pathProgress).slice(0, pierceCount);
                for (const m of targets) {
                    // 거리 기반 딜 증가 (pathProgress 차이가 클수록 보너스)
                    const distBonus = 1 + (1 - m.pathProgress) * 5 * dmgPerDist;
                    m.hp -= baseDmg * distBonus;
                }
                // ★3: 반사 빔 (돌아오며 2차 타격, 50% 딜)
                if (unit.star >= 3) {
                    for (const m of targets) {
                        const distBonus = 1 + m.pathProgress * 5 * dmgPerDist;
                        m.hp -= baseDmg * distBonus * 0.50;
                    }
                }
            }
            // 🛡️ 수수료 장사 (jessepowell — feeHustle: 성급별 버스트+골드+마나)
            if (p.feeHustle) {
                const target = frontTarget;
                const burst = unit.star >= 3 ? (p.burstDmg3 ?? 1200) : (unit.star >= 2 ? (p.burstDmg2 ?? 450) : (p.burstDmg1 ?? 200));
                const killGold = unit.star >= 3 ? (p.killGold3 ?? 2) : (p.killGold1 ?? 1);
                target.hp -= burst;
                // 킬 시 보상
                if (target.hp <= 0 && target.alive) {
                    this.combat.totalGoldEarned += killGold;
                    // ★2+: 마나 30 페이백 / ★3: 마나 100% 페이백
                    if (unit.star >= 3) {
                        unit.currentMana = maxMana;
                    } else if (unit.star >= 2) {
                        unit.currentMana = (unit.currentMana ?? 0) + 30;
                    }
                }
            }
            // 🥷 하이퍼캐리 (wonyotti 풀시드 롱 — hyperCarry)
            if (p.bestAllyAtkSpdBuff && p.hyperCarry !== undefined) {
                const spdBuff = unit.star >= 3 ? 1.50 : (unit.star >= 2 ? 0.80 : p.bestAllyAtkSpdBuff);
                // 가장 공격력 높은 아군 찾기
                let bestAlly: UnitInstance | null = null;
                let bestDmg = 0;
                for (const ally of boardUnits) {
                    if (ally === unit) continue;
                    const ad = UNIT_MAP[ally.unitId];
                    if (!ad || !ally.position) continue;
                    const d = ad.baseDmg * STAR_MULTIPLIER[ally.star];
                    if (d > bestDmg) { bestDmg = d; bestAlly = ally; }
                }
                if (bestAlly) {
                    bestAlly.attackCooldown = Math.max(0, (bestAlly.attackCooldown ?? 0) * (1 - spdBuff));
                }
            }
            // 📉 빙결 + 쇄빙 (hsaka 크립토 윈터 — shatterExplode)
            if (p.freezeTargets && p.freezeDuration && p.frozenBonusDmg !== undefined && p.shatterExplode !== undefined) {
                const targets = unit.star >= 3 ? Math.min(alive.length, 5) : (unit.star >= 2 ? 3 : p.freezeTargets);
                const dur = unit.star >= 2 ? 3 : p.freezeDuration;
                const bonusDmg = unit.star >= 2 ? 0.40 : p.frozenBonusDmg;
                const selected = alive.sort((a, b) => b.pathProgress - a.pathProgress).slice(0, targets);
                for (const t of selected) {
                    if (!t.debuffs) t.debuffs = [];
                    const bossDur = t.isBoss ? dur * 0.3 : dur;
                    t.debuffs.push({ type: 'freeze', slowPct: p.freezeSlow ?? 0.90, remaining: bossDur });
                    // 빙결 적 추가 피해
                    t.hp -= baseDmg * bonusDmg;
                }
            }
            // 아군 사거리+1 (Armstrong — rangeBonus + buffDuration)
            if (p.rangeBonus && p.buffDuration) {
                // 랜덤 아군 사거리 버프 (간단 구현: 즉시 보너스 반영 안 함, 패시브 오라로 처리)
            }

            // ═══════════════════════════════════════════════
            // 증강 후처리: 스킬 발동 후 적용되는 증강 효과들
            // ═══════════════════════════════════════════════

            // 👁️ ZK 증명: 스킬 데미지에 크리 적용
            if (augSet.has('aug_zk_proof')) {
                const critChance = this.buffs?.critChance ?? 0.10;
                if (Math.random() < critChance) {
                    const critMult = (this.buffs?.critDmgMultiplier ?? 1.5);
                    // 가장 앞 적에게 크리 보너스 딜
                    if (frontTarget.alive) {
                        frontTarget.hp -= baseDmg * (critMult - 1);
                    }
                }
            }

            // 🩸 연쇄 청산: 스킬로 적 처치 시 시체 폭발 + 마나 50%
            if (augSet.has('aug_chain_liquidation')) {
                const nowDead = alive.filter(m => m.hp <= 0 && m.alive);
                for (const corpse of nowDead) {
                    // 시체 폭발: 주변 적에게 200 딜
                    const cPos = getPositionOnPath(corpse.pathProgress);
                    for (const m of alive) {
                        if (m === corpse || m.hp <= 0) continue;
                        const dist = Math.abs(m.pathProgress - corpse.pathProgress);
                        if (dist < 0.15) { // 반경 내
                            m.hp -= 200;
                        }
                    }
                }
                if (nowDead.length > 0) {
                    // 마나 50% 회복
                    unit.currentMana = (unit.currentMana ?? 0) + maxMana * 0.50;
                }
            }

            // 📈 숏 스퀴즈: 체력 30% 이하 보스에게 스킬 즉사
            if (augSet.has('aug_short_squeeze')) {
                for (const m of alive) {
                    if (m.isBoss && m.hp > 0 && (m.hp / m.maxHp) <= 0.30) {
                        m.hp = 0; // 보스 즉사!
                    }
                }
            }

            // 🌩️ 라이트닝 네트워크: 체인이 있었다면 추가 단일 집중 딜
            if (augSet.has('aug_lightning_network') && (p.chainTargets || p.ampChainTargets)) {
                const focusCount = p.chainTargets ?? p.ampChainTargets ?? 3;
                const focusDmg = baseDmg * 0.5 * focusCount; // 튕길 횟수 × 50%를 단일 집중
                frontTarget.hp -= focusDmg;
            }

            // 🔱 하드 포크: 단일 타겟 스킬 → 추가 2명에게 70% 딜
            if (augSet.has('aug_hard_fork')) {
                // 단일 타겟 스킬인지 판별 (splash/chain/pierce가 아닌 스킬)
                const isSingleTarget = !p.splashTargets && !p.chainTargets && !p.pierceTargets && !p.ampChainTargets && !p.freezeTargets && !p.stunTargets;
                if (isSingleTarget) {
                    const others = alive.filter(m => m !== frontTarget && m.alive).slice(0, 2);
                    for (const m of others) {
                        m.hp -= baseDmg * 0.70;
                    }
                }
            }

            // 🐈 데드캣 바운스: 관통 스킬에 반사 보너스 딜
            if (augSet.has('aug_dead_cat') && p.pierceTargets) {
                // 관통 스킬의 타겟들에게 50% 추가 반사 딜
                const reflectTargets = alive.slice(0, p.pierceTargets);
                for (const m of reflectTargets) {
                    m.hp -= baseDmg * 0.50;
                }
            }
        }
    }

    /** 유닛 공격 처리 (시너지 버프 + 스킬 적용) */
    private processAttacks(boardUnits: UnitInstance[], dt: number): void {
        const buffs = this.buffs;

        for (const unit of boardUnits) {
            if (!unit.position) continue;
            const def = UNIT_MAP[unit.unitId];
            if (!def) continue;
            const skill = def.skill;

            // 쿨다운 감소
            const cd = unit.attackCooldown ?? 0;
            unit.attackCooldown = Math.max(0, cd - dt);
            if (unit.attackCooldown! > 0) continue;

            // ── passive 스킬: 사거리 보정 ──
            let range = def.attackRange ?? DEFAULT_RANGE;
            if (skill?.type === 'passive' && skill.params.rangeBonus) {
                range += skill.params.rangeBonus;
            }

            // ── 타겟팅 (GCR 역매매: 가장 뒤에 있는 적, ZachXBT: HP 높은 적) ──
            let target: Monster | null = null;

            if (skill?.type === 'passive' && skill.params.dmgBonus && def.id === 'gcr') {
                // GCR: 가장 덜 진행된 적
                let worstProgress = 2;
                for (const m of this.combat.monsters) {
                    if (!m.alive) continue;
                    const pos = getPositionOnPath(m.pathProgress);
                    const dist = this.distToMonster(unit.position.x, unit.position.y, pos.px, pos.py);
                    if (dist <= range && m.pathProgress < worstProgress) {
                        target = m;
                        worstProgress = m.pathProgress;
                    }
                }
            } else if (skill?.type === 'passive' && skill.params.dmgBonus && def.id === 'zachxbt') {
                // ZachXBT: HP 가장 높은 적
                let bestHp = -1;
                for (const m of this.combat.monsters) {
                    if (!m.alive) continue;
                    const pos = getPositionOnPath(m.pathProgress);
                    const dist = this.distToMonster(unit.position.x, unit.position.y, pos.px, pos.py);
                    if (dist <= range && m.hp > bestHp) {
                        target = m;
                        bestHp = m.hp;
                    }
                }
            } else {
                // 기본: 가장 많이 진행된 적
                let bestProgress = -1;
                for (const m of this.combat.monsters) {
                    if (!m.alive) continue;
                    const pos = getPositionOnPath(m.pathProgress);
                    const dist = this.distToMonster(unit.position.x, unit.position.y, pos.px, pos.py);
                    if (dist <= range && m.pathProgress > bestProgress) {
                        target = m;
                        bestProgress = m.pathProgress;
                    }
                }
            }

            if (target) {
                // ── 데미지 계산 ──
                const starMult = STAR_MULTIPLIER[unit.star];
                let dmg = def.baseDmg * starMult;

                // ── 공격 카운트 (nthHit 판정용) ──
                unit.attackCount = (unit.attackCount ?? 0) + 1;

                // passive 스킬 DMG 보정
                if (skill?.type === 'passive') {
                    const sp = skill.params;
                    // selfDmgPct (HODLer + ★보너스)
                    if (sp.selfDmgPct) dmg *= (1 + sp.selfDmgPct + (sp.starBonus ?? 0) * unit.star);
                    // dmgBonus (GCR, ZachXBT)
                    if (sp.dmgBonus) dmg *= (1 + sp.dmgBonus);
                    // bossDmgPct (Willy Woo)
                    if (sp.bossDmgPct && target.isBoss) dmg *= (1 + sp.bossDmgPct);
                    // dmgMult
                    if (sp.dmgMult) dmg *= sp.dmgMult;
                    // dmgPenalty
                    if (sp.dmgPenalty) dmg *= (1 - sp.dmgPenalty);
                    // dmgPerEnemy (Jeff)
                    if (sp.dmgPerEnemy) {
                        const enemyCount = this.combat.monsters.filter(m => m.alive).length;
                        dmg *= (1 + sp.dmgPerEnemy * enemyCount);
                    }
                    // critBonus (기존) — 추가 크리확률
                    if (sp.critBonus && Math.random() < sp.critBonus) {
                        dmg *= (2.0 + (sp.critDmgBonus ?? 0));
                        if (sp.stunSec) target.speed *= 0.1;
                    }
                    // firstHitMult (Tetranode)
                    if (sp.firstHitMult && !unit.skillActive) {
                        dmg *= sp.firstHitMult;
                        unit.skillActive = true;
                    }
                    // killsPerStack + dmgPerStack (Anthropic)
                    if (sp.killsPerStack && sp.dmgPerStack) {
                        dmg *= (1 + (unit.skillStacks ?? 0) * sp.dmgPerStack);
                    }
                    // maxHpPct (Rekt — 최대HP 비례 추가 데미지)
                    if (sp.maxHpPct) {
                        dmg += target.maxHp * sp.maxHpPct;
                    }
                    // ── nthHit 판정: N번째 공격마다 특수효과 ──
                    const isNthHit = sp.nthHit && (unit.attackCount! % sp.nthHit === 0);
                    if (isNthHit) {
                        // burstMult (Hayes, PI User — N번째 강타)
                        if (sp.burstMult) dmg *= sp.burstMult;
                        // stunDuration (Lazarus, Anatoly, Peter Schiff — N번째 스턴)
                        if (sp.stunDuration) {
                            const stunDur = target.isBoss ? (sp.bossStunDuration ?? sp.stunDuration * 0.3) : sp.stunDuration;
                            if (!target.debuffs) target.debuffs = [];
                            target.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: stunDur });
                        }
                        // critStunDuration (Coplan — 크리 시 스턴)
                        if (sp.critStunDuration) {
                            dmg *= 2.0;
                            const stunDur = target.isBoss ? (sp.bossCritStunDuration ?? sp.critStunDuration * 0.3) : sp.critStunDuration;
                            if (!target.debuffs) target.debuffs = [];
                            target.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: stunDur });
                        }
                        // nthHit 크리 확정 (Simon, HODLer — nthHit만 있고 다른 효과 없음)
                        if (!sp.burstMult && !sp.stunDuration && !sp.critStunDuration && !sp.chainTargets && !sp.splashPct && !sp.slowPct) {
                            dmg *= 2.0; // guaranteed crit
                        }
                        // nthHit 체인 (Jack Dorsey, Jesse Pollak, Andre, Scam Dev)
                        if (sp.chainTargets && sp.chainPct) {
                            const tPos = getPositionOnPath(target.pathProgress);
                            const nearby = this.combat.monsters
                                .filter(m => m.alive && m !== target)
                                .map(m => ({ m, d: Math.sqrt((getPositionOnPath(m.pathProgress).px - tPos.px) ** 2 + (getPositionOnPath(m.pathProgress).py - tPos.py) ** 2) }))
                                .sort((a, b) => a.d - b.d)
                                .slice(0, sp.chainTargets);
                            for (const { m } of nearby) {
                                m.hp -= dmg * sp.chainPct;
                            }
                        }
                        // nthHit 광역 (Wintermute)
                        if (sp.splashPct && !sp.chainTargets) {
                            const tPos = getPositionOnPath(target.pathProgress);
                            for (const m of this.combat.monsters) {
                                if (!m.alive || m === target) continue;
                                const mPos = getPositionOnPath(m.pathProgress);
                                const d = Math.sqrt((mPos.px - tPos.px) ** 2 + (mPos.py - tPos.py) ** 2);
                                if (d <= 2.0) m.hp -= dmg * sp.splashPct;
                            }
                        }
                        // nthHit 슬로우 (Scam Dev, Kashkari — slowPct + slowDuration)
                        if (sp.slowPct) {
                            const dur = sp.slowDuration ?? 2;
                            if (!target.debuffs) target.debuffs = [];
                            target.debuffs.push({ type: 'slow', slowPct: sp.slowPct, remaining: dur });
                            // 주변 적에게도 슬로우 (Kashkari — slowTargets)
                            if (sp.slowTargets) {
                                const tPos = getPositionOnPath(target.pathProgress);
                                const nearby = this.combat.monsters
                                    .filter(m => m.alive && m !== target)
                                    .map(m => ({ m, d: Math.sqrt((getPositionOnPath(m.pathProgress).px - tPos.px) ** 2 + (getPositionOnPath(m.pathProgress).py - tPos.py) ** 2) }))
                                    .sort((a, b) => a.d - b.d)
                                    .slice(0, sp.slowTargets);
                                for (const { m } of nearby) {
                                    if (!m.debuffs) m.debuffs = [];
                                    m.debuffs.push({ type: 'slow', slowPct: sp.slowPct, remaining: dur });
                                }
                            }
                        }
                        // nthHit 빙결 (Justin Sun, Andrew Kang, Hsaka, Jim Cramer — freezeDuration)
                        if (sp.freezeDuration) {
                            const slowFactor = sp.freezeSlow ?? 0.15;
                            // 대상에게 빙결
                            const dur = target.isBoss ? (sp.bossFreezeDuration ?? sp.freezeDuration * 0.3) : sp.freezeDuration;
                            if (!target.debuffs) target.debuffs = [];
                            target.debuffs.push({ type: 'freeze', slowPct: slowFactor, remaining: dur });
                            // 빙결 이펙트
                            const tPos = getPositionOnPath(target.pathProgress);
                            this.combat.effects.push({
                                id: this.effectIdCounter++,
                                type: 'freeze',
                                x: tPos.px, y: tPos.py,
                                value: 0,
                                startTime: performance.now(),
                                duration: dur * 1000,
                                frameIndex: 0,
                            });
                            // 주변 적에게도 빙결 (광역 빙결 — freezeSlow가 낮으면 주변도 적용)
                            if (sp.freezeSlow && sp.freezeSlow <= 0.20) {
                                const nearby = this.combat.monsters
                                    .filter(m => m.alive && m !== target)
                                    .map(m => ({ m, d: Math.sqrt((getPositionOnPath(m.pathProgress).px - tPos.px) ** 2 + (getPositionOnPath(m.pathProgress).py - tPos.py) ** 2) }))
                                    .filter(({ d }) => d <= 2.5);
                                for (const { m } of nearby) {
                                    const mDur = m.isBoss ? (sp.bossFreezeDuration ?? sp.freezeDuration * 0.3) : sp.freezeDuration;
                                    if (!m.debuffs) m.debuffs = [];
                                    m.debuffs.push({ type: 'freeze', slowPct: slowFactor, remaining: mDur });
                                    const mPos = getPositionOnPath(m.pathProgress);
                                    this.combat.effects.push({
                                        id: this.effectIdCounter++,
                                        type: 'freeze',
                                        x: mPos.px, y: mPos.py,
                                        value: 0,
                                        startTime: performance.now(),
                                        duration: mDur * 1000,
                                        frameIndex: 0,
                                    });
                                }
                            }
                        }
                        // nthHit 방어 깎기 (Do Kwon — defShred)
                        if (sp.defShred) {
                            target.def = Math.max(0, target.def - sp.defShred);
                        }
                    }
                    // ── 상시 패시브: 관통 (Saylor, GCR, PerpDEX, Daniele — pierceTargets) ──
                    if (sp.pierceTargets && sp.piercePct && !sp.nthHit) {
                        const sorted = this.combat.monsters
                            .filter(m => m.alive && m !== target)
                            .sort((a, b) => a.pathProgress - b.pathProgress); // 뒤쪽 적 우선
                        for (let i = 0; i < sp.pierceTargets && i < sorted.length; i++) {
                            sorted[i].hp -= dmg * sp.piercePct;
                        }
                    }
                    // Jeff 적 많으면 관통 (pierceThreshold1, pierceThreshold2)
                    if (sp.pierceThreshold1) {
                        const enemyCount = this.combat.monsters.filter(m => m.alive).length;
                        let pierceCount = 0;
                        if (enemyCount >= (sp.pierceThreshold2 ?? 999)) pierceCount = 2;
                        else if (enemyCount >= sp.pierceThreshold1) pierceCount = 1;
                        if (pierceCount > 0) {
                            const sorted = this.combat.monsters
                                .filter(m => m.alive && m !== target)
                                .sort((a, b) => b.pathProgress - a.pathProgress);
                            for (let i = 0; i < pierceCount && i < sorted.length; i++) {
                                sorted[i].hp -= dmg * 0.70;
                            }
                        }
                    }
                    // Hayes delayMs (3번째 강타 후 딜레이)
                    if (sp.delayMs && isNthHit) {
                        unit.attackCooldown = (unit.attackCooldown ?? 0) + sp.delayMs / 1000;
                    }
                }

                // Saylor 영구 누적 적용
                if (skill?.type === 'periodic' && skill.params.selfDmgPct && !skill.params.buffDuration) {
                    dmg *= (1 + (unit.skillStacks ?? 0) * skill.params.selfDmgPct);
                }

                // Lazarus 영구 누적 적용
                if (skill?.type === 'onKill' && skill.params.selfDmgPct) {
                    const maxPct = skill.params.maxPct ?? 1.0;
                    const stacks = Math.min((unit.skillStacks ?? 0) * skill.params.selfDmgPct, maxPct);
                    dmg *= (1 + stacks);
                }

                // 시너지 버프 적용
                if (buffs) {
                    dmg *= buffs.dmgMultiplier;
                    dmg += buffs.flatDmgBonus;
                    if (target.isBoss) dmg *= buffs.singleTargetMultiplier;
                    if (Math.random() < buffs.doubleHitChance) dmg *= 1.5;
                    if (Math.random() < buffs.critChance) dmg *= 2.0;
                    if (Math.random() < buffs.stunChance) {
                        if (!target.debuffs) target.debuffs = [];
                        target.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: 0.5 });
                    }
                }

                // ── DEF/MDEF 비율 감소 적용 (LoL식: DMG × 100 / (100 + effectiveDef)) ──
                const unitDmgType = def.dmgType ?? 'physical';
                let rawArmor: number;
                if (this._adaptiveDmg) {
                    // 적응형 관통: 물방/마방 중 낮은 값 사용
                    rawArmor = Math.min(target.def, target.mdef);
                } else {
                    rawArmor = unitDmgType === 'physical' ? target.def : target.mdef;
                }
                const armorIgnore = buffs?.armorIgnore ?? 0;
                const effectiveArmor = rawArmor * (1 - armorIgnore);
                if (effectiveArmor > 0) {
                    dmg = dmg * 100 / (100 + effectiveArmor);
                }

                // ── onHit 스킬 ──
                if (skill?.type === 'onHit') {
                    const chance = skill.chance ?? 1.0;
                    if (Math.random() < chance) {
                        const sp = skill.params;
                        // 슬로우 (Gareth, FUD유포자, DoKwon)
                        if (sp.slowPct) {
                            const dur = sp.slowDuration ?? 2;
                            if (!target.debuffs) target.debuffs = [];
                            target.debuffs.push({ type: 'slow', slowPct: sp.slowPct, remaining: dur });
                        }
                        // 확률 DMG배수 (PerpDEX, Hayes)
                        if (sp.dmgMult) dmg *= sp.dmgMult;
                        if (sp.critMultiplier && buffs && Math.random() < buffs.critChance) dmg *= sp.critMultiplier;
                        // HP 비례 추가 DMG (Zhu Su, Rekt, 국장)
                        if (sp.hpPctDmg) dmg += target.maxHp * sp.hpPctDmg;
                        if (sp.maxHpPct) dmg += target.maxHp * sp.maxHpPct;
                        // 공매도 Hsaka: HP 50% 이하일 때 DMG 2배
                        if (sp.hpThreshold && target.hp / target.maxHp < sp.hpThreshold) {
                            dmg *= (sp.dmgMult ?? 2.0);
                        }
                        // 스턴 (Albanese)
                        if (sp.stunSec) {
                            if (!target.debuffs) target.debuffs = [];
                            target.debuffs.push({ type: 'stun', slowPct: 0.95, remaining: sp.stunSec });
                        }
                        // 누적 팀 DMG (Jesse Powell)
                        if (sp.flatDmg && sp.maxStacks) {
                            const stacks = unit.skillStacks ?? 0;
                            if (stacks < sp.maxStacks) {
                                unit.skillStacks = stacks + 1;
                            }
                            dmg += (unit.skillStacks ?? 0) * sp.flatDmg;
                        }
                        // 스플래시 (Andre Flash Loan)
                        if (sp.splashPct) {
                            const targetPos = getPositionOnPath(target.pathProgress);
                            let splashHit = 0;
                            for (const m of this.combat.monsters) {
                                if (!m.alive || m === target) continue;
                                if (splashHit >= (sp.splashTargets ?? 2)) break;
                                const mPos = getPositionOnPath(m.pathProgress);
                                const d = Math.sqrt((mPos.px - targetPos.px) ** 2 + (mPos.py - targetPos.py) ** 2);
                                if (d <= 2.0) {
                                    m.hp -= dmg * sp.splashPct;
                                    splashHit++;
                                }
                            }
                        }
                        // 관통 (pierceTargets + piercePct)
                        if (sp.pierceTargets && sp.piercePct) {
                            const sorted = this.combat.monsters
                                .filter(m => m.alive && m !== target)
                                .sort((a, b) => b.pathProgress - a.pathProgress);
                            for (let i = 0; i < sp.pierceTargets && i < sorted.length; i++) {
                                sorted[i].hp -= dmg * sp.piercePct;
                            }
                        }
                        // ⚡ 체인 (chainTargets + chainPct: 연쇄 튕김)
                        if (sp.chainTargets && sp.chainPct) {
                            let curTarget = target;
                            let curDmg = dmg * sp.chainPct;
                            const hitChain = new Set<Monster>();
                            hitChain.add(target);

                            for (let b = 0; b < sp.chainTargets; b++) {
                                const cPos = getPositionOnPath(curTarget.pathProgress);
                                let next: Monster | null = null;
                                let best = Infinity;
                                for (const m of this.combat.monsters) {
                                    if (!m.alive || hitChain.has(m)) continue;
                                    const mP = getPositionOnPath(m.pathProgress);
                                    const d = Math.sqrt((mP.px - cPos.px) ** 2 + (mP.py - cPos.py) ** 2);
                                    if (d <= 3.0 && d < best) { best = d; next = m; }
                                }
                                if (!next) break;
                                curDmg *= 1.1; // 평타 체인: 10% 증폭
                                next.hp -= curDmg;
                                hitChain.add(next);
                                curTarget = next;
                            }
                        }
                        // DoT (dotPct + dotDuration: 초당 baseDmg의 n% 지속피해)
                        if (sp.dotPct && sp.dotDuration) {
                            const dotDps = dmg * sp.dotPct;
                            if (!target.dots) target.dots = [];
                            target.dots.push({ dps: dotDps, remaining: sp.dotDuration });
                        }
                        // 그림자 공격 (WCT 더블히트)
                        if (sp.extraHits) {
                            target.hp -= dmg * sp.extraHits;
                        }
                        // Craig Wright 사기꾼: miss → 다음 공격 ×3
                        if (sp.nextHitMult) {
                            if (unit.skillActive) {
                                dmg *= sp.nextHitMult;
                                unit.skillActive = false;
                            } else {
                                dmg = 0; // miss
                                unit.skillActive = true;
                            }
                        }
                    }
                }

                // 크리티컬 판정
                const isCrit = dmg > def.baseDmg * STAR_MULTIPLIER[unit.star] * 1.8;

                // 데미지 적용 (오버킬 방지 + 유닛별 누적 추적)
                applyDamage(target, dmg, unit);

                // ── 공격 애니메이션 트리거 ──
                unit.lastAttackTime = performance.now();
                const attackTargetPos = getPositionOnPath(target.pathProgress);
                unit.lastTargetX = attackTargetPos.px;

                // 💧 평타 마나 회복 (+DeFi 시너지 보너스 + 증강 효과)
                if (UNIT_MAP[unit.unitId]?.skill?.type === 'active') {
                    const unitDef = UNIT_MAP[unit.unitId]!;
                    const unitMaxMana = unitDef.maxMana ?? 100;
                    const manaBonus = this.buffs?.manaRegenBonus ?? 0;
                    const augs = this._augments;
                    // ⛏️ 작업 증명: 평타 마나 = 최대마나의 15%
                    let hitMana = augs?.has('aug_pow') ? unitMaxMana * 0.15 : 10;
                    hitMana += manaBonus;
                    // ❄️ 크립토 윈터: CC 걸린 적 타격 시 마나 2배
                    if (augs?.has('aug_crypto_winter') && target.debuffs?.some(d => d.type === 'stun' || d.type === 'freeze' || d.type === 'slow')) {
                        hitMana *= 2;
                    }
                    unit.currentMana = (unit.currentMana ?? 0) + hitMana;
                }

                // 투사체 + 피격 이펙트
                if (dmg > 0 && unit.position) {
                    const tPos = getPositionOnPath(target.pathProgress);
                    this.combat.projectiles.push({
                        fromX: unit.position.x,
                        fromY: unit.position.y,
                        toX: tPos.px,
                        toY: tPos.py,
                        startTime: performance.now(),
                        duration: 150,
                    });
                    target.hitTime = performance.now();

                    // ── 이펙트 생성 (Unity: type → VFX Prefab) ──
                    this.combat.effects.push({
                        id: this.effectIdCounter++,
                        type: isCrit ? 'crit' : 'damage',
                        x: tPos.px,
                        y: tPos.py,
                        value: Math.round(dmg),
                        startTime: performance.now(),
                        duration: isCrit ? 900 : 600,
                        frameIndex: isCrit ? Math.floor(Math.random() * 8) : Math.floor(Math.random() * 6),
                    });
                }

                // ── 킬 체크 + onKill 스킬 ──
                if (target.hp <= 0 && target.alive) {
                    // 💧 킬 마나 회복 +30 (막타 유닛)
                    if (UNIT_MAP[unit.unitId]?.skill?.type === 'active') {
                        unit.currentMana = (unit.currentMana ?? 0) + 30;
                    }
                    // Anthropic 킬 카운트
                    const anthropicSkill = def.skill;
                    if (anthropicSkill?.type === 'passive' && anthropicSkill.params.killsPerStack) {
                        unit.skillStacks = (unit.skillStacks ?? 0) + 1;
                    }
                    // Jesse Powell killsPerGold: 매 N킬마다 골드+1
                    if (skill?.type === 'passive' && skill.params.killsPerGold) {
                        const killCount = (unit.skillStacks ?? 0) + 1;
                        unit.skillStacks = killCount;
                        if (killCount % skill.params.killsPerGold === 0) {
                            this.combat.totalGoldEarned += 1;
                        }
                    }

                    if (skill?.type === 'onKill') {
                        const chance = skill.chance ?? 1.0;
                        if (Math.random() < chance) {
                            const sp = skill.params;
                            // 골드 보너스
                            if (sp.gold) this.combat.totalGoldEarned += sp.gold;
                            // 골드 배수
                            if (sp.goldMult) this.combat.totalGoldEarned += target.goldReward * (sp.goldMult - 1);
                            // Lazarus 영구 DMG 누적
                            if (sp.selfDmgPct) unit.skillStacks = (unit.skillStacks ?? 0) + 1;
                            // Kyle Davies 청산 도미노
                            if (sp.explosionPct && sp.range) {
                                const tPos = getPositionOnPath(target.pathProgress);
                                for (const m of this.combat.monsters) {
                                    if (!m.alive || m === target) continue;
                                    const mPos = getPositionOnPath(m.pathProgress);
                                    const d = Math.sqrt((mPos.px - tPos.px) ** 2 + (mPos.py - tPos.py) ** 2);
                                    if (d <= sp.range) {
                                        m.hp -= target.maxHp * sp.explosionPct;
                                    }
                                }
                            }
                        }
                    }
                }

                // 시너지 스플래시
                if (buffs && buffs.splashDmg > 0 && Math.random() < buffs.splashDmg) {
                    const splashRange = 1.5;
                    const targetPos = getPositionOnPath(target.pathProgress);
                    for (const m of this.combat.monsters) {
                        if (!m.alive || m === target) continue;
                        const mPos = getPositionOnPath(m.pathProgress);
                        const d = Math.sqrt((mPos.px - targetPos.px) ** 2 + (mPos.py - targetPos.py) ** 2);
                        if (d <= splashRange) {
                            m.hp -= dmg * 0.5;
                        }
                    }
                }

                // ── 쿨다운 설정 (공속 버프 + passive 스킬 적용) ──
                let baseAtkSpd = def.attackSpeed ?? DEFAULT_ATTACK_SPEED;
                if (skill?.type === 'passive') {
                    if (skill.params.atkSpdBonus) baseAtkSpd *= (1 + skill.params.atkSpdBonus);
                    if (skill.params.atkSpdMult) baseAtkSpd *= skill.params.atkSpdMult;
                }
                // ── 주변 아군 atkSpdBuff 오라 적용 (Stani, Hayden, PC Miner) ──
                for (const ally of boardUnits) {
                    if (ally === unit || !ally.position) continue;
                    const allyDef = UNIT_MAP[ally.unitId];
                    if (!allyDef?.skill || allyDef.skill.type !== 'passive') continue;
                    const asp = allyDef.skill.params;
                    if (!asp.atkSpdBuff || !asp.buffRange) continue;
                    // 거리 체크
                    const dx = Math.abs(unit.position!.x - ally.position.x);
                    const dy = Math.abs(unit.position!.y - ally.position.y);
                    if (dx <= asp.buffRange && dy <= asp.buffRange) {
                        baseAtkSpd *= (1 + asp.atkSpdBuff);
                    }
                }
                const atkSpd = baseAtkSpd * (buffs?.atkSpeedMultiplier ?? 1.0);
                unit.attackCooldown = 1 / atkSpd;
            }
        }
    }

    getCombat(): CombatState { return this.combat; }
}

// ─── Result Type ────────────────────────────────────────────

export interface CombatResult {
    won: boolean;
    kills: number;
    goldEarned: number;
    damage: number;      // 통과 피해
    elapsedTime: number;
    grade: 'S' | 'A' | 'B' | 'F';
    bonusGold: number;   // 등급 보너스 골드
}
