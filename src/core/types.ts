// ============================================================
// CoinRandomDefense v3.4 — Core Type Definitions
// 렌더링 무관. Unity C# 1:1 변환 가능.
// ============================================================

// ─── Enums ──────────────────────────────────────────────────

/** 특성 (Origin) — 크립토 테마 */
export enum Origin {
    Bitcoin = 'Bitcoin',    // ₿ 비트코인
    DeFi = 'DeFi',       // 🔓 DeFi
    Social = 'Social',     // 📱 소셜
    Exchange = 'Exchange',   // 🏦 거래소
    VC = 'VC',         // 💼 VC
    FUD = 'FUD',        // 💀 FUD
    Rugpull = 'Rugpull',    // 🚩 러그풀
    Bear = 'Bear',       // 📉 베어마켓
}



/** 고유 계열 (7코/10코 전용) */
export enum UniqueTrait {
    // 7코
    Creator = 'Creator',       // 📜 창시자 (Vitalik)
    SAFU = 'SAFU',          // 🛡️ SAFU (CZ)
    Mars = 'Mars',          // 🚀 화성 (Elon)
    FirstReceiver = 'FirstReceiver', // ⏳ 최초수신 (Trump)
    GoodAfternoon = 'GoodAfternoon', // ⚖️ GOOD AFTERNOON (Gensler)
    // 10코
    Anon = 'Anon',          // 🥷 익명 (Satoshi)
    // 5코 고유
    Depeg = 'Depeg',         // 💀 디페그 (Do Kwon)
    Embezzle = 'Embezzle',      // 🕳️ 횡령 (SBF)
    DiamondHand = 'DiamondHand',   // 💎 다이아몬드핸드 (Saylor)
    Leverage100x = 'Leverage100x',  // 🎰 100x (Arthur Hayes)
}

/** 게임 단계 */
export enum GamePhase {
    Prep = 'prep',    // 준비 단계 (상점/배치)
    Combat = 'combat',  // 전투 단계
    Boss = 'boss',    // 보스 전투
    Bonus = 'bonus',   // 보너스 (증강 3택)
}

// ─── Damage Type ────────────────────────────────────────────

/** 데미지 유형 */
export type DmgType = 'physical' | 'magic';

// ─── Unit Skill ─────────────────────────────────────────────

/** 스킬 발동 타입 */
export type SkillType = 'onHit' | 'onKill' | 'passive' | 'periodic' | 'active' | 'onCombatStart';

/** 유닛 개별 스킬 정의 */
export interface UnitSkill {
    type: SkillType;
    name: string;
    desc: string;
    cooldown?: number;                // periodic 전용 (초)
    chance?: number;                  // 확률 (0~1), 기본 1.0
    params: Record<string, number>;   // 범용 파라미터
}

// ─── Unit Definition ────────────────────────────────────────

/** 유닛 정의 (config 데이터) — 변하지 않는 스펙 */
export interface UnitDef {
    id: string;
    name: string;
    emoji: string;
    cost: 1 | 2 | 3 | 4 | 5 | 7 | 10;
    origin: Origin;
    dmgType: DmgType;        // 물리/마법
    baseDmg: number;
    attackRange?: number;    // 사거리 (칸 단위), 기본 2.5
    attackSpeed?: number;    // 초당 공격 횟수, 기본 1.0
    // 고유 특성 (5코+만 해당)
    uniqueTrait?: UniqueTrait;
    // 고유 효과 설명
    uniqueEffect?: string;
    // 개별 스킬
    skill?: UnitSkill;
    // 💧 마나 시스템
    maxMana?: number;       // 스킬 발동에 필요한 마나 (기본 100)
    startingMana?: number;  // 웨이브 시작 시 초기 마나 (기본 0)
}

/** 유닛 인스턴스 (게임 내 실제 유닛) — 상태 가변 */
export interface UnitInstance {
    instanceId: string;     // 고유 인스턴스 ID (UUID)
    unitId: string;         // config 참조 (UnitDef.id)
    star: 1 | 2 | 3;
    position: Position | null;  // null = 벤치
    attackCooldown?: number;     // 남은 쿨다운 (초)
    // 스킬 런타임 상태
    skillTimer?: number;         // periodic 스킬 타이머
    skillStacks?: number;        // 누적 스택
    skillActive?: boolean;       // 전투당 1회 스킬 사용 여부
    attackCount?: number;        // 공격 카운트 (nthHit 판정용)
    lastAttackTime?: number;     // 마지막 공격 시각 (performance.now ms)
    lastTargetX?: number;        // 마지막 타겟 X 좌표 (시선 방향용)
    // 💧 마나
    currentMana?: number;        // 현재 마나 (런타임)
    // 📊 실시간 DPS 추적
    totalDamageDealt?: number;   // 웨이브 누적 실제 데미지
}

export interface Position {
    x: number;  // 0~6 (7칸)
    y: number;  // 0~3 (4줄)
}

// ─── Combat Types ───────────────────────────────────────────

/** 경로 위의 좌표 (소수점 — 보간용) */
export interface PathPoint {
    px: number;  // 픽셀/그리드 좌표 X
    py: number;  // 픽셀/그리드 좌표 Y
}

/** CC 디버프 타입 */
export type CCType = 'stun' | 'freeze' | 'slow';

/** 몬스터에 걸린 CC 디버프 */
export interface CCDebuff {
    type: CCType;
    slowPct: number;        // 이속 감소 비율 (0~1): stun=1.0, freeze=0.5~0.8, slow=0.1~0.5
    remaining: number;      // 남은 지속 시간 (초)
}

/** 몬스터 인스턴스 */
export interface Monster {
    id: number;
    hp: number;
    maxHp: number;
    def: number;            // 물리 방어력
    mdef: number;           // 마법 방어력
    speed: number;          // 현재 유효 이속 (매 틱 재계산)
    baseSpeed: number;      // 원본 이속 (CC 해제 시 복원용)
    pathProgress: number;   // 경로 진행률 (0.0 ~ 1.0+, ≥1.0 = 1바퀴)
    laps: number;           // 완주 바퀴 수
    alive: boolean;
    isBoss: boolean;
    goldReward: number;
    hitTime?: number;       // 피격 시각 (performance.now ms, 플래시 효과용)
    dots?: { dps: number; remaining: number }[];  // DoT 효과
    debuffs?: CCDebuff[];   // CC 디버프 목록
}

/** 전투 이펙트 (Unity 매핑: type → VFX Prefab) */
export interface CombatEffect {
    id: number;
    type: 'damage' | 'crit' | 'death' | 'boss_warning' | 'freeze'
    | 'skill_explosion' | 'skill_lightning' | 'skill_heal' | 'skill_stun'
    | 'skill_aoe' | 'skill_buff' | 'skill_sniper' | 'skill_gold'
    | 'skill_blackhole' | 'skill_execute' | 'skill_chain';
    x: number;               // grid 좌표
    y: number;
    value?: number;           // 데미지 수치
    startTime: number;        // performance.now()
    duration: number;         // ms
    frameIndex?: number;      // 스프라이트 시트 프레임 (0-based)
}

/** 전투 상태 (실시간) */
export interface CombatState {
    active: boolean;
    monsters: Monster[];
    projectiles: Projectile[];  // 비행 중인 투사체
    effects: CombatEffect[];    // 시각 이펙트 (데미지 숫자, 폭발 등)
    spawnQueue: number;       // 남은 스폰 수
    spawnTimer: number;       // 다음 스폰까지 남은 시간
    elapsedTime: number;      // 전투 경과 시간
    totalKills: number;
    totalGoldEarned: number;
    leakedDamage: number;     // 통과한 몬스터로 인한 누적 피해
}

/** 투사체 (시각 효과용) */
export interface Projectile {
    fromX: number;  // 그리드 좌표 (유닛)
    fromY: number;
    toX: number;    // 그리드 좌표 (몬스터)
    toY: number;
    startTime: number;  // performance.now()
    duration: number;   // ms (비행 시간)
}

// ─── Synergy ────────────────────────────────────────────────

/** 시너지 브레이크포인트 */
export interface SynergyBreakpoint {
    count: number;
    effect: string;
}

/** 시너지 정의 */
export interface SynergyDef {
    id: string;
    type: 'origin';
    cryptoName: string;    // 크립토 이름 (예: 'FUD')
    fantasyName: string;   // 판타지 이름 (예: '공허')
    emoji: string;
    breakpoints: SynergyBreakpoint[];
    totalUnits: number;    // 이 시너지에 속한 총 유닛 수
}

/** 활성화된 시너지 */
export interface ActiveSynergy {
    synergyId: string;
    count: number;           // 현재 배치된 유닛 수
    activeLevel: number;     // 달성한 브레이크포인트 인덱스 (-1=미달)
}

// ─── Player State ───────────────────────────────────────────

export interface PlayerState {
    id: string;
    gold: number;
    level: number;
    xp: number;
    hp: number;
    winStreak: number;
    lossStreak: number;
    board: UnitInstance[];     // 배치된 유닛 (최대 level개)
    bench: UnitInstance[];     // 대기석 (최대 9개)
    shop: (string | null)[];  // 상점 5칸 (unitId, null=구매됨)
    shopLocked: boolean;
    items: string[];           // 보유 해금 아이템 ID
    augments: string[];        // 보유 증강 ID
    unlocked7cost: string[];   // 해금된 7코 유닛 ID
    unlocked10cost: boolean;   // 사토시 해금 여부
    freeRerolls: number;       // 무료 리롤 잔여 횟수
}

// ─── Game State (직렬화 가능) ─────────────────────────────

export interface GameState {
    round: number;
    phase: GamePhase;
    players: PlayerState[];    // 멀티: 최대 8명
    // 유닛 풀 (남은 수량 — 멀티에서 공유)
    unitPool: Record<string, number>;
    stageId: number;           // 캠페인 스테이지 ID (코스트 제한용)
}

// ─── Commands (Command 패턴) ────────────────────────────────

export type GameCommand =
    | { type: 'BUY_UNIT'; playerId: string; shopIndex: number }
    | { type: 'SELL_UNIT'; playerId: string; instanceId: string }
    | { type: 'MOVE_UNIT'; playerId: string; instanceId: string; to: Position }
    | { type: 'BENCH_UNIT'; playerId: string; instanceId: string }
    | { type: 'REROLL'; playerId: string }
    | { type: 'BUY_XP'; playerId: string }
    | { type: 'LOCK_SHOP'; playerId: string }
    | { type: 'START_COMBAT' }
    | { type: 'END_ROUND' };

// ─── Events (이벤트 버스) ───────────────────────────────────

export type GameEventType =
    | 'unit:bought'
    | 'unit:sold'
    | 'unit:placed'
    | 'unit:merged'          // ★ 합성
    | 'shop:rerolled'
    | 'shop:freeReroll'
    | 'round:start'
    | 'round:end'
    | 'combat:start'
    | 'combat:end'
    | 'boss:defeated'
    | 'boss:dropped'         // 상자 드랍
    | 'augment:offered'
    | 'augment:picked'
    | 'unlock:available'     // 7코/10코 해금 가능
    | 'unlock:activated'
    | 'synergy:changed'
    | 'player:damaged'
    | 'player:defeated'
    | 'gold:changed'
    | 'level:up';

export interface GameEvent {
    type: GameEventType;
    data?: unknown;
    timestamp: number;
}

// ─── Unlock System ──────────────────────────────────────────

export interface UnlockCondition {
    unitId: string;
    synergyRequirements: { synergyId: string; minCount: number }[];
    requiredAugment: string;
    requiredItem: string;
}

/** 아이템 드랍 풀 (보스 상자) */
export interface BoxDropTable {
    round: number;       // 보스 라운드 (10, 20, 30...)
    boxName: string;
    items: { itemId: string; weight: number }[];
}

// ─── Augment ────────────────────────────────────────────────

export interface AugmentDef {
    id: string;
    name: string;
    emoji: string;
    minRound: number;       // 등장 최소 라운드
    unlockUnit?: string;    // 해금 대상 7코/10코 유닛 ID
    effect: string;
}

// ─── Economy ────────────────────────────────────────────────

export interface LevelDef {
    level: number;
    slots: number;           // 배치 가능 유닛 수
    requiredXp: number;
    naturalRound: number;    // 자연 도달 라운드 (대략)
    shopOdds: number[];      // [1코%, 2코%, 3코%, 4코%, 5코%]
}
