// ============================================================
// EconomySystem — 골드, 이자, 연승, 레벨 관리
// ============================================================

import { PlayerState, GameState } from '../types';
import {
    getBaseIncome, getInterest, getStreakBonus, getXpPerRound, getStage,
    XP_BUY_COST, XP_BUY_AMOUNT, XP_PER_ROUND, LEVELS,
} from '../config';
import { EventBus } from '../EventBus';

export class EconomySystem {
    constructor(private events: EventBus) { }

    /** 라운드 종료 시 수입 정산 */
    processIncome(state: GameState, player: PlayerState): number {
        const base = getBaseIncome(state.round);
        const isWarmup = getStage(state.round) === 1;
        const interest = isWarmup ? 0 : getInterest(player.gold);
        const streak = isWarmup ? 0 : getStreakBonus(Math.max(player.winStreak, player.lossStreak));

        const total = base + interest + streak;
        player.gold += total;

        this.events.emit('gold:changed', {
            gold: player.gold,
            breakdown: { base, interest, streak },
        });

        return total;
    }

    /** XP 구매 (4골드 = 4XP) */
    buyXp(player: PlayerState): boolean {
        if (player.gold < XP_BUY_COST) return false;
        if (player.level >= 10) return false;

        player.gold -= XP_BUY_COST;
        this.addXp(player, XP_BUY_AMOUNT);
        this.events.emit('gold:changed', { gold: player.gold });

        return true;
    }

    /** 라운드 시작 시 자동 XP (스테이지별 증가) */
    processRoundXp(player: PlayerState, round: number): void {
        if (player.level >= 10) return;
        if (round <= 1) return; // 1-1은 첫 라운드, XP 없음
        this.addXp(player, getXpPerRound(round));
    }

    /** XP 추가 + 레벨업 체크 */
    private addXp(player: PlayerState, amount: number): void {
        player.xp += amount;

        // 레벨업 체크 (연쇄 가능)
        while (player.level < 10) {
            const nextLevel = LEVELS.find(l => l.level === player.level + 1);
            if (!nextLevel) break;
            if (player.xp >= nextLevel.requiredXp) {
                player.xp -= nextLevel.requiredXp;
                player.level++;
                this.events.emit('level:up', { level: player.level });
            } else {
                break;
            }
        }

        // 레벨 10이면 XP 초과분 제거
        if (player.level >= 10) {
            player.xp = 0;
        }
    }

    /** 전투 결과 반영 (승/패) */
    processStreaks(player: PlayerState, won: boolean): void {
        if (won) {
            player.winStreak++;
            player.lossStreak = 0;
        } else {
            player.lossStreak++;
            player.winStreak = 0;
        }
    }

    /** HP 피해 */
    applyDamage(player: PlayerState, damage: number): void {
        player.hp = Math.max(0, player.hp - damage);
        this.events.emit('player:damaged', { hp: player.hp, damage });

        if (player.hp <= 0) {
            this.events.emit('player:defeated', { playerId: player.id });
        }
    }

    /** 현재 레벨에 필요한 XP */
    getXpToNext(player: PlayerState): number {
        if (player.level >= 10) return 0;
        const next = LEVELS.find(l => l.level === player.level + 1);
        return next ? next.requiredXp - player.xp : 0;
    }
}
