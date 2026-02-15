// ============================================================
// UserState — 클라이언트 상태 캐시
// ============================================================

import { getMe, authGuest, getToken } from './api';

export interface ClientUserState {
    userId: string;
    profile: { nickname: string };
    wallet: { soft: number; hard: number };
    progress: {
        unlockedStage: number;
        bestRound: number;
        bestBossGrades: Record<string, Record<string, string>>;
    };
    unlocks: {
        unlockedCosts: Record<string, boolean>;
        license7: boolean;
        license10: boolean;
        license7Shards: number;
        license10Shards: number;
    };
    missions: {
        daily: any[];
        dailyResetAt: string;
    };
}

let _state: ClientUserState | null = null;

export function getCachedState(): ClientUserState | null {
    return _state;
}

export function setCachedState(state: ClientUserState) {
    _state = state;
}

/** 서버에서 최신 상태 가져오기 (또는 게스트 생성) */
export async function initUserState(): Promise<ClientUserState> {
    if (!getToken()) {
        // 토큰 없음 → 게스트 생성
        const data = await authGuest();
        _state = data.me;
        return _state!;
    }

    try {
        _state = await getMe();
        return _state!;
    } catch {
        // 토큰 만료 → 재생성
        const data = await authGuest();
        _state = data.me;
        return _state!;
    }
}

export async function refreshState(): Promise<ClientUserState> {
    _state = await getMe();
    return _state!;
}
