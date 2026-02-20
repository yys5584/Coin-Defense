// ============================================================
// GameState — 직렬화 가능한 게임 상태
// 멀티플레이어: 서버에서 관리, 클라이언트에 브로드캐스트
// Unity: 동일 구조 C# class로 변환
// ============================================================

import { GameState, PlayerState, GamePhase, UnitInstance, Position } from './types';
import { UNITS, POOL_SIZE, STARTING_GOLD, STARTING_HP, LEVELS } from './config';

/** 고유 ID 생성기 */
let _idCounter = 0;
export function generateId(): string {
    return `u_${Date.now()}_${_idCounter++}`;
}

/** 새 플레이어 상태 생성 */
export function createPlayerState(playerId: string): PlayerState {
    return {
        id: playerId,
        gold: STARTING_GOLD,
        level: 1,
        xp: 0,
        hp: STARTING_HP,
        winStreak: 0,
        lossStreak: 0,
        board: [],
        bench: [],
        shop: [null, null, null, null, null],
        shopLocked: false,
        items: [],
        augments: [],
        unlocked7cost: [],
        unlocked10cost: false,
        freeRerolls: 0,
    };
}

/** 유닛 풀 초기화 (1~5코만, 7/10코 제외) */
export function createUnitPool(): Record<string, number> {
    const pool: Record<string, number> = {};
    UNITS.forEach(unit => {
        const size = POOL_SIZE[unit.cost];
        if (size !== undefined) {
            pool[unit.id] = size;
        }
    });
    return pool;
}

/** 새 게임 상태 생성 (싱글 또는 멀티) */
export function createGameState(playerIds: string[], stageId: number = 1): GameState {
    return {
        round: 0,
        phase: GamePhase.Prep,
        players: playerIds.map(id => createPlayerState(id)),
        unitPool: createUnitPool(),
        stageId,
    };
}

/** 게임 상태 직렬화 (네트워크/저장용) */
export function serializeState(state: GameState): string {
    return JSON.stringify(state);
}

/** 게임 상태 역직렬화 */
export function deserializeState(json: string): GameState {
    return JSON.parse(json) as GameState;
}

/** 플레이어의 현재 레벨 정보 조회 */
export function getLevelDef(level: number) {
    return LEVELS.find(l => l.level === level) ?? LEVELS[0];
}

/** 유닛 인스턴스 생성 */
export function createUnitInstance(unitId: string, position: Position | null = null): UnitInstance {
    return {
        instanceId: generateId(),
        unitId,
        star: 1,
        position,
    };
}

/** 플레이어의 보드+벤치에서 특정 유닛ID 개수 세기 */
export function countUnits(player: PlayerState, unitId: string, star: 1 | 2 | 3 = 1): number {
    const allUnits = [...player.board, ...player.bench];
    return allUnits.filter(u => u.unitId === unitId && u.star === star).length;
}

/** 플레이어의 배치 가능 슬롯 수 */
export function getMaxBoardSize(player: PlayerState): number {
    const bonus = player.augments.includes('aug_layer2') ? 1 : 0;
    return getLevelDef(player.level).slots + bonus;
}

/** 딥 복사 (상태 분기점 — 멀티에서 사용) */
export function cloneState(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state));
}
