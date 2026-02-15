// 100회 시뮬레이션: 보스 드랍, 증강 타이밍, 7/10코 유닛 등장 확인
// Updated for new 46-unit / 8-origin system
const fs = require('fs');
const src = fs.readFileSync('./src/core/config.ts', 'utf8');

// 유닛 파싱 — config.ts에서 유닛 데이터 추출
const unitRe = /\{\s*id:\s*'(\w+)',\s*name:\s*'([^']+)',\s*emoji:\s*'([^']+)',\s*cost:\s*(\d+),[\s\S]*?baseDmg:\s*(\d+)[\s\S]*?attackSpeed:\s*([\d.]+)/g;
const UNITS = []; let m;
while ((m = unitRe.exec(src)) !== null) {
    UNITS.push({ id: m[1], name: m[2], cost: parseInt(m[4]), baseDmg: parseInt(m[5]), atkSpd: parseFloat(m[6]), dps: parseInt(m[5]) * parseFloat(m[6]) });
}
const byCost = {}; for (const u of UNITS) (byCost[u.cost] = byCost[u.cost] || []).push(u);

console.log(`[파싱] 유닛 ${UNITS.length}종 발견`);
for (const c of [1, 2, 3, 4, 5, 7, 10]) {
    const list = byCost[c] || [];
    console.log(`  ${c}코: ${list.length}종 — ${list.map(u => u.name).join(', ')}`);
}
console.log('');

// LEVELS (config.ts의 LEVELS에서 가져온 shopOdds)
const SHOP_ODDS = [
    [100, 0, 0, 0, 0],   // Lv1
    [100, 0, 0, 0, 0],   // Lv2
    [75, 25, 0, 0, 0],    // Lv3
    [55, 30, 15, 0, 0],   // Lv4
    [40, 30, 25, 5, 0],   // Lv5
    [25, 30, 30, 12, 3],  // Lv6
    [20, 25, 30, 18, 7],  // Lv7
    [15, 20, 25, 25, 15], // Lv8
    [10, 15, 25, 30, 20], // Lv9
    [5, 10, 20, 30, 35],  // Lv10
];
const XP_PER_LEVEL = [0, 2, 2, 6, 10, 20, 36, 48, 72, 80];
const STAR_MULT = { 1: 1, 2: 3.0, 3: 9.0 };

function getStage(r) { return r <= 3 ? 1 : Math.min(Math.floor((r - 4) / 7) + 2, 7); }
function isBoss(r) { return r > 3 && (r - 3) % 7 === 0; }
function sr(r) { const s = getStage(r); return s === 1 ? s + '-' + r : s + '-' + (((r - 4) % 7) + 1); }

function rollUnit(l) {
    const o = SHOP_ODDS[Math.min(l - 1, 9)];
    const r = Math.random() * 100; let a = 0;
    for (let t = 0; t < 5; t++) {
        a += o[t];
        if (r < a) { const c = [1, 2, 3, 4, 5][t]; const p = byCost[c] || byCost[1]; return p[Math.floor(Math.random() * p.length)]; }
    }
    return byCost[1][0];
}

// 보스/증강 라운드
const BOX_DROPS = [
    { round: 10, name: '2-7' }, { round: 17, name: '3-7' },
    { round: 24, name: '4-7' }, { round: 31, name: '5-7' }, { round: 38, name: '6-7' },
];
const BOX_UNLOCK_CHANCE = 0.30;
const AUGMENT_ROUNDS = [11, 18, 25, 32, 39];

// 몬스터 HP 공식 (config.ts에서 가져옴)
const nA = 0.18, nB = 3.5, nC = 5;
const bA = 1.5, bB = 50, bC = 150;

function runGame() {
    let hp = 20, gold = 10, level = 1, xp = 0, ws = 0, ls = 0;
    const board = []; const uc = {}; let slots = 1;
    const events = {
        bossDrops: [],
        augments: [],
        units7cost: 0,
        units10cost: 0,
    };
    let unlocked7 = false;
    let unlocked10 = false;
    const roundLog = []; // 매 라운드 상태

    for (let r = 1; r <= 45; r++) {
        const st = getStage(r);

        // 수입
        if (r > 1) {
            gold += [0, 0, 1, 3, 4, 6, 7, 8][st] || 0;
            if (st > 1) gold += Math.min(Math.floor(gold / 10), 3);
            if (st > 1) { const sk = Math.max(ws, ls); gold += sk >= 6 ? 3 : sk >= 5 ? 2 : sk >= 2 ? 1 : 0; }
        }

        // XP/레벨업
        if (r > 1 && level < 10) {
            xp += [0, 2, 2, 4, 6, 8, 10, 12][st] || 2;
            while (level < 10 && xp >= XP_PER_LEVEL[level]) { xp -= XP_PER_LEVEL[level]; level++; slots = Math.min(level, 6); }
        }

        // 상점 (7/10코 해금)
        if (st >= 4) unlocked7 = true;
        if (st >= 6) unlocked10 = true;

        const shop = [];
        for (let s = 0; s < 5; s++) {
            if (unlocked7 && Math.random() < 0.15) {
                if (unlocked10 && Math.random() < 0.2) {
                    const c10 = byCost[10] || [];
                    shop.push(c10.length > 0 ? c10[0] : rollUnit(level));
                } else {
                    const c7 = byCost[7] || [];
                    shop.push(c7.length > 0 ? c7[Math.floor(Math.random() * c7.length)] : rollUnit(level));
                }
            } else {
                shop.push(rollUnit(level));
            }
        }
        shop.sort((a, b) => b.cost - a.cost);

        // 구매 로직
        for (const u of shop) {
            if (gold >= u.cost) {
                gold -= u.cost;
                if (u.cost === 7) events.units7cost++;
                if (u.cost === 10) events.units10cost++;
                uc[u.id] = (uc[u.id] || 0) + 1;
                const cnt = uc[u.id]; const star = cnt >= 9 ? 3 : cnt >= 3 ? 2 : 1;
                const ex = board.find(x => x.unitId === u.id);
                if (ex) { ex.star = star; ex.dps = u.dps * STAR_MULT[star]; }
                else if (board.length < slots) board.push({ unitId: u.id, star, dps: u.dps * STAR_MULT[star], cost: u.cost });
            }
        }

        // XP 구매 (골드 여유 있으면)
        if (st >= 3) while (gold >= 14 && level < 10) {
            gold -= 4; xp += 4;
            while (level < 10 && xp >= XP_PER_LEVEL[level]) { xp -= XP_PER_LEVEL[level]; level++; slots = Math.min(level, 6); }
        }

        // 전투 시뮬레이션
        const tdps = board.reduce((s, u) => s + u.dps, 0);
        const boss = isBoss(r);
        const cnt = boss ? 1 : (st === 1 ? (r === 1 ? 1 : r === 2 ? 3 : 5) : 10);
        const mhp = boss ? Math.floor(r * r * bA + r * bB + bC) : Math.floor(r * r * nA + r * nB + nC);
        const thp = mhp * cnt; const spd = 1.2 + r * 0.012; const lt = 18 / spd;
        let won = true;
        if (tdps <= 0) { hp -= cnt * (boss ? 5 : 1); won = false; }
        else { const ttk = thp / tdps; if (ttk > lt) { const k = Math.floor(tdps * lt / mhp); const l = cnt - Math.min(k, cnt); hp -= l * (boss ? 5 : 1); won = l === 0; } }

        if (won) { gold += 1; ws++; ls = 0; } else { ls++; ws = 0; }

        // 라운드 로그
        roundLog.push({ round: r, stage: sr(r), level, hp, gold, tdps: Math.round(tdps), mhp, cnt, won, boardSize: board.length });

        // 보스 드랍
        if (boss && won) {
            const drop = BOX_DROPS.find(d => d.round === r);
            if (drop) {
                const gotKey = Math.random() < BOX_UNLOCK_CHANCE;
                events.bossDrops.push({ round: r, name: drop.name, gotKey });
            }
        }

        // 증강
        if (AUGMENT_ROUNDS.includes(r)) {
            events.augments.push({ round: r, stageRound: sr(r) });
        }

        if (hp <= 0) return { finalRound: r, level, events, board, roundLog };
    }
    return { finalRound: 45, level, won: true, events, board, roundLog };
}

// ═══ 100회 실행 ═══
const results = [];
for (let i = 0; i < 100; i++) results.push(runGame());

// ── 통계 ──
const finalRounds = results.map(r => r.finalRound);
const avgRound = finalRounds.reduce((a, b) => a + b, 0) / 100;
const wins = results.filter(r => r.won).length;
const avgLevel = results.reduce((a, r) => a + r.level, 0) / 100;

// 스테이지별 사망 분포
const deathByStage = {};
for (const r of results) {
    if (!r.won) {
        const s = getStage(r.finalRound);
        deathByStage[s] = (deathByStage[s] || 0) + 1;
    }
}

// 보스 도달
const bossWins = {};
for (const r of results) {
    for (const boss of BOX_DROPS) {
        if (r.finalRound >= boss.round) {
            bossWins[boss.name] = (bossWins[boss.name] || 0) + 1;
        }
    }
}

// 보스 드랍 열쇠
let totalKeys = 0;
for (const r of results) totalKeys += r.events.bossDrops.filter(d => d.gotKey).length;

// 증강
let totalAugments = 0;
for (const r of results) totalAugments += r.events.augments.length;

// 7코/10코
const avg7 = results.reduce((a, r) => a + r.events.units7cost, 0) / 100;
const avg10 = results.reduce((a, r) => a + r.events.units10cost, 0) / 100;
const total7 = results.reduce((a, r) => a + r.events.units7cost, 0);
const total10 = results.reduce((a, r) => a + r.events.units10cost, 0);
const got7 = results.filter(r => r.events.units7cost > 0).length;
const got10 = results.filter(r => r.events.units10cost > 0).length;

// ── 라운드별 평균 DPS/HP ──
const maxRound = Math.max(...finalRounds);
const roundStats = [];
for (let r = 1; r <= maxRound; r++) {
    const alive = results.filter(res => res.finalRound >= r);
    if (alive.length === 0) break;
    const logs = alive.map(res => res.roundLog[r - 1]).filter(Boolean);
    const avgDps = logs.reduce((a, l) => a + l.tdps, 0) / logs.length;
    const avgHp = logs.reduce((a, l) => a + l.hp, 0) / logs.length;
    const winRate = logs.filter(l => l.won).length / logs.length * 100;
    const mhp = logs[0] ? logs[0].mhp : 0;
    const cnt = logs[0] ? logs[0].cnt : 0;
    roundStats.push({ round: r, stage: sr(r), avgDps: Math.round(avgDps), mhp, cnt, totalMhp: mhp * cnt, avgHp: avgHp.toFixed(1), winRate: winRate.toFixed(0), alive: alive.length });
}

// ═══════════════════ 출력 ═══════════════════

console.log('=== 100회 시뮬레이션 결과 (v2 - 46유닛/8시너지) ===');
console.log('');

console.log('## 기본 통계');
console.log(`| 항목 | 값 |`);
console.log(`|------|-----|`);
console.log(`| 클리어(7-7) | ${wins}회 (${wins}%) |`);
console.log(`| 평균 도달 | ${sr(Math.round(avgRound))} (R${avgRound.toFixed(1)}) |`);
console.log(`| 평균 레벨 | ${avgLevel.toFixed(1)} |`);
console.log('');

console.log('## 스테이지별 사망 분포');
console.log('| 스테이지 | 사망 수 |');
console.log('|---------|--------|');
for (let s = 1; s <= 7; s++) {
    console.log(`| Stage ${s} | ${deathByStage[s] || 0} |`);
}
console.log(`| 클리어 | ${wins} |`);
console.log('');

console.log('## 보스 도달/처치율');
console.log('| 보스 | 도달 | 드랍(승리) | 열쇠 획득 |');
console.log('|------|------|-----------|----------|');
for (const b of BOX_DROPS) {
    const reached = bossWins[b.name] || 0;
    const dropped = results.reduce((a, r) => a + r.events.bossDrops.filter(d => d.name === b.name).length, 0);
    const keys = results.reduce((a, r) => a + r.events.bossDrops.filter(d => d.name === b.name && d.gotKey).length, 0);
    console.log(`| ${b.name} | ${reached}회 | ${dropped}회 | ${keys}개 |`);
}
console.log('');

console.log('## 증강 선택 (3-1부터)');
console.log('| 라운드 | 받은 횟수(100게임) |');
console.log('|-------|-----------------|');
for (const ar of AUGMENT_ROUNDS) {
    const cnt = results.reduce((a, r) => a + r.events.augments.filter(e => e.round === ar).length, 0);
    console.log(`| ${sr(ar)} | ${cnt}회 |`);
}
console.log(`| 총 증강 | ${totalAugments}개 (평균 ${(totalAugments / 100).toFixed(1)}) |`);
console.log('');

console.log('## 7코/10코 유닛 통계');
console.log('| 항목 | 값 |');
console.log('|------|-----|');
console.log(`| 7코 구매 총 | ${total7}개 (${got7}/100 게임에서 등장) |`);
console.log(`| 7코 평균 | ${avg7.toFixed(1)}개/게임 |`);
console.log(`| 10코 구매 총 | ${total10}개 (${got10}/100 게임에서 등장) |`);
console.log(`| 10코 평균 | ${avg10.toFixed(1)}개/게임 |`);
console.log('');

console.log('## 라운드별 DPS vs 몬스터HP (주요 라운드)');
console.log('| 라운드 | 스테이지 | 팀DPS | 몬스터HP | 몬수 | 총HP | 승률 | 플레이어HP | 생존 |');
console.log('|--------|---------|-------|---------|------|------|------|-----------|------|');
for (const rs of roundStats) {
    if (rs.round <= 5 || isBoss(rs.round) || rs.round % 5 === 0 || rs.round === maxRound) {
        console.log(`| R${rs.round} | ${rs.stage} | ${rs.avgDps} | ${rs.mhp} | ${rs.cnt} | ${rs.totalMhp} | ${rs.winRate}% | ${rs.avgHp} | ${rs.alive}/100 |`);
    }
}
console.log('');

// DPS 밸런스 체크: 코스트별 평균 DPS
console.log('## 코스트별 유닛 DPS (1성 기준)');
console.log('| 코스트 | 유닛수 | 평균DPS | 최소DPS | 최대DPS | 골드효율(DPS/코스트) |');
console.log('|--------|--------|---------|---------|---------|-------------------|');
for (const c of [1, 2, 3, 4, 5, 7, 10]) {
    const list = byCost[c] || [];
    if (list.length === 0) continue;
    const dpsList = list.map(u => u.dps);
    const avg = dpsList.reduce((a, b) => a + b, 0) / dpsList.length;
    const min = Math.min(...dpsList);
    const max = Math.max(...dpsList);
    console.log(`| ${c}코 | ${list.length} | ${avg.toFixed(1)} | ${min.toFixed(1)} | ${max.toFixed(1)} | ${(avg / c).toFixed(1)} |`);
}
console.log('');

// 7코 유닛별 보유 빈도
console.log('## 7코 유닛별 구매 빈도');
const unit7counts = {};
for (const r of results) {
    for (const u of r.board) {
        if (u.cost === 7) unit7counts[u.unitId] = (unit7counts[u.unitId] || 0) + 1;
    }
}
if (Object.keys(unit7counts).length > 0) {
    console.log('| 유닛 | 보유 게임 수 |');
    console.log('|------|-----------|');
    for (const [id, cnt] of Object.entries(unit7counts).sort((a, b) => b[1] - a[1])) {
        const u = UNITS.find(x => x.id === id);
        console.log(`| ${u ? u.name : id} | ${cnt}회 |`);
    }
} else {
    console.log('(7코 유닛 보유 기록 없음)');
}
