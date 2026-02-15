// ============================================================
// Me Route — Single UserState endpoint
// ============================================================

import { Router, Request, Response } from 'express';
import { getUserState } from '../services/rewardService.js';

const router = Router();

// GET /api/me
router.get('/', (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const me = getUserState(userId);
    res.json(me);
});

export default router;
