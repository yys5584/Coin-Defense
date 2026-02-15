// ============================================================
// Auth Routes — Guest login
// ============================================================

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { getUserState } from '../services/rewardService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'coinrd-dev-secret-2026';

const router = Router();

// POST /api/auth/guest
router.post('/guest', (req: Request, res: Response) => {
    const userId = uuidv4();

    db.prepare('INSERT INTO users (id) VALUES (?)').run(userId);
    db.prepare('INSERT INTO profile (userId) VALUES (?)').run(userId);
    db.prepare('INSERT INTO wallet (userId) VALUES (?)').run(userId);
    db.prepare('INSERT INTO progress (userId) VALUES (?)').run(userId);
    db.prepare('INSERT INTO unlocks (userId) VALUES (?)').run(userId);

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
    const me = getUserState(userId);

    res.json({ token, userId, me });
});

export default router;
export { JWT_SECRET };
