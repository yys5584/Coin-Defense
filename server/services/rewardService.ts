// ============================================================
// RewardService — 보상/해금/미션 처리
// ============================================================

import db from '../db.js';
import { UserState, DailyMission, UNLOCK_MAP, GRADE_ORDER, isGradeBetterOrEqual } from '../types.js';

// ── UserState 조회 ──
export function getUserState(userId: string): UserState {
    const profile = db.prepare('SELECT * FROM profile WHERE userId = ?').get(userId) as any;
    const wallet = db.prepare('SELECT * FROM wallet WHERE userId = ?').get(userId) as any;
    const progress = db.prepare('SELECT * FROM progress WHERE userId = ?').get(userId) as any;
    const unlocks = db.prepare('SELECT * FROM unlocks WHERE userId = ?').get(userId) as any;
    const missions = db.prepare('SELECT * FROM missions WHERE userId = ?').get(userId) as any;

    // 미션 리셋 체크
    const missionData = ensureDailyMissions(userId, missions);

    return {
        userId,
        profile: {
            nickname: profile?.nickname ?? 'Player',
        },
        wallet: {
            soft: wallet?.soft ?? 0,
            hard: wallet?.hard ?? 0,
        },
        progress: {
            unlockedStage: progress?.unlockedStage ?? 2,
            bestRound: progress?.bestRound ?? 0,
            bestBossGrades: JSON.parse(progress?.bestBossGrades ?? '{}'),
        },
        unlocks: {
            unlockedCosts: JSON.parse(unlocks?.unlockedCosts ?? '{"1":true,"2":true}'),
            license7: !!(unlocks?.license7),
            license10: !!(unlocks?.license10),
            license7Shards: unlocks?.license7Shards ?? 0,
            license10Shards: unlocks?.license10Shards ?? 0,
        },
        missions: {
            daily: missionData.daily,
            dailyResetAt: missions?.dailyResetAt ?? new Date().toISOString(),
            rerollsUsed: missionData.rerollsUsed,
        },
    };
}

// ════════════════════════════════════════════════════════════
// 퀘스트 풀 시스템
// ════════════════════════════════════════════════════════════

interface QuestDef {
    type: string;
    category: 'fixed' | 'skill' | 'variety';
    desc: string;
    target: number;
    reward: DailyMission['reward'];
}

const QUEST_POOL: QuestDef[] = [
    // ── 고정 (매일 1개 확정) ──
    { type: 'PLAY_RUN', category: 'fixed', desc: '캠페인 1회 플레이', target: 1, reward: { soft: 50 } },

    // ── 기술 (1개 랜덤) ──
    { type: 'BOSS_GRADE_B', category: 'skill', desc: '보스 B등급 이상 1회', target: 1, reward: { soft: 40, shards7: 5 } },
    { type: 'BOSS_GRADE_A', category: 'skill', desc: '보스 A등급 이상 1회', target: 1, reward: { soft: 60, shards7: 5 } },
    { type: 'CLEAR_STAGE', category: 'skill', desc: '스테이지 클리어 1회', target: 1, reward: { soft: 80, shards7: 3 } },

    // ── 변주 (1개 랜덤) ──
    { type: 'KILL_BOSS', category: 'variety', desc: '보스 1회 처치', target: 1, reward: { soft: 30 } },
    { type: 'KILL_BOSS_2', category: 'variety', desc: '보스 2회 처치', target: 2, reward: { soft: 50 } },
    { type: 'REACH_ROUND_20', category: 'variety', desc: 'R20 이상 도달', target: 1, reward: { soft: 40 } },
    { type: 'HIGHEST_STAR_3', category: 'variety', desc: '★3 유닛 1개 만들기', target: 1, reward: { soft: 40 } },
    { type: 'REROLL_10', category: 'variety', desc: '리롤 10회 사용', target: 1, reward: { soft: 30 } },
    { type: 'XP_BUY_5', category: 'variety', desc: 'XP 5회 구매', target: 1, reward: { soft: 30 } },
];

function pickRandomFromCategory(category: string, exclude: Set<string>): QuestDef {
    const pool = QUEST_POOL.filter(q => q.category === category && !exclude.has(q.type));
    if (pool.length === 0) {
        return QUEST_POOL.filter(q => q.category === category)[0];
    }
    return pool[Math.floor(Math.random() * pool.length)];
}

function generateDailyMissions(): DailyMission[] {
    const chosen = new Set<string>();
    const missions: DailyMission[] = [];
    const ts = Date.now();

    // 1) 고정 1개
    const fixed = pickRandomFromCategory('fixed', chosen);
    chosen.add(fixed.type);
    missions.push({ id: `daily_${ts}_0`, type: fixed.type, desc: fixed.desc, target: fixed.target, current: 0, claimed: false, reward: { ...fixed.reward } });

    // 2) 기술 1개
    const skill = pickRandomFromCategory('skill', chosen);
    chosen.add(skill.type);
    missions.push({ id: `daily_${ts}_1`, type: skill.type, desc: skill.desc, target: skill.target, current: 0, claimed: false, reward: { ...skill.reward } });

    // 3) 변주 1개
    const variety = pickRandomFromCategory('variety', chosen);
    chosen.add(variety.type);
    missions.push({ id: `daily_${ts}_2`, type: variety.type, desc: variety.desc, target: variety.target, current: 0, claimed: false, reward: { ...variety.reward } });

    return missions;
}

function ensureDailyMissions(userId: string, missions: any): { daily: DailyMission[]; rerollsUsed: number } {
    const now = new Date();
    const resetAt = missions?.dailyResetAt ? new Date(missions.dailyResetAt) : new Date(0);
    const needReset = now.getTime() - resetAt.getTime() > 24 * 60 * 60 * 1000;

    if (!missions || needReset) {
        const freshMissions = generateDailyMissions();
        db.prepare(`
            INSERT INTO missions (userId, daily, dailyResetAt, rerollsUsed)
            VALUES (?, ?, datetime('now'), 0)
            ON CONFLICT(userId) DO UPDATE SET daily = excluded.daily, dailyResetAt = excluded.dailyResetAt, rerollsUsed = 0
        `).run(userId, JSON.stringify(freshMissions));
        return { daily: freshMissions, rerollsUsed: 0 };
    }

    return {
        daily: JSON.parse(missions.daily ?? '[]'),
        rerollsUsed: missions.rerollsUsed ?? 0,
    };
}

// ── 등급 보상 테이블 ──
const GRADE_SOFT_REWARD: Record<string, number> = {
    'S': 100, 'A': 60, 'B': 30, 'F': 0,
};

// ── 런 종료 처리 ──
export function processRunFinish(
    userId: string,
    stageId: number,
    reachedRound: number,
    cleared: boolean,
    bossGrades: Record<string, string>,
    stats?: { rerollCount?: number; highestStar?: number; synergyTiers?: Record<string, number>; totalBossKills?: number; xpBought?: number },
): { rewards: { soft: number; shards7: number; shards10: number }; newUnlocks: string[]; missionProgress: string[] } {
    const rewards = { soft: 0, shards7: 0, shards10: 0 };
    const newUnlocks: string[] = [];
    const missionProgress: string[] = [];

    // 1) 등급별 보상
    for (const [round, grade] of Object.entries(bossGrades)) {
        rewards.soft += GRADE_SOFT_REWARD[grade] ?? 0;
        if (isGradeBetterOrEqual(grade, 'B')) {
            rewards.shards7 += 5;
        }
        if (grade === 'S') {
            rewards.shards10 += 3;
        }
    }

    // 2) 클리어 보너스
    if (cleared) {
        rewards.soft += 50;
        rewards.shards7 += 10;
    }

    // 3) 지갑 + 조각 업데이트
    db.prepare('UPDATE wallet SET soft = soft + ? WHERE userId = ?').run(rewards.soft, userId);
    if (rewards.shards7 > 0) {
        db.prepare('UPDATE unlocks SET license7Shards = license7Shards + ? WHERE userId = ?').run(rewards.shards7, userId);
    }
    if (rewards.shards10 > 0) {
        db.prepare('UPDATE unlocks SET license10Shards = license10Shards + ? WHERE userId = ?').run(rewards.shards10, userId);
    }

    // 4) 최고 라운드 업데이트
    const progress = db.prepare('SELECT * FROM progress WHERE userId = ?').get(userId) as any;
    if (reachedRound > (progress?.bestRound ?? 0)) {
        db.prepare('UPDATE progress SET bestRound = ? WHERE userId = ?').run(reachedRound, userId);
    }

    // 4b) 보스 등급 기록
    const savedGrades = JSON.parse(progress?.bestBossGrades ?? '{}');
    for (const [round, grade] of Object.entries(bossGrades)) {
        const stageKey = `S${stageId}`;
        if (!savedGrades[stageKey]) savedGrades[stageKey] = {};
        const prev = savedGrades[stageKey][round];
        if (!prev || GRADE_ORDER.indexOf(grade as any) < GRADE_ORDER.indexOf(prev as any)) {
            savedGrades[stageKey][round] = grade;
        }
    }
    db.prepare('UPDATE progress SET bestBossGrades = ? WHERE userId = ?').run(JSON.stringify(savedGrades), userId);

    // 5) 해금 체크
    const unlocks = db.prepare('SELECT * FROM unlocks WHERE userId = ?').get(userId) as any;
    const currentUnlockedCosts = JSON.parse(unlocks?.unlockedCosts ?? '{}');
    const currentStage = progress?.unlockedStage ?? 2;

    for (const [key, rule] of Object.entries(UNLOCK_MAP)) {
        const ruleStageKey = `S${rule.needStage}`;
        const bossRound = `R${rule.needStage * 10}`;
        const bestGrade = savedGrades[ruleStageKey]?.[bossRound];

        if (bestGrade && (rule.needBossGrade === 'C' || isGradeBetterOrEqual(bestGrade, rule.needBossGrade))) {
            if (rule.unlockStage > currentStage) {
                db.prepare('UPDATE progress SET unlockedStage = ? WHERE userId = ?').run(rule.unlockStage, userId);
                newUnlocks.push(`stage:${rule.unlockStage}`);
            }
            if (rule.unlockCost && !currentUnlockedCosts[String(rule.unlockCost)]) {
                currentUnlockedCosts[String(rule.unlockCost)] = true;
                db.prepare('UPDATE unlocks SET unlockedCosts = ? WHERE userId = ?').run(JSON.stringify(currentUnlockedCosts), userId);
                newUnlocks.push(`cost:${rule.unlockCost}`);
            }
        }
    }

    // 6) 미션 진행 (타입 기반)
    const missionsRow = db.prepare('SELECT * FROM missions WHERE userId = ?').get(userId) as any;
    const dailyMissions: DailyMission[] = JSON.parse(missionsRow?.daily ?? '[]');
    const bossKills = Object.keys(bossGrades).length;
    const hasGradeB = Object.values(bossGrades).some(g => isGradeBetterOrEqual(g, 'B'));
    const hasGradeA = Object.values(bossGrades).some(g => isGradeBetterOrEqual(g, 'A'));

    for (const m of dailyMissions) {
        if (m.claimed) continue;
        let progressed = false;

        switch (m.type) {
            case 'PLAY_RUN':
                m.current = Math.min(m.current + 1, m.target);
                progressed = true;
                break;
            case 'KILL_BOSS':
            case 'KILL_BOSS_2':
                if (bossKills > 0) {
                    m.current = Math.min(m.current + bossKills, m.target);
                    progressed = true;
                }
                break;
            case 'BOSS_GRADE_B':
                if (hasGradeB) { m.current = Math.min(m.current + 1, m.target); progressed = true; }
                break;
            case 'BOSS_GRADE_A':
                if (hasGradeA) { m.current = Math.min(m.current + 1, m.target); progressed = true; }
                break;
            case 'CLEAR_STAGE':
                if (cleared) { m.current = Math.min(m.current + 1, m.target); progressed = true; }
                break;
            case 'REACH_ROUND_20':
                if (reachedRound >= 20) { m.current = Math.min(m.current + 1, m.target); progressed = true; }
                break;
            case 'HIGHEST_STAR_3':
                if (stats?.highestStar && stats.highestStar >= 3) { m.current = Math.min(m.current + 1, m.target); progressed = true; }
                break;
            case 'REROLL_10':
                if (stats?.rerollCount && stats.rerollCount >= 10) { m.current = Math.min(m.current + 1, m.target); progressed = true; }
                break;
            case 'XP_BUY_5':
                if (stats?.xpBought && stats.xpBought >= 5) { m.current = Math.min(m.current + 1, m.target); progressed = true; }
                break;
        }

        if (progressed) missionProgress.push(m.type);
    }

    db.prepare('UPDATE missions SET daily = ? WHERE userId = ?').run(JSON.stringify(dailyMissions), userId);

    return { rewards, newUnlocks, missionProgress };
}

// ── 미션 수령 ──
export function claimMission(userId: string, missionId: string): { success: boolean; reward?: DailyMission['reward'] } {
    const missionsRow = db.prepare('SELECT * FROM missions WHERE userId = ?').get(userId) as any;
    const dailyMissions: DailyMission[] = JSON.parse(missionsRow?.daily ?? '[]');

    const mission = dailyMissions.find(m => m.id === missionId);
    if (!mission || mission.claimed || mission.current < mission.target) {
        return { success: false };
    }

    mission.claimed = true;
    db.prepare('UPDATE missions SET daily = ? WHERE userId = ?').run(JSON.stringify(dailyMissions), userId);

    if (mission.reward.soft) {
        db.prepare('UPDATE wallet SET soft = soft + ? WHERE userId = ?').run(mission.reward.soft, userId);
    }
    if (mission.reward.shards7) {
        db.prepare('UPDATE unlocks SET license7Shards = license7Shards + ? WHERE userId = ?').run(mission.reward.shards7, userId);
    }
    if (mission.reward.shards10) {
        db.prepare('UPDATE unlocks SET license10Shards = license10Shards + ? WHERE userId = ?').run(mission.reward.shards10, userId);
    }

    return { success: true, reward: mission.reward };
}

// ── 미션 리롤 ──
const REROLL_COSTS = [0, 30, 60, 100]; // 1회 무료, 이후 점증

export function rerollMission(userId: string, missionIndex: number): { success: boolean; cost: number; newMission?: DailyMission; error?: string } {
    const missionsRow = db.prepare('SELECT * FROM missions WHERE userId = ?').get(userId) as any;
    const dailyMissions: DailyMission[] = JSON.parse(missionsRow?.daily ?? '[]');
    const rerollsUsed = missionsRow?.rerollsUsed ?? 0;

    if (missionIndex < 0 || missionIndex >= dailyMissions.length) {
        return { success: false, cost: 0, error: '잘못된 미션 인덱스' };
    }

    const target = dailyMissions[missionIndex];
    if (target.claimed) {
        return { success: false, cost: 0, error: '이미 수령한 미션은 리롤 불가' };
    }

    const cost = REROLL_COSTS[Math.min(rerollsUsed, REROLL_COSTS.length - 1)];

    if (cost > 0) {
        const wallet = db.prepare('SELECT soft FROM wallet WHERE userId = ?').get(userId) as any;
        if ((wallet?.soft ?? 0) < cost) {
            return { success: false, cost, error: 'Soft 부족' };
        }
        db.prepare('UPDATE wallet SET soft = soft - ? WHERE userId = ?').run(cost, userId);
    }

    // 기존 미션 타입 제외하고 같은 카테고리에서 새 미션 뽑기
    const existingTypes = new Set(dailyMissions.map(m => m.type));
    const oldDef = QUEST_POOL.find(q => q.type === target.type);
    const category = oldDef?.category ?? 'variety';
    const newDef = pickRandomFromCategory(category, existingTypes);

    const newMission: DailyMission = {
        id: `daily_${Date.now()}_${missionIndex}`,
        type: newDef.type,
        desc: newDef.desc,
        target: newDef.target,
        current: 0,
        claimed: false,
        reward: { ...newDef.reward },
    };

    dailyMissions[missionIndex] = newMission;
    db.prepare('UPDATE missions SET daily = ?, rerollsUsed = ? WHERE userId = ?')
        .run(JSON.stringify(dailyMissions), rerollsUsed + 1, userId);

    return { success: true, cost, newMission };
}
