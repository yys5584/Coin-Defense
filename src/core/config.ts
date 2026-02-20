// ============================================================
// CoinRandomDefense v3.4 — Game Config Data
// 렌더링 무관. 순수 게임 데이터.
// Unity 이식 시 → ScriptableObject로 변환
// ============================================================

import {
    Origin, UniqueTrait,
    UnitDef, SynergyDef, LevelDef,
    UnlockCondition, BoxDropTable, AugmentDef,
} from './types';

// ─── 유닛 정의 (46종: 40풀 + 5히든 + 1궁극) ─────────────────

export const UNITS: UnitDef[] = [

    // === 10코 궁극 ===
    {
        id: 'satoshi', name: '나카모토 사토시', emoji: '🌟', cost: 10,
        origin: Origin.Bitcoin,
        dmgType: 'physical' as const,
        baseDmg: 233, attackSpeed: 3.64, attackRange: 4,
        uniqueTrait: UniqueTrait.Anon,
        uniqueEffect: '마나 충전 시 제네시스 블록: 전체적 HP50% + 보스 제외 즉사',
        maxMana: 200, startingMana: 0,
        skill: { type: 'active', name: '제네시스 블록', desc: '마나 충전 시 전적 HP50% 트루딜 + 잡몹 즉사', cooldown: 5, params: { genesisBlock: 1, hpCutPct: 0.50, nonBossKill: 1 } }
    },

    // ═══ 7코 히든 (5종) ═══
    {
        id: 'vitalik', name: 'Vitalik', emoji: '🌟', cost: 7,
        origin: Origin.DeFi,
        dmgType: 'magic' as const,
        baseDmg: 167, attackSpeed: 1.95, attackRange: 4,
        uniqueTrait: UniqueTrait.Creator,
        uniqueEffect: '마나 충전 시 더 머지: 폭발 + 전아군 마나 100% 충전',
        maxMana: 150, startingMana: 30,
        skill: { type: 'active', name: '더 머지', desc: '마나 충전 시 거대 마법 폭발 + 전아군 마나 충전', cooldown: 5, params: { splashPct: 0.60, splashTargets: 5, theMerge: 1 } }
    },
    {
        id: 'cz', name: 'CZ', emoji: '🐋', cost: 7,
        origin: Origin.Exchange,
        dmgType: 'physical' as const,
        baseDmg: 167, attackSpeed: 1.63, attackRange: 3,
        uniqueTrait: UniqueTrait.SAFU,
        uniqueEffect: '마나 충전 시 블랙홀: 적 흡입 + 영구 스턴',
        maxMana: 120, startingMana: 20,
        skill: { type: 'active', name: '런치패드 블랙홀', desc: '마나 충전 시 적 흡입 + 영구 스턴', cooldown: 5, params: { blackhole: 1, pullStrength: 0.30, stunDuration: 3 } }
    },
    {
        id: 'elon', name: 'Elon', emoji: '🚀', cost: 7,
        origin: Origin.Social,
        dmgType: 'magic' as const,
        baseDmg: 167, attackSpeed: 1.76, attackRange: 4,
        uniqueTrait: UniqueTrait.Mars,
        uniqueEffect: '마나 충전 시 로켓: 전체 넥백 + 아군 광분',
        maxMana: 150, startingMana: 30,
        skill: { type: 'active', name: '화성 갈끄니까', desc: '마나 충전 시 전체 넥백 + 아군 공속 200%', cooldown: 5, params: { marsRocket: 1, knockbackAll: 0.40, allyFrenzyDuration: 10, allyFrenzyAtkSpd: 2.0 } }
    },
    {
        id: 'trump', name: 'Donald Trump', emoji: '⛏️', cost: 7,
        origin: Origin.Bitcoin,
        dmgType: 'physical' as const,
        baseDmg: 167, attackSpeed: 1.66, attackRange: 3,
        uniqueTrait: UniqueTrait.FirstReceiver,
        uniqueEffect: '4번째 공격마다 💥광역(55%) + ⏸️스턴 + 보스 🛡️DEF↓',
        skill: { type: 'passive', name: '비축령', desc: '4번째 공격마다 💥광역(55%) + ⏸️스턴, 보스 DEF−10', params: { nthHit: 4, splashPct: 0.55, stunDuration: 0.6, bossStunDuration: 0.2, defShred: 10 } }
    },
    {
        id: 'gensler', name: 'Gensler', emoji: '👨‍⚖️', cost: 7,
        origin: Origin.FUD,
        dmgType: 'magic' as const,
        baseDmg: 167, attackSpeed: 1.69, attackRange: 4,
        uniqueTrait: UniqueTrait.GoodAfternoon,
        uniqueEffect: '마나 충전 시 적 전체 슬로우 (보스는 효과 감소)',
        maxMana: 120, startingMana: 30,
        skill: { type: 'active', name: '규제 집행', desc: '마나 충전 시 적 전체 슬로우(이속↓), 보스 효과 감소', cooldown: 8, params: { slowPct: 0.25, slowDuration: 2, bossSlowPct: 0.10 } }
    },

    // ═══ 5코 (8종) ═══
    {
        id: 'saylor', name: 'Saylor', emoji: '💎', cost: 5,
        origin: Origin.Bitcoin,
        dmgType: 'physical' as const,
        baseDmg: 75, attackSpeed: 1.37, attackRange: 3,
        uniqueTrait: UniqueTrait.DiamondHand,
        skill: { type: 'passive', name: '매수벽', desc: '기본 공격 🔫관통 2 (뒤쪽 적 우선)', params: { pierceTargets: 2, piercePct: 0.70 } }
    },
    {
        id: 'coplan', name: 'Shayne Coplan', emoji: '🔮', cost: 5,
        origin: Origin.DeFi,
        dmgType: 'magic' as const,
        baseDmg: 75, attackSpeed: 1.79, attackRange: 3,
        skill: { type: 'passive', name: '예측시장', desc: '크리 적중 시 ⏸️스턴', params: { critStunDuration: 0.6, bossCritStunDuration: 0.2 } }
    },
    {
        id: 'armstrong', name: 'Armstrong', emoji: '🏛️', cost: 5,
        origin: Origin.Social,
        dmgType: 'magic' as const,
        baseDmg: 75, attackSpeed: 1.47, attackRange: 3,
        skill: { type: 'passive', name: '기관 유입', desc: '기본 공격 🔫관통 1 (뒤쪽 적 우선)', params: { pierceTargets: 1, piercePct: 0.55 } }
    },
    {
        id: 'hayes', name: 'Arthur Hayes', emoji: '🎰', cost: 5,
        origin: Origin.Exchange,
        dmgType: 'physical' as const,
        baseDmg: 75, attackSpeed: 1.71, attackRange: 3,
        uniqueTrait: UniqueTrait.Leverage100x,
        skill: { type: 'passive', name: '레버리지', desc: '3번째 공격 = 강타(큰 피해), 다음 공격은 딜레이', params: { nthHit: 3, burstMult: 2.5, delayMs: 500 } }
    },
    {
        id: 'jeff', name: 'Jeff', emoji: '🏎️', cost: 5,
        origin: Origin.VC,
        dmgType: 'physical' as const,
        baseDmg: 75, attackSpeed: 1.58, attackRange: 3,
        skill: { type: 'passive', name: '테일 리스크', desc: '적이 많을수록 🔫관통 증가 (물량 웨이브 특화)', params: { pierceThreshold1: 8, pierceThreshold2: 12 } }
    },
    {
        id: 'dokwon', name: 'Do Kwon', emoji: '💀', cost: 5,
        origin: Origin.FUD,
        dmgType: 'magic' as const,
        baseDmg: 75, attackSpeed: 1.43, attackRange: 3,
        uniqueTrait: UniqueTrait.Depeg,
        maxMana: 80, startingMana: 20,
        skill: { type: 'active', name: '디페그', desc: '마나 충전 시 "디페그": 🔥도트 + 방어무시', cooldown: 6, params: { dotPct: 0.03, dotDuration: 3, armorIgnore: 1.0 } }
    },
    {
        id: 'sbf', name: 'SBF', emoji: '🚩', cost: 5,
        origin: Origin.Rugpull,
        dmgType: 'physical' as const,
        baseDmg: 75, attackSpeed: 1.58, attackRange: 3,
        uniqueTrait: UniqueTrait.Embezzle,
        skill: { type: 'passive', name: '백도어', desc: '3번째 공격마다 대상 🛡️방깎 + ⏸️짧은 스턴', params: { nthHit: 3, defShred: 12, debuffDuration: 4, stunDuration: 0.5, bossStunDuration: 0.2 } }
    },
    {
        id: 'justinsun', name: 'Justin Sun', emoji: '🌪️', cost: 5,
        origin: Origin.Bear,
        dmgType: 'magic' as const,
        baseDmg: 75, attackSpeed: 1.36, attackRange: 3,
        skill: { type: 'passive', name: '빙결 폭풍', desc: '4번째 공격마다 주변 적 ❄️빙결 (15% 감속)', params: { nthHit: 4, freezeDuration: 1.2, freezeSlow: 0.15, bossFreezeDuration: 0.4 } }
    },
    {
        id: 'etf', name: '현물 ETF', emoji: '📈', cost: 4,
        origin: Origin.Exchange,
        dmgType: 'physical' as const,
        baseDmg: 42, attackSpeed: 1.05, attackRange: 3,
        maxMana: 100, startingMana: 15,
        skill: { type: 'active', name: '기관 빔', desc: '마나 충전 시 관통 레이저 + ★3 무한 빔', cooldown: 5, params: { pierceTargets: 3, piercePct: 0.55, infiniteBeam: 1 } }
    },
    {
        id: 'aave', name: 'AAVE', emoji: '🏦', cost: 4,
        origin: Origin.DeFi,
        dmgType: 'magic' as const,
        baseDmg: 42, attackSpeed: 1.10, attackRange: 3,
        maxMana: 80, startingMana: 15,
        skill: { type: 'active', name: '플래시 론', desc: '마나 충전 시 방깎 흡수 + ★3 원기옥', cooldown: 5, params: { defAbsorb: 0.20, defAbsorbTargets: 1, flashLoan: 1 } }
    },

    // ═══ 4코 (8종) ═══
    {
        id: 'stani', name: 'Stani Kulechov', emoji: '🔒', cost: 4,
        origin: Origin.Bitcoin,
        dmgType: 'physical' as const,
        baseDmg: 42, attackSpeed: 1.11, attackRange: 3,
        skill: { type: 'passive', name: '렌딩 프로토콜', desc: '3번째 공격마다 대상 🛡️물방 삭감', params: { nthHit: 3, defShred: 10, debuffDuration: 4 } }
    },
    {
        id: 'gavin', name: 'Gavin Wood', emoji: '🔗', cost: 4,
        origin: Origin.DeFi,
        dmgType: 'magic' as const,
        baseDmg: 42, attackSpeed: 1.36, attackRange: 3,
        maxMana: 110, startingMana: 20,
        skill: { type: 'active', name: '파라체인 연결', desc: '마나 충전 시 아군 스킬 2연속 + ★3 전체', cooldown: 5, params: { doubleCast: 1, doubleCastRange: 1, doubleCastPenalty: 0.50 } }
    },
    {
        id: 'hayden', name: 'Hayden Adams', emoji: '🦄', cost: 4,
        origin: Origin.Social,
        dmgType: 'magic' as const,
        baseDmg: 42, attackSpeed: 1.16, attackRange: 3,
        maxMana: 100, startingMana: 20,
        skill: { type: 'active', name: 'AMM 스왕', desc: '마나 충전 시 체인 + ★3 HP스왕', cooldown: 5, params: { chainTargets: 3, chainPct: 0.40, hpSwap: 1, mdefIgnore: 1 } }
    },
    {
        id: 'marc', name: 'Marc Andreessen', emoji: '💰', cost: 4,
        origin: Origin.Exchange,
        dmgType: 'physical' as const,
        baseDmg: 42, attackSpeed: 1.04, attackRange: 3,
        maxMana: 90, startingMana: 20,
        skill: { type: 'active', name: 'a16z 펀드', desc: '마나 충전 시 체인 + ★3 포탑 소환', cooldown: 5, params: { chainTargets: 3, chainPct: 0.45, turretSummon: 1 } }
    },
    {
        id: 'balaji', name: 'Balaji', emoji: '🎯', cost: 4,
        origin: Origin.VC,
        dmgType: 'physical' as const,
        baseDmg: 42, attackSpeed: 1.21, attackRange: 4,
        maxMana: 80, startingMana: 20,
        skill: { type: 'active', name: '백만불 베팅', desc: '마나 충전 시 보스 저격 + ★3 트루딜+마나페이백', cooldown: 5, params: { sniperShots: 3, sniperMult: 1.0, defIgnore: 0.0, killManaPayback: 0 } }
    },
    {
        id: 'lazarus', name: 'Lazarus', emoji: '💀', cost: 4,
        origin: Origin.FUD,
        dmgType: 'magic' as const,
        baseDmg: 42, attackSpeed: 1.47, attackRange: 3,
        maxMana: 110, startingMana: 20,
        skill: { type: 'active', name: '브릿지 해킹', desc: '마나 충전 시 광역 기절 + ★3 넥서스 힐', cooldown: 5, params: { stunDuration: 2, stunTargets: 3, dotPct: 0.04, dotDuration: 3, nexusHeal: 2 } }
    },
    {
        id: 'zhusu', name: 'Zhu Su', emoji: '📉', cost: 4,
        origin: Origin.Rugpull,
        dmgType: 'physical' as const,
        baseDmg: 42, attackSpeed: 1.48, attackRange: 3,
        maxMana: 100, startingMana: 20,
        skill: { type: 'active', name: '슈퍼사이클 청산', desc: '마나 충전 시 블랙홀 몹몰이 + 대폭발', cooldown: 5, params: { superCycle: 1, pullDuration: 1, burstDmg: 400 } }
    },
    {
        id: 'anatoly', name: 'Anatoly', emoji: '⚡', cost: 4,
        origin: Origin.Bear,
        dmgType: 'magic' as const,
        baseDmg: 42, attackSpeed: 1.27, attackRange: 3,
        maxMana: 80, startingMana: 0,
        skill: { type: 'active', name: '네트워크 지연', desc: '마나 충전 시 기절 + ★3 시간 정지', cooldown: 5, params: { stunDuration: 1, stunTargets: 1, timeStop: 4 } }
    },

    // ═══ 3코 (8종) ═══
    {
        id: 'rogerver', name: 'Roger Ver', emoji: '⛏️', cost: 3,
        origin: Origin.Bitcoin,
        dmgType: 'physical' as const,
        baseDmg: 28, attackSpeed: 0.88, attackRange: 3,
        maxMana: 60, startingMana: 0,
        skill: { type: 'active', name: '빅 블록', desc: '마나 충전 시 관통 레이저 + ★3 전체 넥백', cooldown: 5, params: { pierceTargets: 3, piercePct: 0.60, knockback: 1 } }
    },
    {
        id: 'andre', name: 'Andre Cronje', emoji: '🧙', cost: 3,
        origin: Origin.DeFi,
        dmgType: 'magic' as const,
        baseDmg: 28, attackSpeed: 0.98, attackRange: 3,
        maxMana: 70, startingMana: 0,
        skill: { type: 'active', name: '일드 파밍', desc: '마나 충전 시 증폭 체인 + ★3 6회 증폭', cooldown: 5, params: { ampChain: 1, ampChainTargets: 3, ampChainBoost: 0.20 } }
    },
    {
        id: 'rekt', name: 'Rekt', emoji: '👤', cost: 3,
        origin: Origin.Social,
        dmgType: 'magic' as const,
        baseDmg: 28, attackSpeed: 1.12, attackRange: 3,
        maxMana: 50, startingMana: 0,
        skill: { type: 'active', name: '청산 빔', desc: '마나 충전 시 체력% 이하 적 즉사 + ★3 연쇄처형', cooldown: 5, params: { executeThreshold: 0.20, executeManaRefund: 0.50 } }
    },
    {
        id: 'wintermute', name: 'Wintermute', emoji: '🤖', cost: 3,
        origin: Origin.Exchange,
        dmgType: 'physical' as const,
        baseDmg: 28, attackSpeed: 0.97, attackRange: 3,
        maxMana: 60, startingMana: 0,
        skill: { type: 'active', name: '마켓 메이킹', desc: '마나 충전 시 광역 폭발 + ★3 HP 절반', cooldown: 5, params: { splashPct: 0.50, splashTargets: 3, hpHalve: 1 } }
    },
    {
        id: 'simon', name: 'Simon', emoji: '🎯', cost: 3,
        origin: Origin.VC,
        dmgType: 'physical' as const,
        baseDmg: 28, attackSpeed: 1.06, attackRange: 3,
        maxMana: 50, startingMana: 0,
        skill: { type: 'active', name: '시드 투자', desc: '마나 충전 시 확정크리 + ★3 아군 영구 공↑', cooldown: 5, params: { guaranteedCrit: 1, critMultiplier: 3.0, allyPermDmgBuff: 0.10 } }
    },
    {
        id: 'peterschiff', name: 'Peter Schiff', emoji: '🧊', cost: 3,
        origin: Origin.FUD,
        dmgType: 'magic' as const,
        baseDmg: 28, attackSpeed: 0.94, attackRange: 3,
        maxMana: 70, startingMana: 0,
        skill: { type: 'active', name: '골드 버그', desc: '마나 충전 시 기절 + ★3 황금동상 5초기절+골드', cooldown: 5, params: { stunDuration: 1.5, stunTargets: 1, goldStatue: 1 } }
    },
    {
        id: 'gcr', name: 'GCR', emoji: '🐸', cost: 3,
        origin: Origin.Rugpull,
        dmgType: 'physical' as const,
        baseDmg: 28, attackSpeed: 1.1, attackRange: 4,
        maxMana: 60, startingMana: 0,
        skill: { type: 'active', name: '빅 숏', desc: '마나 충전 시 거리비례 관통 + ★3 반사 빔', cooldown: 5, params: { distancePierce: 1, distanceDmgBonus: 0.10, pierceTargets: 3 } }
    },
    {
        id: 'akang', name: 'Andrew Kang', emoji: '🦈', cost: 3,
        origin: Origin.Bear,
        dmgType: 'magic' as const,
        baseDmg: 28, attackSpeed: 0.77, attackRange: 3,
        maxMana: 80, startingMana: 0,
        skill: { type: 'active', name: '풀 레버리지 숏', desc: '마나 충전 시 광역 빙결 + ★3 마나통 영구 축소', cooldown: 5, params: { freezeTargets: 3, freezeDuration: 2, freezeSlow: 0.90, permManaReduce: 1 } }
    },

    // ═══ 2코 (8종) ═══
    {
        id: 'jackdorsey', name: 'Jack Dorsey', emoji: '⚡', cost: 2,
        origin: Origin.Bitcoin,
        dmgType: 'physical' as const,
        baseDmg: 16, attackSpeed: 0.9, attackRange: 3,
        maxMana: 50, startingMana: 0,
        skill: { type: 'active', name: '라이트닝 네트워크', desc: '마나 충전 시 체인 번개 + 감전 장판', cooldown: 5, params: { chainTargets: 3, chainPct: 0.35, electricField: 1 } }
    },
    {
        id: 'jessepollak', name: 'Jesse Pollak', emoji: '🌐', cost: 2,
        origin: Origin.DeFi,
        dmgType: 'magic' as const,
        baseDmg: 16, attackSpeed: 0.91, attackRange: 3,
        maxMana: 50, startingMana: 0,
        skill: { type: 'active', name: '스마트 컨트랙트', desc: '마나 충전 시 체인 + DeFi 공격력 버프', cooldown: 5, params: { chainTargets: 3, chainPct: 0.35, defiDmgBuff: 0.10, defiBuffDuration: 2 } }
    },
    {
        id: 'wonyotti', name: '워뇨띠', emoji: '🥷', cost: 2,
        origin: Origin.Social,
        dmgType: 'magic' as const,
        baseDmg: 16, attackSpeed: 0.98, attackRange: 3,
        maxMana: 70, startingMana: 0,
        skill: { type: 'active', name: '풀시드 롱', desc: '마나 충전 시 최강아군 공속↑ + ★3 스플래시', cooldown: 5, params: { bestAllyAtkSpdBuff: 0.40, buffDuration: 4, hyperCarry: 1 } }
    },
    {
        id: 'jessepowell', name: 'Jesse Powell', emoji: '🛡️', cost: 2,
        origin: Origin.Exchange,
        dmgType: 'physical' as const,
        baseDmg: 16, attackSpeed: 0.95, attackRange: 3,
        maxMana: 60, startingMana: 0,
        skill: { type: 'active', name: '수수료 장사', desc: '마나 충전 시 버스트딜 + 킬 시 골드/마나', cooldown: 5, params: { feeHustle: 1, burstDmg1: 200, burstDmg2: 450, burstDmg3: 1200, killGold1: 1, killGold3: 2, killManaPayback3: 1.0 } }
    },
    {
        id: 'opensea', name: 'OpenSea', emoji: '🔍', cost: 2,
        origin: Origin.VC,
        dmgType: 'physical' as const,
        baseDmg: 16, attackSpeed: 0.91, attackRange: 3,
        maxMana: 80, startingMana: 0,
        skill: { type: 'active', name: 'NFT 민팅', desc: '마나 충전 시 아군 딜↑ 버프', cooldown: 5, params: { allyDmgBuff: 0.20, allyBuffTargets: 1, buffDuration: 3 } }
    },
    {
        id: 'craigwright', name: 'Craig Wright', emoji: '💀', cost: 2,
        origin: Origin.FUD,
        dmgType: 'magic' as const,
        baseDmg: 16, attackSpeed: 0.89, attackRange: 3,
        maxMana: 70, startingMana: 0,
        skill: { type: 'active', name: '소송 남발', desc: '마나 충전 시 적 디버프 + ★3 스킬 표절', cooldown: 5, params: { dotPct: 0.05, dotDuration: 3, defShred: 5, skillSteal: 1 } }
    },
    {
        id: 'daniele', name: 'Daniele Sesta', emoji: '👻', cost: 2,
        origin: Origin.Rugpull,
        dmgType: 'physical' as const,
        baseDmg: 16, attackSpeed: 0.9, attackRange: 3,
        maxMana: 60, startingMana: 0,
        skill: { type: 'active', name: '리베이스', desc: '마나 충전 시 관통 빔 + ★3 HP 되감기', cooldown: 5, params: { pierceTargets: 2, piercePct: 0.60, hpRewind: 1 } }
    },
    {
        id: 'hsaka', name: 'Hsaka', emoji: '📉', cost: 2,
        origin: Origin.Bear,
        dmgType: 'magic' as const,
        baseDmg: 16, attackSpeed: 0.95, attackRange: 3,
        maxMana: 60, startingMana: 0,
        skill: { type: 'active', name: '크립토 윈터', desc: '마나 충전 시 빙결 + 추가피해 + ★3 쇄빙', cooldown: 5, params: { freezeTargets: 1, freezeDuration: 2, freezeSlow: 0.90, frozenBonusDmg: 0.20, shatterHpPct: 0.10, shatterExplode: 1 } }
    },

    // ═══ 1코 (8종) ═══
    {
        id: 'pcminer', name: 'PC방 채굴자', emoji: '⛏️', cost: 1,
        origin: Origin.Bitcoin,
        dmgType: 'physical' as const,
        baseDmg: 9, attackSpeed: 0.65, attackRange: 2,
        maxMana: 40, startingMana: 0,
        skill: { type: 'active', name: '해시레이트 공유', desc: '마나 충전 시 인접 아군 마나 회복', cooldown: 5, params: { allyManaHeal: 15, allyManaHealRange: 1, allyManaTargets: 1 } }
    },
    {
        id: 'metamask', name: '메타마스크 유저', emoji: '🦊', cost: 1,
        origin: Origin.DeFi,
        dmgType: 'magic' as const,
        baseDmg: 9, attackSpeed: 0.78, attackRange: 3,
        maxMana: 30, startingMana: 0,
        skill: { type: 'active', name: '가스비 폭발', desc: '마나 충전 시 자신+인접 아군 공속↑', cooldown: 5, params: { atkSpdBuff: 0.30, buffDuration: 3, buffRange: 1, buffTargets: 1 } }
    },
    {
        id: 'scamdev', name: '스캠 개발자', emoji: '🚩', cost: 1,
        origin: Origin.Social,
        dmgType: 'magic' as const,
        baseDmg: 9, attackSpeed: 0.78, attackRange: 3,
        maxMana: 50, startingMana: 0,
        skill: { type: 'active', name: '퍼드 전염', desc: '마나 충전 시 적에게 전이 도트딜', cooldown: 5, params: { dotPct: 0.04, dotDuration: 3, spreadOnKill: 1 } }
    },
    {
        id: 'perpdex', name: 'PerpDEX', emoji: '🏦', cost: 1,
        origin: Origin.Exchange,
        dmgType: 'physical' as const,
        baseDmg: 9, attackSpeed: 0.86, attackRange: 3,
        maxMana: 40, startingMana: 0,
        skill: { type: 'active', name: '롱/숏 빔', desc: '마나 충전 시 관통 빔 + 명중 시 마나 회복', cooldown: 5, params: { pierceTargets: 3, piercePct: 0.50, pierceManaPer: 10 } }
    },
    {
        id: 'hodler', name: 'HODLer', emoji: '🛡️', cost: 1,
        origin: Origin.VC,
        dmgType: 'physical' as const,
        baseDmg: 9, attackSpeed: 0.86, attackRange: 3,
        maxMana: 50, startingMana: 0,
        skill: { type: 'active', name: '다이아몬드 핸드', desc: '마나 충전 시 확정 크리 + 영구 크리DMG 누적', cooldown: 5, params: { guaranteedCrit: 1, permCritDmgBonus: 0.10 } }
    },
    {
        id: 'fudspreader', name: 'FUD 유포자', emoji: '💀', cost: 1,
        origin: Origin.FUD,
        dmgType: 'magic' as const,
        baseDmg: 9, attackSpeed: 0.89, attackRange: 3,
        maxMana: 60, startingMana: 0,
        skill: { type: 'active', name: '공포 전염', desc: '마나 충전 시 도트딜 + 사망 시 마나 구슬 드랍', cooldown: 5, params: { dotPct: 0.04, dotDuration: 4, dotManaOrb: 30 } }
    },
    {
        id: 'piuser', name: 'PI User', emoji: '📱', cost: 1,
        origin: Origin.Rugpull,
        dmgType: 'physical' as const,
        baseDmg: 9, attackSpeed: 0.87, attackRange: 3,
        maxMana: 40, startingMana: 0,
        skill: { type: 'active', name: '폰 채굴', desc: '마나 충전 시 다연속 강타 + 즉사 확률', cooldown: 5, params: { multiHit: 2, multiHitMult: 1.5, instantKillChance: 0.01, instantKillGold: 5 } }
    },
    {
        id: 'gareth', name: 'Gareth Soloway', emoji: '🧊', cost: 1,
        origin: Origin.Bear,
        dmgType: 'magic' as const,
        baseDmg: 9, attackSpeed: 0.77, attackRange: 3,
        maxMana: 50, startingMana: 0,
        skill: { type: 'active', name: '차트 분석', desc: '마나 충전 시 광역 슬로우 + 트루데미지', cooldown: 5, params: { slowPct: 0.30, slowDuration: 3, slowTargets: 2, trueDmgDebuff: 1 } }
    },

    // ═══ 추가 유닛 (8세트 달성용) ═══

    // ── Bitcoin +1 ──
    {
        id: 'halfinney', name: 'Hal Finney', emoji: '🔑', cost: 2,
        origin: Origin.Bitcoin,
        dmgType: 'physical' as const,
        baseDmg: 16, attackSpeed: 0.93, attackRange: 3,
        maxMana: 70, startingMana: 0,
        skill: { type: 'active', name: '최초의 수신자', desc: '마나 충전 시 인접 ₿ 사거리+1 + ★3 전체 사거리 무한', cooldown: 5, params: { btcRangeBuff: 1, btcRangeTargets: 1 } }
    },

    // ── DeFi +2 ──
    {
        id: 'curve', name: 'Curve Finance', emoji: '🔄', cost: 1,
        origin: Origin.DeFi,
        dmgType: 'magic' as const,
        baseDmg: 9, attackSpeed: 0.82, attackRange: 3,
        maxMana: 50, startingMana: 0,
        skill: { type: 'active', name: '유동성 풀', desc: '마나 충전 시 스플래시 폭발', cooldown: 5, params: { splashPct: 0.40, splashTargets: 3 } }
    },
    {
        id: 'chefnomi', name: 'Chef Nomi', emoji: '🍣', cost: 3,
        origin: Origin.DeFi,
        dmgType: 'magic' as const,
        baseDmg: 28, attackSpeed: 0.92, attackRange: 3,
        skill: { type: 'passive', name: '스시 스왑', desc: '3번째 공격마다 ⚡체인 1 + 🔥도트', params: { nthHit: 3, chainTargets: 1, chainPct: 0.35, dotPct: 0.02, dotDuration: 2 } }
    },

    // ── Social +2 ──
    {
        id: 'kol', name: 'CT KOL', emoji: '📢', cost: 1,
        origin: Origin.Social,
        dmgType: 'magic' as const,
        baseDmg: 9, attackSpeed: 0.85, attackRange: 4,
        maxMana: 70, startingMana: 0,
        skill: { type: 'active', name: '선동', desc: '마나 충전 시 아군 공속↑ + ★3 Social 마나 충전', cooldown: 5, params: { atkSpdBuff: 0.20, buffDuration: 3, socialManaCharge: 1 } }
    },
    {
        id: 'cobie', name: 'Cobie', emoji: '🎩', cost: 3,
        origin: Origin.Social,
        dmgType: 'physical' as const,
        baseDmg: 28, attackSpeed: 1.05, attackRange: 3,
        maxMana: 80, startingMana: 30,
        skill: { type: 'active', name: '알파 콜', desc: '마나 충전 시 아군 1명 공속↑(짧게)', cooldown: 8, params: { atkSpdBuff: 0.25, buffDuration: 3 } }
    },

    // ── Exchange +2 ──
    {
        id: 'tradebot', name: '거래봇', emoji: '⚙️', cost: 1,
        origin: Origin.Exchange,
        dmgType: 'physical' as const,
        baseDmg: 9, attackSpeed: 0.90, attackRange: 3,
        maxMana: 20, startingMana: 0,
        skill: { type: 'active', name: '초단타', desc: '마나 충전 시 공속 폭발 + 영구 공속 누적', cooldown: 5, params: { atkSpdBuff: 0.50, buffDuration: 3, permAtkSpdBonus: 0.05 } }
    },
    {
        id: 'kris', name: 'Kris Marszalek', emoji: '💳', cost: 2,
        origin: Origin.Exchange,
        dmgType: 'magic' as const,
        baseDmg: 16, attackSpeed: 0.88, attackRange: 3,
        maxMana: 60, startingMana: 0,
        skill: { type: 'active', name: '캐시백', desc: '마나 충전 시 버스트 + 킬 시 골드 + ★3 골드비례 DMG', cooldown: 5, params: { burstDmg: 150, killGold: 1, goldScaleDmg: 1 } }
    },

    // ── VC +3 ──
    {
        id: 'a16zintern', name: 'a16z 인턴', emoji: '👔', cost: 1,
        origin: Origin.VC,
        dmgType: 'physical' as const,
        baseDmg: 9, attackSpeed: 0.80, attackRange: 3,
        maxMana: 50, startingMana: 0,
        skill: { type: 'active', name: '리서치', desc: '마나 충전 시 물방 깎기 + ★3 광역 스턴', cooldown: 5, params: { defShred: 5, defShredTargets: 1, stunDuration: 0.5 } }
    },
    {
        id: 'cdixon', name: 'Chris Dixon', emoji: '📖', cost: 2,
        origin: Origin.VC,
        dmgType: 'magic' as const,
        baseDmg: 16, attackSpeed: 0.92, attackRange: 3,
        maxMana: 80, startingMana: 0,
        skill: { type: 'active', name: 'Read Write Own', desc: '마나 충전 시 아군크리 버프 + ★3 확정크리', cooldown: 5, params: { allyCritBuff: 0.15, critBuffRange: 3, critBuffDuration: 3 } }
    },
    {
        id: 'cathie', name: 'Cathie Wood', emoji: '🏹', cost: 3,
        origin: Origin.VC,
        dmgType: 'physical' as const,
        baseDmg: 28, attackSpeed: 1.00, attackRange: 4,
        maxMana: 80, startingMana: 30,
        skill: { type: 'active', name: 'ARK 리밸런싱', desc: '마나 충전 시 뒤쪽 적 저격(크리 확정)', cooldown: 8, params: {} }
    },

    // ── FUD +2 ──
    {
        id: 'roubini', name: 'Roubini', emoji: '🐻', cost: 1,
        origin: Origin.FUD,
        dmgType: 'magic' as const,
        baseDmg: 9, attackSpeed: 0.83, attackRange: 3,
        maxMana: 60, startingMana: 0,
        skill: { type: 'active', name: '둠세이어', desc: '마나 충전 시 HP비례 도트 + ★3 최대HP 삭제', cooldown: 5, params: { hpPctDot: 0.05, dotDuration: 3, maxHpShred: 0.30 } }
    },
    {
        id: 'warren', name: 'Elizabeth Warren', emoji: '⚖️', cost: 3,
        origin: Origin.FUD,
        dmgType: 'magic' as const,
        baseDmg: 28, attackSpeed: 0.90, attackRange: 3,
        maxMana: 80, startingMana: 30,
        skill: { type: 'active', name: '반크립토 법안', desc: '마나 충전 시 적 1기 🔥도트 + 슬로우', cooldown: 8, params: { dotPct: 0.03, dotDuration: 3, slowPct: 0.25, slowDuration: 2 } }
    },

    // ── Rugpull +3 ──
    {
        id: 'memecoin', name: '밈코인 발행자', emoji: '🐕', cost: 1,
        origin: Origin.Rugpull,
        dmgType: 'physical' as const,
        baseDmg: 9, attackSpeed: 0.88, attackRange: 3,
        maxMana: 40, startingMana: 0,
        skill: { type: 'active', name: '하이프', desc: '마나 충전 시 체인 번개 + 킬 시 마나 페이백', cooldown: 5, params: { chainTargets: 2, chainPct: 0.40, chainKillManaPayback: 1.0 } }
    },
    {
        id: 'ruja', name: 'Ruja Ignatova', emoji: '👸', cost: 2,
        origin: Origin.Rugpull,
        dmgType: 'magic' as const,
        baseDmg: 16, attackSpeed: 0.91, attackRange: 3,
        skill: { type: 'passive', name: '원코인 러시', desc: '기본 공격 🔫관통 1', params: { pierceTargets: 1, piercePct: 0.45 } }
    },
    {
        id: 'heart', name: 'Richard Heart', emoji: '💎', cost: 3,
        origin: Origin.Rugpull,
        dmgType: 'physical' as const,
        baseDmg: 28, attackSpeed: 1.02, attackRange: 3,
        skill: { type: 'passive', name: '스테이킹 유혹', desc: '3번째 공격마다 ⚡체인 1', params: { nthHit: 3, chainTargets: 1, chainPct: 0.40 } }
    },

    // ── Bear +3 ──
    {
        id: 'cramer', name: 'Jim Cramer', emoji: '📺', cost: 1,
        origin: Origin.Bear,
        dmgType: 'physical' as const,
        baseDmg: 9, attackSpeed: 0.84, attackRange: 4,
        maxMana: 60, startingMana: 0,
        skill: { type: 'active', name: '인버스', desc: '마나 충전 시 적 빙결 + ★3 역주행', cooldown: 5, params: { freezeTargets: 1, freezeDuration: 1.5, freezeSlow: 0.90, reverseMove: 0 } }
    },
    {
        id: 'kashkari', name: 'Kashkari', emoji: '🏛️', cost: 2,
        origin: Origin.Bear,
        dmgType: 'magic' as const,
        baseDmg: 16, attackSpeed: 0.87, attackRange: 3,
        maxMana: 90, startingMana: 0,
        skill: { type: 'active', name: '금리 인상', desc: '마나 충전 시 광역 슬로우 + ★3 전체빙결+골드', cooldown: 5, params: { slowPct: 0.40, slowDuration: 3, fullFreeze: 1, freezeGold: 1 } }
    },
    {
        id: 'burry', name: 'Michael Burry', emoji: '🔍', cost: 3,
        origin: Origin.Bear,
        dmgType: 'physical' as const,
        baseDmg: 28, attackSpeed: 0.95, attackRange: 4,
        skill: { type: 'passive', name: '빅숏', desc: 'HP 낮은 적 우선 + 마무리 피해 증가 (피니셔)', params: { hpThreshold: 0.50, dmgMult: 1.8 } }
    },
];

// ─── 유닛 맵 (빠른 조회) ────────────────────────────────────

export const UNIT_MAP: Record<string, UnitDef> = {};
UNITS.forEach(u => { UNIT_MAP[u.id] = u; });

// ─── 합성 배수 ──────────────────────────────────────────────

export const STAR_MULTIPLIER = {
    1: 1.0,
    2: 3.0,
    3: 9.0,
} as const;

// ─── 유닛풀 사이즈 (공유풀 TFT 스타일) ──────────────────────

export const POOL_SIZE: Record<number, number> = {
    1: 29,
    2: 22,
    3: 18,
    4: 12,
    5: 10,
    7: 2,
    10: 1,
};

// ─── 레벨 정의 ──────────────────────────────────────────────

export const LEVELS: LevelDef[] = [
    { level: 1, requiredXp: 2, naturalRound: 1, slots: 1, shopOdds: [90, 10, 0, 0, 0] },
    { level: 2, requiredXp: 4, naturalRound: 2, slots: 2, shopOdds: [75, 25, 0, 0, 0] },
    { level: 3, requiredXp: 8, naturalRound: 4, slots: 3, shopOdds: [60, 35, 5, 0, 0] },
    { level: 4, requiredXp: 14, naturalRound: 7, slots: 4, shopOdds: [50, 35, 15, 0, 0] },
    { level: 5, requiredXp: 24, naturalRound: 12, slots: 5, shopOdds: [40, 35, 25, 0, 0] },
    { level: 6, requiredXp: 40, naturalRound: 18, slots: 6, shopOdds: [35, 35, 30, 0, 0] },
    { level: 7, requiredXp: 60, naturalRound: 24, slots: 7, shopOdds: [30, 35, 34.9, 0.1, 0] },   // T4 해금 0.1%
    { level: 8, requiredXp: 150, naturalRound: 33, slots: 8, shopOdds: [22, 33, 44.8, 0.2, 0] },   // 잔인한 벽
    { level: 9, requiredXp: 300, naturalRound: 38, slots: 9, shopOdds: [15, 30, 54.7, 0.3, 0] },   // 천문학적 벽
    { level: 10, requiredXp: 999, naturalRound: 99, slots: 10, shopOdds: [10, 25, 64.5, 0.5, 0] },  // T1 10% 유지, T4 0.5% 최대
];


// ─── 스테이지별 몬스터 방어력 ─────────────────────────────

export const STAGE_DEFENSE: Record<number, { def: number; mdef: number }> = {
    1: { def: 0, mdef: 0 },      // 튜토리얼
    2: { def: 5, mdef: 5 },      // 균등
    3: { def: 20, mdef: 5 },     // 물방↑ → 마돀 필요
    4: { def: 5, mdef: 20 },     // 마방↑ → 물돀 필요
    5: { def: 20, mdef: 20 },    // 양쪽 균등 (하향)
    6: { def: 15, mdef: 40 },    // 마방↑↑
    7: { def: 40, mdef: 15 },    // 물방↑↑
};

// 다음 스테이지 방어 경향 힌트 (예고 UI)
export const STAGE_HINTS: Record<number, string> = {
    1: '방어 없음 (튜토리얼)',
    2: '물방/마방 균등 ⚖️',
    3: '물방↑ 마방↓ — 마법 딜러 추천! 🔮',
    4: '마방↑ 물방↓ — 물리 딜러 추천! ⚔️',
    5: '물방/마방 양쪽↑ — 방무/혼합 필요 💀',
    6: '마방↑↑ — 물리 딜러 필수! ⚔️⚔️',
    7: '물방↑↑ — 마법 딜러 필수! 🔮🔮',
};

export const MONSTER_BASE_SPEED = 0.7;

// ─── 시너지 정의 (8특성, 2/4/6/8 브레이크포인트) ───────────────

export const SYNERGIES: SynergyDef[] = [
    {
        id: 'origin_bitcoin', type: 'origin', cryptoName: '비트코인', fantasyName: '용',
        emoji: '₿', totalUnits: 8,
        breakpoints: [
            { count: 2, effect: '[전체] DMG+15%' },
            { count: 4, effect: '[전체] DMG+30%, 보스DMG+20%' },
            { count: 6, effect: '[전체] DMG+50%, 보스DMG+40%' },
            { count: 8, effect: '[전체] DMG+80%, 보스DMG+60%, 크리+20%' },
        ]
    },
    {
        id: 'origin_defi', type: 'origin', cryptoName: 'DeFi', fantasyName: '추방자',
        emoji: '🔓', totalUnits: 8,
        breakpoints: [
            { count: 2, effect: '[전체] 평타 마나회복+2' },
            { count: 4, effect: '[전체] 평타 마나회복+5' },
            { count: 6, effect: '[전체] 평타 마나회복+8, 스킬시 마나20% 환급' },
            { count: 8, effect: '[전체] 평타 마나회복+15, 스킬시 마나50% 환급' },
        ]
    },
    {
        id: 'origin_social', type: 'origin', cryptoName: '소셜', fantasyName: '음유시인',
        emoji: '📱', totalUnits: 8,
        breakpoints: [
            { count: 2, effect: '[전체] 공속+15%' },
            { count: 4, effect: '[전체] 공속+25%' },
            { count: 6, effect: '[전체] 공속+40%, DMG+15%' },
            { count: 8, effect: '[전체] 공속+60%, DMG+30%, 라운드골드+2' },
        ]
    },
    {
        id: 'origin_exchange', type: 'origin', cryptoName: '거래소', fantasyName: '제국',
        emoji: '🏦', totalUnits: 8,
        breakpoints: [
            { count: 2, effect: '[전체] DMG+15%, 공속+5%' },
            { count: 4, effect: '[전체] DMG+30%, 공속+15%' },
            { count: 6, effect: '[전체] DMG+45%, 공속+25%, 킬골드+1' },
            { count: 8, effect: '[전체] DMG+65%, 공속+35%, 킬골드+2' },
        ]
    },
    {
        id: 'origin_vc', type: 'origin', cryptoName: 'VC', fantasyName: '귀족',
        emoji: '💼', totalUnits: 8,
        breakpoints: [
            { count: 2, effect: '[전체] 크리확률+10%, 공속+10%' },
            { count: 4, effect: '[전체] 크리확률+20%, 공속+25%, 크리DMG+30%' },
            { count: 6, effect: '[전체] 크리확률+30%, 공속+40%, 크리DMG+60%' },
            { count: 8, effect: '[전체] 크리확률+40%, 공속+60%, 크리DMG+100%' },
        ]
    },
    {
        id: 'origin_fud', type: 'origin', cryptoName: 'FUD', fantasyName: '공허',
        emoji: '💀', totalUnits: 8,
        breakpoints: [
            { count: 2, effect: '[전체] 방어무시 30%' },
            { count: 4, effect: '[전체] 방어무시 60%, DMG+15%' },
            { count: 6, effect: '[전체] 방어무시 100%, DMG+30%' },
            { count: 8, effect: '[전체] 방어무시 100%, DMG+50%, 즉사확률 5%' },
        ]
    },
    {
        id: 'origin_rugpull', type: 'origin', cryptoName: '러그풀', fantasyName: '악마',
        emoji: '🚩', totalUnits: 8,
        breakpoints: [
            { count: 2, effect: '[적] 방어삭감 25%, [전체] DMG+10%' },
            { count: 4, effect: '[적] 방어삭감 45%, [전체] DMG+20%' },
            { count: 6, effect: '[적] 방어삭감 65%, [전체] DMG+35%, 킬골드+1' },
            { count: 8, effect: '[적] 방어삭감 85%, [전체] DMG+50%, 킬골드+2' },
        ]
    },
    {
        id: 'origin_bear', type: 'origin', cryptoName: '베어마켓', fantasyName: '빙하',
        emoji: '📉', totalUnits: 8,
        breakpoints: [
            { count: 2, effect: '[적] 이속-15%' },
            { count: 4, effect: '[적] 이속-30%, 스턴 10%' },
            { count: 6, effect: '[적] 이속-45%, 스턴 20%, [전체] DMG+20%' },
            { count: 8, effect: '[적] 이속-60%, 스턴 30%, [전체] DMG+40%' },
        ]
    },
];

// ─── 시너지 맵(빠른 조회) ──────────────────────────────────

export const SYNERGY_MAP: Record<string, SynergyDef> = {};
SYNERGIES.forEach(s => { SYNERGY_MAP[s.id] = s; });

// ─── 경제 ───────────────────────────────────────────────────

/** 라운드→스테이지 변환 (7-ROUND SYSTEM)
 *  Stage 1 = 1-1~1-3  (3라운드, 워밍업)
 *  Stage 2 = 2-1~2-7  (7라운드, Boss @ 2-7)
 *  Stage 3~7 = x-1~x-7 (7라운드, Boss @ x-7)
 *  MAX = 7-7 (45라운드)
 */
export function getStage(round: number): number {
    if (round <= 3) return 1;
    const adjustedRound = round - 3;
    return Math.min(Math.floor((adjustedRound - 1) / 7) + 2, 7);
}

/** 스테이지 내 서브 라운드(1-1, 2-7 등) */
export function getStageRound(round: number): string {
    const stage = getStage(round);
    if (stage === 1) return `${stage}-${round}`;
    const adjustedRound = round - 3;
    const subRound = ((adjustedRound - 1) % 7) + 1;
    return `${stage}-${subRound}`;
}

/** 보스 라운드 판정 (x-7) */
export function isBossRound(round: number): boolean {
    if (round <= 3) return false;
    const adjustedRound = round - 3;
    return adjustedRound % 7 === 0;
}

/** 라운드별 기본 수입 — 7-ROUND 스테이지 매핑 */
export function getBaseIncome(round: number): number {
    const stage = getStage(round);
    switch (stage) {
        case 1: return 0;
        case 2: return 1;
        case 3: return 3;
        case 4: return 4;
        case 5: return 6;
        case 6: return 7;
        default: return 8;
    }
}

/** 보유 골드에 따른 이자 (최대 3으로 감소) */
export function getInterest(gold: number): number {
    return Math.min(Math.floor(gold / 10), 3);
}

/** 연승/연패 보너스(TFT 스타일) */
export function getStreakBonus(streak: number): number {
    if (streak >= 6) return 3;
    if (streak >= 5) return 2;
    if (streak >= 2) return 1;
    return 0;
}

export const REROLL_COST = 2;
export const XP_BUY_COST = 4;
export const XP_BUY_AMOUNT = 4;
/** 스테이지별 자동 XP */
export function getXpPerRound(round: number): number {
    const stage = getStage(round);
    switch (stage) {
        case 1: return 2;
        case 2: return 2;
        case 3: return 4;
        case 4: return 6;
        default: return 8;
    }
}
export const XP_PER_ROUND = 2;  // fallback (기존 호환)
export const MAX_BENCH = 9;
export const STARTING_GOLD = 10;
export const STARTING_HP = 20;

// ─── 7코/10코 해금 조건 ─────────────────────────────────────
// 3-7+ 보스 클리어시 해금 아이템 드롭
// 7코: 아이템만 있으면 해금 (시너지 조건 없음)
// 10코: key_satoshi + 7코 유닛 1마리 이상 보유

export const UNLOCK_CONDITIONS: UnlockCondition[] = [
    {
        unitId: 'vitalik',
        synergyRequirements: [],
        requiredAugment: '',
        requiredItem: 'key_ethereum'
    },
    {
        unitId: 'cz',
        synergyRequirements: [],
        requiredAugment: '',
        requiredItem: 'key_binance'
    },
    {
        unitId: 'elon',
        synergyRequirements: [],
        requiredAugment: '',
        requiredItem: 'key_tesla'
    },
    {
        unitId: 'trump',
        synergyRequirements: [],
        requiredAugment: '',
        requiredItem: 'key_block1'
    },
    {
        unitId: 'gensler',
        synergyRequirements: [],
        requiredAugment: '',
        requiredItem: 'key_sec'
    },
    {
        unitId: 'satoshi',
        synergyRequirements: [],
        requiredAugment: '',
        requiredItem: 'key_satoshi'
        // 추가 조건: 7코 1마리 이상 보유 (코드에서 별도 체크)
    },
];

// ─── 증강 정의 ──────────────────────────────────────────────
// 카테고리: 전투(combat) / 유틸(utility) / 전략(strategy)

export const AUGMENTS: AugmentDef[] = [
    // ═══ 전투 증강 (Combat) ═══
    {
        id: 'aug_zk_proof', name: '👁️🗨️ 영지식 증명', emoji: '👁️',
        minRound: 10,
        effect: '크리티컬이 스킬 데미지에도 적용됩니다 (VC 시너지 크리확률 → 궁극기 크리)'
    },
    {
        id: 'aug_chain_liquidation', name: '🩸 연쇄 청산', emoji: '🩸',
        minRound: 20,
        effect: '스킬로 적 처치 시 시체 폭발(주변 200DMG) + 마나 50% 즉시 회복'
    },
    {
        id: 'aug_margin_call', name: '📉 마진 콜', emoji: '📉',
        minRound: 20,
        effect: '모든 유닛 최대 마나 50% 감소 (스킬 2배 빈도). 단, 스킬 시전 시 기지 HP -1'
    },
    {
        id: 'aug_dead_cat', name: '🐈 데드캣 바운스', emoji: '🐈',
        minRound: 20,
        effect: '관통 투사체가 맵 끝에서 반사되어 2차 타격 (당구 쿠션 효과)'
    },
    {
        id: 'aug_short_squeeze', name: '📈 숏 스퀴즈', emoji: '📈',
        minRound: 30,
        effect: '보스 공격 시 마나 회복 2배. 체력 30% 이하 보스에게 스킬 즉사'
    },
    {
        id: 'aug_lightning_network', name: '🌩️ 라이트닝 네트워크', emoji: '🌩️',
        minRound: 30,
        effect: '체인 번개가 튕기지 않고 모든 횟수가 단일 타겟에 집중 (보스 극딜)'
    },

    // ═══ 유틸 증강 (Utility) ═══
    {
        id: 'aug_defi_farm', name: '🌾 디파이 이자농사', emoji: '🌾',
        minRound: 10,
        effect: '이자 상한 +3. 보유한 10G당 모든 아군 초당 마나 회복 +1 영구 증가'
    },
    {
        id: 'aug_dex_swap', name: '🔄 DEX 스왑 봇', emoji: '🔄',
        minRound: 10,
        effect: '리롤 1G. 리롤할 때마다 필드 전체 아군 마나 즉시 10 회복'
    },
    {
        id: 'aug_pow', name: '⛏️ 작업 증명', emoji: '⛏️',
        minRound: 10,
        effect: '평타 적중 시 마나 회복이 고정 10 → 최대 마나의 15%로 변경'
    },
    {
        id: 'aug_bailout', name: '🚑 구제 금융', emoji: '🚑',
        minRound: 20,
        effect: '기지 HP 5 이하 시 1회 발동: 적 전체 5초 기절 + 아군 전체 마나 100%'
    },
    {
        id: 'aug_mev', name: '🤖 MEV 샌드위치', emoji: '🤖',
        minRound: 20,
        effect: '킬 골드 +1. 광역 스킬로 7마리 이상 동시 타격 시 즉시 1G 획득'
    },
    {
        id: 'aug_airdrop', name: '🪂 기습 에어드랍', emoji: '🪂',
        minRound: 30,
        effect: '매 라운드 전투 시작 시 무작위 아군 3명 마나 100% 충전'
    },

    // ═══ 전략 증강 (Strategy) ═══
    {
        id: 'aug_layer2', name: '🥞 레이어 2', emoji: '🥞',
        minRound: 20,
        effect: '보드 1개 타일에 유닛 2마리 겹쳐 배치 가능 (특별 타일 1개 생성)'
    },
    {
        id: 'aug_crypto_winter', name: '❄️ 크립토 윈터', emoji: '❄️',
        minRound: 30,
        effect: '몬스터 이속 -20%. CC 걸린 적 타격 시 마나 회복 2배'
    },
    {
        id: 'aug_cold_wallet', name: '🥶 콜드 월렛', emoji: '🥶',
        minRound: 10,
        effect: '벤치 +3. 유닛 판매 시 구매 비용 100% 환불'
    },
    {
        id: 'aug_crosschain', name: '🌉 크로스체인 브릿지', emoji: '🌉',
        minRound: 30,
        effect: '모든 활성 시너지 유닛 카운트 +1 증가'
    },
    {
        id: 'aug_gas_payback', name: '⛽ 가스비 페이백', emoji: '⛽',
        minRound: 20,
        effect: '스킬 사용 후 마나가 0이 아닌 최대 마나의 30%로 시작'
    },
    {
        id: 'aug_hard_fork', name: '🔱 하드 포크', emoji: '🔱',
        minRound: 20,
        effect: '단일 타겟 스킬이 3갈래로 쪼개져 발사 (피해량 70%)'
    },
];

// ─── 보스 전자 드롭 테이블 ──────────────────────────────────

export const BOX_DROP_TABLES: BoxDropTable[] = [
    {
        round: 10, boxName: '2-7 보스 전자', items: [
            { itemId: 'key_ethereum', weight: 40 },
            { itemId: 'key_binance', weight: 40 },
            { itemId: 'key_tesla', weight: 10 },
            { itemId: 'key_block1', weight: 10 },
        ]
    },
    {
        round: 17, boxName: '3-7 보스 전자', items: [
            { itemId: 'key_ethereum', weight: 35 },
            { itemId: 'key_binance', weight: 35 },
            { itemId: 'key_tesla', weight: 15 },
            { itemId: 'key_block1', weight: 15 },
        ]
    },
    {
        round: 24, boxName: '4-7 보스 전자', items: [
            { itemId: 'key_ethereum', weight: 25 },
            { itemId: 'key_binance', weight: 25 },
            { itemId: 'key_tesla', weight: 20 },
            { itemId: 'key_block1', weight: 20 },
            { itemId: 'key_sec', weight: 10 },
        ]
    },
    {
        round: 31, boxName: '5-7 보스 전자', items: [
            { itemId: 'key_tesla', weight: 25 },
            { itemId: 'key_block1', weight: 25 },
            { itemId: 'key_sec', weight: 40 },
            { itemId: 'key_satoshi', weight: 10 },
        ]
    },
    {
        round: 38, boxName: '6-7 보스 전자', items: [
            { itemId: 'key_sec', weight: 50 },
            { itemId: 'key_satoshi', weight: 50 },
        ]
    },
];

/** 전자에서 해금 아이디가 나올 확률 */
export const BOX_UNLOCK_CHANCE = 0.30; // 30%
