// ============================================================
// UserState — 서버↔클라이언트 공유 타입
// GET /api/me 응답 형식
// ============================================================

export interface UserState {
    userId: string;
    profile: {
        nickname: string;
    };
    wallet: {
        soft: number;
        hard: number;
    };
    progress: {
        unlockedStage: number;
        bestRound: number;
        bestBossGrades: Record<string, Record<string, string>>; // {S2:{R20:'A'}}
    };
    unlocks: {
        unlockedCosts: Record<string, boolean>; // {"1":true,"2":true}
        license7: boolean;
        license10: boolean;
        license7Shards: number;
        license10Shards: number;
    };
    missions: {
        daily: DailyMission[];
        dailyResetAt: string;
        rerollsUsed: number; // 오늘 리롤 사용 횟수
    };
}

export interface DailyMission {
    id: string;
    type: string; // PLAY_RUN, KILL_BOSS, BOSS_GRADE_B, BOSS_GRADE_A, CLEAR_STAGE, REACH_ROUND, HIGHEST_STAR, REROLL_COUNT
    desc: string;
    target: number;
    current: number;
    claimed: boolean;
    reward: { soft: number; shards7?: number; shards10?: number };
}

export interface RunFinishRequest {
    runId: string;
    stageId: number;
    reachedRound: number;
    cleared: boolean;
    bossGrades: Record<string, string>; // {"R10":"S","R20":"B"}
    stats?: RunStats; // 런 내 통계 (퀘스트/이벤트 확장용)
}

export interface RunStats {
    rerollCount: number;         // 총 리롤 횟수
    highestStar: number;         // 달성한 최고 ★ (1~3)
    synergyTiers: Record<string, number>; // {Bitcoin:4, Meme:2 ...}
    totalBossKills: number;      // 보스 처치 수
    xpBought: number;            // XP 구매 횟수
}

export interface RunFinishResponse {
    rewards: {
        soft: number;
        shards7: number;
        shards10: number;
    };
    newUnlocks: string[]; // ["stage:3", "cost:3", ...]
    missionProgress: string[];
    me: UserState;
}

// 해금 로드맵
export const UNLOCK_MAP: Record<number, { needStage: number; needBossGrade: string; unlockStage: number; unlockCost: number }> = {
    3: { needStage: 2, needBossGrade: 'B', unlockStage: 3, unlockCost: 3 },
    4: { needStage: 3, needBossGrade: 'B', unlockStage: 4, unlockCost: 4 },
    5: { needStage: 4, needBossGrade: 'B', unlockStage: 5, unlockCost: 5 },
    6: { needStage: 5, needBossGrade: 'C', unlockStage: 6, unlockCost: 0 }, // clear only
    7: { needStage: 6, needBossGrade: 'C', unlockStage: 7, unlockCost: 0 },
};

// 보스 등급 순서
export const GRADE_ORDER = ['S', 'A', 'B', 'F'] as const;
export function isGradeBetterOrEqual(grade: string, threshold: string): boolean {
    const gi = GRADE_ORDER.indexOf(grade as any);
    const ti = GRADE_ORDER.indexOf(threshold as any);
    if (gi === -1 || ti === -1) return false;
    return gi <= ti; // S=0 < A=1 < B=2 < F=3
}
