// ============================================================
// Quest Routes — PRO 퀘스트 시스템 API
// ============================================================

import { Router, Request, Response } from 'express';
import {
    ensureDaily, ensureWeekly,
    claimQuest, rerollQuest,
    claimWeeklyMilestone,
    getWeeklyState, getRerollState,
} from '../services/questService.js';
import { getUserState } from '../services/rewardService.js';

const router = Router();

// GET /api/quests?scope=daily|weekly
router.get('/', (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const scope = (req.query.scope as string)?.toUpperCase() || 'DAILY';

    let quests;
    if (scope === 'WEEKLY') {
        quests = ensureWeekly(userId);
    } else {
        quests = ensureDaily(userId);
    }

    const weekly = getWeeklyState(userId);
    const reroll = getRerollState(userId);

    res.json({ quests, weekly, reroll });
});

// POST /api/quests/claim
router.post('/claim', (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { userQuestId } = req.body;
    if (!userQuestId) return res.status(400).json({ error: 'userQuestId required' });

    const result = claimQuest(userId, userQuestId);
    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }

    const me = getUserState(userId);
    const weekly = getWeeklyState(userId);
    res.json({ rewards: result.rewards, me, weekly });
});

// POST /api/quests/reroll
router.post('/reroll', (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { slotIndex } = req.body;
    if (slotIndex === undefined || slotIndex === null) {
        return res.status(400).json({ error: 'slotIndex required (1 or 2)' });
    }

    const result = rerollQuest(userId, slotIndex);
    if (!result.success) {
        return res.status(400).json({ error: result.error, cost: result.cost });
    }

    const me = getUserState(userId);
    const reroll = getRerollState(userId);
    res.json({ cost: result.cost, newQuest: result.newQuest, me, reroll });
});

// POST /api/weekly/claimMilestone
router.post('/milestone', (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { tier } = req.body;
    if (!tier) return res.status(400).json({ error: 'tier required (30, 60, or 100)' });

    const result = claimWeeklyMilestone(userId, tier);
    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }

    const me = getUserState(userId);
    const weekly = getWeeklyState(userId);
    res.json({ rewards: result.rewards, me, weekly });
});

export default router;
