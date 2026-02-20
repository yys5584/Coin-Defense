// ============================================================
// ShopSystem — TFT식 상점 로직
// 확률 기반 5택, 리롤, 구매, 판매
// ============================================================

import { PlayerState, GameState, UnitInstance } from '../types';
import { UNITS, UNIT_MAP, LEVELS, POOL_SIZE, REROLL_COST, MAX_BENCH, STAR_MULTIPLIER } from '../config';
import { createUnitInstance, getLevelDef } from '../GameState';
import { EventBus } from '../EventBus';

export class ShopSystem {
    constructor(private events: EventBus) { }

    /** 상점 5칸 생성 (레벨별 확률 + 유닛 풀 기반) */
    generateShop(state: GameState, player: PlayerState): void {
        if (player.shopLocked) {
            player.shopLocked = false;
            return; // 잠긴 상점은 유지
        }
        const levelDef = getLevelDef(player.level);
        const odds = levelDef.shopOdds; // [1코%, 2코%, 3코%, 4코%, 5코%]

        // ── 스테이지별 코스트 상한 ──
        const maxCost = state.stageId === 1 ? 2 : state.stageId === 2 ? 3 : 5;

        // 해금된 7/10코 유닛 목록 (풀에 남아있는 것만) — 코스트 제한 적용
        const unlockedHighCost = maxCost >= 7 ? UNITS.filter(u =>
            (u.cost === 7 || u.cost === 10) &&
            (state.unitPool[u.id] ?? 0) > 0 &&
            (u.cost === 10 ? player.unlocked10cost : player.unlocked7cost.includes(u.id))
        ) : [];

        player.shop = [];
        for (let i = 0; i < 5; i++) {
            // 해금 유닛이 있으면 15% 확률로 등장
            if (unlockedHighCost.length > 0 && Math.random() < 0.15) {
                const pick = unlockedHighCost[Math.floor(Math.random() * unlockedHighCost.length)];
                player.shop.push(pick.id);
            } else {
                const unitId = this.rollUnit(state, odds, maxCost);
                player.shop.push(unitId);
            }
        }
    }

    /** 확률+풀 기반 유닛 1종 뽑기 */
    private rollUnit(state: GameState, odds: number[], maxCost: number = 5): string | null {
        // 코스트 상한에 맞춰 odds 재조정
        const cappedOdds = odds.slice(0, maxCost);
        const totalOdds = cappedOdds.reduce((a, b) => a + b, 0);

        // 1) 코스트 결정 (가중치 랜덤)
        const roll = Math.random() * totalOdds;
        let cumulative = 0;
        let targetCost = 1;
        for (let i = 0; i < cappedOdds.length; i++) {
            cumulative += cappedOdds[i];
            if (roll < cumulative) {
                targetCost = i + 1;
                break;
            }
        }

        // 2) 해당 코스트 유닛 중 풀에 남은 것 선택
        const candidates = UNITS.filter(u =>
            u.cost === targetCost && (state.unitPool[u.id] ?? 0) > 0
        );
        if (candidates.length === 0) return null;

        // 풀 가중치 (남은 수량만큼)
        const totalWeight = candidates.reduce((sum, c) => sum + (state.unitPool[c.id] ?? 0), 0);
        let pick = Math.random() * totalWeight;
        for (const c of candidates) {
            pick -= state.unitPool[c.id] ?? 0;
            if (pick <= 0) return c.id;
        }
        return candidates[candidates.length - 1].id;
    }

    /** 유닛 구매 */
    buyUnit(state: GameState, player: PlayerState, shopIndex: number): boolean {
        const unitId = player.shop[shopIndex];
        if (!unitId) return false;

        const unitDef = UNIT_MAP[unitId];
        if (!unitDef) return false;
        if (player.gold < unitDef.cost) return false;
        if (player.bench.length >= (MAX_BENCH + (player.augments.includes('aug_cold_wallet') ? 3 : 0))) {
            // 벤치 꽉 찼지만 합성 가능하면 구매 허용
            // 전투 중에는 벤치만 합성 대상
            const mergePool = state.phase === 'combat'
                ? player.bench
                : [...player.board, ...player.bench];
            const star1Count = mergePool.filter(u => u.unitId === unitId && u.star === 1).length;
            const star2Count = mergePool.filter(u => u.unitId === unitId && u.star === 2).length;
            // 구매 후 ★1이 3개 이상이면 ★2 합성, 또는 ★2가 3개 이상이면 ★3 합성
            const willMerge = (star1Count >= 2) || (star2Count >= 2 && star1Count >= 2);
            if (!willMerge) return false;
        }

        // 골드 차감
        player.gold -= unitDef.cost;

        // 풀에서 제거
        if (state.unitPool[unitId] !== undefined) {
            state.unitPool[unitId]--;
        }

        // 벤치에 추가
        const instance = createUnitInstance(unitId);
        player.bench.push(instance);

        // 상점 슬롯 비우기
        player.shop[shopIndex] = null;

        this.events.emit('unit:bought', { unitId, instanceId: instance.instanceId });
        this.events.emit('gold:changed', { gold: player.gold });

        // 합성 체크
        this.checkMerge(state, player, unitId);

        return true;
    }

    /** 유닛 판매 */
    sellUnit(state: GameState, player: PlayerState, instanceId: string): boolean {
        // 보드 또는 벤치에서 찾기
        let unit: UnitInstance | undefined;
        let fromBoard = false;

        const boardIdx = player.board.findIndex(u => u.instanceId === instanceId);
        if (boardIdx >= 0) {
            unit = player.board[boardIdx];
            player.board.splice(boardIdx, 1);
            fromBoard = true;
        } else {
            const benchIdx = player.bench.findIndex(u => u.instanceId === instanceId);
            if (benchIdx >= 0) {
                unit = player.bench[benchIdx];
                player.bench.splice(benchIdx, 1);
            }
        }

        if (!unit) return false;

        const unitDef = UNIT_MAP[unit.unitId];
        if (!unitDef) return false;

        // 판매 골드: ★1=cost, ★2=cost*3, ★3=cost*9
        const sellMultiplier = unit.star === 3 ? 9 : unit.star === 2 ? 3 : 1;
        // 증강: 콜드 월렛 — 판매 시 100% 환불
        const coldWallet = player.augments.includes('aug_cold_wallet');
        const sellBonus = player.augments.includes('aug_sell_profit') ? 1 : 0;
        // 콜드 월렛: 단순히 cost * multiplier 전액 환불 (패널티 없음)
        player.gold += unitDef.cost * sellMultiplier + sellBonus;

        // 풀에 반환 (★2=3개, ★3=9개)
        const returnCount = unit.star === 3 ? 9 : unit.star === 2 ? 3 : 1;
        if (state.unitPool[unit.unitId] !== undefined) {
            state.unitPool[unit.unitId] += returnCount;
        }

        this.events.emit('unit:sold', { unitId: unit.unitId, star: unit.star });
        this.events.emit('gold:changed', { gold: player.gold });

        return true;
    }

    /** 리롤 */
    reroll(state: GameState, player: PlayerState): boolean {
        const isFree = player.freeRerolls > 0;
        // 증강: 리롤 마스터 — 리롤 비용 2→1
        const cost = player.augments.includes('aug_dex_swap') ? 1 : REROLL_COST;
        if (!isFree && player.gold < cost) return false;

        // 현재 상점의 유닛을 풀에 반환
        player.shop.forEach(unitId => {
            if (unitId && state.unitPool[unitId] !== undefined) {
                state.unitPool[unitId]++;
            }
        });

        if (isFree) {
            player.freeRerolls--;
            this.events.emit('shop:freeReroll', { remaining: player.freeRerolls });
        } else {
            player.gold -= cost;
            this.events.emit('gold:changed', { gold: player.gold });
        }

        this.generateShop(state, player);
        this.events.emit('shop:rerolled', {});

        // 🔄 DEX 스왓 봇: 리롤 시 전아군 마나 10 회복
        if (player.augments.includes('aug_dex_swap')) {
            for (const unit of player.board) {
                if (UNIT_MAP[unit.unitId]?.skill?.type === 'active') {
                    unit.currentMana = (unit.currentMana ?? 0) + 10;
                }
            }
        }

        return true;
    }

    /** 상점 잠금 토글 */
    toggleLock(player: PlayerState): void {
        player.shopLocked = !player.shopLocked;
    }

    /** 합성 체크 (★→★★→★★★) */
    private checkMerge(state: GameState, player: PlayerState, unitId: string): void {
        // ★1 → ★2 체크
        this.tryMerge(state, player, unitId, 1);
    }

    private tryMerge(state: GameState, player: PlayerState, unitId: string, star: 1 | 2): void {
        // 전투 중에는 보드 유닛 터치 금지 — 벤치만 합성 대상
        const inCombat = state.phase === 'combat';
        const mergePool = inCombat
            ? player.bench
            : [...player.board, ...player.bench];
        const matches = mergePool.filter(u => u.unitId === unitId && u.star === star);

        if (matches.length >= 3) {
            // 준비 단계: 보드 유닛 우선 keep
            const boardMatch = !inCombat
                ? matches.find(u => player.board.includes(u))
                : undefined;
            const keep = boardMatch ?? matches[0];
            const remove = matches.filter(u => u.instanceId !== keep.instanceId).slice(0, 2);
            const newStar = (star + 1) as 1 | 2 | 3;
            keep.star = newStar;

            // 원본 유닛 중 보드에 있던 게 하나라도 있었는지 체크
            const hadBoardUnit = matches.some(u => player.board.includes(u));

            // 제거 대상 삭제
            for (const rem of remove) {
                const bIdx = player.board.findIndex(u => u.instanceId === rem.instanceId);
                if (bIdx >= 0) player.board.splice(bIdx, 1);
                const eIdx = player.bench.findIndex(u => u.instanceId === rem.instanceId);
                if (eIdx >= 0) player.bench.splice(eIdx, 1);
            }

            // 준비 단계: 합성 결과가 벤치에 있고 원본이 보드에 있었고 보드 슬롯 여유 있으면 → 보드로 이동
            if (!inCombat && !player.board.includes(keep) && hadBoardUnit) {
                const maxSlots = LEVELS.find(l => l.level === player.level)?.slots ?? 1;
                if (player.board.length < maxSlots) {
                    const benchIdx = player.bench.findIndex(u => u.instanceId === keep.instanceId);
                    if (benchIdx >= 0) {
                        player.bench.splice(benchIdx, 1);
                        // 빈 보드 위치 찾기
                        const occupied = new Set(player.board.map(u => `${u.position?.x},${u.position?.y}`));
                        for (let y = 0; y < 4; y++) {
                            for (let x = 0; x < 7; x++) {
                                if (!occupied.has(`${x},${y}`)) {
                                    keep.position = { x, y };
                                    player.board.push(keep);
                                    y = 4; // break outer
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            this.events.emit('unit:merged', {
                unitId,
                newStar,
                instanceId: keep.instanceId,
            });

            // ★2 → ★3 연쇄 체크
            if (newStar === 2) {
                this.tryMerge(state, player, unitId, 2);
            }
        }
    }
}
