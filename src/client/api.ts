// ============================================================
// API Client — fetch wrapper with JWT auto-attach
// ============================================================

const API_BASE = '/api';

let _token: string | null = localStorage.getItem('coinrd_token');

export function setToken(token: string) {
    _token = token;
    localStorage.setItem('coinrd_token', token);
}

export function getToken(): string | null {
    return _token;
}

export function clearToken() {
    _token = null;
    localStorage.removeItem('coinrd_token');
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
    };
    if (_token) {
        headers['Authorization'] = `Bearer ${_token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(body.error || `API ${res.status}`);
    }

    return res.json();
}

// ── Auth ──
export async function authGuest() {
    const data = await apiFetch<{ token: string; userId: string; me: any }>('/auth/guest', {
        method: 'POST',
    });
    setToken(data.token);
    return data;
}

// ── Me ──
export async function getMe() {
    return apiFetch<any>('/me');
}

// ── Run ──
export async function runStart(stageId: number) {
    return apiFetch<{ runId: string }>('/run/start', {
        method: 'POST',
        body: JSON.stringify({ stageId }),
    });
}

export async function runFinish(data: {
    runId: string;
    stageId: number;
    reachedRound: number;
    cleared: boolean;
    bossGrades: Record<string, string>;
    stats?: {
        rerollCount: number;
        highestStar: number;
        synergyTiers: Record<string, number>;
        totalBossKills: number;
        xpBought: number;
    };
}) {
    return apiFetch<any>('/run/finish', {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

// ── Missions (Legacy) ──
export async function getDailyMissions() {
    return apiFetch<any>('/missions/daily');
}

export async function claimMission(missionId: string) {
    return apiFetch<any>('/missions/claim', {
        method: 'POST',
        body: JSON.stringify({ missionId }),
    });
}

export async function rerollMission(missionIndex: number) {
    return apiFetch<any>('/missions/reroll', {
        method: 'POST',
        body: JSON.stringify({ missionIndex }),
    });
}

// ── PRO Quests ──
export async function getQuests(scope: 'daily' | 'weekly' = 'daily') {
    return apiFetch<any>(`/quests?scope=${scope}`);
}

export async function claimQuest(userQuestId: string) {
    return apiFetch<any>('/quests/claim', {
        method: 'POST',
        body: JSON.stringify({ userQuestId }),
    });
}

export async function rerollQuest(slotIndex: number) {
    return apiFetch<any>('/quests/reroll', {
        method: 'POST',
        body: JSON.stringify({ slotIndex }),
    });
}

export async function claimWeeklyMilestone(tier: number) {
    return apiFetch<any>('/quests/milestone', {
        method: 'POST',
        body: JSON.stringify({ tier }),
    });
}

