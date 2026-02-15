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

// ─── 경로 계산 ──────────────────────────────────────────────
//
// 반시계: (0,0)→(0,3)→(6,3)→(6,0)→(0,0)
// 경로 = 테두리 셀 좌표들 (총 둘레 = 2*(7+4)-4 = 18칸)
//

/** 반시계 방향 테두리 경로 (그리드 셀 좌표, 바깥 링) */
function buildPerimeterPath(): PathPoint[] {
    const path: PathPoint[] = [];

    // 1) 좌측: (0,0) → (0,3) — 아래로 (x=-0.5 기준, 보드 왼쪽 바깥)
    for (let y = 0; y <= BOARD_H; y++) {
        path.push({ px: -0.7, py: y - 0.5 });
    }
    // 2) 하단: (0,3) → (6,3) — 오른쪽 (보드 아래 바깥)
    for (let x = 0; x <= BOARD_W; x++) {
        path.push({ px: x - 0.5, py: BOARD_H - 0.3 });
    }
    // 3) 우측: (6,3) → (6,0) — 위로
    for (let y = BOARD_H; y >= 0; y--) {
        path.push({ px: BOARD_W - 0.3, py: y - 0.5 });
    }
    // 4) 상단: (6,0) → (0,0) — 왼쪽
    for (let x = BOARD_W; x >= 0; x--) {
        path.push({ px: x - 0.5, py: -0.7 });
    }

    return path;
}

export const PERIMETER_PATH = buildPerimeterPath();
export const PATH_LENGTH = PERIMETER_PATH.length - 1; // 보간에 사용

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

            // 5) 죽은 몬스터 정리 + 사망 이펙트
            for (const m of this.combat.monsters) {
                if (m.alive && m.hp <= 0) {
                    m.alive = false;
                    this.combat.totalKills++;
                    this.combat.totalGoldEarned += m.goldReward + (this.buffs?.bonusKillGold ?? 0);
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
                // 보스: 120초 돌파 시 HP-5, 이후 5초마다 HP-3
                if (this.combat.elapsedTime >= 120) {
                    const overtime = this.combat.elapsedTime - 120;
                    const prevOvertime = overtime - dt;
                    // 120초 돌파 순간: HP -5
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
                // 일반: 60초 돌파 시 HP-1, 이후 5초마다 HP-1
                if (this.combat.elapsedTime >= 60) {
                    const overtime = this.combat.elapsedTime - 60;
                    const prevOvertime = overtime - dt;
                    // 60초 돌파 순간: HP -1
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
        });
        this.combat.spawnQueue--;
    }

    /** active 스킬 타이머 처리 (쿨다운 자동 시전) */
    private processActiveSkills(boardUnits: UnitInstance[], dt: number, player: PlayerState): void {
        for (const unit of boardUnits) {
            if (!unit.position) continue;
            const def = UNIT_MAP[unit.unitId];
            if (!def?.skill || def.skill.type !== 'active') continue;
            const s = def.skill;
            const cd = s.cooldown ?? 5;

            unit.skillTimer = (unit.skillTimer ?? 0) + dt;
            if (unit.skillTimer < cd) continue;
            unit.skillTimer -= cd;

            const p = s.params;
            const starMult = STAR_MULTIPLIER[unit.star];
            const baseDmg = def.baseDmg * starMult;

            // 타겟 선택 (가장 앞 적, 또는 최대HP 적)
            const alive = this.combat.monsters.filter(m => m.alive);
            if (alive.length === 0) continue;
            const frontTarget = alive.reduce((a, b) => b.pathProgress > a.pathProgress ? b : a);
            const hpTarget = alive.reduce((a, b) => b.hp > a.hp ? b : a);

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
            // 체인 (Vitalik 이더 번개, Marc — chainTargets + chainPct)
            if (p.chainTargets && p.chainPct && !p.pierceTargets) {
                const target = frontTarget;
                target.hp -= baseDmg;
                const tPos = getPositionOnPath(target.pathProgress);
                const nearby = alive
                    .filter(m => m !== target)
                    .map(m => ({ m, d: Math.sqrt((getPositionOnPath(m.pathProgress).px - tPos.px) ** 2 + (getPositionOnPath(m.pathProgress).py - tPos.py) ** 2) }))
                    .sort((a, b) => a.d - b.d)
                    .slice(0, p.chainTargets);
                for (const { m } of nearby) {
                    m.hp -= baseDmg * p.chainPct;
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
                unit.attackCooldown = Math.max(0, (unit.attackCooldown ?? 0) * (1 - p.atkSpdBuff));
            }
            // 아군 사거리+1 (Armstrong — rangeBonus + buffDuration)
            if (p.rangeBonus && p.buffDuration) {
                // 랜덤 아군 사거리 버프 (간단 구현: 즉시 보너스 반영 안 함, 패시브 오라로 처리)
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
                    const dx = pos.px - unit.position.x;
                    const dy = pos.py - unit.position.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
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
                    const dx = pos.px - unit.position.x;
                    const dy = pos.py - unit.position.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
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
                    const dx = pos.px - unit.position.x;
                    const dy = pos.py - unit.position.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
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

                // ── DEF/MDEF 감쇠 적용 ──
                const unitDmgType = def.dmgType ?? 'physical';
                const armor = unitDmgType === 'physical' ? target.def : target.mdef;
                if (armor > 0) {
                    dmg = dmg * 100 / (100 + armor);
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
                        // 체인 (chainTargets + chainPct: 근처 적에게 번짐)
                        if (sp.chainTargets && sp.chainPct) {
                            const targetPos = getPositionOnPath(target.pathProgress);
                            const nearby = this.combat.monsters
                                .filter(m => m.alive && m !== target)
                                .map(m => ({ m, d: Math.sqrt((getPositionOnPath(m.pathProgress).px - targetPos.px) ** 2 + (getPositionOnPath(m.pathProgress).py - targetPos.py) ** 2) }))
                                .sort((a, b) => a.d - b.d)
                                .slice(0, sp.chainTargets);
                            for (const { m } of nearby) {
                                if (m.alive) m.hp -= dmg * sp.chainPct;
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

                // 데미지 적용
                target.hp -= dmg;

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
