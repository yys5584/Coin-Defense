// ============================================================
// CommandProcessor — Command 패턴 중앙 처리기
// 모든 플레이어 액션 → Command → 상태 변경
// 멀티: 클라이언트→서버 전송 → 서버에서 실행 → 결과 브로드캐스트
// ============================================================

import { GameState, GameCommand, PlayerState } from '../types';
import { EventBus } from '../EventBus';
import { ShopSystem } from './ShopSystem';
import { EconomySystem } from './EconomySystem';
import { BoardSystem } from './BoardSystem';

export class CommandProcessor {
    private shop: ShopSystem;
    private economy: EconomySystem;
    private board: BoardSystem;

    constructor(private events: EventBus) {
        this.shop = new ShopSystem(events);
        this.economy = new EconomySystem(events);
        this.board = new BoardSystem(events);
    }

    /** 커맨드 실행 (→ 상태 변경) */
    execute(state: GameState, command: GameCommand): boolean {
        const player = this.findPlayer(state, command);
        if (!player && command.type !== 'START_COMBAT' && command.type !== 'END_ROUND') {
            console.warn(`[CMD] Player not found for command:`, command);
            return false;
        }

        switch (command.type) {
            case 'BUY_UNIT':
                return this.shop.buyUnit(state, player!, command.shopIndex);

            case 'SELL_UNIT':
                return this.shop.sellUnit(state, player!, command.instanceId);

            case 'REROLL':
                return this.shop.reroll(state, player!);

            case 'BUY_XP':
                return this.economy.buyXp(player!);

            case 'LOCK_SHOP':
                this.shop.toggleLock(player!);
                return true;

            case 'MOVE_UNIT':
                return this.board.moveUnit(player!, command.instanceId, command.to);

            case 'BENCH_UNIT':
                return this.board.benchUnit(player!, command.instanceId);

            case 'START_COMBAT':
                return this.startCombat(state);

            case 'END_ROUND':
                return this.endRound(state);

            default:
                console.warn(`[CMD] Unknown command type:`, command);
                return false;
        }
    }

    /** 전투 시작 */
    private startCombat(state: GameState): boolean {
        state.phase = 'combat' as any;
        this.events.emit('combat:start', { round: state.round });
        return true;
    }

    /** 라운드 종료 → 수입 정산 → 새 상점 → 다음 준비 */
    private endRound(state: GameState): boolean {
        state.round++;
        state.phase = 'prep' as any;

        for (const player of state.players) {
            // XP 자동 지급
            this.economy.processRoundXp(player, state.round);
            // 수입 정산
            this.economy.processIncome(state, player);
            // 새 상점 생성
            this.shop.generateShop(state, player);
        }

        this.events.emit('round:start', { round: state.round });
        return true;
    }

    /** 커맨드에서 playerId 추출 후 플레이어 찾기 */
    private findPlayer(state: GameState, cmd: GameCommand): PlayerState | undefined {
        if ('playerId' in cmd) {
            return state.players.find(p => p.id === cmd.playerId);
        }
        return undefined;
    }

    // 시스템 접근 (외부에서 필요 시)
    getShop(): ShopSystem { return this.shop; }
    getEconomy(): EconomySystem { return this.economy; }
    getBoard(): BoardSystem { return this.board; }
}
