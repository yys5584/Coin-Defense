// ============================================================
// Server — Express entry point (port 3001)
// ============================================================

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import authRoutes, { JWT_SECRET } from './routes/auth.js';
import meRoutes from './routes/me.js';
import runRoutes from './routes/run.js';
import missionRoutes from './routes/missions.js';
import questRoutes from './routes/quests.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// ── Middleware ──
app.use(cors());
app.use(express.json());

// JWT 인증 미들웨어 (auth 제외)
app.use('/api', (req, res, next) => {
    // /api/auth, /api/health는 인증 불요
    if (req.path.startsWith('/auth') || req.path === '/health') return next();

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token' });
    }

    try {
        const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as any;
        (req as any).userId = decoded.userId;
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
});

// ── Routes ──
app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/run', runRoutes);
app.use('/api/missions', missionRoutes);
app.use('/api/quests', questRoutes);

// ── Health check ──
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Production: serve Vite build ──
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// SPA fallback: non-API routes → index.html
app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

// ── Start ──
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] CoinRandomDefense PRO running on port ${PORT}`);
    console.log(`[Server] Routes: /api/auth, /api/me, /api/run, /api/missions, /api/quests`);
});
