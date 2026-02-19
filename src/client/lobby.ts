// ============================================================
// Lobby — 로비 메인 화면 + 뷰 전환
// ============================================================

import { getCachedState, ClientUserState } from './userState';

// 스테이지 정보
const STAGE_INFO: Record<number, { name: string; defType: string; rounds: string }> = {
    1: { name: 'Tutorial', defType: '방어 없음', rounds: 'R1~R10' },
    2: { name: 'Equal Ground', defType: '물방/마방 균등', rounds: 'R11~R20' },
    3: { name: 'Armor Wall', defType: '물방↑ 마딜 필요', rounds: 'R21~R30' },
    4: { name: 'Magic Barrier', defType: '마방↑ 물딜 필요', rounds: 'R31~R40' },
    5: { name: 'Twin Shield', defType: '양쪽 균등↑', rounds: 'R41~R50' },
    6: { name: 'Spirit Guard', defType: '마방↑↑', rounds: 'R51~R60' },
    7: { name: 'Iron Fortress', defType: '물방↑↑', rounds: 'R61~R70' },
};

// 해금 조건 표시
const UNLOCK_CONDITIONS: Record<number, string> = {
    3: 'S2 보스 B등급 이상',
    4: 'S3 보스 B등급 이상',
    5: 'S4 보스 B등급 이상',
    6: 'S5 클리어',
    7: 'S6 클리어',
};

export type LobbyView = 'home' | 'campaign' | 'stageDetail' | 'freeplay' | 'freeplayDetail' | 'missions' | 'collection' | 'license' | 'shop' | 'settings';

let currentView: LobbyView = 'home';
let selectedStage: number = 1;
let _cameFromFreeplay = false;
let onStartGame: ((stageId: number) => void) | null = null;

export function setOnStartGame(cb: (stageId: number) => void) {
    onStartGame = cb;
}

export function renderLobby(container: HTMLElement) {
    const state = getCachedState();
    if (!state) return;
    currentView = 'home';
    renderCurrentView(container, state);
}

function renderCurrentView(container: HTMLElement, state: ClientUserState) {
    container.innerHTML = '';

    // TopBar: profile + currencies(Soft/Shard7/Shard10) + settings
    const topBar = document.createElement('div');
    topBar.className = 'lobby-topbar';
    const s7 = state.unlocks.license7Shards;
    const s10 = state.unlocks.license10Shards;
    topBar.innerHTML = `
        <div class="top-profile">
            <div class="top-avatar">🎮</div>
            <span class="top-name">${state.profile.nickname}</span>
        </div>
        <div class="top-currencies">
            <div class="currency-pill">
                <span class="c-icon">💰</span>
                <span class="c-val">${state.wallet.soft.toLocaleString()}</span>
            </div>
            <div class="currency-pill shard7">
                <span class="c-icon">🔑</span>
                <span class="c-val">${s7}</span>
            </div>
            <div class="currency-pill shard10">
                <span class="c-icon">⭐</span>
                <span class="c-val">${s10}</span>
            </div>
        </div>
        <button class="top-settings" id="btn-settings">⚙️</button>
    `;
    container.appendChild(topBar);

    // Settings button
    topBar.querySelector('#btn-settings')?.addEventListener('click', () => {
        currentView = 'settings';
        renderCurrentView(container, state);
    });

    // Body
    const body = document.createElement('div');
    body.className = 'lobby-body';
    container.appendChild(body);

    if (currentView === 'home') {
        // Home uses native 3-column grid
        renderHome(body, state);
    } else {
        // Other views: wrap in scrollable full-width container
        const scroll = document.createElement('div');
        scroll.className = 'sub-page-scroll';
        body.appendChild(scroll);

        switch (currentView) {
            case 'campaign': renderCampaign(scroll, state); break;
            case 'stageDetail': renderStageDetail(scroll, state); break;
            case 'freeplay': renderFreeplay(scroll, state); break;
            case 'freeplayDetail': renderStageDetail(scroll, state); break;
            case 'missions': renderMissions(scroll, state); break;
            case 'collection': renderCollection(scroll, state); break;
            case 'license': renderLicense(scroll, state); break;
            case 'shop': renderShop(scroll, state); break;
            case 'settings': renderSettings(scroll, state); break;
        }
    }

    // Bottom Tab Bar
    if (currentView !== 'stageDetail' && currentView !== 'freeplayDetail') {
        const nav = document.createElement('div');
        nav.className = 'lobby-nav';
        const navItems = [
            { id: 'home', icon: '🏠', label: 'Home' },
            { id: 'campaign', icon: '📖', label: '캠페인' },
            { id: 'freeplay', icon: '🎮', label: '일반전' },
            { id: 'missions', icon: '📋', label: 'Quest' },
            { id: 'license', icon: '🔑', label: 'License' },
        ];

        for (const item of navItems) {
            const btn = document.createElement('button');
            btn.className = `lobby-nav-btn ${currentView === item.id ? 'active' : ''}`;
            btn.innerHTML = `<span class="nav-icon">${item.icon}</span><span class="nav-label">${item.label}</span>`;
            btn.onclick = () => {
                currentView = item.id as LobbyView;
                renderCurrentView(container, state);
            };
            nav.appendChild(btn);
        }
        container.appendChild(nav);
    }
}

// Home — 모드 선택 허브
function renderHome(body: HTMLElement, state: ClientUserState) {
    const bestRound = state.progress.bestRound;
    const currentStage = state.progress.unlockedStage;
    const stageName = STAGE_INFO[currentStage]?.name ?? '';

    // ── 좌측 사이드 ──
    const leftPanel = document.createElement('div');
    leftPanel.className = 'side-panel';
    leftPanel.innerHTML = `
        <button class="side-btn" data-view="shop">
            <span class="side-icon">🛒</span>
            <span class="side-label">Shop</span>
        </button>
        <button class="side-btn" data-view="collection">
            <span class="side-icon">📖</span>
            <span class="side-label">Book</span>
        </button>
        <button class="side-btn" data-view="missions">
            <span class="side-icon">📋</span>
            <span class="side-label">Quest</span>
            <span class="side-badge dot"></span>
        </button>
    `;
    body.appendChild(leftPanel);

    // ── 중앙: 모드 선택 허브 ──
    const center = document.createElement('div');
    center.className = 'center-hub mode-hub';
    center.innerHTML = `
        <div class="mode-hub-title">
            <div class="mode-hub-logo">⚔️</div>
            <div class="mode-hub-text">COIN DEFENSE</div>
            <div class="mode-hub-sub">크립토 랜덤디펜스</div>
        </div>

        <div class="mode-cards">
            <!-- 캠페인 -->
            <div class="mode-card campaign" id="mode-campaign">
                <div class="mode-card-glow"></div>
                <div class="mode-card-icon">📖</div>
                <div class="mode-card-title">Campaign</div>
                <div class="mode-card-desc">캠페인 · <small>튜토리얼</small></div>
                <div class="mode-card-info">
                    <span class="mode-stage">S${currentStage} ${stageName}</span>
                    <span class="mode-round">Best R${bestRound}</span>
                </div>
                <div class="mode-card-progress">
                    <div class="mode-prog-bar">
                        <div class="mode-prog-fill" style="width:${Math.min(100, (currentStage / 7) * 100)}%"></div>
                    </div>
                    <span class="mode-prog-text">${currentStage}/7 스테이지</span>
                </div>
                <div class="mode-card-cta">입장 →</div>
            </div>

            <!-- 일반전 -->
            <div class="mode-card freeplay" id="mode-freeplay">
                <div class="mode-card-glow"></div>
                <div class="mode-card-icon">⚔️</div>
                <div class="mode-card-title">Battle</div>
                <div class="mode-card-desc">일반전 · <small>싱글플레이</small></div>
                <div class="mode-card-info">
                    <span class="mode-players">👤 1 / 4</span>
                    <span class="mode-label-soon">멀티 준비중</span>
                </div>
                <div class="mode-card-detail">
                    자유롭게 스테이지를 선택하고<br>실력을 연마하세요
                </div>
                <div class="mode-card-cta">입장 →</div>
            </div>

            <!-- 랭크전 -->
            <div class="mode-card ranked locked" id="mode-ranked">
                <div class="mode-card-glow"></div>
                <div class="mode-card-icon">🏆</div>
                <div class="mode-card-title">랭크전</div>
                <div class="mode-card-desc">시즌 경쟁 · ELO 매칭</div>
                <div class="mode-card-info">
                    <span class="mode-players">👤 4인 대전</span>
                </div>
                <div class="mode-card-lock-overlay">
                    <span class="mode-lock-icon">🔒</span>
                    <span class="mode-lock-text">COMING SOON</span>
                    <span class="mode-lock-sub">시즌 1 준비중</span>
                </div>
            </div>
        </div>

        <div class="mode-hub-footer">
            <span class="mode-version">v3.5 — Pixel Edition</span>
        </div>
    `;
    body.appendChild(center);

    // ── 우측 사이드 ──
    const rightPanel = document.createElement('div');
    rightPanel.className = 'side-panel';
    rightPanel.innerHTML = `
        <button class="side-btn" data-view="license">
            <span class="side-icon">🔑</span>
            <span class="side-label">License</span>
        </button>
        <button class="side-btn locked">
            <span class="side-icon">🎫</span>
            <span class="side-label">Pass</span>
            <span class="side-soon">SOON</span>
        </button>
        <button class="side-btn locked">
            <span class="side-icon">👑</span>
            <span class="side-label">VIP</span>
            <span class="side-soon">SOON</span>
        </button>
    `;
    body.appendChild(rightPanel);

    // ── 이벤트 ──
    center.querySelector('#mode-campaign')?.addEventListener('click', () => {
        currentView = 'campaign';
        const container = body.parentElement!;
        renderCurrentView(container, state);
    });

    center.querySelector('#mode-freeplay')?.addEventListener('click', () => {
        currentView = 'freeplay';
        const container = body.parentElement!;
        renderCurrentView(container, state);
    });

    center.querySelector('#mode-ranked')?.addEventListener('click', () => {
        showToast('🏆 랭크전은 시즌 1 오픈 후 이용 가능합니다!', body);
    });

    body.querySelectorAll('.side-btn:not(.locked)').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = (btn as HTMLElement).dataset.view as LobbyView;
            if (view) {
                currentView = view;
                const container = body.parentElement!;
                renderCurrentView(container, state);
            }
        });
    });
}

function getNextUnlock(state: ClientUserState): string | null {
    const unlocked = state.progress.unlockedStage;
    if (unlocked >= 7) return null;
    return UNLOCK_CONDITIONS[unlocked + 1] ?? null;
}

// ── 캠페인 스테이지 선택 ──
function renderCampaign(body: HTMLElement, state: ClientUserState) {
    _cameFromFreeplay = false;
    let html = `<div class="campaign-header">
        <h2>📖 캠페인</h2>
        <div class="campaign-subtitle">스테이지를 순서대로 클리어하며 게임을 배워보세요</div>
    </div><div class="stage-grid">`;

    for (let s = 1; s <= 7; s++) {
        const info = STAGE_INFO[s];
        const unlocked = s <= state.progress.unlockedStage;
        const best = state.progress.bestBossGrades[`S${s}`] ?? {};
        const bestGrade = Object.values(best)[0] ?? '-';

        html += `
            <div class="stage-card ${unlocked ? 'unlocked' : 'locked'}" data-stage="${s}">
                <div class="stage-num">S${s}</div>
                <div class="stage-name">${info.name}</div>
                <div class="stage-def">${info.defType}</div>
                <div class="stage-rounds">${info.rounds}</div>
                ${unlocked ?
                `<div class="stage-best">Best: ${bestGrade}</div>` :
                `<div class="stage-lock">🔒 ${UNLOCK_CONDITIONS[s] ?? ''}</div>`
            }
            </div>
        `;
    }

    html += '</div>';
    body.innerHTML = html;

    body.querySelectorAll('.stage-card.unlocked').forEach(card => {
        card.addEventListener('click', () => {
            selectedStage = Number((card as HTMLElement).dataset.stage);
            currentView = 'stageDetail';
            const container = body.parentElement!;
            renderCurrentView(container, state);
        });
    });

    body.querySelectorAll('.stage-card.locked').forEach(card => {
        card.addEventListener('click', () => {
            const s = Number((card as HTMLElement).dataset.stage);
            showToast(`🔒 해금 조건: ${UNLOCK_CONDITIONS[s] ?? '이전 스테이지 클리어'}`, body);
        });
    });
}

// ── 일반전 스테이지 선택 ──
function renderFreeplay(body: HTMLElement, state: ClientUserState) {
    _cameFromFreeplay = true;
    let html = `<div class="campaign-header freeplay-header">
        <h2>🎮 일반전</h2>
        <div class="campaign-subtitle">자유롭게 스테이지를 선택하세요 · 싱글플레이</div>
        <div class="freeplay-mp-notice">👤 1 / 4 — 멀티플레이 업데이트 준비중</div>
    </div><div class="stage-grid">`;

    for (let s = 1; s <= 7; s++) {
        const info = STAGE_INFO[s];
        const best = state.progress.bestBossGrades[`S${s}`] ?? {};
        const bestGrade = Object.values(best)[0] ?? '-';

        html += `
            <div class="stage-card unlocked freeplay-card" data-stage="${s}">
                <div class="stage-num">S${s}</div>
                <div class="stage-name">${info.name}</div>
                <div class="stage-def">${info.defType}</div>
                <div class="stage-rounds">${info.rounds}</div>
                <div class="stage-best">Best: ${bestGrade}</div>
            </div>
        `;
    }

    html += '</div>';
    body.innerHTML = html;

    body.querySelectorAll('.stage-card').forEach(card => {
        card.addEventListener('click', () => {
            selectedStage = Number((card as HTMLElement).dataset.stage);
            currentView = 'freeplayDetail';
            const container = body.parentElement!;
            renderCurrentView(container, state);
        });
    });
}

// ── 스테이지 상세 ──
function renderStageDetail(body: HTMLElement, state: ClientUserState) {
    const info = STAGE_INFO[selectedStage];
    const grades = state.progress.bestBossGrades[`S${selectedStage}`] ?? {};

    body.innerHTML = `
        <div class="stage-detail">
            <button class="back-btn" id="back-to-campaign">← 뒤로</button>
            <div class="detail-header">
                <h2>S${selectedStage} — ${info.name}</h2>
                <div class="detail-def">${info.defType}</div>
                <div class="detail-rounds">${info.rounds}</div>
            </div>

            <div class="detail-boss-grades">
                <h3>보스 기록</h3>
                <div class="boss-grade-list">
                    ${renderBossGrades(selectedStage, grades)}
                </div>
            </div>

            <div class="detail-rewards">
                <h3>보상</h3>
                <div class="reward-item">💰 등급별 Soft (S:100, A:60, B:30)</div>
                <div class="reward-item">🔑 B등급↑ 시 라이선스 조각 +5</div>
                <div class="reward-item">⭐ S등급 시 10코 조각 +3</div>
                <div class="reward-item">🏆 클리어 보너스: Soft 50 + 조각 10</div>
            </div>

            <button class="lobby-cta-main" id="btn-start-run">
                <span class="cta-icon">🚀</span>
                <span class="cta-text">전투 시작</span>
            </button>
        </div>
    `;

    body.querySelector('#back-to-campaign')?.addEventListener('click', () => {
        currentView = _cameFromFreeplay ? 'freeplay' : 'campaign';
        const container = body.parentElement!;
        renderCurrentView(container, state);
    });

    body.querySelector('#btn-start-run')?.addEventListener('click', () => {
        onStartGame?.(selectedStage);
    });
}

function renderBossGrades(stage: number, grades: Record<string, string>): string {
    const bossRound = stage * 10;
    const grade = grades[`R${bossRound}`] ?? '-';
    const gradeClass = grade === 'S' ? 'grade-s' : grade === 'A' ? 'grade-a' : grade === 'B' ? 'grade-b' : '';
    return `<div class="boss-grade-item ${gradeClass}">
        <span>R${bossRound} 보스</span>
        <span class="grade-badge">${grade}</span>
    </div>`;
}

// ── 퀘스트 (PRO) ──
let _questTab: 'daily' | 'weekly' = 'daily';

function renderMissions(body: HTMLElement, _state: ClientUserState) {
    body.innerHTML = '<div class="missions-page"><div class="quest-loading">⏳ 퀘스트 로딩 중...</div></div>';
    loadAndRenderQuests(body);
}

async function loadAndRenderQuests(body: HTMLElement) {
    try {
        const { getQuests } = await import('./api');
        const dailyData = await getQuests('daily');
        const weeklyData = await getQuests('weekly');
        renderQuestsUI(body, dailyData, weeklyData);
    } catch (e) {
        body.innerHTML = '<div class="missions-page"><p>❌ 퀘스트 로딩 실패</p></div>';
    }
}

function renderQuestsUI(body: HTMLElement, dailyData: any, weeklyData: any) {
    const quests = _questTab === 'daily' ? dailyData.quests : weeklyData.quests;
    const reroll = dailyData.reroll;
    const weekly = weeklyData.weekly;
    const MILESTONES = [30, 60, 100];

    // 완료 카운트 계산
    const totalQuests = quests.length;
    const doneCount = quests.filter((q: any) => q.status === 'CLAIMED' || q.status === 'COMPLETED').length;

    const questCards = quests.map((q: any) => {
        const claimed = q.status === 'CLAIMED';
        const completed = q.status === 'COMPLETED';
        const rewards = JSON.parse(q.rewards_json ?? '{}');
        const slotIdx = q.slot_index;
        const canReroll = _questTab === 'daily' && (slotIdx === 1 || slotIdx === 2) && !completed && !claimed;

        // 진행률 계산
        const progress = Math.min(q.progress, q.target);
        const pct = q.target > 0 ? Math.floor((progress / q.target) * 100) : 0;
        const isDone = completed || claimed;

        // 보상 표시
        const rewardAmt = rewards.soft ?? 0;

        let actionHtml = '';
        if (completed) {
            actionHtml = '<button class="q-claim-btn" data-quest="' + q.id + '">수령</button>';
        } else if (claimed) {
            actionHtml = '<span class="q-done-dot">●</span>';
        } else if (canReroll) {
            const costLabel = reroll.nextCost > 0 ? reroll.nextCost + 'G' : '무료';
            actionHtml = '<button class="q-reroll-btn" data-slot="' + slotIdx + '">🔄 ' + costLabel + '</button>';
        }

        return `<div class="q-card ${isDone ? 'q-done' : ''} ${completed ? 'q-claimable' : ''}">
            <div class="q-left">
                <div class="q-reward-icon">💰</div>
                <div class="q-reward-amt">${rewardAmt}</div>
            </div>
            <div class="q-mid">
                <div class="q-desc">${q.description ?? q.name}</div>
                <div class="q-bar-wrap">
                    <div class="q-bar" style="width:${pct}%"></div>
                </div>
            </div>
            <div class="q-right">
                <div class="q-frac">${progress}/${q.target > 999 ? Math.floor(q.target / 1000) + 'K' : q.target}</div>
                ${actionHtml}
            </div>
        </div>`;
    }).join('');

    let milestoneHtml = '';
    if (_questTab === 'weekly') {
        const milestoneItems = MILESTONES.map(tier => {
            const reached = weekly.points >= tier;
            const claimedM = (weekly.claimedMilestones ?? []).includes(tier);
            let btn = '<span>🔒</span>';
            if (reached && !claimedM) btn = '<button class="milestone-claim-btn" data-tier="' + tier + '">🎁</button>';
            if (claimedM) btn = '<span>✅</span>';
            return '<div class="milestone-item ' + (reached ? 'reached' : '') + ' ' + (claimedM ? 'claimed' : '') + '">' +
                '<span class="milestone-tier">' + tier + 'pt</span>' + btn + '</div>';
        }).join('');
        milestoneHtml = '<div class="weekly-milestones"><h3>⭐ 주간 마일스톤 (' + weekly.points + 'pt)</h3><div class="milestone-bar">' + milestoneItems + '</div></div>';
    } else {
        const rerollInfo = reroll.freeUsed ? '유료 ' + reroll.paidCount + '회 사용' : '무료 1회 남음';
        milestoneHtml = '<div class="reroll-info">리롤: 1회 무료, 이후 점증 | ' + rerollInfo + '</div>';
    }

    body.innerHTML = `<div class="missions-page">
        <!-- 탭 바 -->
        <div class="q-tabs">
            <button class="q-tab ${_questTab === 'daily' ? 'active' : ''}" data-tab="daily">일일</button>
            <button class="q-tab ${_questTab === 'weekly' ? 'active' : ''}" data-tab="weekly">주간</button>
        </div>

        <!-- 완료 카운터 -->
        <div class="q-counter-bar">
            <span class="q-counter-icon">💰</span>
            <span class="q-counter-num">${doneCount}</span>
            <span class="q-counter-total">${doneCount}/${totalQuests}</span>
        </div>

        <!-- 미션 카드 리스트 -->
        <div class="q-list">${questCards}</div>

        ${milestoneHtml}
    </div>`;

    // 탭 전환
    body.querySelectorAll('.q-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            _questTab = (tab as HTMLElement).dataset.tab as 'daily' | 'weekly';
            renderQuestsUI(body, dailyData, weeklyData);
        });
    });

    // 수령 버튼
    body.querySelectorAll('.q-claim-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const questId = (btn as HTMLElement).dataset.quest!;
            try {
                const { claimQuest } = await import('./api');
                const result = await claimQuest(questId);
                const { setCachedState } = await import('./userState');
                setCachedState(result.me);
                const r = result.rewards;
                showToast('🎉 퀘스트 보상! 💰' + r.soft + (r.shards7 ? ' 🔑' + r.shards7 : '') + (r.shards10 ? ' 💎' + r.shards10 : ''), body);
                loadAndRenderQuests(body);
            } catch (e) {
                showToast('❌ 수령 실패', body);
            }
        });
    });

    // 리롤 버튼
    body.querySelectorAll('.q-reroll-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const slot = parseInt((btn as HTMLElement).dataset.slot!);
            try {
                const { rerollQuest } = await import('./api');
                const result = await rerollQuest(slot);
                const { setCachedState } = await import('./userState');
                setCachedState(result.me);
                showToast('🔄 퀘스트 변경! ' + (result.cost > 0 ? '(-' + result.cost + 'G)' : '(무료)'), body);
                loadAndRenderQuests(body);
            } catch (e: any) {
                showToast(e?.message?.includes('Soft') ? '💰 골드 부족!' : '❌ 리롤 실패', body);
            }
        });
    });

    // 마일스톤 수령
    body.querySelectorAll('.milestone-claim-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const tier = parseInt((btn as HTMLElement).dataset.tier!);
            try {
                const { claimWeeklyMilestone } = await import('./api');
                const result = await claimWeeklyMilestone(tier);
                const { setCachedState } = await import('./userState');
                setCachedState(result.me);
                const r = result.rewards;
                showToast('🎁 ' + tier + 'pt 상자! 💰' + r.soft + ' 🔑' + r.shards7 + (r.shards10 ? ' 💎' + r.shards10 : ''), body);
                loadAndRenderQuests(body);
            } catch (e: any) {
                showToast('❌ ' + (e?.message || '수령 실패'), body);
            }
        });
    });
}

// ── 도감 (읽기 전용) ──
function renderCollection(body: HTMLElement, state: ClientUserState) {
    body.innerHTML = `
        <div class="collection-page">
            <h2>📖 유닛 도감</h2>
            <div class="collection-info">유닛 수집 현황 (추후 업데이트)</div>
            <div class="collection-grid" id="collection-grid"></div>
        </div>
    `;
    const grid = body.querySelector('#collection-grid')!;
    const costs = [1, 2, 3, 4, 5, 7, 10];
    for (const c of costs) {
        const unlocked = state.unlocks.unlockedCosts[String(c)] || (c <= 2);
        const div = document.createElement('div');
        div.className = `collection-cost-group ${unlocked ? 'unlocked' : 'locked'}`;
        div.innerHTML = `<span class="cost-label">${c}코스트</span><span>${unlocked ? '✅ 해금됨' : '🔒'}</span>`;
        grid.appendChild(div);
    }
}

// ── 라이선스 ──
function renderLicense(body: HTMLElement, state: ClientUserState) {
    const s7 = state.unlocks.license7Shards;
    const s10 = state.unlocks.license10Shards;
    const l7 = state.unlocks.license7;
    const l10 = state.unlocks.license10;

    body.innerHTML = `
        <div class="license-page">
            <h2>🔑 라이선스</h2>

            <div class="license-card ${l7 ? 'unlocked' : ''}">
                <div class="license-title">7코스트 라이선스</div>
                <div class="license-bar-wrap">
                    <div class="license-bar" style="width:${l7 ? 100 : Math.min(100, s7)}%"></div>
                </div>
                <div class="license-progress">${l7 ? '✅ 해금 완료!' : `${s7} / 100 조각`}</div>
                ${!l7 && s7 >= 100 ? '<button class="license-unlock-btn" data-license="7">해금하기</button>' : ''}
                <div class="license-source">획득처: 보스 B등급↑, 퀘스트, 클리어 보너스</div>
            </div>

            <div class="license-card ${l10 ? 'unlocked' : ''}">
                <div class="license-title">10코스트 라이선스</div>
                <div class="license-bar-wrap">
                    <div class="license-bar" style="width:${l10 ? 100 : Math.min(100, s10 / 2)}%"></div>
                </div>
                <div class="license-progress">${l10 ? '✅ 해금 완료!' : `${s10} / 200 조각`}</div>
                ${!l10 && s10 >= 200 ? '<button class="license-unlock-btn" data-license="10">해금하기</button>' : ''}
                <div class="license-source">획득처: 보스 S등급, 주간 마일스톤</div>
            </div>
        </div>
    `;
}

// ── 상점 (v1 틀만) ──
function renderShop(body: HTMLElement, state: ClientUserState) {
    body.innerHTML = `
        <div class="shop-page">
            <h2>🛒 상점</h2>
            <div class="shop-grid">
                <div class="shop-item">
                    <div class="shop-item-icon">📝</div>
                    <div class="shop-item-name">닉네임 변경권</div>
                    <div class="shop-item-price">💰 500</div>
                    <button class="shop-buy-btn" ${state.wallet.soft >= 500 ? '' : 'disabled'}>구매</button>
                </div>
                <div class="shop-item">
                    <div class="shop-item-icon">🎨</div>
                    <div class="shop-item-name">로비 테마: 다크</div>
                    <div class="shop-item-price">💰 1000</div>
                    <button class="shop-buy-btn" ${state.wallet.soft >= 1000 ? '' : 'disabled'}>구매</button>
                </div>
                <div class="shop-item">
                    <div class="shop-item-icon">✨</div>
                    <div class="shop-item-name">타격 이펙트: 골드</div>
                    <div class="shop-item-price">💰 800</div>
                    <button class="shop-buy-btn" ${state.wallet.soft >= 800 ? '' : 'disabled'}>구매</button>
                </div>
            </div>
        </div>
    `;
}

// ── 설정 ──
function renderSettings(body: HTMLElement, state: ClientUserState) {
    body.innerHTML = `
        <div class="settings-page">
            <h2>⚙️ 설정</h2>
            <div class="settings-list">
                <div class="settings-item">
                    <span>계정</span>
                    <span>게스트 #${state.userId.slice(0, 8)}</span>
                </div>
                <div class="settings-item">
                    <span>데이터 저장</span>
                    <span>☁️ 서버 저장됨</span>
                </div>
                <div class="settings-item">
                    <span>사운드</span>
                    <span>ON</span>
                </div>
            </div>
        </div>
    `;
}

// ── Toast ──
function showToast(msg: string, container: HTMLElement) {
    const toast = document.createElement('div');
    toast.className = 'lobby-toast';
    toast.textContent = msg;
    (container.parentElement ?? container).appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ── 결과 화면 export ──
export function renderResult(container: HTMLElement, resultData: {
    rewards: { soft: number; shards7: number; shards10: number };
    newUnlocks: string[];
    missionProgress: string[];
    reachedRound: number;
    cleared: boolean;
    bossGrades: Record<string, string>;
    stageId: number;
}, onRetry: () => void, onHome: () => void) {
    container.innerHTML = '';

    const win = resultData.cleared;
    const unlockHtml = resultData.newUnlocks.length > 0
        ? `<div class="result-unlocks">${resultData.newUnlocks.map(u => {
            if (u.startsWith('stage:')) return `<div class="unlock-item">🔓 스테이지 S${u.split(':')[1]} 해금!</div>`;
            if (u.startsWith('cost:')) return `<div class="unlock-item">🎯 ${u.split(':')[1]}코스트 유닛 해금!</div>`;
            return '';
        }).join('')}</div>`
        : '';

    container.innerHTML = `
        <div class="result-screen">
            <div class="result-header ${win ? 'win' : 'lose'}">
                <h1>${win ? '🏆 클리어!' : '💀 실패'}</h1>
                <div class="result-round">${win ? `스테이지 ${resultData.stageId + 1} 완료!` : `도달 라운드: R${resultData.reachedRound}`}</div>
            </div>

            <div class="result-grades">
                <h3>보스 등급</h3>
                <div class="grade-list">
                    ${Object.entries(resultData.bossGrades).map(([r, g]) => {
        const cls = g === 'S' ? 'grade-s' : g === 'A' ? 'grade-a' : g === 'B' ? 'grade-b' : '';
        return `<div class="grade-item ${cls}"><span>${r}</span><span class="grade-badge">${g}</span></div>`;
    }).join('') || '<div class="no-boss">보스 라운드 미도달</div>'}
                </div>
            </div>

            <div class="result-rewards">
                <h3>획득 보상</h3>
                <div class="reward-list">
                    <div class="reward-item">💰 Soft: +${resultData.rewards.soft}</div>
                    ${resultData.rewards.shards7 > 0 ? `<div class="reward-item">🔑 7코 조각: +${resultData.rewards.shards7}</div>` : ''}
                    ${resultData.rewards.shards10 > 0 ? `<div class="reward-item">⭐ 10코 조각: +${resultData.rewards.shards10}</div>` : ''}
                </div>
            </div>

            ${unlockHtml}

            <div class="result-actions">
                <button class="result-btn retry" id="result-retry">🔄 다시하기</button>
                <button class="result-btn home" id="result-home">🏠 로비로</button>
            </div>
        </div>
    `;

    container.querySelector('#result-retry')?.addEventListener('click', onRetry);
    container.querySelector('#result-home')?.addEventListener('click', onHome);
}
