// ============================================================
// QuestService — PRO 데이터 기반 퀘스트 엔진
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { isGradeBetterOrEqual } from '../types.js';

// ── 타입 ──

interface QuestDef {
    id: string;
    scope: string;
    category: string;
    name: string;
    description: string;
    type: string;
    params_json: string;
    target: number;
    rewards_json: string;
    weight: number;
    min_unlocked_stage: number;
    min_unlocked_cost: number;
}

export interface UserQuest {
    id: string;
    user_id: string;
    quest_def_id: string;
    scope: string;
    reset_key: string;
    slot_index: number | null;
    progress: number;
    target: number;
    status: string; // ACTIVE | COMPLETED | CLAIMED
    assigned_at: string;
    completed_at: string | null;
    claimed_at: string | null;
    // joined from quest_definitions
    name?: string;
    description?: string;
    type?: string;
    params_json?: string;
    rewards_json?: string;
    category?: string;
}

export interface WeeklyState {
    points: number;
    claimedMilestones: number[];
}

export interface RunFinishPayload {
    stageId: number;
    cleared: boolean;
    reachedRound: number;
    bossKilled: boolean;
    bossGrade: string;
    stats: {
        rerollCount: number;
        xpBought: number;
        highestStar: number;
        synergyMax: Record<string, number>;
    };
    // 서버가 계산한 보상 (조각 지급량)
    earnedShards7?: number;
}

// ── 날짜/주차 키 (KST) ──

function getDailyKeyKST(): string {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getWeekKeyKST(): string {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const year = kst.getFullYear();
    // ISO week calculation
    const jan1 = new Date(year, 0, 1);
    const days = Math.floor((kst.getTime() - jan1.getTime()) / 86400000);
    const week = Math.ceil((days + jan1.getDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
}

// ── 리셋 상태 관리 ──

function getUserResets(userId: string): any {
    let row = db.prepare('SELECT * FROM user_resets WHERE user_id = ?').get(userId) as any;
    if (!row) {
        db.prepare(`INSERT INTO user_resets (user_id, updated_at) VALUES (?, datetime('now'))`).run(userId);
        row = db.prepare('SELECT * FROM user_resets WHERE user_id = ?').get(userId) as any;
    }
    return row;
}

// ── 가중치 랜덤 선택 ──

function pickWeightedQuest(defs: QuestDef[], exclude: Set<string>): QuestDef | null {
    const pool = defs.filter(d => !exclude.has(d.id));
    if (pool.length === 0) return null;

    const totalWeight = pool.reduce((sum, d) => sum + d.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const d of pool) {
        roll -= d.weight;
        if (roll <= 0) return d;
    }
    return pool[pool.length - 1];
}

// ── 퀘스트 할당 ──

function assignQuest(userId: string, def: QuestDef, scope: string, resetKey: string, slotIndex: number | null): UserQuest {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO user_quests (id, user_id, quest_def_id, scope, reset_key, slot_index, progress, target, status, assigned_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'ACTIVE', ?)
    `).run(id, userId, def.id, scope, resetKey, slotIndex, def.target, now);

    return {
        id, user_id: userId, quest_def_id: def.id, scope, reset_key: resetKey,
        slot_index: slotIndex, progress: 0, target: def.target, status: 'ACTIVE',
        assigned_at: now, completed_at: null, claimed_at: null,
        name: def.name, description: def.description, type: def.type,
        params_json: def.params_json, rewards_json: def.rewards_json, category: def.category,
    };
}

// ── 유저 진행 상태 조회 (해금 단계) ──

function getUserProgress(userId: string): { unlockedStage: number; unlockedCosts: Record<string, boolean> } {
    const progress = db.prepare('SELECT unlockedStage FROM progress WHERE userId = ?').get(userId) as any;
    const unlocks = db.prepare('SELECT unlockedCosts FROM unlocks WHERE userId = ?').get(userId) as any;
    const costs = JSON.parse(unlocks?.unlockedCosts ?? '{"1":true,"2":true}');
    const maxCost = Math.max(...Object.keys(costs).filter(k => costs[k]).map(Number));
    return { unlockedStage: progress?.unlockedStage ?? 2, unlockedCosts: costs };
}

// ════════════════════════════════════════════════════════════
// 1) ensureDaily — 데일리 퀘스트 생성/리셋
// ════════════════════════════════════════════════════════════

export function ensureDaily(userId: string): UserQuest[] {
    const dailyKey = getDailyKeyKST();
    const resets = getUserResets(userId);

    if (resets.last_daily_key === dailyKey) {
        // 이미 오늘 생성됨 → 기존 퀘스트 반환
        return getQuestsWithDefs(userId, 'DAILY', dailyKey);
    }

    // 기존 데일리 만료 처리 (안 한 퀘스트는 그냥 남겨둠)
    const userProg = getUserProgress(userId);
    const maxCost = Math.max(...Object.keys(userProg.unlockedCosts).filter(k => userProg.unlockedCosts[k]).map(Number));

    // 퀘스트 정의 가져오기 (유저 진행에 맞는 것만)
    const allDefs = db.prepare(
        `SELECT * FROM quest_definitions WHERE scope = 'DAILY' AND enabled = 1 AND min_unlocked_stage <= ? AND min_unlocked_cost <= ?`
    ).all(userProg.unlockedStage, maxCost) as QuestDef[];

    const fixedDefs = allDefs.filter(d => d.category === 'FIXED');
    const skillDefs = allDefs.filter(d => d.category === 'SKILL');
    const varietyDefs = allDefs.filter(d => d.category === 'VARIETY');

    const exclude = new Set<string>();
    const quests: UserQuest[] = [];

    // Slot0: 고정
    const fixed = fixedDefs[0] || pickWeightedQuest(allDefs, exclude);
    if (fixed) {
        exclude.add(fixed.id);
        quests.push(assignQuest(userId, fixed, 'DAILY', dailyKey, 0));
    }

    // Slot1: 실력
    const skill = pickWeightedQuest(skillDefs, exclude);
    if (skill) {
        exclude.add(skill.id);
        quests.push(assignQuest(userId, skill, 'DAILY', dailyKey, 1));
    }

    // Slot2: 변주
    const variety = pickWeightedQuest(varietyDefs, exclude);
    if (variety) {
        exclude.add(variety.id);
        quests.push(assignQuest(userId, variety, 'DAILY', dailyKey, 2));
    }

    // 리셋 상태 업데이트
    db.prepare(`
        UPDATE user_resets SET last_daily_key = ?, daily_paid_reroll_count = 0, daily_free_reroll_used_key = NULL, updated_at = datetime('now')
        WHERE user_id = ?
    `).run(dailyKey, userId);

    return quests;
}

// ════════════════════════════════════════════════════════════
// 2) ensureWeekly — 위클리 퀘스트 생성/리셋
// ════════════════════════════════════════════════════════════

export function ensureWeekly(userId: string): UserQuest[] {
    const weekKey = getWeekKeyKST();
    const resets = getUserResets(userId);

    if (resets.last_week_key === weekKey) {
        return getQuestsWithDefs(userId, 'WEEKLY', weekKey);
    }

    const userProg = getUserProgress(userId);
    const maxCost = Math.max(...Object.keys(userProg.unlockedCosts).filter(k => userProg.unlockedCosts[k]).map(Number));

    const weeklyDefs = db.prepare(
        `SELECT * FROM quest_definitions WHERE scope = 'WEEKLY' AND enabled = 1 AND min_unlocked_stage <= ? AND min_unlocked_cost <= ?`
    ).all(userProg.unlockedStage, maxCost) as QuestDef[];

    const exclude = new Set<string>();
    const quests: UserQuest[] = [];

    // 위클리 6개 할당 (있는 만큼)
    const count = Math.min(6, weeklyDefs.length);
    for (let i = 0; i < count; i++) {
        const def = pickWeightedQuest(weeklyDefs, exclude);
        if (def) {
            exclude.add(def.id);
            quests.push(assignQuest(userId, def, 'WEEKLY', weekKey, i));
        }
    }

    // 주간 포인트 초기화
    db.prepare(`
        INSERT INTO user_weekly (user_id, week_key, points, claimed_milestones_json, updated_at)
        VALUES (?, ?, 0, '[]', datetime('now'))
        ON CONFLICT(user_id, week_key) DO NOTHING
    `).run(userId, weekKey);

    // 리셋 상태 업데이트
    db.prepare(`UPDATE user_resets SET last_week_key = ?, updated_at = datetime('now') WHERE user_id = ?`).run(weekKey, userId);

    return quests;
}

// ── 퀘스트 조회 (정의 join) ──

function getQuestsWithDefs(userId: string, scope: string, resetKey: string): UserQuest[] {
    return db.prepare(`
        SELECT uq.*, qd.name, qd.description, qd.type, qd.params_json, qd.rewards_json, qd.category
        FROM user_quests uq
        JOIN quest_definitions qd ON uq.quest_def_id = qd.id
        WHERE uq.user_id = ? AND uq.scope = ? AND uq.reset_key = ?
        ORDER BY uq.slot_index ASC
    `).all(userId, scope, resetKey) as UserQuest[];
}

// ════════════════════════════════════════════════════════════
// 3) processQuestProgress — runFinish 시 진행 업데이트
// ════════════════════════════════════════════════════════════

export function processQuestProgress(userId: string, payload: RunFinishPayload): string[] {
    const dailyKey = getDailyKeyKST();
    const weekKey = getWeekKeyKST();
    const progressed: string[] = [];

    // 활성 퀘스트 가져오기 (DAILY + WEEKLY)
    const activeQuests = db.prepare(`
        SELECT uq.*, qd.type, qd.params_json, qd.rewards_json, qd.category
        FROM user_quests uq
        JOIN quest_definitions qd ON uq.quest_def_id = qd.id
        WHERE uq.user_id = ? AND uq.status = 'ACTIVE'
        AND ((uq.scope = 'DAILY' AND uq.reset_key = ?) OR (uq.scope = 'WEEKLY' AND uq.reset_key = ?))
    `).all(userId, dailyKey, weekKey) as UserQuest[];

    for (const uq of activeQuests) {
        const delta = calcProgressDelta(uq, payload);
        if (delta <= 0) continue;

        const newProgress = Math.min(uq.progress + delta, uq.target);
        const completed = newProgress >= uq.target;

        if (completed) {
            db.prepare(`UPDATE user_quests SET progress = ?, status = 'COMPLETED', completed_at = datetime('now') WHERE id = ?`)
                .run(newProgress, uq.id);
            db.prepare(`INSERT INTO user_quest_history (user_id, quest_def_id, completed_at) VALUES (?, ?, datetime('now'))`)
                .run(userId, uq.quest_def_id);
        } else {
            db.prepare(`UPDATE user_quests SET progress = ? WHERE id = ?`).run(newProgress, uq.id);
        }

        progressed.push(uq.quest_def_id);
    }

    return progressed;
}

// ── delta 계산 ──

function calcProgressDelta(uq: UserQuest, payload: RunFinishPayload): number {
    const params = JSON.parse(uq.params_json ?? '{}');

    switch (uq.type) {
        case 'PLAY_RUN':
        case 'ACCUM_PLAY_RUN':
            return 1;

        case 'KILL_BOSS':
        case 'ACCUM_KILL_BOSS':
            return payload.bossKilled ? 1 : 0;

        case 'BOSS_GRADE_AT_LEAST':
        case 'ACCUM_BOSS_GRADE_AT_LEAST':
            return (payload.bossKilled && isGradeBetterOrEqual(payload.bossGrade, params.grade)) ? 1 : 0;

        case 'CLEAR_STAGE':
        case 'ACCUM_CLEAR_STAGE':
            return payload.cleared ? 1 : 0;

        case 'CLEAR_HIGHEST_UNLOCKED_STAGE': {
            if (!payload.cleared) return 0;
            const userProg = getUserProgress(uq.user_id);
            return payload.stageId >= userProg.unlockedStage ? 1 : 0;
        }

        case 'ACCUM_REROLL':
            return payload.stats.rerollCount;

        case 'ACCUM_XP_BUY':
            return payload.stats.xpBought;

        case 'HIGHEST_STAR_AT_LEAST':
        case 'ACCUM_HIGHEST_STAR_AT_LEAST':
            return payload.stats.highestStar >= (params.star ?? 3) ? 1 : 0;

        case 'SYNERGY_TIER_AT_LEAST':
        case 'ACCUM_SYNERGY_TIER_AT_LEAST': {
            const tier = params.tier ?? 4;
            if (params.any) {
                return Object.values(payload.stats.synergyMax).some(v => v >= tier) ? 1 : 0;
            }
            if (params.origin) {
                return (payload.stats.synergyMax[params.origin] ?? 0) >= tier ? 1 : 0;
            }
            return 0;
        }

        case 'ACCUM_LICENSE7_SHARDS':
            return payload.earnedShards7 ?? 0;

        case 'ACCUM_SPEND_SOFT':
            // Soft 소비는 별도 함수에서 처리
            return 0;

        default:
            return 0;
    }
}

// ════════════════════════════════════════════════════════════
// 4) claimQuest — 퀘스트 수령
// ════════════════════════════════════════════════════════════

export function claimQuest(userId: string, userQuestId: string): { success: boolean; rewards?: any; error?: string } {
    const uq = db.prepare(`
        SELECT uq.*, qd.rewards_json FROM user_quests uq
        JOIN quest_definitions qd ON uq.quest_def_id = qd.id
        WHERE uq.id = ? AND uq.user_id = ?
    `).get(userQuestId, userId) as any;

    if (!uq) return { success: false, error: '퀘스트 없음' };
    if (uq.status !== 'COMPLETED') return { success: false, error: '완료되지 않은 퀘스트' };

    const rewards = JSON.parse(uq.rewards_json ?? '{}');

    // 보상 지급
    if (rewards.soft) {
        db.prepare('UPDATE wallet SET soft = soft + ? WHERE userId = ?').run(rewards.soft, userId);
    }
    if (rewards.shards7) {
        db.prepare('UPDATE unlocks SET license7Shards = license7Shards + ? WHERE userId = ?').run(rewards.shards7, userId);
    }
    if (rewards.shards10) {
        db.prepare('UPDATE unlocks SET license10Shards = license10Shards + ? WHERE userId = ?').run(rewards.shards10, userId);
    }

    // 주간 포인트 반영
    if (rewards.weeklyPoints && uq.scope === 'WEEKLY') {
        const weekKey = getWeekKeyKST();
        db.prepare(`UPDATE user_weekly SET points = points + ?, updated_at = datetime('now') WHERE user_id = ? AND week_key = ?`)
            .run(rewards.weeklyPoints, userId, weekKey);
    }

    // 상태 업데이트
    db.prepare(`UPDATE user_quests SET status = 'CLAIMED', claimed_at = datetime('now') WHERE id = ?`).run(userQuestId);

    return { success: true, rewards };
}

// ════════════════════════════════════════════════════════════
// 5) rerollQuest — 데일리 퀘스트 리롤
// ════════════════════════════════════════════════════════════

const REROLL_COSTS = [0, 30, 60, 120];

export function rerollQuest(userId: string, slotIndex: number): { success: boolean; cost: number; newQuest?: UserQuest; error?: string } {
    if (slotIndex !== 1 && slotIndex !== 2) {
        return { success: false, cost: 0, error: 'Slot0(고정)은 리롤 불가' };
    }

    const dailyKey = getDailyKeyKST();
    const resets = getUserResets(userId);

    // 비용 계산
    const freeUsed = resets.daily_free_reroll_used_key === dailyKey;
    const paidCount = resets.daily_paid_reroll_count ?? 0;
    const cost = freeUsed ? REROLL_COSTS[Math.min(paidCount + 1, REROLL_COSTS.length - 1)] : 0;

    // Soft 체크 & 차감
    if (cost > 0) {
        const wallet = db.prepare('SELECT soft FROM wallet WHERE userId = ?').get(userId) as any;
        if ((wallet?.soft ?? 0) < cost) {
            return { success: false, cost, error: 'Soft 부족' };
        }
        db.prepare('UPDATE wallet SET soft = soft - ? WHERE userId = ?').run(cost, userId);
    }

    // 현재 슬롯 퀘스트 찾기
    const current = db.prepare(
        `SELECT * FROM user_quests WHERE user_id = ? AND scope = 'DAILY' AND reset_key = ? AND slot_index = ?`
    ).get(userId, dailyKey, slotIndex) as any;

    if (!current) return { success: false, cost: 0, error: '해당 슬롯에 퀘스트 없음' };
    if (current.status === 'CLAIMED') return { success: false, cost: 0, error: '이미 수령한 퀘스트는 리롤 불가' };

    // 현재 데일리에 있는 defId 제외
    const currentDefs = db.prepare(
        `SELECT quest_def_id FROM user_quests WHERE user_id = ? AND scope = 'DAILY' AND reset_key = ?`
    ).all(userId, dailyKey) as any[];
    const exclude = new Set<string>(currentDefs.map((r: any) => r.quest_def_id));

    // 새 퀘스트 뽑기
    const userProg = getUserProgress(userId);
    const maxCost = Math.max(...Object.keys(userProg.unlockedCosts).filter(k => userProg.unlockedCosts[k]).map(Number));
    const category = slotIndex === 1 ? 'SKILL' : 'VARIETY';

    const candidates = db.prepare(
        `SELECT * FROM quest_definitions WHERE scope = 'DAILY' AND category = ? AND enabled = 1 AND min_unlocked_stage <= ? AND min_unlocked_cost <= ?`
    ).all(category, userProg.unlockedStage, maxCost) as QuestDef[];

    const newDef = pickWeightedQuest(candidates, exclude);
    if (!newDef) return { success: false, cost: 0, error: '리롤 가능한 퀘스트가 없음' };

    // 기존 퀘스트 삭제 + 새 퀘스트 할당
    db.prepare('DELETE FROM user_quests WHERE id = ?').run(current.id);
    const newQuest = assignQuest(userId, newDef, 'DAILY', dailyKey, slotIndex);

    // 리셋 상태 업데이트
    if (!freeUsed) {
        db.prepare(`UPDATE user_resets SET daily_free_reroll_used_key = ?, updated_at = datetime('now') WHERE user_id = ?`)
            .run(dailyKey, userId);
    } else {
        db.prepare(`UPDATE user_resets SET daily_paid_reroll_count = daily_paid_reroll_count + 1, updated_at = datetime('now') WHERE user_id = ?`)
            .run(userId);
    }

    return { success: true, cost, newQuest };
}

// ════════════════════════════════════════════════════════════
// 6) 주간 마일스톤 수령
// ════════════════════════════════════════════════════════════

const WEEKLY_MILESTONES: Record<number, { soft: number; shards7: number; shards10: number }> = {
    30: { soft: 150, shards7: 5, shards10: 0 },
    60: { soft: 250, shards7: 10, shards10: 0 },
    100: { soft: 400, shards7: 15, shards10: 3 },
};

export function claimWeeklyMilestone(userId: string, tier: number): { success: boolean; rewards?: any; error?: string } {
    const weekKey = getWeekKeyKST();
    const weekly = db.prepare('SELECT * FROM user_weekly WHERE user_id = ? AND week_key = ?').get(userId, weekKey) as any;

    if (!weekly) return { success: false, error: '주간 데이터 없음' };
    if (weekly.points < tier) return { success: false, error: '포인트 부족' };

    const claimed: number[] = JSON.parse(weekly.claimed_milestones_json ?? '[]');
    if (claimed.includes(tier)) return { success: false, error: '이미 수령' };

    const rewards = WEEKLY_MILESTONES[tier];
    if (!rewards) return { success: false, error: '잘못된 마일스톤' };

    // 보상 지급
    if (rewards.soft) db.prepare('UPDATE wallet SET soft = soft + ? WHERE userId = ?').run(rewards.soft, userId);
    if (rewards.shards7) db.prepare('UPDATE unlocks SET license7Shards = license7Shards + ? WHERE userId = ?').run(rewards.shards7, userId);
    if (rewards.shards10) db.prepare('UPDATE unlocks SET license10Shards = license10Shards + ? WHERE userId = ?').run(rewards.shards10, userId);

    // 수령 기록
    claimed.push(tier);
    db.prepare('UPDATE user_weekly SET claimed_milestones_json = ?, updated_at = datetime(\'now\') WHERE user_id = ? AND week_key = ?')
        .run(JSON.stringify(claimed), userId, weekKey);

    return { success: true, rewards };
}

// ── 주간 상태 조회 ──

export function getWeeklyState(userId: string): WeeklyState {
    const weekKey = getWeekKeyKST();
    const row = db.prepare('SELECT * FROM user_weekly WHERE user_id = ? AND week_key = ?').get(userId, weekKey) as any;
    return {
        points: row?.points ?? 0,
        claimedMilestones: JSON.parse(row?.claimed_milestones_json ?? '[]'),
    };
}

// ── 리롤 상태 조회 ──

export function getRerollState(userId: string): { freeUsed: boolean; paidCount: number; nextCost: number } {
    const dailyKey = getDailyKeyKST();
    const resets = getUserResets(userId);
    const freeUsed = resets.daily_free_reroll_used_key === dailyKey;
    const paidCount = resets.daily_paid_reroll_count ?? 0;
    const nextCost = freeUsed ? REROLL_COSTS[Math.min(paidCount + 1, REROLL_COSTS.length - 1)] : 0;
    return { freeUsed, paidCount, nextCost };
}
