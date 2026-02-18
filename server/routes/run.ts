// ============================================================
// Run Routes — Start / Finish combat run
// ============================================================

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { processRunFinish, getUserState } from '../services/rewardService.js';
import { processQuestProgress } from '../services/questService.js';

const router = Router();

// POST /api/run/start
router.post('/start', (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { stageId } = req.body;
    if (!stageId) return res.status(400).json({ error: 'stageId required' });

    // 스테이지 해금 체크
    const progress = db.prepare('SELECT unlockedStage FROM progress WHERE userId = ?').get(userId) as any;
    if (stageId > (progress?.unlockedStage ?? 2)) {
        return res.status(403).json({ error: 'Stage locked' });
    }

    const runId = uuidv4();
    db.prepare('INSERT INTO run_history (id, userId, stageId) VALUES (?, ?, ?)').run(runId, userId, stageId);

    res.json({ runId });
});

// POST /api/run/finish
router.post('/finish', (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { runId, stageId, reachedRound, cleared, bossGrades, stats } = req.body;
    if (!runId || !stageId) return res.status(400).json({ error: 'Missing fields' });

    // ── Anti-Cheat Sanity Check ──
    const run = db.prepare('SELECT stageId, createdAt FROM run_history WHERE id = ? AND userId = ?').get(runId, userId) as any;
    if (!run) {
        return res.status(403).json({ error: 'Invalid or unauthorized runId' });
    }

    // 1) stageId 일치 검증
    if (run.stageId !== stageId) {
        console.warn(`[ANTI-CHEAT] userId=${userId} stageId mismatch: started=${run.stageId}, claimed=${stageId}`);
        return res.status(403).json({ error: 'Stage mismatch' });
    }

    // 2) 최소 플레이 시간 검증 (라운드당 최소 5초)
    const startTime = new Date(run.createdAt + 'Z').getTime();
    const elapsed = (Date.now() - startTime) / 1000;
    const minSeconds = Math.max(10, (reachedRound ?? 1) * 5);
    if (elapsed < minSeconds) {
        console.warn(`[ANTI-CHEAT] userId=${userId} too fast: ${elapsed.toFixed(1)}s for ${reachedRound} rounds (min ${minSeconds}s)`);
        return res.status(403).json({ error: 'Abnormal clear speed' });
    }

    // 3) 라운드 한도 검증 (스테이지별 최대 라운드)
    const STAGE_MAX_ROUNDS: Record<number, number> = { 1: 3, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 7 };
    const maxRound = STAGE_MAX_ROUNDS[stageId] ?? 7;
    if ((reachedRound ?? 0) > maxRound) {
        console.warn(`[ANTI-CHEAT] userId=${userId} impossible round: ${reachedRound} > max ${maxRound} for stage ${stageId}`);
        return res.status(403).json({ error: 'Invalid round count' });
    }

    // run_history 업데이트 (stats JSON 포함)
    db.prepare(`
        UPDATE run_history SET reachedRound = ?, cleared = ?, bossGrades = ?, stats = ? WHERE id = ? AND userId = ?
    `).run(reachedRound ?? 0, cleared ? 1 : 0, JSON.stringify(bossGrades ?? {}), JSON.stringify(stats ?? {}), runId, userId);

    // 보상 + 해금 + 구 미션 처리
    const result = processRunFinish(userId, stageId, reachedRound ?? 0, !!cleared, bossGrades ?? {}, stats);

    // run_history에 보상 기록
    db.prepare('UPDATE run_history SET softReward = ?, shardsReward = ? WHERE id = ?')
        .run(result.rewards.soft, result.rewards.shards7 + result.rewards.shards10, runId);

    // ── PRO 퀘스트 진행 ──
    const bossKeys = Object.keys(bossGrades ?? {});
    const bestGrade = bossKeys.length > 0
        ? Object.values(bossGrades as Record<string, string>).sort((a, b) => {
            const order = ['S', 'A', 'B', 'F'];
            return order.indexOf(a) - order.indexOf(b);
        })[0]
        : 'F';

    const questPayload = {
        stageId,
        cleared: !!cleared,
        reachedRound: reachedRound ?? 0,
        bossKilled: bossKeys.length > 0,
        bossGrade: bestGrade,
        stats: {
            rerollCount: stats?.rerollCount ?? 0,
            xpBought: stats?.xpBought ?? 0,
            highestStar: stats?.highestStar ?? 1,
            synergyMax: stats?.synergyTiers ?? stats?.synergyMax ?? {},
        },
        earnedShards7: result.rewards.shards7,
    };

    const questProgress = processQuestProgress(userId, questPayload);

    const me = getUserState(userId);

    res.json({
        rewards: result.rewards,
        newUnlocks: result.newUnlocks,
        missionProgress: result.missionProgress,
        questProgress,
        me,
    });
});

export default router;
