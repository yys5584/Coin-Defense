// Advanced simulation with synergy effects + plat/diamond deck strategy
// 시너지 반영 + 플래/다이아 덱 전략 시뮬레이션
const fs = require('fs');
const src = fs.readFileSync('./src/core/config.ts', 'utf8');

// Parse units
const re = /\{\s*id:\s*'(\w+)',\s*name:\s*'([^']+)',\s*emoji:\s*'([^']+)',\s*cost:\s*(\d+),\s*\n?\s*origin:\s*Origin\.(\w+),\s*\n?\s*baseDmg:\s*(\d+)[\s\S]*?attackSpeed:\s*([\d.]+)/g;
const UNITS = []; let m;
while ((m = re.exec(src)) !== null) {
    UNITS.push({ id: m[1], name: m[2], cost: +m[4], origin: m[5].toLowerCase(), baseDmg: +m[6], atkSpd: +m[7], dps: m[6] * m[7] });
}
const byCost = {}; for (const u of UNITS) (byCost[u.cost] = byCost[u.cost] || []).push(u);
const byOrigin = {}; for (const u of UNITS) (byOrigin[u.origin] = byOrigin[u.origin] || []).push(u);

console.log('Parsed ' + UNITS.length + ' units');
for (const c of [1, 2, 3, 4, 5, 7, 10]) console.log('  ' + c + '-cost: ' + (byCost[c] || []).length);
console.log('');

// Synergy breakpoints: count needed for each level (0-3)
const SYN_BP = [2, 4, 6, 8]; // all origins use 2/4/6/8

// Synergy effects: returns DPS multiplier, slow%, stun effective time ratio
function getSynergyBuffs(originCounts) {
    let dmgMult = 1.0;
    let atkSpdMult = 1.0;
    let critChance = 0;
    let critDmg = 2.0;
    let slowPct = 0;
    let stunTimeRatio = 0; // fraction of time enemies are stunned
    let bonusGoldPerRound = 0;
    let bonusKillGold = 0;

    for (const [origin, count] of Object.entries(originCounts)) {
        if (count < 2) continue;
        const level = count >= 8 ? 3 : count >= 6 ? 2 : count >= 4 ? 1 : 0;

        switch (origin) {
            case 'bitcoin':
                dmgMult += [0.15, 0.30, 0.50, 0.80][level];
                if (level >= 1) dmgMult += [0, 0.10, 0.20, 0.30][level]; // boss dmg approx
                if (level >= 3) critChance += 0.20;
                break;
            case 'defi':
                dmgMult += [0.10, 0.25, 0.40, 0.60][level];
                // skill CDR -> treat as ~15% effective DPS boost at higher levels
                if (level >= 1) dmgMult += [0, 0.08, 0.15, 0.25][level];
                break;
            case 'social':
                atkSpdMult += [0.10, 0.25, 0.40, 0.60][level];
                if (level >= 2) dmgMult += [0, 0, 0.15, 0.30][level];
                if (level >= 3) bonusGoldPerRound += 2;
                break;
            case 'exchange':
                dmgMult += [0.15, 0.30, 0.45, 0.65][level];
                atkSpdMult += [0.05, 0.15, 0.25, 0.35][level];
                if (level >= 2) bonusKillGold += [0, 0, 1, 2][level];
                break;
            case 'vc':
                critChance += [0.10, 0.20, 0.30, 0.40][level];
                atkSpdMult += [0.10, 0.25, 0.40, 0.60][level];
                if (level >= 1) critDmg = 2.0 + [0, 0.30, 0.60, 1.00][level];
                break;
            case 'fud':
                // armor ignore -> treat as ~15-30% DPS boost
                dmgMult += [0.12, 0.25, 0.40, 0.55][level];
                if (level >= 1) dmgMult += [0, 0.15, 0.30, 0.50][level];
                break;
            case 'rugpull':
                dmgMult += [0.10, 0.20, 0.35, 0.50][level];
                // armor reduce -> ~10-20% DPS boost
                dmgMult += [0.08, 0.15, 0.22, 0.30][level];
                if (level >= 2) bonusKillGold += [0, 0, 1, 2][level];
                break;
            case 'bear':
                slowPct = Math.max(slowPct, [0.15, 0.30, 0.45, 0.60][level]);
                if (level >= 1) stunTimeRatio = [0, 0.08, 0.15, 0.25][level]; // approx
                if (level >= 2) dmgMult += [0, 0, 0.20, 0.40][level];
                break;
        }
    }

    // Effective DPS multiplier including crit
    const critMult = 1 + critChance * (critDmg - 1);
    const effectiveDpsMult = dmgMult * atkSpdMult * critMult;

    // CC effectiveness: slow increases time enemies spend in range
    // stun effectively multiplies DPS time
    const ccMult = 1 / (1 - slowPct * 0.7) * (1 + stunTimeRatio);

    return { effectiveDpsMult, ccMult, slowPct, bonusGoldPerRound, bonusKillGold };
}

// Shop/Level constants
const ODDS = [[100, 0, 0, 0, 0], [100, 0, 0, 0, 0], [75, 25, 0, 0, 0], [55, 30, 15, 0, 0], [40, 30, 25, 5, 0],
[25, 30, 30, 12, 3], [20, 25, 30, 18, 7], [15, 20, 25, 25, 15], [10, 15, 25, 30, 20], [5, 10, 20, 30, 35]];
const XP = [0, 2, 2, 6, 10, 20, 36, 48, 72, 80];
const SM = { 1: 1, 2: 3, 3: 9 };

function stg(r) { return r <= 3 ? 1 : Math.min(Math.floor((r - 4) / 7) + 2, 7); }
function isB(r) { return r > 3 && (r - 3) % 7 === 0; }
function sr(r) { const s = stg(r); return s === 1 ? s + '-' + r : s + '-' + (((r - 4) % 7) + 1); }

function roll(l) {
    const o = ODDS[Math.min(l - 1, 9)];
    const r = Math.random() * 100; let a = 0;
    for (let t = 0; t < 5; t++) {
        a += o[t];
        if (r < a) { const c = [1, 2, 3, 4, 5][t]; const p = byCost[c] || byCost[1]; return p[Math.floor(Math.random() * p.length)]; }
    }
    return byCost[1][0];
}

// Plat/Diamond strategy: prefer units that contribute to existing synergies
function platDiamondBuyStrategy(shop, board, gold, slots, uc) {
    const originCounts = {};
    for (const u of board) originCounts[u.origin] = (originCounts[u.origin] || 0) + 1;

    // Score each shop unit
    const scored = shop.map(u => {
        let score = 0;
        const existing = board.find(b => b.uid === u.id);
        const copies = uc[u.id] || 0;

        // High priority: can upgrade (have 2 copies, buying 3rd = 2-star)
        if (copies === 2 || copies === 8) score += 50;
        // Medium: have 1 copy already
        else if (copies >= 1) score += 20;

        // Synergy contribution
        const oCnt = originCounts[u.origin] || 0;
        // About to hit breakpoint?
        if (oCnt === 1 || oCnt === 3 || oCnt === 5 || oCnt === 7) score += 25;
        // Already have this origin
        if (oCnt >= 1) score += 10;

        // Prefer higher cost (better stats)
        score += u.cost * 3;

        // Can we afford it?
        if (gold < u.cost) score = -999;

        // Don't buy if board full and can't upgrade
        if (!existing && board.length >= slots && gold < u.cost) score = -999;

        return { unit: u, score, isUpgrade: !!existing };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
}

function runGame() {
    let hp = 20, gold = 10, lv = 1, xp = 0, ws = 0, ls = 0;
    const board = []; const uc = {}; let sl = 1;
    let u7 = 0, u10 = 0, unl7 = false, unl10 = false;
    const log = [];

    for (let r = 1; r <= 45; r++) {
        const st = stg(r);

        // Income
        if (r > 1) {
            gold += [0, 0, 1, 3, 4, 6, 7, 8][st] || 0;
            if (st > 1) gold += Math.min(Math.floor(gold / 10), 3); // interest
            if (st > 1) { const sk = Math.max(ws, ls); gold += sk >= 6 ? 3 : sk >= 5 ? 2 : sk >= 2 ? 1 : 0; }
        }

        // Synergy gold bonus
        const oc = {};
        for (const u of board) oc[u.origin] = (oc[u.origin] || 0) + 1;
        const synBuffs = getSynergyBuffs(oc);
        gold += synBuffs.bonusGoldPerRound;

        // XP/level
        if (r > 1 && lv < 10) {
            xp += [0, 2, 2, 4, 6, 8, 10, 12][st] || 2;
            while (lv < 10 && xp >= XP[lv]) { xp -= XP[lv]; lv++; sl = Math.min(lv, 6); }
        }

        // Unlock hidden units
        if (st >= 4) unl7 = true;
        if (st >= 6) unl10 = true;

        // Shop
        const shop = [];
        for (let s = 0; s < 5; s++) {
            if (unl7 && Math.random() < 0.15) {
                if (unl10 && Math.random() < 0.2) {
                    const c10 = byCost[10] || [];
                    shop.push(c10.length > 0 ? c10[0] : roll(lv));
                } else {
                    const c7 = byCost[7] || [];
                    shop.push(c7.length > 0 ? c7[Math.floor(Math.random() * c7.length)] : roll(lv));
                }
            } else {
                shop.push(roll(lv));
            }
        }

        // Plat/Diamond: smart buying
        const scored = platDiamondBuyStrategy(shop, board, gold, sl, uc);
        for (const { unit: u, score, isUpgrade } of scored) {
            if (score < 0) continue;
            if (gold < u.cost) continue;

            gold -= u.cost;
            if (u.cost === 7) u7++;
            if (u.cost === 10) u10++;
            uc[u.id] = (uc[u.id] || 0) + 1;
            const cnt = uc[u.id];
            const star = cnt >= 9 ? 3 : cnt >= 3 ? 2 : 1;
            const ex = board.find(x => x.uid === u.id);
            if (ex) {
                ex.star = star;
                ex.dps = u.dps * SM[star];
            } else if (board.length < sl) {
                board.push({ uid: u.id, star, dps: u.dps * SM[star], cost: u.cost, origin: u.origin });
            }
        }

        // Buy XP (plat/diamond: more aggressive leveling in stage 3+)
        if (st >= 3) while (gold >= 12 && lv < 10) {
            gold -= 4; xp += 4;
            while (lv < 10 && xp >= XP[lv]) { xp -= XP[lv]; lv++; sl = Math.min(lv, 6); }
        }

        // Reroll occasionally (plat/diamond behavior, 30% chance if gold > 15)
        if (st >= 3 && gold > 15 && Math.random() < 0.3) {
            gold -= 2;
            const reroll = [];
            for (let s = 0; s < 5; s++) reroll.push(roll(lv));
            const scored2 = platDiamondBuyStrategy(reroll, board, gold, sl, uc);
            for (const { unit: u, score } of scored2) {
                if (score < 10) continue;
                if (gold < u.cost) continue;
                gold -= u.cost;
                uc[u.id] = (uc[u.id] || 0) + 1;
                const cnt = uc[u.id];
                const star = cnt >= 9 ? 3 : cnt >= 3 ? 2 : 1;
                const ex = board.find(x => x.uid === u.id);
                if (ex) { ex.star = star; ex.dps = u.dps * SM[star]; }
                else if (board.length < sl) board.push({ uid: u.id, star, dps: u.dps * SM[star], cost: u.cost, origin: u.origin });
            }
        }

        // Combat with synergy buffs
        const oc2 = {};
        for (const u of board) oc2[u.origin] = (oc2[u.origin] || 0) + 1;
        const buffs = getSynergyBuffs(oc2);

        const rawDps = board.reduce((s, u) => s + u.dps, 0);
        const effectiveDps = rawDps * buffs.effectiveDpsMult;
        const ccMult = buffs.ccMult; // CC makes enemies slower -> more time to deal damage

        const boss = isB(r);
        const cnt = boss ? 1 : (st === 1 ? (r === 1 ? 1 : r === 2 ? 3 : 5) : 10);
        const mhp = boss ? Math.floor(r * r * 2.5 + r * 70 + 150) : Math.floor(r * r * 0.45 + r * 6.0 + 5);
        const thp = mhp * cnt;
        const spd = 1.2 + r * 0.012;
        const effectiveSpeed = spd * (1 - buffs.slowPct);
        const lt = 18 / effectiveSpeed; // more time with slow

        let won = true;
        if (effectiveDps <= 0) { hp -= cnt * (boss ? 5 : 1); won = false; }
        else {
            const ttk = thp / effectiveDps;
            if (ttk > lt) {
                const k = Math.floor(effectiveDps * lt / mhp);
                const l = cnt - Math.min(k, cnt);
                hp -= l * (boss ? 5 : 1);
                won = l === 0;
            }
        }

        // Kill gold bonus from synergy
        if (won) {
            const killGold = buffs.bonusKillGold * cnt * 0.3; // not all kills, approximate
            gold += 1 + Math.floor(killGold);
            ws++; ls = 0;
        } else { ls++; ws = 0; }

        // Active synergies for logging
        const activeSyns = [];
        for (const [o, c] of Object.entries(oc2)) {
            if (c >= 2) activeSyns.push(o + ':' + c);
        }

        log.push({
            r, lv, hp, rawDps: Math.round(rawDps), effDps: Math.round(effectiveDps),
            synMult: buffs.effectiveDpsMult.toFixed(2), ccMult: ccMult.toFixed(2),
            mhp, cnt, won, boardSz: board.length, syns: activeSyns.join(' ')
        });

        if (hp <= 0) return { fr: r, lv, u7, u10, log, board: [...board], synCounts: oc2 };
    }
    return { fr: 45, lv, won: true, u7, u10, log, board: [...board], synCounts: oc2 };
}

// Run 500 games
const R = [];
for (let i = 0; i < 500; i++) R.push(runGame());
const n = 500;

// Key round survival
const keyRounds = [3, 5, 10, 17, 24, 31, 38, 45];
console.log('=== 500 GAMES (SYNERGY + PLAT/DIA STRATEGY) ===\n');

console.log('SURVIVAL BY BOSS ROUND:');
for (const kr of keyRounds) {
    const alive = R.filter(r => r.fr >= kr).length;
    console.log('  ' + sr(kr) + ' (R' + kr + '): ' + Math.round(alive / n * 100) + '% (' + alive + '/' + n + ')');
}
const clr = R.filter(r => r.won).length;
console.log('  CLEAR: ' + Math.round(clr / n * 100) + '%');
console.log('');

// Death distribution
const ds = {};
for (const r of R) if (!r.won) { const s = stg(r.fr); ds[s] = (ds[s] || 0) + 1; }
console.log('DEATH BY STAGE:');
for (let s = 1; s <= 7; s++) console.log('  S' + s + ': ' + (ds[s] || 0));
console.log('  Clear: ' + clr);
console.log('');

// Round-by-round key data
console.log('ROUND DATA (key rounds):');
console.log('Rnd | Stage | RawDPS | EffDPS | SynMult | MonHP | MonCnt | WR% | HP | Alive');
const maxR = Math.max(...R.map(r => r.fr));
for (let r = 1; r <= maxR; r++) {
    const alive = R.filter(res => res.fr >= r);
    if (!alive.length) break;
    const logs = alive.map(res => res.log[r - 1]).filter(Boolean);
    const rawD = logs.reduce((a, l) => a + l.rawDps, 0) / logs.length;
    const effD = logs.reduce((a, l) => a + l.effDps, 0) / logs.length;
    const ah = logs.reduce((a, l) => a + l.hp, 0) / logs.length;
    const wr = logs.filter(l => l.won).length / logs.length * 100;
    const mhp = logs[0].mhp; const cnt = logs[0].cnt;
    if (r <= 5 || isB(r) || r % 5 === 0 || r === maxR) {
        console.log('R' + r + ' | ' + sr(r) + ' | ' + Math.round(rawD) + ' | ' + Math.round(effD) + ' | ' + (effD / rawD).toFixed(2) + 'x | ' + mhp + ' | ' + cnt + ' | ' + wr.toFixed(0) + '% | ' + ah.toFixed(1) + ' | ' + alive.length);
    }
}
console.log('');

// Average synergy count at death/end
const synAtEnd = {};
for (const r of R) {
    for (const [o, c] of Object.entries(r.synCounts || {})) {
        if (c >= 2) synAtEnd[o] = (synAtEnd[o] || 0) + 1;
    }
}
console.log('SYNERGY POPULARITY (active at game end, 2+ count):');
const sorted = Object.entries(synAtEnd).sort((a, b) => b[1] - a[1]);
for (const [o, cnt] of sorted) {
    console.log('  ' + o + ': ' + cnt + '/' + n + ' (' + Math.round(cnt / n * 100) + '%)');
}
console.log('');

// Example game log (first game that cleared or furthest)
const best = R.reduce((a, b) => b.fr > a.fr ? b : a, R[0]);
console.log('SAMPLE GAME (best run, R' + best.fr + '):');
for (const l of best.log) {
    if (l.r <= 3 || isB(l.r) || l.r % 5 === 0 || l.r === best.fr) {
        console.log('  R' + l.r + ' Lv' + l.lv + ' RawDPS:' + l.rawDps + ' EffDPS:' + l.effDps + '(' + l.synMult + 'x) HP:' + l.hp + ' [' + l.syns + '] ' + (l.won ? 'W' : 'L'));
    }
}
