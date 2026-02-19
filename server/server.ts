// ============================================================
// Server — Express + Socket.io (port 3001)
// ============================================================

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import authRoutes, { JWT_SECRET } from './routes/auth.js';
import meRoutes from './routes/me.js';
import runRoutes from './routes/run.js';
import missionRoutes from './routes/missions.js';
import questRoutes from './routes/quests.js';
import { setupMultiplayer } from './multiplayer.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// ── HTTP Server (for Socket.io) ──
const httpServer = createServer(app);

// ── Middleware ──
app.use(cors());
app.use(express.json());

// JWT middleware (skip auth & health)
app.use('/api', (req, res, next) => {
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

// ── Socket.io Multiplayer ──
setupMultiplayer(httpServer);

// ── Production: serve Vite build ──
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// Landing page: dashboard
app.get('/', (_req, res) => {
    res.sendFile(path.join(distPath, 'dashboard.html'));
});

// Game page
app.get('/game', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

// SPA fallback (API 외 나머지)
app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

// ── Start ──
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] CoinRandomDefense running on port ${PORT}`);
    console.log(`[Server] REST: /api/auth, /api/me, /api/run, /api/missions, /api/quests`);
    console.log(`[Server] Socket.io: ws://localhost:${PORT}/socket.io`);
});
