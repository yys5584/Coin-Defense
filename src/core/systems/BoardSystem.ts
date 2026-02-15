// ============================================================
// BoardSystem — 유닛 배치·벤치·이동
// ============================================================

import { PlayerState, UnitInstance, Position } from '../types';
import { getMaxBoardSize } from '../GameState';
import { EventBus } from '../EventBus';

export class BoardSystem {
    constructor(private events: EventBus) { }

    /** 벤치 → 보드 배치 (점유된 위치면 기존 유닛과 스왑) */
    placeUnit(player: PlayerState, instanceId: string, to: Position): boolean {
        const benchIdx = player.bench.findIndex(u => u.instanceId === instanceId);
        if (benchIdx < 0) return false;

        // 해당 위치에 이미 유닛이 있는가?
        const existing = player.board.find(u =>
            u.position?.x === to.x && u.position?.y === to.y
        );

        if (existing) {
            // 스왑: 기존 보드 유닛 → 벤치, 벤치 유닛 → 보드
            // 벤치에서 1개 빼고 1개 넣으므로 크기 동일 — 체크 불필요
            const boardIdx = player.board.findIndex(u => u.instanceId === existing.instanceId);
            const newUnit = player.bench.splice(benchIdx, 1)[0];
            const boardUnit = player.board.splice(boardIdx, 1)[0];
            boardUnit.position = null;

            newUnit.position = { ...to };
            player.board.push(newUnit);
            player.bench.push(boardUnit);

            this.events.emit('unit:placed', { instanceId, position: to });
            this.events.emit('synergy:changed', {});
            return true;
        }

        // 빈 자리면 그냥 배치
        if (player.board.length >= getMaxBoardSize(player)) return false;

        const unit = player.bench.splice(benchIdx, 1)[0];
        unit.position = { ...to };
        player.board.push(unit);

        this.events.emit('unit:placed', { instanceId, position: to });
        this.events.emit('synergy:changed', {});
        return true;
    }

    /** 보드 → 벤치 회수 */
    benchUnit(player: PlayerState, instanceId: string): boolean {
        const boardIdx = player.board.findIndex(u => u.instanceId === instanceId);
        if (boardIdx < 0) return false;
        if (player.bench.length >= 9) return false;

        const unit = player.board.splice(boardIdx, 1)[0];
        unit.position = null;
        player.bench.push(unit);

        this.events.emit('synergy:changed', {});
        return true;
    }

    /** 보드 내 위치 이동 */
    moveUnit(player: PlayerState, instanceId: string, to: Position): boolean {
        const unit = player.board.find(u => u.instanceId === instanceId);
        if (!unit) {
            // 벤치에서 보드로
            return this.placeUnit(player, instanceId, to);
        }

        // 해당 위치에 유닛이 있으면 스왑
        const other = player.board.find(u =>
            u.position?.x === to.x && u.position?.y === to.y
        );
        if (other && other.instanceId !== instanceId) {
            const temp = { ...unit.position! };
            unit.position = { ...to };
            other.position = temp;
        } else {
            unit.position = { ...to };
        }

        this.events.emit('unit:placed', { instanceId, position: to });
        return true;
    }
}
