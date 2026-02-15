// 500-run simulation — v10 simplified skills + detailed cost/unit tracking
// Node.js CJS script — standalone, no imports

// ═══ CONFIG DATA ═══════════════════════════════════════════
const ORIGINS = ['Bitcoin', 'DeFi', 'Social', 'Exchange', 'VC', 'FUD', 'Rugpull', 'Bear'];

// Updated unit data matching config.ts v10 simplified skills
const UNITS = [
    // 10코
    {
        id: 'satoshi', name: '사토시', cost: 10, origin: 'Bitcoin', dmgType: 'physical', dmg: 233, spd: 3.64,
        sk: 'active', cd: 12, p: { splashPct: 0.50, stunDur: 0.8 }
    },
    // 7코
    {
        id: 'vitalik', name: 'Vitalik', cost: 7, origin: 'DeFi', dmgType: 'magic', dmg: 167, spd: 1.95,
        sk: 'active', cd: 8, p: { chainN: 3, chainPct: 0.40 }
    },
    {
        id: 'cz', name: 'CZ', cost: 7, origin: 'Exchange', dmgType: 'physical', dmg: 167, spd: 1.63,
        sk: 'passive', p: { stack: true }
    },
    {
        id: 'elon', name: 'Elon', cost: 7, origin: 'Social', dmgType: 'magic', dmg: 167, spd: 1.76,
        sk: 'active', cd: 3, p: { atkSpdBuff: 0.35 }
    },
    {
        id: 'trump', name: 'Trump', cost: 7, origin: 'Bitcoin', dmgType: 'physical', dmg: 167, spd: 1.66,
        sk: 'onCombatStart', p: { btcPierceN: 1, piercePct: 0.60, bossDefShred: 10 }
    },
    {
        id: 'gensler', name: 'Gensler', cost: 7, origin: 'FUD', dmgType: 'magic', dmg: 167, spd: 1.69,
        sk: 'active', cd: 8, p: { slowPct: 0.25 }
    },
    // 5코
    {
        id: 'saylor', cost: 5, origin: 'Bitcoin', dmgType: 'physical', dmg: 82, spd: 1.37,
        sk: 'passive', p: { pierceN: 2, piercePct: 0.70 }
    },
    {
        id: 'coplan', cost: 5, origin: 'DeFi', dmgType: 'magic', dmg: 82, spd: 1.79,
        sk: 'passive', p: { critStun: true }
    },
    {
        id: 'armstrong', cost: 5, origin: 'Social', dmgType: 'magic', dmg: 82, spd: 1.47,
        sk: 'active', cd: 6, p: {}
    },
    {
        id: 'hayes', cost: 5, origin: 'Exchange', dmgType: 'physical', dmg: 82, spd: 1.71,
        sk: 'passive', p: { nthHit: 3, burstMult: 2.5 }
    },
    {
        id: 'jeff', cost: 5, origin: 'VC', dmgType: 'physical', dmg: 82, spd: 1.58,
        sk: 'passive', p: { pierceThreshold1: 8, pierceThreshold2: 12 }
    },
    {
        id: 'dokwon', cost: 5, origin: 'FUD', dmgType: 'magic', dmg: 82, spd: 1.43,
        sk: 'active', cd: 6, p: { dotPct: 0.03, dotDur: 3, armorIgnore: 1.0 }
    },
    {
        id: 'sbf', cost: 5, origin: 'Rugpull', dmgType: 'physical', dmg: 82, spd: 1.58,
        sk: 'active', cd: 6, p: { defShred: 12, stunDur: 0.5 }
    },
    {
        id: 'justinsun', cost: 5, origin: 'Bear', dmgType: 'magic', dmg: 82, spd: 1.36,
        sk: 'active', cd: 6, p: { freezeDur: 1.2 }
    },
    // 4코
    {
        id: 'stani', cost: 4, origin: 'Bitcoin', dmgType: 'physical', dmg: 52, spd: 1.11,
        sk: 'passive', p: { atkSpdBuff: 0.20 }
    },
    {
        id: 'gavin', cost: 4, origin: 'DeFi', dmgType: 'magic', dmg: 52, spd: 1.36,
        sk: 'active', cd: 8, p: { mdefShred: 12 }
    },
    {
        id: 'hayden', cost: 4, origin: 'Social', dmgType: 'magic', dmg: 52, spd: 1.16,
        sk: 'passive', p: { atkSpdBuff: 0.15 }
    },
    {
        id: 'marc', cost: 4, origin: 'Exchange', dmgType: 'physical', dmg: 52, spd: 1.04,
        sk: 'active', cd: 8, p: { pierceN: 1, piercePct: 0.60, chainN: 1, chainPct: 0.30 }
    },
    {
        id: 'balaji', cost: 4, origin: 'VC', dmgType: 'physical', dmg: 52, spd: 1.21,
        sk: 'active', cd: 8, p: { burstMult: 3.0 }
    },
    {
        id: 'lazarus', cost: 4, origin: 'FUD', dmgType: 'magic', dmg: 52, spd: 1.47,
        sk: 'passive', p: { nthHit: 4, stunDur: 0.8 }
    },
    {
        id: 'zhusu', cost: 4, origin: 'Rugpull', dmgType: 'physical', dmg: 52, spd: 1.48,
        sk: 'active', cd: 8, p: { splashPct: 0.50, splashN: 2 }
    },
    {
        id: 'anatoly', cost: 4, origin: 'Bear', dmgType: 'magic', dmg: 52, spd: 1.27,
        sk: 'passive', p: { nthHit: 3, stunDur: 0.8 }
    },
    // 3코
    {
        id: 'rogerver', cost: 3, origin: 'Bitcoin', dmgType: 'physical', dmg: 24, spd: 0.88,
        sk: 'passive', p: { pierceN: 1, piercePct: 0.50 }
    },
    {
        id: 'andre', cost: 3, origin: 'DeFi', dmgType: 'magic', dmg: 24, spd: 0.98,
        sk: 'passive', p: { nthHit: 3, chainN: 2, chainPct: 0.40 }
    },
    {
        id: 'rekt', cost: 3, origin: 'Social', dmgType: 'magic', dmg: 24, spd: 1.12,
        sk: 'passive', p: { maxHpPct: 0.02 }
    },
    {
        id: 'wintermute', cost: 3, origin: 'Exchange', dmgType: 'physical', dmg: 24, spd: 0.97,
        sk: 'passive', p: { nthHit: 3, splashPct: 0.40 }
    },
    {
        id: 'simon', cost: 3, origin: 'VC', dmgType: 'physical', dmg: 24, spd: 1.06,
        sk: 'passive', p: { nthHit: 3, critBonus: 1.0 }
    },
    {
        id: 'peterschiff', cost: 3, origin: 'FUD', dmgType: 'magic', dmg: 24, spd: 0.94,
        sk: 'passive', p: { nthHit: 3, stunDur: 0.8 }
    },
    {
        id: 'gcr', cost: 3, origin: 'Rugpull', dmgType: 'physical', dmg: 24, spd: 1.1,
        sk: 'passive', p: { pierceN: 2, piercePct: 0.70 }
    },
    {
        id: 'akang', cost: 3, origin: 'Bear', dmgType: 'magic', dmg: 24, spd: 0.77,
        sk: 'active', cd: 8, p: { freezeDur: 0.9 }
    },
    // 2코
    {
        id: 'jackdorsey', cost: 2, origin: 'Bitcoin', dmgType: 'physical', dmg: 16, spd: 0.90,
        sk: 'passive', p: { nthHit: 4, chainN: 1, chainPct: 0.30 }
    },
    {
        id: 'jessepollak', cost: 2, origin: 'DeFi', dmgType: 'magic', dmg: 16, spd: 0.91,
        sk: 'passive', p: { nthHit: 4, chainN: 1, chainPct: 0.30 }
    },
    {
        id: 'wonyotti', cost: 2, origin: 'Social', dmgType: 'magic', dmg: 16, spd: 0.98,
        sk: 'active', cd: 8, p: { atkSpdBuff: 0.30 }
    },
    {
        id: 'jessepowell', cost: 2, origin: 'Exchange', dmgType: 'physical', dmg: 16, spd: 0.95,
        sk: 'passive', p: { killGold: true, killsPerGold: 4 }
    },
    {
        id: 'opensea', cost: 2, origin: 'VC', dmgType: 'physical', dmg: 16, spd: 0.91,
        sk: 'passive', p: {}
    },
    {
        id: 'craigwright', cost: 2, origin: 'FUD', dmgType: 'magic', dmg: 16, spd: 0.89,
        sk: 'active', cd: 8, p: { dotPct: 0.03, dotDur: 3 }
    },
    {
        id: 'daniele', cost: 2, origin: 'Rugpull', dmgType: 'physical', dmg: 16, spd: 0.90,
        sk: 'passive', p: { pierceN: 1, piercePct: 0.50 }
    },
    {
        id: 'hsaka', cost: 2, origin: 'Bear', dmgType: 'magic', dmg: 16, spd: 0.95,
        sk: 'active', cd: 8, p: { freezeDur: 1.0 }
    },
    // 1코
    {
        id: 'pcminer', cost: 1, origin: 'Bitcoin', dmgType: 'physical', dmg: 9, spd: 0.65,
        sk: 'passive', p: { atkSpdBuff: 0.15 }
    },
    {
        id: 'metamask', cost: 1, origin: 'DeFi', dmgType: 'magic', dmg: 9, spd: 0.78,
        sk: 'passive', p: { atkSpdBonus: 0.20 }
    },
    {
        id: 'scamdev', cost: 1, origin: 'Social', dmgType: 'magic', dmg: 9, spd: 0.78,
        sk: 'passive', p: { nthHit: 5, chainN: 1, chainPct: 0.30, slowPct: 0.20 }
    },
    {
        id: 'perpdex', cost: 1, origin: 'Exchange', dmgType: 'physical', dmg: 9, spd: 0.86,
        sk: 'passive', p: { pierceN: 1, piercePct: 0.40 }
    },
    {
        id: 'hodler', cost: 1, origin: 'VC', dmgType: 'physical', dmg: 9, spd: 0.86,
        sk: 'passive', p: { nthHit: 5, critBonus: 1.0 }
    },
    {
        id: 'fudspreader', cost: 1, origin: 'FUD', dmgType: 'magic', dmg: 9, spd: 0.89,
        sk: 'active', cd: 8, p: { dotPct: 0.02, dotDur: 3 }
    },
    {
        id: 'piuser', cost: 1, origin: 'Rugpull', dmgType: 'physical', dmg: 9, spd: 0.87,
        sk: 'passive', p: { nthHit: 5, burstMult: 2.0 }
    },
    {
        id: 'gareth', cost: 1, origin: 'Bear', dmgType: 'magic', dmg: 9, spd: 0.77,
        sk: 'active', cd: 8, p: { slowPct: 0.30 }
    },
    // ── 추가 유닛 (8세트용) ──
    {
        id: 'halfinney', cost: 2, origin: 'Bitcoin', dmgType: 'physical', dmg: 16, spd: 0.93,
        sk: 'passive', p: {}
    },
    {
        id: 'curve', cost: 1, origin: 'DeFi', dmgType: 'magic', dmg: 9, spd: 0.82,
        sk: 'passive', p: { nthHit: 5, splashPct: 0.35 }
    },
    {
        id: 'chefnomi', cost: 3, origin: 'DeFi', dmgType: 'magic', dmg: 24, spd: 0.92,
        sk: 'passive', p: { nthHit: 3, chainN: 1, chainPct: 0.35, dotPct: 0.02, dotDur: 2 }
    },
    {
        id: 'kol', cost: 1, origin: 'Social', dmgType: 'magic', dmg: 9, spd: 0.85,
        sk: 'active', cd: 8, p: { atkSpdBuff: 0.15 }
    },
    {
        id: 'cobie', cost: 3, origin: 'Social', dmgType: 'physical', dmg: 24, spd: 1.05,
        sk: 'active', cd: 8, p: { atkSpdBuff: 0.25 }
    },
    {
        id: 'tradebot', cost: 1, origin: 'Exchange', dmgType: 'physical', dmg: 9, spd: 0.90,
        sk: 'passive', p: { atkSpdBonus: 0.25 }
    },
    {
        id: 'kris', cost: 2, origin: 'Exchange', dmgType: 'magic', dmg: 16, spd: 0.88,
        sk: 'passive', p: { killGold: true, killsPerGold: 3 }
    },
    {
        id: 'a16zintern', cost: 1, origin: 'VC', dmgType: 'physical', dmg: 9, spd: 0.80,
        sk: 'active', cd: 8, p: { critBonus: 0.10 }
    },
    {
        id: 'cdixon', cost: 2, origin: 'VC', dmgType: 'magic', dmg: 16, spd: 0.92,
        sk: 'passive', p: {}
    },
    {
        id: 'cathie', cost: 3, origin: 'VC', dmgType: 'physical', dmg: 24, spd: 1.00,
        sk: 'active', cd: 8, p: { critBonus: 1.0 }
    },
    {
        id: 'roubini', cost: 1, origin: 'FUD', dmgType: 'magic', dmg: 9, spd: 0.83,
        sk: 'passive', p: { nthHit: 5, dotPct: 0.03, dotDur: 2 }
    },
    {
        id: 'warren', cost: 3, origin: 'FUD', dmgType: 'magic', dmg: 24, spd: 0.90,
        sk: 'active', cd: 8, p: { dotPct: 0.03, dotDur: 3, slowPct: 0.25 }
    },
    {
        id: 'memecoin', cost: 1, origin: 'Rugpull', dmgType: 'physical', dmg: 9, spd: 0.88,
        sk: 'passive', p: { nthHit: 5, chainN: 1, chainPct: 0.30 }
    },
    {
        id: 'ruja', cost: 2, origin: 'Rugpull', dmgType: 'magic', dmg: 16, spd: 0.91,
        sk: 'passive', p: { pierceN: 1, piercePct: 0.45 }
    },
    {
        id: 'heart', cost: 3, origin: 'Rugpull', dmgType: 'physical', dmg: 24, spd: 1.02,
        sk: 'passive', p: { nthHit: 3, chainN: 1, chainPct: 0.40 }
    },
    {
        id: 'cramer', cost: 1, origin: 'Bear', dmgType: 'physical', dmg: 9, spd: 0.84,
        sk: 'active', cd: 8, p: { freezeDur: 0.8, selfDelay: 0.5 }
    },
    {
        id: 'kashkari', cost: 2, origin: 'Bear', dmgType: 'magic', dmg: 16, spd: 0.87,
        sk: 'active', cd: 8, p: { slowPct: 0.30, targets: 2 }
    },
    {
        id: 'burry', cost: 3, origin: 'Bear', dmgType: 'physical', dmg: 24, spd: 0.95,
        sk: 'passive', p: { hpThreshold: 0.50, dmgMult: 1.8 }
    },
];

const STAR_MULT = { 1: 1.0, 2: 3.0, 3: 9.0 };

const LEVELS = [
    { level: 1, naturalRound: 1, slots: 1, odds: [100, 0, 0, 0, 0] },
    { level: 2, naturalRound: 2, slots: 2, odds: [100, 0, 0, 0, 0] },
    { level: 3, naturalRound: 4, slots: 3, odds: [75, 25, 0, 0, 0] },
    { level: 4, naturalRound: 7, slots: 4, odds: [55, 30, 15, 0, 0] },
    { level: 5, naturalRound: 12, slots: 5, odds: [40, 30, 25, 5, 0] },
    { level: 6, naturalRound: 18, slots: 6, odds: [25, 30, 30, 12, 3] },
    { level: 7, naturalRound: 24, slots: 7, odds: [20, 25, 30, 18, 7] },
    { level: 8, naturalRound: 33, slots: 8, odds: [15, 20, 25, 25, 15] },
    { level: 9, naturalRound: 38, slots: 9, odds: [10, 15, 25, 30, 20] },
    { level: 10, naturalRound: 45, slots: 10, odds: [5, 10, 20, 30, 35] },
];

const STAGE_DEF = {
    1: { def: 0, mdef: 0 }, 2: { def: 5, mdef: 5 }, 3: { def: 20, mdef: 5 },
    4: { def: 5, mdef: 20 }, 5: { def: 25, mdef: 25 }, 6: { def: 15, mdef: 40 }, 7: { def: 40, mdef: 15 }
};

const COSTS = [1, 2, 3, 4, 5];
const PATH_LEN = 28;

// ═══ BOSS BOX DROP TABLES ═══
const KEY_TO_UNIT = {
    'key_ethereum': 'vitalik',
    'key_binance': 'cz',
    'key_tesla': 'elon',
    'key_block1': 'trump',
    'key_sec': 'gensler',
    'key_satoshi': 'satoshi',
};
const BOX_DROP_TABLES = [
    { round: 10, items: [{ itemId: 'key_ethereum', weight: 40 }, { itemId: 'key_binance', weight: 40 }, { itemId: 'key_tesla', weight: 10 }, { itemId: 'key_block1', weight: 10 }] },
    { round: 17, items: [{ itemId: 'key_ethereum', weight: 35 }, { itemId: 'key_binance', weight: 35 }, { itemId: 'key_tesla', weight: 15 }, { itemId: 'key_block1', weight: 15 }] },
    { round: 24, items: [{ itemId: 'key_ethereum', weight: 25 }, { itemId: 'key_binance', weight: 25 }, { itemId: 'key_tesla', weight: 20 }, { itemId: 'key_block1', weight: 20 }, { itemId: 'key_sec', weight: 10 }] },
    { round: 31, items: [{ itemId: 'key_tesla', weight: 25 }, { itemId: 'key_block1', weight: 25 }, { itemId: 'key_sec', weight: 40 }, { itemId: 'key_satoshi', weight: 10 }] },
    { round: 38, items: [{ itemId: 'key_sec', weight: 50 }, { itemId: 'key_satoshi', weight: 50 }] },
];
const BOX_UNLOCK_CHANCE = 0.30;

function rollBoxDrop(round) {
    const table = BOX_DROP_TABLES.find(t => t.round === round);
    if (!table) return null;
    if (Math.random() > BOX_UNLOCK_CHANCE) return null;
    const totalW = table.items.reduce((s, i) => s + i.weight, 0);
    let r = Math.random() * totalW;
    for (const item of table.items) {
        r -= item.weight;
        if (r <= 0) return item.itemId;
    }
    return table.items[table.items.length - 1].itemId;
}

function getStage(r) { return Math.min(7, Math.floor((r - 1) / 10) + 1); }
function isBoss(r) { return r % 10 === 0; }

function getLevel(round) {
    let lv = 1;
    for (const l of LEVELS) {
        if (round >= l.naturalRound) lv = l.level;
    }
    return LEVELS[lv - 1];
}

function monsterHp(r, boss) {
    if (boss) return Math.floor(r * r * 12 + r * 150 + 300);
    return Math.floor(r * r * 0.52 + r * 7.8 + 5);
}

function monsterCount(r) {
    if (isBoss(r)) return 1;
    const s = getStage(r);
    if (s === 1) return r === 1 ? 1 : r === 2 ? 3 : 5;
    return 10;
}

function monsterSpeed(r, boss = false) {
    const base = 0.7 + r * 0.012;
    return boss ? base * 1.3 : base;
}

// ═══ SYNERGY BUFFS ═══
function calcSynergyBuffs(board) {
    const counts = {};
    for (const u of board) {
        const unit = UNITS.find(x => x.id === u.id);
        if (!unit) continue;
        counts[unit.origin] = (counts[unit.origin] || 0) + 1;
    }

    const buffs = { dmgMult: 1, atkSpdMult: 1, critChance: 0, critDmgMult: 2.0, bossDmg: 1, armorIgnore: 0, armorReduce: 0, slowPct: 0, stunChance: 0, killGold: 0, roundGold: 0 };

    for (const [origin, count] of Object.entries(counts)) {
        const bp = count >= 8 ? 3 : count >= 6 ? 2 : count >= 4 ? 1 : count >= 2 ? 0 : -1;
        if (bp < 0) continue;

        switch (origin) {
            case 'Bitcoin':
                buffs.dmgMult += [0.15, 0.30, 0.50, 0.80][bp];
                if (bp >= 1) buffs.bossDmg += [0, 0.20, 0.40, 0.60][bp];
                if (bp >= 3) buffs.critChance += 0.20;
                break;
            case 'DeFi':
                buffs.dmgMult += [0.10, 0.25, 0.40, 0.60][bp];
                break;
            case 'Social':
                buffs.atkSpdMult += [0.10, 0.25, 0.40, 0.60][bp];
                if (bp >= 2) buffs.dmgMult += [0, 0, 0.15, 0.30][bp];
                break;
            case 'Exchange':
                buffs.dmgMult += [0.15, 0.30, 0.45, 0.65][bp];
                buffs.atkSpdMult += [0.05, 0.15, 0.25, 0.35][bp];
                if (bp >= 2) buffs.killGold += [0, 0, 1, 2][bp];
                break;
            case 'VC':
                buffs.critChance += [0.10, 0.20, 0.30, 0.40][bp];
                buffs.atkSpdMult += [0.10, 0.25, 0.40, 0.60][bp];
                if (bp >= 1) buffs.critDmgMult = 2.0 + [0, 0.30, 0.60, 1.00][bp];
                break;
            case 'FUD':
                buffs.armorIgnore = [0.30, 0.60, 1.00, 1.00][bp];
                if (bp >= 1) buffs.dmgMult += [0, 0.15, 0.30, 0.50][bp];
                break;
            case 'Rugpull':
                buffs.armorReduce = [0.25, 0.45, 0.65, 0.85][bp];
                buffs.dmgMult += [0.10, 0.20, 0.35, 0.50][bp];
                break;
            case 'Bear':
                buffs.slowPct = [0.15, 0.30, 0.45, 0.60][bp];
                if (bp >= 1) buffs.stunChance = [0, 0.10, 0.20, 0.30][bp];
                if (bp >= 2) buffs.dmgMult += [0, 0, 0.20, 0.40][bp];
                break;
        }
    }
    return buffs;
}

// ═══ DPS CALCULATION ═══
function calcTeamDPS(board, buffs, monsters, stage, boss = false) {
    const rawSd = STAGE_DEF[stage] || { def: 0, mdef: 0 };
    const defMult = boss ? 2.5 : 1;
    const sd = { def: rawSd.def * defMult, mdef: rawSd.mdef * defMult };
    let totalDps = 0;
    const coverage = 0.55;

    for (const slot of board) {
        const unit = UNITS.find(u => u.id === slot.id);
        if (!unit) continue;
        const star = slot.star || 1;
        const starMult = STAR_MULT[star] || 1;
        let dmg = unit.dmg * starMult;
        let atkSpd = unit.spd;

        const p = unit.p;

        // Nth hit bonuses (average over cycle)
        let nthMultiplier = 1.0;
        if (p.nthHit) {
            // Every Nth hit triggers bonus
            const triggerRate = 1 / p.nthHit;
            if (p.burstMult) nthMultiplier += triggerRate * (p.burstMult - 1);
            if (p.critBonus) nthMultiplier += triggerRate * p.critBonus;
            if (p.stunDur) nthMultiplier += triggerRate * 0.15; // stun DPS equiv
        }
        dmg *= nthMultiplier;

        // Passive bonuses
        if (p.atkSpdBonus) atkSpd *= (1 + p.atkSpdBonus);
        if (p.dmgMult && p.hpThreshold) {
            // finisher bonus (50% of time target is low HP)
            dmg *= (1 + 0.3 * (p.dmgMult - 1));
        }

        // synergy
        dmg *= buffs.dmgMult;
        atkSpd *= buffs.atkSpdMult;
        if (buffs.critChance > 0) dmg *= (1 + buffs.critChance * (buffs.critDmgMult - 1));

        // DEF/MDEF reduction
        let armor = unit.dmgType === 'physical' ? sd.def : sd.mdef;
        armor *= (1 - buffs.armorReduce);
        const ignoreAmt = p.armorIgnore || buffs.armorIgnore || 0;
        armor *= (1 - ignoreAmt);
        if (armor > 0) dmg = dmg * 100 / (100 + armor);

        let dps = dmg * atkSpd * coverage;

        // Multi-target: pierce
        if (p.pierceN && p.piercePct) {
            const nthScale = p.nthHit ? (1 / p.nthHit) : 1;
            const extraTargets = Math.min(p.pierceN, Math.max(0, monsters - 1));
            dps *= (1 + extraTargets * p.piercePct * nthScale);
        }
        // Multi-target: chain
        if (p.chainN && p.chainPct) {
            const nthScale = p.nthHit ? (1 / p.nthHit) : 1;
            const chainHits = Math.min(p.chainN, Math.max(0, monsters - 1));
            dps *= (1 + chainHits * p.chainPct * nthScale);
        }
        // Multi-target: splash
        if (p.splashPct) {
            const nthScale = p.nthHit ? (1 / p.nthHit) : 1;
            const splashHits = Math.min(p.splashN || 2, Math.max(0, monsters - 1));
            dps *= (1 + splashHits * p.splashPct * nthScale);
        }
        // DoT
        if (p.dotPct && p.dotDur) {
            const nthScale = p.nthHit ? (1 / p.nthHit) : 1;
            dps *= (1 + p.dotPct * p.dotDur * nthScale);
        }
        // HP% damage
        if (p.maxHpPct) {
            dps *= 1.20;
        }
        // Active skill CD bonus (burst every CD seconds)
        if (unit.cd && p.burstMult) {
            dps *= (1 + (p.burstMult - 1) * 0.15); // approx
        }

        totalDps += dps;
    }

    return totalDps;
}

// ═══ SIMULATION ═══
function simGame() {
    let hp = 30;
    let gold = 5;
    const board = [];
    const bench = [];
    let deathRound = -1;
    let freeRerolls = 0;

    // 7/10코 unlock tracking
    const unlockedKeys = new Set();      // obtained keys
    const unlocked7cost = new Set();     // unlocked 7코 unit IDs
    let unlocked10cost = false;
    const keyDropLog = [];               // {round, key, unitId}
    const highCostBoughtLog = [];        // {round, unitId, cost}

    // Tracking
    const unitsSeen = {};     // id -> { firstRound, appearances }
    const costSeen = {};      // cost -> { count, firstRound }
    const boardSnapshots = {}; // round -> board snapshot

    for (let round = 1; round <= 70; round++) {
        const level = getLevel(round);
        const slots = level.slots;
        const stage = getStage(round);
        const boss = isBoss(round);

        const stageRound = ((round - 1) % 10) + 1;
        if (stageRound === 1 && stage >= 2) freeRerolls++;

        // SHOP PHASE
        gold += 5 + Math.floor(Math.min(gold, 50) / 10);

        // Build list of unlocked high-cost units for shop
        const availableHighCost = UNITS.filter(u => {
            if (u.cost === 7) return unlocked7cost.has(u.id);
            if (u.cost === 10) return unlocked10cost;
            return false;
        });

        const shopRolls = 1 + freeRerolls;
        freeRerolls = 0;
        const shopUnits = [];
        for (let r = 0; r < shopRolls; r++) {
            for (let i = 0; i < 5; i++) {
                // 15% chance to show unlocked 7/10코
                if (availableHighCost.length > 0 && Math.random() < 0.15) {
                    const pick = availableHighCost[Math.floor(Math.random() * availableHighCost.length)];
                    shopUnits.push(pick);
                } else {
                    shopUnits.push(rollUnit(level));
                }
            }
        }

        for (const u of shopUnits) {
            if (!u || gold < u.cost) continue;
            const all = [...board, ...bench];
            const s1 = all.filter(b => b.id === u.id && b.star === 1).length;
            const s2 = all.filter(b => b.id === u.id && b.star === 2).length;

            if (s2 >= 2) {
                gold -= u.cost;
                const bi = board.findIndex(b => b.id === u.id && b.star === 2);
                if (bi >= 0) board[bi].star = 3;
                const bxi = bench.findIndex(b => b.id === u.id && b.star === 2);
                if (bxi >= 0) bench.splice(bxi, 1);
                continue;
            }
            if (s1 >= 2) {
                gold -= u.cost;
                const bi = board.findIndex(b => b.id === u.id && b.star === 1);
                if (bi >= 0) {
                    board[bi].star = 2;
                    const bxi = bench.findIndex(b => b.id === u.id && b.star === 1);
                    if (bxi >= 0) bench.splice(bxi, 1);
                } else {
                    const bxi1 = bench.findIndex(b => b.id === u.id && b.star === 1);
                    if (bxi1 >= 0) {
                        bench[bxi1].star = 2;
                        const bxi2 = bench.findIndex((b, i) => i !== bxi1 && b.id === u.id && b.star === 1);
                        if (bxi2 >= 0) bench.splice(bxi2, 1);
                    }
                }
                continue;
            }
            if (s1 >= 1) {
                gold -= u.cost;
                bench.push({ id: u.id, star: 1, cost: u.cost });
                continue;
            }
            if (board.length < slots) {
                gold -= u.cost;
                board.push({ id: u.id, star: 1, cost: u.cost });
            } else if (bench.length < 8) {
                gold -= u.cost;
                bench.push({ id: u.id, star: 1, cost: u.cost });
            }
        }

        // Deploy from bench
        bench.sort((a, b) => ((UNITS.find(x => x.id === b.id)?.cost || 1) * (b.star || 1)) - ((UNITS.find(x => x.id === a.id)?.cost || 1) * (a.star || 1)));
        while (board.length < slots && bench.length > 0) {
            board.push(bench.shift());
        }

        // Track board composition
        for (const slot of board) {
            const unit = UNITS.find(u => u.id === slot.id);
            if (!unit) continue;
            if (!unitsSeen[unit.id]) unitsSeen[unit.id] = { firstRound: round, appearances: 0, maxStar: 1 };
            unitsSeen[unit.id].appearances++;
            unitsSeen[unit.id].maxStar = Math.max(unitsSeen[unit.id].maxStar, slot.star || 1);

            if (!costSeen[unit.cost]) costSeen[unit.cost] = { count: 0, firstRound: round };
            costSeen[unit.cost].count++;
            if (round < costSeen[unit.cost].firstRound) costSeen[unit.cost].firstRound = round;
        }

        // Snapshot at key rounds
        if ([10, 20, 30, 40, 50].includes(round)) {
            boardSnapshots[round] = board.map(s => {
                const u = UNITS.find(x => x.id === s.id);
                return { id: s.id, name: u?.name || s.id, cost: u?.cost || 0, star: s.star || 1, origin: u?.origin || '?' };
            });
        }

        // COMBAT PHASE
        const mc = monsterCount(round);
        const mhp = monsterHp(round, boss);
        const totalHp = mhp * mc;
        const speed = monsterSpeed(round, boss);

        const buffs = calcSynergyBuffs(board);

        // Aura/buff effects from specific units
        for (const slot of board) {
            const unit = UNITS.find(u => u.id === slot.id);
            if (!unit) continue;
            if (unit.p.atkSpdBuff && unit.sk === 'passive') {
                buffs.atkSpdMult *= (1 + unit.p.atkSpdBuff * 0.3); // partial team coverage
            }
            if (unit.sk === 'active' && unit.p.atkSpdBuff) {
                buffs.atkSpdMult *= (1 + unit.p.atkSpdBuff * 0.2); // intermittent
            }
        }

        const effectiveSpeed = speed * (1 - buffs.slowPct);
        const lapTime = PATH_LEN / effectiveSpeed;

        const teamDps = calcTeamDPS(board, buffs, mc, stage, boss);

        let effectiveDps = teamDps;
        if (boss) effectiveDps *= buffs.bossDmg;

        const stunBonus = buffs.stunChance * 0.5;
        effectiveDps *= (1 + stunBonus);

        const ROUND_TIMEOUT = boss ? 60 : 40;
        const dmgInTime = effectiveDps * ROUND_TIMEOUT;
        const lapDmg = boss ? 3 : 1;
        const lapsInTime = Math.floor(ROUND_TIMEOUT / lapTime);
        const timeoutDmgPerTick = Math.min(stage, 4);

        if (dmgInTime >= totalHp) {
            const killTime = totalHp / Math.max(effectiveDps, 0.1);
            const lapsBeforeKill = Math.floor(killTime / lapTime);
            hp -= lapsBeforeKill * lapDmg * (boss ? 1 : Math.ceil(mc * 0.3));
            gold += mc * 2 + 5;
            let bonusGold = 0;
            if (boss) {
                if (killTime <= 35) { bonusGold = 5; freeRerolls += 2; }
                else if (killTime <= 50) { bonusGold = 3; }
                else { bonusGold = 2; }
            } else {
                if (killTime <= 20) { bonusGold = 4; }
                else if (killTime <= 30) { bonusGold = 2; }
                else { bonusGold = 1; }
            }
            gold += bonusGold;
        } else {
            const monstersKilled = Math.floor(dmgInTime / mhp);
            const survived = mc - monstersKilled;
            hp -= lapsInTime * lapDmg * Math.ceil((mc + survived) / 2);
            if (boss) {
                const remainingHp = mhp - (effectiveDps * ROUND_TIMEOUT);
                const postTimeoutKillTime = remainingHp / Math.max(effectiveDps, 0.1);
                const overtimeSec = Math.min(postTimeoutKillTime, 30);
                hp -= 5;
                hp -= Math.floor(overtimeSec / 5);
            } else {
                hp -= survived;
                const remainingMonsterHp = (mhp * survived) - (effectiveDps * ROUND_TIMEOUT - mhp * monstersKilled);
                const postTimeoutTime = Math.min(remainingMonsterHp / Math.max(effectiveDps, 0.1), 15);
                const extraTicks = Math.floor(postTimeoutTime / 5);
                hp -= survived * timeoutDmgPerTick * extraTicks;
            }
            gold += monstersKilled * 2 + 2;
        }

        if (hp <= 0) {
            deathRound = round;
            break;
        }

        if (boss && dmgInTime >= totalHp) {
            freeRerolls++;

            // ── BOSS BOX DROP ──
            const keyDrop = rollBoxDrop(round);
            if (keyDrop && !unlockedKeys.has(keyDrop)) {
                unlockedKeys.add(keyDrop);
                const unitId = KEY_TO_UNIT[keyDrop];
                if (unitId) {
                    if (keyDrop === 'key_satoshi') {
                        // 10코: 7코 1마리 이상 보유 필요
                        const has7 = board.some(s => UNITS.find(u => u.id === s.id)?.cost === 7);
                        if (has7) {
                            unlocked10cost = true;
                            keyDropLog.push({ round, key: keyDrop, unitId });
                        }
                    } else {
                        unlocked7cost.add(unitId);
                        keyDropLog.push({ round, key: keyDrop, unitId });
                    }
                }
            }
        }
    }

    return {
        deathRound: deathRound > 0 ? deathRound : 71,
        hp,
        boardSize: board.length,
        stars: board.filter(b => b.star >= 2).length,
        unitsSeen,
        costSeen,
        boardSnapshots,
        keyDropLog,
        unlocked7cost: [...unlocked7cost],
        unlocked10cost,
        finalBoard: board.map(s => {
            const u = UNITS.find(x => x.id === s.id);
            return { id: s.id, cost: u?.cost || 0, star: s.star || 1 };
        })
    };
}

function rollUnit(level) {
    const odds = level.odds;
    const r = Math.random() * 100;
    let cum = 0;
    let costIdx = 0;
    for (let i = 0; i < 5; i++) {
        cum += odds[i];
        if (r < cum) { costIdx = i; break; }
    }
    const cost = COSTS[costIdx];
    const pool = UNITS.filter(u => u.cost === cost);
    return pool[Math.floor(Math.random() * pool.length)];
}

// ═══ RUN 500 SIMULATIONS ═══
const N = 500;
const results = [];
const roundDeaths = {};
const stageDeaths = {};

// Aggregate tracking
const costAppearance = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 7: 0, 10: 0 };
const costFirstRound = { 1: [], 2: [], 3: [], 4: [], 5: [], 7: [], 10: [] };
const unitAppearance = {};
const unitMaxStars = {};
const gamesWithCost = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 7: 0, 10: 0 };
const costAtDeath = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 7: 0, 10: 0 };

// R10/R20/R30 board cost composition
const boardAtRound = { 10: [], 20: [], 30: [], 40: [], 50: [] };

for (let i = 0; i < N; i++) {
    const r = simGame();
    results.push(r);
    if (r.deathRound <= 70) {
        roundDeaths[r.deathRound] = (roundDeaths[r.deathRound] || 0) + 1;
        const s = getStage(r.deathRound);
        stageDeaths[s] = (stageDeaths[s] || 0) + 1;
    }

    // Aggregate unit appearances
    for (const [id, data] of Object.entries(r.unitsSeen)) {
        const unit = UNITS.find(u => u.id === id);
        if (!unit) continue;
        if (!unitAppearance[id]) unitAppearance[id] = { count: 0, games: 0, maxStar: 1, name: unit.name || id, cost: unit.cost, origin: unit.origin };
        unitAppearance[id].count += data.appearances;
        unitAppearance[id].games++;
        unitAppearance[id].maxStar = Math.max(unitAppearance[id].maxStar, data.maxStar);
    }

    // Cost-tier tracking
    for (const slot of r.finalBoard) {
        costAppearance[slot.cost] = (costAppearance[slot.cost] || 0) + 1;
        costAtDeath[slot.cost] = (costAtDeath[slot.cost] || 0) + 1;
    }
    for (const slot of r.finalBoard) {
        const c = slot.cost;
        if (!gamesWithCost[c]) gamesWithCost[c] = 0;
    }
    const finalCosts = new Set(r.finalBoard.map(s => s.cost));
    for (const c of finalCosts) {
        gamesWithCost[c] = (gamesWithCost[c] || 0) + 1;
    }

    // Board snapshots
    for (const [rnd, snap] of Object.entries(r.boardSnapshots)) {
        boardAtRound[rnd].push(snap);
    }
}

// ═══ ANALYSIS ═══
const deaths = results.filter(r => r.deathRound <= 70);
const clears = results.filter(r => r.deathRound > 70);
const deathRounds = deaths.map(r => r.deathRound);
const avgDeathRound = deathRounds.length > 0 ? (deathRounds.reduce((a, b) => a + b, 0) / deathRounds.length).toFixed(1) : 'N/A';
const medianDeathRound = deathRounds.length > 0 ? deathRounds.sort((a, b) => a - b)[Math.floor(deathRounds.length / 2)] : 'N/A';

console.log('══════════════════════════════════════════════════════════════');
console.log(`  500-Game Simulation Results (v10 Simplified Skills)`);
console.log('══════════════════════════════════════════════════════════════');
console.log(`  Clear Rate:       ${clears.length}/${N} (${(clears.length / N * 100).toFixed(1)}%)`);
console.log(`  Death Rate:       ${deaths.length}/${N} (${(deaths.length / N * 100).toFixed(1)}%)`);
console.log(`  Avg Death Round:  ${avgDeathRound}`);
console.log(`  Median Death Rnd: ${medianDeathRound}`);
console.log('');

// Survival by Stage
console.log('─── Survival by Stage ────────────────────────────────────────');
console.log('  Stage | Rounds    | Deaths | Survive | Rate    | Δ(prev)');
console.log('  ─────┼───────────┼────────┼─────────┼─────────┼────────');
let survived = N;
let prevSurvived = N;
for (let s = 1; s <= 7; s++) {
    const rStart = (s - 1) * 10 + 1;
    const rEnd = s * 10;
    const d = stageDeaths[s] || 0;
    prevSurvived = survived;
    survived -= d;
    const delta = prevSurvived > 0 ? `-${(d / prevSurvived * 100).toFixed(0)}%` : '─';
    console.log(`    ${s}   | R${String(rStart).padStart(2)}-R${String(rEnd).padStart(2)}  |  ${String(d).padStart(4)}  |  ${String(survived).padStart(4)}   | ${(survived / N * 100).toFixed(1).padStart(5)}%  | ${delta}`);
}

// Death distribution per round (top 15)
console.log('');
console.log('─── Death Distribution (top 15 rounds) ──────────────────────');
const sortedDeaths = Object.entries(roundDeaths).sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [round, count] of sortedDeaths) {
    const bar = '█'.repeat(Math.ceil(count / 2));
    const s = getStage(Number(round));
    console.log(`  R${String(round).padStart(2)} (S${s}): ${String(count).padStart(3)} ${bar}`);
}

// Boss Analysis
console.log('');
console.log('─── Boss Round Analysis ──────────────────────────────────────');
const bossRounds = [10, 20, 30, 40, 50, 60, 70];
for (const br of bossRounds) {
    const aliveAtBoss = results.filter(r => r.deathRound > br || (r.deathRound === br)).length;
    const survivedBoss = results.filter(r => r.deathRound > br).length;
    const diedAtBoss = roundDeaths[br] || 0;
    if (aliveAtBoss > 0) {
        console.log(`  R${br}: ${survivedBoss}/${aliveAtBoss} survived (${(survivedBoss / aliveAtBoss * 100).toFixed(0)}%), died: ${diedAtBoss}`);
    }
}

// ── 7코/10코 출현 분석 ──
console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  7코/10코 유닛 상세 분석');
console.log('═══════════════════════════════════════════════════════════════');

// KEY DROP ANALYSIS
console.log('');
console.log('─── 보스 상자 열쇠 드랍 분석 ─────────────────────────────');
const keyDropCounts = {};
const keyDropRounds = {};
let totalKeyDrops = 0;
let gamesWithAnyKey = 0;
let gamesWithAny7 = 0;
let gamesWith10 = 0;

for (const r of results) {
    if (r.keyDropLog.length > 0) gamesWithAnyKey++;
    if (r.unlocked7cost.length > 0) gamesWithAny7++;
    if (r.unlocked10cost) gamesWith10++;

    for (const log of r.keyDropLog) {
        totalKeyDrops++;
        keyDropCounts[log.key] = (keyDropCounts[log.key] || 0) + 1;
        if (!keyDropRounds[log.key]) keyDropRounds[log.key] = [];
        keyDropRounds[log.key].push(log.round);
    }
}

console.log(`  열쇠 드랍 게임:    ${gamesWithAnyKey}/${N} (${(gamesWithAnyKey / N * 100).toFixed(1)}%)`);
console.log(`  7코 해금 게임:     ${gamesWithAny7}/${N} (${(gamesWithAny7 / N * 100).toFixed(1)}%)`);
console.log(`  10코 해금 게임:    ${gamesWith10}/${N} (${(gamesWith10 / N * 100).toFixed(1)}%)`);
console.log(`  총 열쇠 드랍:      ${totalKeyDrops}건 (게임당 ${(totalKeyDrops / N).toFixed(2)}개)`);

console.log('');
console.log('─── 열쇠별 드랍 횟수 ──────────────────────────────────────');
console.log('  열쇠          | 유닛      | 드랍수 | 비율   | 평균 라운드');
console.log('  ─────────────┼──────────┼───────┼────────┼───────────');
const allKeys = ['key_ethereum', 'key_binance', 'key_tesla', 'key_block1', 'key_sec', 'key_satoshi'];
for (const key of allKeys) {
    const cnt = keyDropCounts[key] || 0;
    const unitName = KEY_TO_UNIT[key] || '?';
    const rounds = keyDropRounds[key] || [];
    const avgRnd = rounds.length > 0 ? (rounds.reduce((a, b) => a + b, 0) / rounds.length).toFixed(0) : '-';
    console.log(`  ${key.padEnd(14)}| ${unitName.padEnd(9)}| ${String(cnt).padStart(4)}  | ${(cnt / N * 100).toFixed(1).padStart(5)}% | R${avgRnd}`);
}

// 7코/10코 games with
console.log('');
console.log('─── 코스트별 보유 게임 수 ─────────────────────────────────');
console.log('  코스트 | 보유 게임 | 비율   | 사망 시 평균 보유수');
console.log('  ──────┼──────────┼────────┼───────────────────');
for (const c of [1, 2, 3, 4, 5, 7, 10]) {
    const games = gamesWithCost[c] || 0;
    const avgCount = games > 0 ? (costAppearance[c] / N).toFixed(1) : '0.0';
    console.log(`    ${String(c).padStart(2)}코 |   ${String(games).padStart(4)}   | ${(games / N * 100).toFixed(1).padStart(5)}% | ${avgCount}`);
}

// 7코/10코 유닛별 상세
console.log('');
console.log('─── 7코/10코 유닛별 보드 출현 ──────────────────────────────');
console.log('  유닛           | 출현 게임 | 비율   | 최대★');
console.log('  ──────────────┼──────────┼────────┼──────');
const highCostUnits = Object.values(unitAppearance).filter(u => u.cost >= 7).sort((a, b) => b.games - a.games);
if (highCostUnits.length === 0) {
    console.log('  (아직 보드에 올라간 7/10코 없음 — 해금 후 상점 출현 확인 필요)');
}
for (const u of highCostUnits) {
    const nameStr = `${u.name}(${u.cost}코)`.padEnd(14);
    console.log(`  ${nameStr} |   ${String(u.games).padStart(4)}   | ${(u.games / N * 100).toFixed(1).padStart(5)}% | ★${u.maxStar}`);
}

// 보스 라운드별 보드 코스트 구성
console.log('');
console.log('─── 보스 라운드 보드 코스트 구성 (평균) ──────────────────────');
console.log('  라운드 | 1코  | 2코  | 3코  | 4코  | 5코  | 7코  | 10코 | 총수');
console.log('  ──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼────');
for (const rnd of [10, 20, 30, 40, 50]) {
    const snaps = boardAtRound[rnd];
    if (snaps.length === 0) continue;
    const costCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 7: 0, 10: 0 };
    let totalUnits = 0;
    for (const snap of snaps) {
        for (const u of snap) {
            costCounts[u.cost] = (costCounts[u.cost] || 0) + 1;
            totalUnits++;
        }
    }
    const n = snaps.length;
    const row = [1, 2, 3, 4, 5, 7, 10].map(c => (costCounts[c] / n).toFixed(1).padStart(4)).join(' | ');
    console.log(`   R${String(rnd).padStart(2)}  | ${row} | ${(totalUnits / n).toFixed(1).padStart(3)}`);
}

// 7코/10코 첫 출현 라운드 분포
console.log('');
console.log('─── 7코/10코 첫 등판 라운드 분포 ────────────────────────────');
for (const c of [7, 10]) {
    const roundsFound = [];
    for (const r of results) {
        for (const [id, data] of Object.entries(r.unitsSeen)) {
            const unit = UNITS.find(u => u.id === id);
            if (unit && unit.cost === c) {
                roundsFound.push(data.firstRound);
            }
        }
    }
    if (roundsFound.length === 0) {
        console.log(`  ${c}코: 출현 없음`);
        continue;
    }
    roundsFound.sort((a, b) => a - b);
    const avg = (roundsFound.reduce((a, b) => a + b, 0) / roundsFound.length).toFixed(1);
    const min = roundsFound[0];
    const max = roundsFound[roundsFound.length - 1];
    const median = roundsFound[Math.floor(roundsFound.length / 2)];
    console.log(`  ${c}코: 출현 ${roundsFound.length}건 | 최초 R${min} | 중간값 R${median} | 평균 R${avg} | 최후 R${max}`);

    // Distribution histogram
    const buckets = {};
    for (const r of roundsFound) {
        const bucket = Math.floor((r - 1) / 5) * 5 + 1;
        const label = `R${bucket}-${bucket + 4}`;
        buckets[label] = (buckets[label] || 0) + 1;
    }
    for (const [label, cnt] of Object.entries(buckets)) {
        const bar = '▓'.repeat(Math.ceil(cnt / 2));
        console.log(`    ${label.padEnd(8)}: ${String(cnt).padStart(3)} ${bar}`);
    }
}

// ★ 등급 분포
console.log('');
console.log('─── 사망 시 ★ 등급 분포 ──────────────────────────────────');
const starDist = { 1: 0, 2: 0, 3: 0 };
let totalFinalUnits = 0;
for (const r of results) {
    for (const slot of r.finalBoard) {
        starDist[slot.star] = (starDist[slot.star] || 0) + 1;
        totalFinalUnits++;
    }
}
console.log(`  ★1: ${starDist[1]} (${(starDist[1] / totalFinalUnits * 100).toFixed(1)}%)`);
console.log(`  ★2: ${starDist[2]} (${(starDist[2] / totalFinalUnits * 100).toFixed(1)}%)`);
console.log(`  ★3: ${starDist[3]} (${(starDist[3] / totalFinalUnits * 100).toFixed(1)}%)`);

// Top 15 most used units
console.log('');
console.log('─── 인기 유닛 TOP 15 (보드 출현 게임 수) ─────────────────');
console.log('  순위 | 유닛             | 코스트 | 출현 | 비율   | 특성');
console.log('  ────┼─────────────────┼───────┼──────┼────────┼──────');
const sortedUnits = Object.values(unitAppearance).sort((a, b) => b.games - a.games).slice(0, 15);
sortedUnits.forEach((u, i) => {
    const nameStr = u.name.padEnd(15);
    console.log(`   ${String(i + 1).padStart(2)} | ${nameStr} | ${String(u.cost).padStart(2)}코   | ${String(u.games).padStart(4)} | ${(u.games / N * 100).toFixed(1).padStart(5)}% | ${u.origin}`);
});

// Difficulty Assessment
console.log('');
console.log('─── Difficulty Assessment ────────────────────────────────────');
const earlyDeaths = results.filter(r => r.deathRound <= 10).length;
const midDeaths = results.filter(r => r.deathRound > 10 && r.deathRound <= 30).length;
const lateDeaths = results.filter(r => r.deathRound > 30 && r.deathRound <= 50).length;
const endDeaths = results.filter(r => r.deathRound > 50 && r.deathRound <= 70).length;
console.log(`  Early (R1-10):  ${earlyDeaths} deaths (${(earlyDeaths / N * 100).toFixed(1)}%)`);
console.log(`  Mid   (R11-30): ${midDeaths} deaths (${(midDeaths / N * 100).toFixed(1)}%)`);
console.log(`  Late  (R31-50): ${lateDeaths} deaths (${(lateDeaths / N * 100).toFixed(1)}%)`);
console.log(`  End   (R51-70): ${endDeaths} deaths (${(endDeaths / N * 100).toFixed(1)}%)`);
console.log(`  Clear (R70+):   ${clears.length} (${(clears.length / N * 100).toFixed(1)}%)`);

// Origin distribution at death
console.log('');
console.log('─── 사망 시 특성 분포 ────────────────────────────────────');
const originDist = {};
for (const r of results) {
    for (const slot of r.finalBoard) {
        const unit = UNITS.find(u => u.id === slot.id);
        if (unit) originDist[unit.origin] = (originDist[unit.origin] || 0) + 1;
    }
}
const sortedOrigins = Object.entries(originDist).sort((a, b) => b[1] - a[1]);
for (const [origin, count] of sortedOrigins) {
    const bar = '█'.repeat(Math.ceil(count / 10));
    console.log(`  ${origin.padEnd(10)}: ${String(count).padStart(4)} (${(count / totalFinalUnits * 100).toFixed(1)}%) ${bar}`);
}

console.log('══════════════════════════════════════════════════════════════');
