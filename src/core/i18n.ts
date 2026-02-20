// ============================================================
// i18n — 다국어 지원 모듈 (한국어 / English)
// ============================================================

export type Lang = 'ko' | 'en';

let currentLang: Lang = (localStorage.getItem('crd_lang') as Lang) || 'ko';

// ─── 번역 사전 ──────────────────────────────────────────────

const strings: Record<Lang, Record<string, string>> = {
    ko: {
        // ── 로비 ──
        'lobby.title': 'COIN DEFENSE',
        'lobby.campaign': '🏰 캠페인',
        'lobby.freeplay': '⚔️ 일반전',
        'lobby.quest': '📜 퀘스트',
        'lobby.collection': '📖 도감',
        'lobby.shop': '🛒 상점',
        'lobby.settings': '⚙️ 설정',
        'lobby.license': '📄 라이선스',
        'lobby.start': '🚀 게임 시작',
        'lobby.back': '← 뒤로',
        'lobby.account': '계정',
        'lobby.guest': '게스트',
        'lobby.dataSave': '데이터 저장',
        'lobby.serverSaved': '☁️ 서버 저장됨',
        'lobby.sound': '사운드',
        'lobby.language': '🌐 언어',
        'lobby.stageSelect': '스테이지 선택',
        'lobby.locked': '🔒 잠김',
        'lobby.cleared': '✅ 클리어',

        // ── HUD ──
        'hud.round': '라운드',
        'hud.gold': '골드',
        'hud.hp': 'HP',
        'hud.level': '레벨',
        'hud.reroll': '🔄 리롤',
        'hud.buyXp': '📈 XP 구매',
        'hud.lock': '🔓 잠금해제',
        'hud.locked': '🔒 잠금중',
        'hud.nextRound': '▶ 다음 라운드',
        'hud.sell': '판매',
        'hud.board': '보드',
        'hud.bench': '벤치',
        'hud.maxLevel': '🏆 MAX LEVEL',

        // ── 상점 ──
        'shop.cost1': '1코',
        'shop.cost2': '2코',
        'shop.cost3': '3코',
        'shop.cost4': '4코',
        'shop.currentLevel': '현재',
        'shop.nextLevel': '다음',

        // ── 전투 ──
        'combat.prepPhase': '🛡️ 준비 페이즈',
        'combat.battlePhase': '⚔️ 전투 페이즈',
        'combat.bossWave': '🔥 보스 웨이브',
        'combat.victory': '승리!',
        'combat.defeat': '패배',
        'combat.waveCleared': '웨이브 클리어!',

        // ── 게임오버 ──
        'gameover.title': '☠️ RUG PULL',
        'gameover.round': '도달 라운드',
        'gameover.level': '플레이어 레벨',
        'gameover.goldSpent': '사용한 골드',
        'gameover.retry': '🔄 재도전',
        'gameover.home': '🏠 로비로',
        'gameover.cleared': '🏆 클리어!',

        // ── 시너지 ──
        'synergy.title': '시너지',
        'synergy.active': '활성',

        // ── 설정 ──
        'settings.title': '⚙️ 설정',
        'settings.speed': '배속',
        'settings.volume': '볼륨',

        // ── 보스 등급 ──
        'boss.grade': '등급',
        'boss.time': '시간',

        // ── 기타 ──
        'misc.free': '무료',
        'misc.max': 'MAX',
        'misc.confirm': '확인',
        'misc.cancel': '취소',
    },

    en: {
        // ── Lobby ──
        'lobby.title': 'COIN DEFENSE',
        'lobby.campaign': '🏰 Campaign',
        'lobby.freeplay': '⚔️ Freeplay',
        'lobby.quest': '📜 Quests',
        'lobby.collection': '📖 Collection',
        'lobby.shop': '🛒 Shop',
        'lobby.settings': '⚙️ Settings',
        'lobby.license': '📄 License',
        'lobby.start': '🚀 Start Game',
        'lobby.back': '← Back',
        'lobby.account': 'Account',
        'lobby.guest': 'Guest',
        'lobby.dataSave': 'Data Save',
        'lobby.serverSaved': '☁️ Server Saved',
        'lobby.sound': 'Sound',
        'lobby.language': '🌐 Language',
        'lobby.stageSelect': 'Stage Select',
        'lobby.locked': '🔒 Locked',
        'lobby.cleared': '✅ Cleared',

        // ── HUD ──
        'hud.round': 'Round',
        'hud.gold': 'Gold',
        'hud.hp': 'HP',
        'hud.level': 'Level',
        'hud.reroll': '🔄 Reroll',
        'hud.buyXp': '📈 Buy XP',
        'hud.lock': '🔓 Unlocked',
        'hud.locked': '🔒 Locked',
        'hud.nextRound': '▶ Next Round',
        'hud.sell': 'Sell',
        'hud.board': 'Board',
        'hud.bench': 'Bench',
        'hud.maxLevel': '🏆 MAX LEVEL',

        // ── Shop ──
        'shop.cost1': 'T1',
        'shop.cost2': 'T2',
        'shop.cost3': 'T3',
        'shop.cost4': 'T4',
        'shop.currentLevel': 'Current',
        'shop.nextLevel': 'Next',

        // ── Combat ──
        'combat.prepPhase': '🛡️ Prep Phase',
        'combat.battlePhase': '⚔️ Battle Phase',
        'combat.bossWave': '🔥 Boss Wave',
        'combat.victory': 'Victory!',
        'combat.defeat': 'Defeat',
        'combat.waveCleared': 'Wave Cleared!',

        // ── Game Over ──
        'gameover.title': '☠️ RUG PULL',
        'gameover.round': 'Round Reached',
        'gameover.level': 'Player Level',
        'gameover.goldSpent': 'Gold Spent',
        'gameover.retry': '🔄 Retry',
        'gameover.home': '🏠 Lobby',
        'gameover.cleared': '🏆 Cleared!',

        // ── Synergy ──
        'synergy.title': 'Synergies',
        'synergy.active': 'Active',

        // ── Settings ──
        'settings.title': '⚙️ Settings',
        'settings.speed': 'Speed',
        'settings.volume': 'Volume',

        // ── Boss Grade ──
        'boss.grade': 'Grade',
        'boss.time': 'Time',

        // ── Misc ──
        'misc.free': 'Free',
        'misc.max': 'MAX',
        'misc.confirm': 'OK',
        'misc.cancel': 'Cancel',
    },
};

// ─── API ─────────────────────────────────────────────────────

/** 현재 언어로 번역 키에 해당하는 문자열 반환 */
export function t(key: string): string {
    return strings[currentLang][key] ?? strings['ko'][key] ?? key;
}

/** 현재 언어 가져오기 */
export function getLang(): Lang {
    return currentLang;
}

/** 언어 변경 + localStorage 저장 */
export function setLang(lang: Lang): void {
    currentLang = lang;
    localStorage.setItem('crd_lang', lang);
}

/** 사용 가능한 언어 목록 */
export const AVAILABLE_LANGS: { code: Lang; label: string }[] = [
    { code: 'ko', label: '한국어' },
    { code: 'en', label: 'English' },
];
