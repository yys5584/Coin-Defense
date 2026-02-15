// ============================================================
// Mission Routes
// ============================================================

import { Router, Request, Response } from 'express';
import { claimMission, rerollMission, getUserState } from '../services/rewardService.js';

const router = Router();

// GET /api/missions/daily
router.get('/daily', (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const me = getUserState(userId);
    res.json(me.missions);
});

// POST /api/missions/claim
router.post('/claim', (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { missionId } = req.body;
    if (!missionId) return res.status(400).json({ error: 'missionId required' });

    const result = claimMission(userId, missionId);
    if (!result.success) {
        return res.status(400).json({ error: 'Cannot claim mission' });
    }

    const me = getUserState(userId);
    res.json({ reward: result.reward, me });
});

// POST /api/missions/reroll — 미션 리롤
router.post('/reroll', (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { missionIndex } = req.body;
    if (missionIndex === undefined || missionIndex === null) {
        return res.status(400).json({ error: 'missionIndex required' });
    }

    const result = rerollMission(userId, missionIndex);
    if (!result.success) {
        return res.status(400).json({ error: result.error, cost: result.cost });
    }

    const me = getUserState(userId);
    res.json({ cost: result.cost, newMission: result.newMission, me });
});

export default router;

