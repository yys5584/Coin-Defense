/**
 * Headless Game Simulation — 500 runs
 * Replicates core game loop without DOM/rendering
 * Usage: npx tsx sim.ts
 */

import { UNITS, UNIT_MAP, LEVELS, POOL_SIZE, STAR_MULTIPLIER, STAGE_DEFENSE, MONSTER_BASE_SPEED, isBossRound, getStage, STARTING_GOLD, STARTING_HP, getBaseIncome, getInterest, getStreakBonus, getXpPerRound, REROLL_COST } from './src/core/config';

const NUM_SIMS = 500;
const MAX_ROUNDS = 70;
const DT = 0.05; // 50ms tick
const SPAWN_INTERVAL = 0.5;

// ---- Minimal types ----
interface SimUnit {
    unitId: string;
    star: 1 | 2 | 3;
    posX: number;
    posY: number;
    attackCooldown: number;
    attackCount: number;
    skillTimer: number;
    skillStacks: number;
    skillActive: boolean;
}

interface SimMonster {
    hp: number;
    maxHp: number;
    def: number;
    mdef: number;
    speed: number;
    pathProgress: number;
    alive: boolean;
    isBoss: boolean;
    goldReward: number;
    laps: number;
    dots: { dps: number; remaining: number }[];
}

interface SimPlayer {
    gold: number;
    level: number;
    xp: number;
    hp: number;
    winStreak: number;
    lossStreak: number;
    board: SimUnit[];
    bench: SimUnit[];
    freeRerolls: number;
}

// ---- Utility ----
function getLevelDef(level: number) {
    return LEVELS.find(l => l.level === level) ?? LEVELS[0];
}

function addXp(p: SimPlayer, amount: number) {
    p.xp += amount;
    while (p.level < 10) {
        const next = LEVELS.find(l => l.level === p.level + 1);
        if (!next) break;
        if (p.xp >= next.requiredXp) {
            p.xp -= next.requiredXp;
            p.level++;
        } else break;
    }
    if (p.level >= 10) p.xp = 0;
}

// ---- Shop: roll a unit ----
function rollUnit(level: number, pool: Record<string, number>): string | null {
    const def = getLevelDef(level);
    const odds = def.shopOdds;
    // Pick cost tier
    const r = Math.random() * 100;
    let cumulative = 0;
    let tier = 1;
    for (let i = 0; i < odds.length; i++) {
        cumulative += odds[i];
        if (r < cumulative) { tier = i + 1; break; }
    }
    // Filter units of this tier with pool > 0
    const candidates = UNITS.filter(u => u.cost === tier && (pool[u.id] ?? 0) > 0);
    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return pick.id;
}

// ---- AI: Simple greedy strategy ----
function aiDecidePhase(p: SimPlayer, round: number, pool: Record<string, number>): void {
    const maxSlots = getLevelDef(p.level).slots;

    // Buy XP if we have excess gold and are below level cap
    const stage = getStage(round);
    if (stage >= 2 && p.level < 10 && p.gold >= 8) {
        // Buy XP once
        p.gold -= 4;
        addXp(p, 4);
    }

    // Generate shop (5 slots)
    const shop: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
        shop.push(rollUnit(p.level, pool));
    }

    // Buy units from shop
    for (const unitId of shop) {
        if (!unitId) continue;
        const def = UNIT_MAP[unitId];
        if (!def) continue;
        if (p.gold < def.cost) continue;

        // Check if we already have 2 copies on bench/board (can merge to 2*)
        const allUnits = [...p.board, ...p.bench];
        const sameCount = allUnits.filter(u => u.unitId === unitId && u.star === 1).length;

        // Buy if: we have room on board, or can merge, or bench has space
        const boardCount = p.board.length;
        const benchCount = p.bench.length;

        if (sameCount >= 2) {
            // Will merge! Always buy
            p.gold -= def.cost;
            pool[unitId] = Math.max(0, (pool[unitId] ?? 0) - 1);
            // Do merge: remove 2 copies, add 1 star-2
            let removed = 0;
            p.board = p.board.filter(u => {
                if (u.unitId === unitId && u.star === 1 && removed < 2) { removed++; return false; }
                return true;
            });
            p.bench = p.bench.filter(u => {
                if (u.unitId === unitId && u.star === 1 && removed < 2) { removed++; return false; }
                return true;
            });
            const merged: SimUnit = {
                unitId, star: 2,
                posX: Math.floor(Math.random() * 7),
                posY: Math.floor(Math.random() * 4),
                attackCooldown: 0, attackCount: 0, skillTimer: 0, skillStacks: 0, skillActive: false,
            };
            if (p.board.length < maxSlots) {
                p.board.push(merged);
            } else {
                p.bench.push(merged);
            }
        } else if (boardCount < maxSlots) {
            // Place directly on board
            p.gold -= def.cost;
            pool[unitId] = Math.max(0, (pool[unitId] ?? 0) - 1);
            p.board.push({
                unitId, star: 1,
                posX: Math.floor(Math.random() * 7),
                posY: Math.floor(Math.random() * 4),
                attackCooldown: 0, attackCount: 0, skillTimer: 0, skillStacks: 0, skillActive: false,
            });
        } else if (benchCount < 9 && sameCount >= 1) {
            // Buy for future merge
            p.gold -= def.cost;
            pool[unitId] = Math.max(0, (pool[unitId] ?? 0) - 1);
            p.bench.push({
                unitId, star: 1,
                posX: 0, posY: 0,
                attackCooldown: 0, attackCount: 0, skillTimer: 0, skillStacks: 0, skillActive: false,
            });
        }
    }

    // Move bench units to board if there's room
    while (p.bench.length > 0 && p.board.length < maxSlots) {
        const u = p.bench.shift()!;
        u.posX = Math.floor(Math.random() * 7);
        u.posY = Math.floor(Math.random() * 4);
        p.board.push(u);
    }
}

// ---- Headless combat simulation ----
interface CombatResult {
    won: boolean;
    kills: number;
    goldEarned: number;
    damage: number;
    elapsedTime: number;
    grade: 'S' | 'A' | 'B' | 'F';
    bonusGold: number;
}

function simulateCombat(p: SimPlayer, round: number): CombatResult {
    const isBoss = isBossRound(round);
    const stage = getStage(round);

    // Monster count
    let monsterCount: number;
    if (isBoss) {
        monsterCount = 1;
    } else if (stage === 1) {
        monsterCount = round === 1 ? 1 : round === 2 ? 3 : 5;
    } else {
        monsterCount = 10;
    }

    // Monster stats
    const baseHp = isBoss
        ? Math.floor(round * round * 12 + round * 150 + 300)
        : Math.floor(round * round * 0.52 + round * 7.8 + 5);
    const baseSpeed = MONSTER_BASE_SPEED + round * 0.012;
    const speed = isBoss ? baseSpeed * 1.3 : baseSpeed;
    const stageDefData = STAGE_DEFENSE[stage] ?? { def: 0, mdef: 0 };
    const monsterDef = isBoss ? Math.floor(stageDefData.def * 2.5) : stageDefData.def;
    const monsterMdef = isBoss ? Math.floor(stageDefData.mdef * 2.5) : stageDefData.mdef;

    // Spawn all monsters
    const monsters: SimMonster[] = [];
    const spawnQueue = monsterCount;

    // Reset unit state
    for (const u of p.board) {
        u.attackCooldown = 0;
        u.skillTimer = 0;
        u.skillStacks = 0;
        u.skillActive = false;
        u.attackCount = 0;
    }

    // Default synergy buffs (simplified - no synergy calc in sim)
    const dmgMult = 1.0;
    const atkSpdMult = 1.0;

    let elapsed = 0;
    let totalKills = 0;
    let totalGold = 0;
    let leakedDamage = 0;
    let spawned = 0;
    let spawnTimer = 0;
    const PATH_LENGTH = 17;
    const DEFAULT_RANGE = 3;
    const DEFAULT_ATK_SPD = 1.0;

    // Main combat loop (max 200s to prevent infinite)
    while (elapsed < 200) {
        // Spawn
        if (spawned < spawnQueue) {
            spawnTimer -= DT;
            if (spawnTimer <= 0) {
                monsters.push({
                    hp: baseHp, maxHp: baseHp,
                    def: monsterDef, mdef: monsterMdef,
                    speed, pathProgress: 0, alive: true,
                    isBoss, goldReward: 0, laps: 0, dots: [],
                });
                spawned++;
                spawnTimer = SPAWN_INTERVAL;
            }
        }

        // Monster movement
        for (const m of monsters) {
            if (!m.alive) continue;
            m.pathProgress += m.speed * DT / PATH_LENGTH;
            if (m.pathProgress >= 1.0) {
                m.pathProgress -= 1.0;
                m.laps++;
                // No lap damage - timer-based now
            }
        }

        // Unit attacks (simplified)
        for (const unit of p.board) {
            const def = UNIT_MAP[unit.unitId];
            if (!def) continue;

            unit.attackCooldown = Math.max(0, unit.attackCooldown - DT);
            if (unit.attackCooldown > 0) continue;

            // Find target (most advanced)
            const range = def.attackRange ?? DEFAULT_RANGE;
            let target: SimMonster | null = null;
            let bestProgress = -1;
            for (const m of monsters) {
                if (!m.alive) continue;
                if (m.pathProgress > bestProgress) {
                    target = m;
                    bestProgress = m.pathProgress;
                }
            }

            if (target) {
                const starMult = STAR_MULTIPLIER[unit.star];
                let dmg = def.baseDmg * starMult * dmgMult;

                // Apply passive skill effects
                if (def.skill?.type === 'passive') {
                    const sp = def.skill.params;
                    if (sp.selfDmgPct) dmg *= (1 + sp.selfDmgPct + (sp.starBonus ?? 0) * unit.star);
                    if (sp.dmgBonus) dmg *= (1 + sp.dmgBonus);
                    if (sp.bossDmgPct && target.isBoss) dmg *= (1 + sp.bossDmgPct);
                    if (sp.dmgMult) dmg *= sp.dmgMult;
                    if (sp.dmgPenalty) dmg *= (1 - sp.dmgPenalty);
                    if (sp.dmgPerEnemy) {
                        const enemyCount = monsters.filter(m => m.alive).length;
                        dmg *= (1 + sp.dmgPerEnemy * enemyCount);
                    }
                    if (sp.maxHpPct) dmg += target.maxHp * sp.maxHpPct;

                    // nthHit
                    unit.attackCount++;
                    const isNthHit = sp.nthHit && (unit.attackCount % sp.nthHit === 0);
                    if (isNthHit) {
                        if (sp.burstMult) dmg *= sp.burstMult;
                        if (sp.stunDuration) target.speed *= 0.05;
                        if (sp.critStunDuration) { dmg *= 2.0; target.speed *= 0.05; }
                        if (!sp.burstMult && !sp.stunDuration && !sp.critStunDuration && !sp.chainTargets && !sp.splashPct && !sp.slowPct) {
                            dmg *= 2.0; // guaranteed crit
                        }
                        // Chain
                        if (sp.chainTargets && sp.chainPct) {
                            const nearby = monsters.filter(m => m.alive && m !== target).slice(0, sp.chainTargets);
                            for (const m of nearby) m.hp -= dmg * sp.chainPct;
                        }
                        // Splash
                        if (sp.splashPct && !sp.chainTargets) {
                            for (const m of monsters) {
                                if (!m.alive || m === target) continue;
                                m.hp -= dmg * sp.splashPct;
                            }
                        }
                        if (sp.slowPct) target.speed *= (1 - sp.slowPct);
                    } else {
                        unit.attackCount++;
                    }

                    // Pierce
                    if (sp.pierceTargets && sp.piercePct && !sp.nthHit) {
                        const sorted = monsters.filter(m => m.alive && m !== target);
                        for (let i = 0; i < sp.pierceTargets && i < sorted.length; i++) {
                            sorted[i].hp -= dmg * sp.piercePct;
                        }
                    }
                } else {
                    unit.attackCount++;
                }

                // Armor reduction
                const armor = def.dmgType === 'magic' ? target.mdef : target.def;
                const reduction = armor / (armor + 100);
                dmg *= (1 - reduction);

                target.hp -= dmg;

                // Set cooldown
                const baseAtkSpd = def.attackSpeed ?? DEFAULT_ATK_SPD;
                const atkSpd = baseAtkSpd * atkSpdMult;
                unit.attackCooldown = 1 / atkSpd;
            }
        }

        // Active skills (simplified)
        for (const unit of p.board) {
            const def = UNIT_MAP[unit.unitId];
            if (!def?.skill || def.skill.type !== 'active') continue;
            const cd = def.skill.cooldown ?? 5;
            unit.skillTimer += DT;
            if (unit.skillTimer < cd) continue;
            unit.skillTimer -= cd;

            const sp = def.skill.params;
            const starMult = STAR_MULTIPLIER[unit.star];
            const baseDmg = def.baseDmg * starMult;
            const alive = monsters.filter(m => m.alive);
            if (alive.length === 0) continue;
            const target = alive[0]; // frontmost

            if (sp.gold) totalGold += sp.gold;
            if (sp.summonDmg) {
                const t = alive[Math.floor(Math.random() * alive.length)];
                t.hp -= sp.summonDmg * starMult;
            }
            if (sp.slowPct) target.speed *= (1 - sp.slowPct);
            if (sp.freezeDuration) target.speed *= 0.2;
            if (sp.defShred) target.def = Math.max(0, target.def - sp.defShred);
            if (sp.mdefShred) target.mdef = Math.max(0, target.mdef - sp.mdefShred);
            if (sp.burstMult) target.hp -= baseDmg * sp.burstMult;
            if (sp.chainTargets && sp.chainPct) {
                target.hp -= baseDmg;
                alive.slice(1, 1 + sp.chainTargets).forEach(m => m.hp -= baseDmg * sp.chainPct);
            }
            if (sp.splashPct && !sp.chainTargets) {
                target.hp -= baseDmg;
                alive.slice(1, 3).forEach(m => m.hp -= baseDmg * sp.splashPct);
            }
            if (sp.hpPct && sp.targets) {
                alive.slice(0, sp.targets).forEach(t => t.hp -= t.maxHp * sp.hpPct);
            }
            if (sp.dotPct && sp.dotDuration) {
                target.dots.push({ dps: baseDmg * sp.dotPct, remaining: sp.dotDuration });
            }
        }

        // DoT ticks
        for (const m of monsters) {
            if (!m.alive || !m.dots || m.dots.length === 0) continue;
            for (let i = m.dots.length - 1; i >= 0; i--) {
                m.hp -= m.dots[i].dps * DT;
                m.dots[i].remaining -= DT;
                if (m.dots[i].remaining <= 0) m.dots.splice(i, 1);
            }
        }

        // Kill check
        for (const m of monsters) {
            if (m.alive && m.hp <= 0) {
                m.alive = false;
                totalKills++;
            }
        }

        elapsed += DT;

        // Timeout damage
        if (isBoss) {
            if (elapsed >= 120) {
                const overtime = elapsed - 120;
                const prevOvertime = overtime - DT;
                if (prevOvertime < 0) leakedDamage += 5;
                const prevTicks = Math.floor(Math.max(0, prevOvertime) / 5);
                const curTicks = Math.floor(overtime / 5);
                if (curTicks > prevTicks) leakedDamage += 3 * (curTicks - prevTicks);
            }
        } else {
            if (elapsed >= 60) {
                const overtime = elapsed - 60;
                const prevOvertime = overtime - DT;
                if (prevOvertime < 0) leakedDamage += 1;
                const prevTicks = Math.floor(Math.max(0, prevOvertime) / 5);
                const curTicks = Math.floor(overtime / 5);
                if (curTicks > prevTicks) leakedDamage += (curTicks - prevTicks);
            }
        }

        // End check
        const allDead = monsters.every(m => !m.alive);
        if (spawned >= spawnQueue && allDead) break;

        // Force end if damage too high
        if (leakedDamage >= 50) break;
    }

    const won = leakedDamage === 0;
    const t = elapsed;
    let grade: 'S' | 'A' | 'B' | 'F';
    let bonusGold = 0;
    if (isBoss) {
        if (t <= 10) { grade = 'S'; bonusGold = 5; }
        else if (t <= 20) { grade = 'A'; bonusGold = 3; }
        else if (t <= 35) { grade = 'B'; bonusGold = 2; }
        else { grade = 'F'; bonusGold = 0; }
    } else {
        if (t <= 10) { grade = 'S'; bonusGold = 4; }
        else if (t <= 20) { grade = 'A'; bonusGold = 2; }
        else if (t <= 30) { grade = 'B'; bonusGold = 1; }
        else { grade = 'F'; bonusGold = 0; }
    }

    return { won, kills: totalKills, goldEarned: totalGold, damage: leakedDamage, elapsedTime: t, grade, bonusGold };
}

// ---- Main simulation ----
function runOneSim(): { deathRound: number; bossBeaten: number[] } {
    const pool = Object.fromEntries(UNITS.map(u => [u.id, POOL_SIZE[u.cost] ?? 0]));

    const p: SimPlayer = {
        gold: STARTING_GOLD, level: 1, xp: 0, hp: STARTING_HP,
        winStreak: 0, lossStreak: 0, board: [], bench: [], freeRerolls: 0,
    };

    const bossBeaten: number[] = [];

    for (let round = 1; round <= MAX_ROUNDS; round++) {
        // Prep phase
        if (round > 1) {
            // XP
            addXp(p, getXpPerRound(round));
            // Income
            const isWarmup = getStage(round) === 1;
            const base = getBaseIncome(round);
            const interest = isWarmup ? 0 : getInterest(p.gold);
            const streak = isWarmup ? 0 : getStreakBonus(Math.max(p.winStreak, p.lossStreak));
            p.gold += base + interest + streak;
        }

        // AI decisions
        aiDecidePhase(p, round, pool);

        // Combat
        if (p.board.length === 0) {
            // No units, take damage
            p.hp -= 1;
            if (p.hp <= 0) return { deathRound: round, bossBeaten };
            continue;
        }

        const result = simulateCombat(p, round);
        p.gold += result.goldEarned + result.bonusGold;

        if (result.won) {
            p.winStreak++;
            p.lossStreak = 0;
            if (isBossRound(round)) bossBeaten.push(round);
        } else {
            p.hp -= result.damage;
            p.lossStreak++;
            p.winStreak = 0;
        }

        if (p.hp <= 0) return { deathRound: round, bossBeaten };
    }

    return { deathRound: MAX_ROUNDS + 1, bossBeaten }; // survived all
}

// ---- Run simulations ----
console.log(`Running ${NUM_SIMS} simulations...`);
const startTime = Date.now();

const results: { deathRound: number; bossBeaten: number[] }[] = [];
for (let i = 0; i < NUM_SIMS; i++) {
    results.push(runOneSim());
    if ((i + 1) % 100 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`  ${i + 1}/${NUM_SIMS} done (${elapsed}s)`);
    }
}

const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\nCompleted in ${totalTime}s\n`);

// ---- Analysis ----
const deaths = results.map(r => r.deathRound);
const survived = deaths.filter(d => d > MAX_ROUNDS).length;
const avgDeath = deaths.filter(d => d <= MAX_ROUNDS).reduce((a, b) => a + b, 0) / (NUM_SIMS - survived || 1);
const sortedDeaths = [...deaths.filter(d => d <= MAX_ROUNDS)].sort((a, b) => a - b);
const medianDeath = sortedDeaths.length > 0 ? sortedDeaths[Math.floor(sortedDeaths.length / 2)] : MAX_ROUNDS;

console.log('=== RESULTS ===');
console.log(`Clear rate: ${survived}/${NUM_SIMS} (${(survived / NUM_SIMS * 100).toFixed(1)}%)`);
console.log(`Avg death round: R${avgDeath.toFixed(1)}`);
console.log(`Median death round: R${medianDeath}`);
console.log();

// Stage survival
const stageRounds = [
    { name: 'S1', start: 1, end: 10 },
    { name: 'S2', start: 11, end: 20 },
    { name: 'S3', start: 21, end: 30 },
    { name: 'S4', start: 31, end: 40 },
    { name: 'S5', start: 41, end: 50 },
    { name: 'S6', start: 51, end: 60 },
    { name: 'S7', start: 61, end: 70 },
];

console.log('Stage Survival:');
console.log('Stage | Rounds  | Deaths | Alive | Rate');
console.log('------|---------|--------|-------|-----');
let prevAlive = NUM_SIMS;
for (const s of stageRounds) {
    const diedInStage = deaths.filter(d => d >= s.start && d <= s.end).length;
    prevAlive -= diedInStage;
    console.log(`${s.name}    | R${String(s.start).padStart(2)}-${String(s.end).padStart(2)} | ${String(diedInStage).padStart(6)} | ${String(prevAlive).padStart(5)} | ${(prevAlive / NUM_SIMS * 100).toFixed(0)}%`);
}

// Boss survival
console.log('\nBoss Survival (of those who reached):');
const bossRounds = [10, 20, 30, 40, 50, 60, 70];
for (const br of bossRounds) {
    const reached = deaths.filter(d => d >= br).length;
    const beaten = results.filter(r => r.bossBeaten.includes(br)).length;
    if (reached > 0) {
        console.log(`  R${br}: ${beaten}/${reached} beaten (${(beaten / reached * 100).toFixed(0)}%)`);
    }
}

// Death distribution (top 10)
console.log('\nDeath Distribution (top 10):');
const deathHist: Record<number, number> = {};
for (const d of deaths) {
    if (d <= MAX_ROUNDS) deathHist[d] = (deathHist[d] ?? 0) + 1;
}
const topDeaths = Object.entries(deathHist)
    .map(([r, c]) => ({ round: parseInt(r), count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
for (const { round, count } of topDeaths) {
    const bar = '#'.repeat(Math.floor(count / 2));
    console.log(`  R${String(round).padStart(2)} ${bar} ${count}`);
}

// Grade distribution per stage
console.log('\nHP = 20, Timeout: Normal 60s (-1 then -1/5s), Boss 120s (-5 then -3/5s)');
console.log('No lap damage.');
