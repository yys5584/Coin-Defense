// ============================================================
// DB — SQLite 초기화 + 마이그레이션
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB 경로: 환경변수 DB_PATH (Railway 영구 볼륨) 우선, 없으면 로컬
const DB_PATH = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, 'data', 'coinrd.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── 마이그레이션 ──
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        lastLoginAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profile (
        userId TEXT PRIMARY KEY REFERENCES users(id),
        nickname TEXT NOT NULL DEFAULT 'Player'
    );

    CREATE TABLE IF NOT EXISTS wallet (
        userId TEXT PRIMARY KEY REFERENCES users(id),
        soft INTEGER NOT NULL DEFAULT 0,
        hard INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS progress (
        userId TEXT PRIMARY KEY REFERENCES users(id),
        unlockedStage INTEGER NOT NULL DEFAULT 2,
        bestRound INTEGER NOT NULL DEFAULT 0,
        bestBossGrades TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS unlocks (
        userId TEXT PRIMARY KEY REFERENCES users(id),
        unlockedCosts TEXT NOT NULL DEFAULT '{"1":true,"2":true}',
        license7 INTEGER NOT NULL DEFAULT 0,
        license10 INTEGER NOT NULL DEFAULT 0,
        license7Shards INTEGER NOT NULL DEFAULT 0,
        license10Shards INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS missions (
        userId TEXT PRIMARY KEY REFERENCES users(id),
        daily TEXT NOT NULL DEFAULT '[]',
        dailyResetAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS run_history (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL REFERENCES users(id),
        stageId INTEGER NOT NULL,
        reachedRound INTEGER NOT NULL DEFAULT 0,
        cleared INTEGER NOT NULL DEFAULT 0,
        bossGrades TEXT NOT NULL DEFAULT '{}',
        softReward INTEGER NOT NULL DEFAULT 0,
        shardsReward INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

// ── 마이그레이션: stats 컬럼 추가 ──
try {
    db.exec(`ALTER TABLE run_history ADD COLUMN stats TEXT NOT NULL DEFAULT '{}'`);
} catch (_) { /* 이미 존재하면 무시 */ }

// ── 마이그레이션: rerollsUsed 컬럼 추가 ──
try {
    db.exec(`ALTER TABLE missions ADD COLUMN rerollsUsed INTEGER NOT NULL DEFAULT 0`);
} catch (_) { /* 이미 존재하면 무시 */ }

// ════════════════════════════════════════════════════════════
// PRO 퀘스트 시스템 테이블
// ════════════════════════════════════════════════════════════

db.exec(`
    CREATE TABLE IF NOT EXISTS quest_definitions (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('DAILY','WEEKLY','EVENT')),
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL,
        params_json TEXT NOT NULL DEFAULT '{}',
        target INTEGER NOT NULL DEFAULT 1,
        rewards_json TEXT NOT NULL DEFAULT '{}',
        weight INTEGER NOT NULL DEFAULT 100,
        min_unlocked_stage INTEGER NOT NULL DEFAULT 1,
        min_unlocked_cost INTEGER NOT NULL DEFAULT 1,
        active_from TEXT,
        active_to TEXT,
        enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_qdef_scope_cat
        ON quest_definitions(scope, category, enabled);

    CREATE TABLE IF NOT EXISTS user_quests (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        quest_def_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('DAILY','WEEKLY','EVENT')),
        reset_key TEXT NOT NULL,
        slot_index INTEGER,
        progress INTEGER NOT NULL DEFAULT 0,
        target INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ACTIVE','COMPLETED','CLAIMED')) DEFAULT 'ACTIVE',
        assigned_at TEXT NOT NULL,
        completed_at TEXT,
        claimed_at TEXT,
        rerolled_from_id TEXT,
        FOREIGN KEY (quest_def_id) REFERENCES quest_definitions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_uq_user_scope_key
        ON user_quests(user_id, scope, reset_key);

    CREATE INDEX IF NOT EXISTS idx_uq_user_status
        ON user_quests(user_id, status);

    CREATE TABLE IF NOT EXISTS user_quest_history (
        user_id TEXT NOT NULL,
        quest_def_id TEXT NOT NULL,
        completed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_uqh_user_time
        ON user_quest_history(user_id, completed_at);

    CREATE TABLE IF NOT EXISTS user_resets (
        user_id TEXT PRIMARY KEY,
        last_daily_key TEXT,
        last_week_key TEXT,
        daily_free_reroll_used_key TEXT,
        daily_paid_reroll_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_weekly (
        user_id TEXT NOT NULL,
        week_key TEXT NOT NULL,
        points INTEGER NOT NULL DEFAULT 0,
        claimed_milestones_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, week_key)
    );
`);

// ── 시드 동기화: quest_definitions ──
try {
    const seedPath = path.join(__dirname, 'data', 'quest_definitions.seed.json');
    if (fs.existsSync(seedPath)) {
        const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as any[];
        const upsert = db.prepare(`
            INSERT INTO quest_definitions (id, scope, category, name, description, type, params_json, target, rewards_json, weight, min_unlocked_stage, min_unlocked_cost, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(id) DO UPDATE SET
                scope=excluded.scope, category=excluded.category, name=excluded.name,
                description=excluded.description, type=excluded.type, params_json=excluded.params_json,
                target=excluded.target, rewards_json=excluded.rewards_json, weight=excluded.weight,
                min_unlocked_stage=excluded.min_unlocked_stage, min_unlocked_cost=excluded.min_unlocked_cost
        `);
        const syncMany = db.transaction((items: any[]) => {
            for (const q of items) {
                upsert.run(q.id, q.scope, q.category, q.name, q.description, q.type, q.params_json, q.target, q.rewards_json, q.weight, q.min_unlocked_stage, q.min_unlocked_cost);
            }
        });
        syncMany(seedData);
        console.log(`[DB] Quest definitions synced: ${seedData.length} entries`);
    }
} catch (e) {
    console.error('[DB] Quest seed sync error:', e);
}

export default db;
