// ============================================================
// BoardSystem — 유닛 배치·벤치·이동
// ============================================================

import { PlayerState, UnitInstance, Position } from '../types';
import { getMaxBoardSize } from '../GameState';
import { EventBus } from '../EventBus';

export class BoardSystem {
    constructor(private events: EventBus) { }

    /** 벤치 → 보드 배치 (점유된 위치면 기존 유닛과 스왑, layer2 증강 시 겹침 허용) */
    placeUnit(player: PlayerState, instanceId: string, to: Position): boolean {
        const benchIdx = player.bench.findIndex(u => u.instanceId === instanceId);
        if (benchIdx < 0) return false;

        // 해당 위치에 이미 유닛이 있는가?
        const unitsAtPos = player.board.filter(u =>
            u.position?.x === to.x && u.position?.y === to.y
        );

        if (unitsAtPos.length > 0) {
            // layer2 증강: 해당 타일에 유닛이 1마리만 있으면 겹쳐 배치
            const hasLayer2 = player.augments.includes('aug_layer2');
            if (hasLayer2 && unitsAtPos.length < 2) {
                // 보드 크기 제한 체크
                if (player.board.length >= getMaxBoardSize(player)) return false;

                const unit = player.bench.splice(benchIdx, 1)[0];
                unit.position = { ...to };
                player.board.push(unit);

                this.events.emit('unit:placed', { instanceId, position: to });
                this.events.emit('synergy:changed', {});
                return true;
            }

            // 일반 스왑: 기존 보드 유닛(첫 번째) → 벤치, 벤치 유닛 → 보드
            const existing = unitsAtPos[0];
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

        // 해당 위치에 다른 유닛이 있는지 확인
        const othersAtPos = player.board.filter(u =>
            u.position?.x === to.x && u.position?.y === to.y && u.instanceId !== instanceId
        );

        if (othersAtPos.length > 0) {
            // layer2 증강: 대상 타일에 유닛 1마리만 있으면 겹쳐 배치
            const hasLayer2 = player.augments.includes('aug_layer2');
            if (hasLayer2 && othersAtPos.length < 2) {
                unit.position = { ...to };
            } else {
                // 일반 스왑
                const other = othersAtPos[0];
                const temp = { ...unit.position! };
                unit.position = { ...to };
                other.position = temp;
            }
        } else {
            unit.position = { ...to };
        }

        this.events.emit('unit:placed', { instanceId, position: to });
        return true;
    }
}
