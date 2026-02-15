// ============================================================
// SynergySystem — 시너지 계산 + 전투 버프 적용
//
// 보드에 배치된 유닛 기준으로 시너지를 계산하고,
// 전투 시 실제 스탯 보정치를 반환한다.
// ============================================================

import { PlayerState, ActiveSynergy, UnitInstance, Monster } from '../types';
import { UNIT_MAP, SYNERGIES, SYNERGY_MAP } from '../config';
import { EventBus } from '../EventBus';

// ─── 버프 타입 ──────────────────────────────────────────────

/** 시너지로 인한 전투 버프 */
export interface SynergyBuffs {
    // 공격
    dmgMultiplier: number;       // 전체 DMG 배수 (기본 1.0)
    atkSpeedMultiplier: number;  // 공속 배수
    skillDmgMultiplier: number;  // 스킬DMG 배수
    critChance: number;          // 크리 확률 (0~1)
    critDmgMultiplier: number;   // 크리 DMG 배수 (기본 2.0)
    bossDmgMultiplier: number;   // 보스 DMG 배수 (기본 1.0)

    // 쿨다운
    skillCooldownReduction: number; // 스킬 쿨타임 감소 (0~1)

    // 특수
    armorIgnore: number;         // 방어 무시 (0~1)
    armorReduce: number;         // 방어 삭감 (0~1)
    stunChance: number;          // 스턴 확률 (0~1)
    slowPercent: number;         // 이속 감소 (0~1)
    missChance: number;          // 미스 확률 (0~1)

    // 경제
    bonusKillGold: number;       // 킬 추가 골드
    bonusRoundGold: number;      // 라운드 추가 골드

    // 특수 (플래그)
    doubleHitChance: number;     // 추가타 확률
    splashDmg: number;           // 다수공격 확률
    flatDmgBonus: number;        // 고정 DMG 추가
    singleTargetMultiplier: number; // 단일 타겟 DMG 배수 (보스킬러)
}

/** 빈 버프 */
function defaultBuffs(): SynergyBuffs {
    return {
        dmgMultiplier: 1.0,
        atkSpeedMultiplier: 1.0,
        skillDmgMultiplier: 1.0,
        critChance: 0,
        critDmgMultiplier: 2.0,
        bossDmgMultiplier: 1.0,
        skillCooldownReduction: 0,
        armorIgnore: 0,
        armorReduce: 0,
        stunChance: 0,
        slowPercent: 0,
        missChance: 0,
        bonusKillGold: 0,
        bonusRoundGold: 0,
        doubleHitChance: 0,
        splashDmg: 0,
        flatDmgBonus: 0,
        singleTargetMultiplier: 1.0,
    };
}

// ─── SynergySystem ──────────────────────────────────────────

export class SynergySystem {
    constructor(private events: EventBus) { }

    /** 보드 유닛으로 활성 시너지 계산 */
    calculateSynergies(player: PlayerState): ActiveSynergy[] {
        const originCount: Record<string, number> = {};
        // Only origin synergies (no class)

        // 고유 유닛 ID만 카운트 (같은 유닛 여러 개 = 1회)
        const seenIds = new Set<string>();
        for (const unit of player.board) {
            if (seenIds.has(unit.unitId)) continue;
            seenIds.add(unit.unitId);
            const def = UNIT_MAP[unit.unitId];
            if (!def) continue;

            const oKey = `origin_${def.origin.toLowerCase()}`;
            originCount[oKey] = (originCount[oKey] || 0) + 1;
        }

        const active: ActiveSynergy[] = [];
        for (const syn of SYNERGIES) {
            const count = originCount[syn.id] || 0;
            if (count === 0) continue;

            // 최고 달성 브레이크포인트
            let activeLevel = -1;
            for (let i = 0; i < syn.breakpoints.length; i++) {
                if (count >= syn.breakpoints[i].count) activeLevel = i;
            }

            active.push({
                synergyId: syn.id,
                count,
                activeLevel,
            });
        }

        return active;
    }

    /** 활성 시너지 → 전투 버프 변환 */
    calculateBuffs(synergies: ActiveSynergy[]): SynergyBuffs {
        const buffs = defaultBuffs();

        for (const syn of synergies) {
            if (syn.activeLevel < 0) continue; // 미달
            const def = SYNERGY_MAP[syn.synergyId];
            if (!def) continue;
            const level = syn.activeLevel; // 0-indexed

            switch (syn.synergyId) {
                // ── Bitcoin: DMG + BossDMG + Crit ──
                case 'origin_bitcoin':
                    buffs.dmgMultiplier += [0.15, 0.30, 0.50, 0.80][level] ?? 0.80;
                    if (level >= 1) buffs.bossDmgMultiplier = 1 + [0, 0.20, 0.40, 0.60][level];
                    if (level >= 3) buffs.critChance += 0.20;
                    break;

                // ── DeFi: DMG + SkillCDR + SkillDMG ──
                case 'origin_defi':
                    buffs.dmgMultiplier += [0.10, 0.25, 0.40, 0.60][level] ?? 0.60;
                    if (level >= 1) buffs.skillCooldownReduction = [0, 0.20, 0.35, 0.50][level] ?? 0.50;
                    if (level >= 2) buffs.skillDmgMultiplier += [0, 0, 0.30, 0.60][level] ?? 0.60;
                    break;

                // ── Social: AtkSpd + DMG + RoundGold ──
                case 'origin_social':
                    buffs.atkSpeedMultiplier += [0.10, 0.25, 0.40, 0.60][level] ?? 0.60;
                    if (level >= 2) buffs.dmgMultiplier += [0, 0, 0.15, 0.30][level] ?? 0.30;
                    if (level >= 3) buffs.bonusRoundGold += 2;
                    break;

                // ── Exchange: DMG + AtkSpd + KillGold ──
                case 'origin_exchange':
                    buffs.dmgMultiplier += [0.15, 0.30, 0.45, 0.65][level] ?? 0.65;
                    buffs.atkSpeedMultiplier += [0.05, 0.15, 0.25, 0.35][level] ?? 0.35;
                    if (level >= 2) buffs.bonusKillGold += [0, 0, 1, 2][level] ?? 2;
                    break;

                // ── VC: Crit + AtkSpd + CritDMG ──
                case 'origin_vc':
                    buffs.critChance += [0.10, 0.20, 0.30, 0.40][level] ?? 0.40;
                    buffs.atkSpeedMultiplier += [0.10, 0.25, 0.40, 0.60][level] ?? 0.60;
                    if (level >= 1) buffs.critDmgMultiplier = 2.0 + [0, 0.30, 0.60, 1.00][level];
                    break;

                // ── FUD: ArmorIgnore + DMG ──
                case 'origin_fud':
                    buffs.armorIgnore = [0.30, 0.60, 1.00, 1.00][level] ?? 1.00;
                    if (level >= 1) buffs.dmgMultiplier += [0, 0.15, 0.30, 0.50][level] ?? 0.50;
                    break;

                // ── Rugpull: ArmorReduce + DMG + KillGold ──
                case 'origin_rugpull':
                    buffs.armorReduce = [0.25, 0.45, 0.65, 0.85][level] ?? 0.85;
                    buffs.dmgMultiplier += [0.10, 0.20, 0.35, 0.50][level] ?? 0.50;
                    if (level >= 2) buffs.bonusKillGold += [0, 0, 1, 2][level] ?? 2;
                    break;

                // ── Bear: Slow + Stun + DMG ──
                case 'origin_bear':
                    buffs.slowPercent = [0.15, 0.30, 0.45, 0.60][level] ?? 0.60;
                    if (level >= 1) buffs.stunChance = [0, 0.10, 0.20, 0.30][level] ?? 0.30;
                    if (level >= 2) buffs.dmgMultiplier += [0, 0, 0.20, 0.40][level] ?? 0.40;
                    break;
            }
        }

        return buffs;
    }

    /** 시너지 버프를 적용한 최종 DMG 계산 */
    getFinalDamage(
        baseDmg: number,
        starMultiplier: number,
        buffs: SynergyBuffs,
        isBossTarget: boolean,
    ): number {
        let dmg = baseDmg * starMultiplier;
        dmg *= buffs.dmgMultiplier;
        dmg += buffs.flatDmgBonus;

        // 보스킬러
        if (isBossTarget) {
            dmg *= buffs.singleTargetMultiplier;
        }

        // 추가타격
        if (Math.random() < buffs.doubleHitChance) {
            dmg *= 1.5;
        }

        // 크리
        if (Math.random() < buffs.critChance) {
            dmg *= 2.0;
        }

        return Math.floor(dmg);
    }

    /** 시너지 슬로우로 몬스터 속도 감소 */
    getSlowedSpeed(baseSpeed: number, buffs: SynergyBuffs): number {
        return baseSpeed * (1 - buffs.slowPercent);
    }
}
