// ============================================================
// UnlockSystem — 7코/10코 유닛 해금 조건 체크
//
// 3가지 조건 동시 달성:
//   1) 시너지 요구치
//   2) 증강 보유
//   3) 해금 아이템 보유 (보스 상자 드랍)
// ============================================================

import { PlayerState, ActiveSynergy } from '../types';
import { UNLOCK_CONDITIONS, UNIT_MAP, BOX_DROP_TABLES, BOX_UNLOCK_CHANCE, AUGMENTS } from '../config';
import { EventBus } from '../EventBus';

export interface UnlockStatus {
    unitId: string;
    unitName: string;
    unlocked: boolean;
    synergiesMet: boolean;
    augmentMet: boolean;
    itemMet: boolean;
    // 상세
    synergyDetails: { synergyId: string; current: number; required: number; met: boolean }[];
    requiredAugment: string;
    requiredItem: string;
}

export class UnlockSystem {
    constructor(private events: EventBus) { }

    /** 모든 7코/10코 해금 상태 체크 */
    checkAllUnlocks(player: PlayerState, synergies: ActiveSynergy[]): UnlockStatus[] {
        return UNLOCK_CONDITIONS.map(cond => {
            const unitDef = UNIT_MAP[cond.unitId];

            // 시너지 체크
            const synergyDetails = cond.synergyRequirements.map(req => {
                const active = synergies.find(s => s.synergyId === req.synergyId);
                const current = active?.count ?? 0;
                return {
                    synergyId: req.synergyId,
                    current,
                    required: req.minCount,
                    met: current >= req.minCount,
                };
            });
            const synergiesMet = synergyDetails.every(d => d.met);

            // 증강 체크
            const augmentMet = player.augments.includes(cond.requiredAugment);

            // 아이템 체크
            const itemMet = player.items.includes(cond.requiredItem);

            // 전체 해금
            const unlocked = synergiesMet && augmentMet && itemMet;

            return {
                unitId: cond.unitId,
                unitName: unitDef?.name ?? cond.unitId,
                unlocked,
                synergiesMet,
                augmentMet,
                itemMet,
                synergyDetails,
                requiredAugment: cond.requiredAugment,
                requiredItem: cond.requiredItem,
            };
        });
    }

    /** 해금 가능한 유닛 확인 (아직 해금 안 된 것만) */
    getNewlyUnlockable(player: PlayerState, synergies: ActiveSynergy[]): UnlockStatus[] {
        const all = this.checkAllUnlocks(player, synergies);
        return all.filter(status => {
            if (!status.unlocked) return false;
            if (UNIT_MAP[status.unitId]?.cost === 10) {
                return !player.unlocked10cost;
            }
            return !player.unlocked7cost.includes(status.unitId);
        });
    }

    /** 해금 실행 */
    executeUnlock(player: PlayerState, unitId: string): boolean {
        const def = UNIT_MAP[unitId];
        if (!def) return false;

        if (def.cost === 10) {
            if (player.unlocked10cost) return false;
            player.unlocked10cost = true;
        } else if (def.cost === 7) {
            if (player.unlocked7cost.includes(unitId)) return false;
            player.unlocked7cost.push(unitId);
        } else {
            return false;
        }

        this.events.emit('unlock:activated', { unitId, name: def.name });
        return true;
    }

    /** 보스 상자 드랍 (보스 처치 시 호출) */
    rollBossBox(player: PlayerState, round: number): string | null {
        const table = BOX_DROP_TABLES.find(t => t.round === round);
        if (!table || table.items.length === 0) return null;

        // 해금 아이템 나올 확률
        if (Math.random() > BOX_UNLOCK_CHANCE) return null;

        // 가중치 랜덤
        const totalWeight = table.items.reduce((sum, i) => sum + i.weight, 0);
        let roll = Math.random() * totalWeight;
        for (const item of table.items) {
            roll -= item.weight;
            if (roll <= 0) {
                // 이미 보유 중이면 다시 뽑기 (최대 3회)
                if (player.items.includes(item.itemId)) continue;
                player.items.push(item.itemId);
                return item.itemId;
            }
        }
        return null;
    }

    /** 증강 택 3 생성 (보너스 라운드용) */
    generateAugmentChoices(player: PlayerState, round: number): string[] {
        const available = AUGMENTS.filter(a =>
            a.minRound <= round && !player.augments.includes(a.id)
        );

        // 셔플 후 3개
        const shuffled = [...available].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, 3).map(a => a.id);
    }

    /** 증강 선택 */
    pickAugment(player: PlayerState, augmentId: string): boolean {
        if (player.augments.includes(augmentId)) return false;
        player.augments.push(augmentId);
        this.events.emit('augment:picked', { augmentId });
        return true;
    }
}
