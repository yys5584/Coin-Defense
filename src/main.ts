// ============================================================
// CoinRandomDefense v3.5 — Main Entry Point
// 게임 로직 → UI 연결
// ============================================================

import { EventBus } from './core/EventBus';
import { createGameState, getLevelDef } from './core/GameState';
import { CommandProcessor } from './core/systems/CommandProcessor';
import { CombatSystem, getPositionOnPath, CombatResult } from './core/systems/CombatSystem';
import { SynergySystem } from './core/systems/SynergySystem';
import { UNIT_MAP, SYNERGIES, STAR_MULTIPLIER, LEVELS, getBaseIncome, getInterest, getStreakBonus, getStageRound, getStage, isBossRound, BOX_DROP_TABLES, BOX_UNLOCK_CHANCE, UNLOCK_CONDITIONS, AUGMENTS, STAGE_HINTS, STAGE_DEFENSE } from './core/config';
import { UNIT_DICTIONARY } from './core/unitDictionary';
import { GameState, PlayerState, UnitInstance, CombatState, ActiveSynergy } from './core/types';
import { createUnitVisual, preloadAllSprites, COST_GLOW, COST_GLOW_SHADOW, hasSpriteFor, hasUnitSprite, getUnitSprite, drawUnitSprite, drawMonsterSprite, getUnitSpriteInfo, getUnitSpriteSheet } from './client/sprites';
import { t, getLang, setLang, AVAILABLE_LANGS, Lang } from './core/i18n';

import './client/style.css';

// ─── QA 봇용 데이터 노출 (window 전역) ─────────────────────
if (typeof window !== 'undefined') {
  (window as any).__UNIT_DB__ = UNIT_MAP;
  (window as any).__SYNERGIES__ = SYNERGIES;
}

// ─── PRO 로비 ──────────────────────────────────────────────────

import { initUserState, setCachedState, refreshState } from './client/userState';
import { renderLobby, setOnStartGame, renderResult } from './client/lobby';
import { runStart, runFinish } from './client/api';

const lobbyProEl = document.getElementById('lobby-pro');
const resultViewEl = document.getElementById('result-view');
const appEl = document.getElementById('app');

// 런 추적 변수
let currentRunId: string | null = null;
let currentStageId: number = 7;  // 기본값: 최종 스테이지 (7-7까지 진행)
let collectedBossGrades: Record<string, string> = {};

// PRO 로비 초기화
async function initProLobby() {
  try {
    await initUserState();
    if (lobbyProEl) {
      renderLobby(lobbyProEl);
    }
  } catch (e) {
    console.error('[Lobby] Init failed:', e);
    // 오프라인 fallback: 로비 없이 바로 게임
    lobbyProEl?.classList.add('hidden');
    appEl?.classList.remove('hidden');
  }
}

// 로비→게임 전환
setOnStartGame(async (stageId: number) => {
  currentStageId = stageId;
  state.stageId = stageId;  // 상점 코스트 제한용
  collectedBossGrades = {};

  try {
    const { runId } = await runStart(stageId);
    currentRunId = runId;
  } catch (e) {
    console.warn('[Run] Start failed, playing offline:', e);
    currentRunId = null;
  }

  // 로비 숨기고 게임 보이기
  lobbyProEl?.classList.add('hidden');
  resultViewEl?.classList.add('hidden');
  appEl?.classList.remove('hidden');
  document.querySelector('.rug-pull-overlay')?.remove(); // 방어: 이전 세션 잔여물 제거

  // BGM 시작
  bgm.play().catch(() => { });
});

// 결과→로비 복귀 (최신 메인 로비로)
function returnToLobby() {
  document.querySelector('.rug-pull-overlay')?.remove();
  location.reload();
}

initProLobby();

// ─── 고정 해상도 스케일링 ──────────────────────────────────────
const DESIGN_W = 1440;
const DESIGN_H = 810;
const scaleWrapperEl = document.getElementById('game-scale-wrapper');
let currentScale = 1;

function applyGameScale(): void {
  if (!scaleWrapperEl) return;
  currentScale = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
  const scaledW = DESIGN_W * currentScale;
  const scaledH = DESIGN_H * currentScale;
  const offsetX = Math.max(0, (window.innerWidth - scaledW) / 2);
  const offsetY = Math.max(0, (window.innerHeight - scaledH) / 2);
  scaleWrapperEl.style.transform = `scale(${currentScale})`;
  scaleWrapperEl.style.left = `${offsetX}px`;
  scaleWrapperEl.style.top = `${offsetY}px`;
}

/** getBoundingClientRect÷scale로 정확한 논리좌표 반환 */
function getGridCoords(mapWrapper: HTMLElement, grid: HTMLElement) {
  const s = currentScale;
  const gr = grid.getBoundingClientRect();
  const wr = mapWrapper.getBoundingClientRect();
  const gridOffsetX = (gr.left - wr.left) / s;
  const gridOffsetY = (gr.top - wr.top) / s;
  const gridW = gr.width / s;
  const gridH = gr.height / s;
  return { gridOffsetX, gridOffsetY, gridW, gridH, cellW: gridW / 7, cellH: gridH / 4 };
}

window.addEventListener('resize', applyGameScale);
applyGameScale(); // 초기 적용

// ─── 실시간 DPS 추적 ────────────────────────────────────────
let combatStartTime = 0;         // 웨이브 시작 시각 (performance.now)
let lastDpsUpdate = 0;           // 마지막 DPS 갱신 시각

// 전 라운드 수입 추적
let lastRoundIncome = {
  stageGold: 0,     // 스테이지 보상 (base income)
  gradeGold: 0,     // 등급 보너스
  grade: '-' as string,
  interestGold: 0,  // 이자
  combatGold: 0,    // 전투 킬골드
  totemGold: 0,     // 유닛/증강 보상
  total: 0,
};

// ═══════════════════════════════════════════════════════════════
// ─── ASYNC RACING MULTIPLAYER ────────────────────────────────
// 각자 독립 진행 + 상태 릴레이 + 미니맵 라운드 표시
// ═══════════════════════════════════════════════════════════════

import {
  connectSocket, joinQueue, leaveQueue, startWithBots,
  emitSyncState, emitTimeAttack, emitClaimDraft, emitGetDraft,
  emitPlayerDied, emitGameCleared,
  onQueueUpdate, onGameStart, onSyncState,
  onPlayerDisconnected, onTimeAttack, onUpdateDraft,
  onPlayerDiedBroadcast, onPlayerClearedBroadcast, onMatchEnd,
  disconnectSocket,
  type GameStartData, type SyncStateData, type QueueUpdateData, type DraftCard, type MatchRanking,
} from './client/socket';

// ─── SPA Screen Management ───
const lobbyScreenEl = document.getElementById('lobby-screen');
const matchScreenEl = document.getElementById('match-screen');
const gameScreenEl = document.getElementById('game-screen');

function showScreen(id: string) {
  lobbyScreenEl?.classList.add('hidden');
  matchScreenEl?.classList.add('hidden');
  gameScreenEl?.classList.add('hidden');
  document.getElementById(id)?.classList.remove('hidden');
}

// ─── Multiplayer State ───
let currentViewId = 0;   // 관전 대상 (0=나)
let isMultiMode = false;
let isHost = false;
let mySlotIndex = 0;
let multiPlayerNames: string[] = [];
let botSlots: number[] = [];
let syncInterval: number | null = null;
let botAIInterval: number | null = null;
// 원격 플레이어의 라운드 정보 저장
const remoteRounds: Map<number, { round: number; label: string }> = new Map();

// ─── Speedrun Bounty ───
let gameStartTime = 0; // Date.now() at game start
const SPEEDRUN_TARGET_LABEL = '2-7'; // 타겟 라운드
const SPEEDRUN_TIME_LIMIT = 30;  // QA: 30초 (본번: 180초)
const SPEEDRUN_BONUS_GOLD = 15;

const viewPlayer = () => state.players[currentViewId] ?? state.players[0];

// ─── SPA Lobby Buttons ───
const lobbyModesEl = document.getElementById('lobby-modes');
const lobbySubmodesEl = document.getElementById('lobby-submodes');

// 홈페이지(대시보드) 이동
document.getElementById('btn-lobby-home')?.addEventListener('click', () => {
  window.location.href = '/dashboard.html';
});

// 설정창 열기
document.getElementById('btn-lobby-settings')?.addEventListener('click', () => {
  document.getElementById('settings-overlay')?.classList.remove('hidden');
});

document.getElementById('btn-campaign')?.addEventListener('click', () => {
  alert('튜토리얼은 준비 중입니다.');
});

document.getElementById('btn-normal')?.addEventListener('click', () => {
  lobbyModesEl?.classList.add('hidden');
  lobbySubmodesEl?.classList.remove('hidden');
});

document.getElementById('btn-back-lobby')?.addEventListener('click', () => {
  lobbySubmodesEl?.classList.add('hidden');
  lobbyModesEl?.classList.remove('hidden');
});

document.getElementById('btn-solo')?.addEventListener('click', () => {
  isMultiMode = false;
  showScreen('game-screen');
  startGameFromSPA(7);  // 7-7까지 진행 가능
});

document.getElementById('btn-4player')?.addEventListener('click', () => {
  isMultiMode = true;
  showScreen('match-screen');
  connectSocket();
  setupSocketListeners();
  joinQueue(`Player_${Math.random().toString(36).slice(2, 6)}`);
});

document.getElementById('btn-cancel-match')?.addEventListener('click', () => {
  cancelMatchmaking();
  leaveQueue();
  showScreen('lobby-screen');
  lobbySubmodesEl?.classList.add('hidden');
  lobbyModesEl?.classList.remove('hidden');
});

document.getElementById('btn-start-bots')?.addEventListener('click', () => {
  startWithBots();
  document.getElementById('btn-start-bots')?.classList.add('hidden');
});

// ─── Matchmaking UI ───
let matchTimers: number[] = [];
function cancelMatchmaking() {
  matchTimers.forEach(t => clearTimeout(t));
  matchTimers = [];
  for (let i = 1; i <= 3; i++) {
    const slot = document.getElementById(`mp-slot-${i}`);
    if (slot) {
      slot.className = 'match-player-slot waiting';
      slot.querySelector('.mp-avatar')!.textContent = '❓';
      slot.querySelector('.mp-name')!.textContent = '대기중...';
      slot.querySelector('.mp-status')!.textContent = '';
    }
  }
  document.getElementById('match-status')!.textContent = '1/4 대기중...';
  document.getElementById('match-loading')?.classList.add('hidden');
  document.getElementById('btn-cancel-match')?.classList.remove('hidden');
}

// ─── Socket Event Listeners ───
let socketListenersSet = false;
function setupSocketListeners() {
  if (socketListenersSet) return;
  socketListenersSet = true;

  onQueueUpdate((data: QueueUpdateData) => {
    document.getElementById('match-status')!.textContent = `${data.count}/4 대기중...`;
    isHost = data.isHost;

    const startBtn = document.getElementById('btn-start-bots');
    if (startBtn) {
      if (data.isHost && data.count >= 1) {
        startBtn.classList.remove('hidden');
        startBtn.textContent = `🤖 ${data.count}/4 - 봇 채우고 이대로 시작하기`;
      } else {
        startBtn.classList.add('hidden');
      }
    }

    for (let i = 0; i < 3; i++) {
      const slot = document.getElementById(`mp-slot-${i + 1}`);
      if (!slot) continue;
      if (i < data.count - 1) {
        slot.className = 'match-player-slot joined';
        slot.querySelector('.mp-avatar')!.textContent = '🎮';
        slot.querySelector('.mp-name')!.textContent = data.players[i + 1] || `Player ${i + 2}`;
        slot.querySelector('.mp-status')!.textContent = '✔ 준비됨';
        (slot.querySelector('.mp-status') as HTMLElement).className = 'mp-status ready';
      } else {
        slot.className = 'match-player-slot waiting';
        slot.querySelector('.mp-avatar')!.textContent = '❓';
        slot.querySelector('.mp-name')!.textContent = '대기중...';
        slot.querySelector('.mp-status')!.textContent = '';
      }
    }
  });

  onGameStart((data: GameStartData) => {
    console.log('[MP] Game starting!', data);
    mySlotIndex = data.myIndex;
    isHost = data.isHost;
    multiPlayerNames = data.players.map(p => p.name);
    botSlots = data.players.filter(p => p.isBot).map(p => p.slotIndex);

    const statusEl = document.getElementById('match-status')!;
    const loadingEl = document.getElementById('match-loading')!;
    const cancelBtn = document.getElementById('btn-cancel-match')!;
    const startBtn = document.getElementById('btn-start-bots');

    statusEl.textContent = '4/4 매칭 완료!';
    cancelBtn.classList.add('hidden');
    startBtn?.classList.add('hidden');
    matchScreenEl?.classList.add('match-shake');

    setTimeout(() => {
      matchScreenEl?.classList.remove('match-shake');
      loadingEl.classList.remove('hidden');
      statusEl.textContent = '';
      const fillEl = document.getElementById('match-loading-fill')!;
      let progress = 0;
      const loadInterval = window.setInterval(() => {
        progress += 5;
        fillEl.style.width = `${progress}%`;
        if (progress >= 100) {
          clearInterval(loadInterval);
          showScreen('game-screen');
          startMultiplayerGame(data);
        }
      }, 60);
    }, 800);
  });

  // 다른 플레이어 상태 수신 (비동기 레이싱: round 포함!)
  onSyncState((data: SyncStateData) => {
    if (data.slotIndex === mySlotIndex) return;
    const localIdx = findLocalIndex(data.slotIndex);
    if (localIdx <= 0 || localIdx >= state.players.length) return;

    const p = state.players[localIdx];
    p.hp = data.hp;
    p.gold = data.gold;
    p.level = data.level;
    p.board = data.boardUnits || [];
    p.bench = data.benchUnits || [];

    // 라운드 정보 저장
    remoteRounds.set(localIdx, { round: data.round, label: data.roundLabel });

    if (currentViewId === localIdx) render();
    renderMinimapPanel();
  });

  onPlayerDisconnected((data) => {
    const localIdx = findLocalIndex(data.slotIndex);
    if (localIdx > 0 && localIdx < state.players.length) {
      state.players[localIdx].hp = 0;
      renderMinimapPanel();
    }
  });

  // ── Speedrun Bounty: 상대방 타임어택 성공 알림 (FOMO 토스트) ──
  onTimeAttack((data) => {
    showFomoToast(`📢 ${data.playerName}님이 ${data.stage}스테이지 타임어택 보상을 차지했습니다! (${data.elapsed.toFixed(1)}s)`);
  });

  // ── Draft Room: 실시간 카드 상태 업데이트 ──
  onUpdateDraft((data) => {
    const prevCards = currentDraftCards;
    currentDraftCards = data.cards;
    renderDraftCards();

    // 내가 방금 claim한 카드가 있으면 보상 적용!
    const myName = multiPlayerNames[0] || '';
    for (const card of data.cards) {
      if (card.owner === myName) {
        // 이전에는 null이었는데 이제 내 이름이면 → 방금 claim됨
        const prev = prevCards.find(c => c.id === card.id);
        if (!prev || prev.owner === null) {
          applyDraftReward(card);
          return;
        }
      }
    }
  });

  // ── 사망/클리어 브로드캐스트 ─
  onPlayerDiedBroadcast((data) => {
    showFomoToast(`☠️ ${data.playerName}님이 ${data.round}에서 탈락했습니다!`);
    renderMinimapPanel();
  });

  onPlayerClearedBroadcast((data) => {
    showFomoToast(`🏆 ${data.playerName}님이 ${data.round} ALL CLEAR!`);
    renderMinimapPanel();
  });

  onMatchEnd((_data) => {
    console.log('[Match] Match ended, rankings:', _data.rankings);
  });
}

// ─── Multiplayer Game Start ───
function startMultiplayerGame(data: GameStartData) {
  gameStartTime = Date.now(); // ⚡ 타임어택 타이머 시작!
  currentStageId = 7;  // 멀티: 7-7까지 진행
  state.stageId = 7;
  collectedBossGrades = {};
  currentViewId = 0;

  const me = state.players[0];
  me.id = data.players[mySlotIndex].name;
  me.hp = 20; me.gold = 10; me.level = 1; me.xp = 0;
  me.board = []; me.bench = [];
  me.shop = [null, null, null, null, null];
  me.winStreak = 0; me.lossStreak = 0;

  while (state.players.length > 1) state.players.pop();
  for (let i = 0; i < 4; i++) {
    if (i === mySlotIndex) continue;
    state.players.push({
      id: data.players[i].name,
      gold: 10, level: 1, xp: 0, hp: 20,
      winStreak: 0, lossStreak: 0,
      board: [], bench: [],
      shop: [null, null, null, null, null],
      shopLocked: false, items: [], augments: [],
      unlocked7cost: [], unlocked10cost: false, freeRerolls: 0,
    });
  }

  multiPlayerNames = ['나 (' + data.players[mySlotIndex].name + ')'];
  for (let i = 0; i < 4; i++) {
    if (i === mySlotIndex) continue;
    multiPlayerNames.push(data.players[i].name);
  }

  lobbyProEl?.classList.add('hidden');
  resultViewEl?.classList.add('hidden');

  // 첫 라운드 시작 (각자 독립!)
  state.round = 0; // 리셋 (모듈 초기화 시 이미 1로 올라간 상태)
  cmd.execute(state, { type: 'END_ROUND' }); // round 0 → 1 = 1-1

  bgm.play().catch(() => { });
  render();
  renderMinimapPanel();
  updateSpectateState();
  startSyncLoop();

  // 경쟁전: 배속 버튼 잠금 표시
  const speedBtn = document.getElementById('btn-speed');
  if (speedBtn) {
    speedBtn.textContent = '🔒 1x';
    speedBtn.classList.add('speed-locked');
  }

  if (isHost && botSlots.length > 0) startBotAI();
}

function startGameFromSPA(stageId: number) {
  currentStageId = stageId;
  state.stageId = stageId;
  collectedBossGrades = {};
  lobbyProEl?.classList.add('hidden');
  resultViewEl?.classList.add('hidden');
  bgm.play().catch(() => { });
}

// ─── State Sync Loop (1초 간격) ───
function startSyncLoop() {
  stopSyncLoop();
  syncInterval = window.setInterval(() => {
    const p = player();
    const roundLabel = getStageRound(state.round);
    emitSyncState({
      slotIndex: mySlotIndex,
      hp: p.hp,
      gold: p.gold,
      level: p.level,
      round: state.round,
      roundLabel,
      boardUnits: p.board.map(u => ({
        instanceId: u.instanceId, unitId: u.unitId,
        star: u.star, position: u.position,
      })),
      benchUnits: p.bench.map(u => ({
        instanceId: u.instanceId, unitId: u.unitId, star: u.star,
      })),
    });

    // 방장: 봇 상태도 전송
    if (isHost) {
      for (const bIdx of botSlots) {
        const botLocalIdx = findLocalIndex(bIdx);
        if (botLocalIdx > 0 && botLocalIdx < state.players.length) {
          const bp = state.players[botLocalIdx];
          emitSyncState({
            slotIndex: bIdx,
            hp: bp.hp, gold: bp.gold, level: bp.level,
            round: state.round, roundLabel,
            boardUnits: bp.board.map(u => ({
              instanceId: u.instanceId, unitId: u.unitId,
              star: u.star, position: u.position,
            })),
            benchUnits: bp.bench.map(u => ({
              instanceId: u.instanceId, unitId: u.unitId, star: u.star,
            })),
          });
        }
      }
    }
  }, 1000);
}

function stopSyncLoop() {
  if (syncInterval !== null) { clearInterval(syncInterval); syncInterval = null; }
}

// ─── Slot Index Mapping ───
function findLocalIndex(serverSlot: number): number {
  if (serverSlot === mySlotIndex) return 0;
  let localIdx = 1;
  for (let s = 0; s < 4; s++) {
    if (s === mySlotIndex) continue;
    if (s === serverSlot) return localIdx;
    localIdx++;
  }
  return -1;
}

// ─── Bot AI (호스트만 실행) ───
function startBotAI() {
  stopBotAI();
  if (!isMultiMode) return;

  botAIInterval = window.setInterval(() => {
    if (!isMultiMode) { stopBotAI(); return; }

    for (let idx = 1; idx < state.players.length; idx++) {
      const ai = state.players[idx];
      if (ai.hp <= 0) continue;

      // 상점에서 구매 가능한 유닛 1개 구매
      for (let si = 0; si < 5; si++) {
        const shopId = ai.shop[si];
        if (!shopId) continue;
        const def = UNIT_MAP[shopId];
        if (def && ai.gold >= def.cost) {
          const ok = cmd.execute(state, {
            type: 'BUY_UNIT', playerId: ai.id, shopIndex: si,
          });
          if (ok) break;
        }
      }

      // 벤치→보드 랜덤 배치
      if (ai.bench.length > 0) {
        const unit = ai.bench[0];
        const emptySlots: { x: number; y: number }[] = [];
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 7; x++) {
            if (!ai.board.find(u => u.position?.x === x && u.position?.y === y)) {
              emptySlots.push({ x, y });
            }
          }
        }
        if (emptySlots.length > 0) {
          const slot = emptySlots[Math.floor(Math.random() * emptySlots.length)];
          cmd.execute(state, {
            type: 'MOVE_UNIT', playerId: ai.id,
            instanceId: unit.instanceId, to: slot,
          });
        }
      }

      // 20% XP 구매
      if (Math.random() < 0.2 && ai.gold >= 4) {
        cmd.execute(state, { type: 'BUY_XP', playerId: ai.id });
      }

      // 상점 비면 리롤
      if (ai.shop.every(s => s === null) && ai.gold >= 2) {
        cmd.execute(state, { type: 'REROLL', playerId: ai.id });
      }
    }

    if (currentViewId !== 0) render();
    renderMinimapPanel();
  }, 3500);
}

function stopBotAI() {
  if (botAIInterval !== null) { clearInterval(botAIInterval); botAIInterval = null; }
}

// ─── Speedrun Bounty UI ───

/** ⚡ 중앙 화려한 스피드런 보너스 애니메이션 */
function showSpeedrunFlash() {
  const flash = document.createElement('div');
  flash.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    font-size: 42px; font-weight: 900; color: #fbbf24;
    text-shadow: 0 0 40px #fbbf24, 0 0 80px #f59e0b, 0 0 120px #d97706,
                 0 4px 8px rgba(0,0,0,0.8);
    z-index: 10000; pointer-events: none;
    font-family: 'neodgm', monospace;
    white-space: nowrap;
    animation: speedrunFlash 2.5s ease-out forwards;
  `;
  flash.textContent = `⚡ SPEEDRUN BONUS +${SPEEDRUN_BONUS_GOLD}G ⚡`;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 3000);

  // 파티클 이펙트
  for (let i = 0; i < 20; i++) {
    const particle = document.createElement('div');
    const angle = (Math.PI * 2 * i) / 20;
    const dist = 60 + Math.random() * 100;
    particle.style.cssText = `
      position: fixed; top: 50%; left: 50%; width: 8px; height: 8px;
      background: ${['#fbbf24', '#f59e0b', '#ef4444', '#fff'][i % 4]};
      border-radius: 50%; z-index: 10001; pointer-events: none;
      transform: translate(-50%, -50%);
      animation: particleBurst 1.5s ease-out forwards;
      --dx: ${Math.cos(angle) * dist}px;
      --dy: ${Math.sin(angle) * dist}px;
    `;
    document.body.appendChild(particle);
    setTimeout(() => particle.remove(), 1600);
  }
}

/** 📢 FOMO 토스트 알림 (상단 배너) */
function showFomoToast(message: string) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    background: linear-gradient(135deg, #991b1b, #7f1d1d);
    border: 2px solid #fbbf24; border-radius: 12px;
    padding: 14px 28px; color: #fbbf24; font-size: 18px; font-weight: 900;
    z-index: 10000; text-align: center;
    box-shadow: 0 0 30px rgba(251,191,36,0.4), 0 4px 15px rgba(0,0,0,0.6);
    font-family: 'neodgm', monospace;
    animation: fomoSlideIn 0.4s ease-out, fomoFadeOut 0.5s ease-in 2.5s forwards;
    max-width: 90vw;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ─── Draft Room (비동기 선착순 드래프트) ───

let currentDraftCards: DraftCard[] = [];
let draftScreenOpen = false;

function showDraftScreen() {
  draftScreenOpen = true;
  console.log('[Draft] Opening draft screen...');

  let overlay = document.getElementById('draft-screen');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'draft-screen';
    document.body.appendChild(overlay);
  }

  // 매번 innerHTML 갱신 (포기 버튼 포함)
  overlay.innerHTML = `
    <div class="draft-inner">
      <h1 class="draft-title">🃏 선착순 보상 드래프트</h1>
      <p class="draft-subtitle">보상 카드를 하나 선택하세요! 다른 플레이어가 먼저 가져갈 수 있습니다.</p>
      <div id="draft-cards" class="draft-cards">
        <p style="color:#94a3b8;grid-column:1/-1;text-align:center;">⏳ 카드 로딩중...</p>
      </div>
      <button id="draft-skip-btn" class="draft-skip-btn">⏭️ 보상 포기하고 진행하기</button>
    </div>
  `;

  // 포기 버튼 — 소프트락 방지
  document.getElementById('draft-skip-btn')?.addEventListener('click', () => {
    console.log('[Draft] Skip button clicked — closing without reward');
    closeDraftScreen();
    afterCombatCleanup(player());
  });

  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';

  // 서버에 현재 드래프트 상태 요청
  emitGetDraft();
  console.log('[Draft] Requested draft state from server');

  // 10초 안에 응답 없으면 자동 닫기 (안전장치)
  setTimeout(() => {
    if (draftScreenOpen && currentDraftCards.length === 0) {
      console.warn('[Draft] Timeout — no cards received, auto-closing');
      closeDraftScreen();
      afterCombatCleanup(player());
    }
  }, 10000);
}

function renderDraftCards() {
  const container = document.getElementById('draft-cards');
  if (!container || !draftScreenOpen) return;

  console.log('[Draft] Rendering cards:', currentDraftCards.length, currentDraftCards);

  if (currentDraftCards.length === 0) {
    container.innerHTML = '<p style="color:#94a3b8;grid-column:1/-1;text-align:center;">⏳ 카드 로딩중...</p>';
    return;
  }

  container.innerHTML = '';

  const cardIcons: Record<string, string> = {
    gold: '💰', reroll: '🔄', hp: '💖', unit: '🎲'
  };
  const cardColors: Record<string, string> = {
    gold: '#fbbf24', reroll: '#60a5fa', hp: '#f472b6', unit: '#a78bfa'
  };

  for (const card of currentDraftCards) {
    const isClaimed = card.owner !== null;

    const el = document.createElement('button');
    el.className = `draft-card ${isClaimed ? 'claimed' : 'available'}`;
    el.style.setProperty('--card-color', cardColors[card.type] || '#94a3b8');

    el.innerHTML = `
      <div class="draft-card-icon">${cardIcons[card.type] || '🎲'}</div>
      <div class="draft-card-text">${card.text}</div>
      ${isClaimed
        ? `<div class="draft-card-owner">🔒 ${card.owner} 획득 완료</div>`
        : '<div class="draft-card-hint">클릭하여 선택</div>'}
    `;

    if (!isClaimed) {
      el.addEventListener('click', () => {
        console.log('[Draft] Claiming card:', card.id, card.text);
        emitClaimDraft(card.id, multiPlayerNames[0] || 'Player');
      });
    }

    container.appendChild(el);
  }

  // 모든 카드가 이미 선점됐으면 안내
  if (currentDraftCards.every(c => c.owner !== null)) {
    const allTaken = document.createElement('p');
    allTaken.style.cssText = 'color:#ef4444;grid-column:1/-1;text-align:center;font-size:16px;margin-top:12px;';
    allTaken.textContent = '⚠️ 모든 보상이 선점되었습니다. 아래 버튼으로 진행하세요.';
    container.appendChild(allTaken);
  }
}

function closeDraftScreen() {
  draftScreenOpen = false;
  const overlay = document.getElementById('draft-screen');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
  }
}

function applyDraftReward(card: DraftCard) {
  const p = player();
  switch (card.type) {
    case 'gold':
      p.gold += card.val;
      log(`🃏 드래프트 보상: +${card.val}G!`, 'gold');
      break;
    case 'reroll':
      p.freeRerolls += card.val;
      log(`🃏 드래프트 보상: 무료 리롤 +${card.val}회!`, 'gold');
      break;
    case 'hp':
      p.hp = Math.min(p.hp + card.val, 99);
      log(`🃏 드래프트 보상: HP +${card.val} 회복!`, 'gold');
      break;
    case 'unit': {
      // 4~5코 유닛 랜덤 지급 (벤치에 추가)
      const highCostUnits = Object.values(UNIT_MAP).filter(u => u.cost >= 4 && u.cost <= 5);
      if (highCostUnits.length > 0) {
        const pick = highCostUnits[Math.floor(Math.random() * highCostUnits.length)];
        const inst: UnitInstance = {
          instanceId: `draft_${Date.now()}`,
          unitId: pick.id,
          star: 1,
          position: undefined as any,
        };
        p.bench.push(inst);
        log(`🃏 드래프트 보상: ${pick.name} (★) 획득!`, 'gold');
      }
      break;
    }
  }
  showFomoToast(`🃏 ${card.text} 획득!`);
  closeDraftScreen();
  render();
  // 게임 재개 — 다음 라운드 진행
  afterCombatCleanup(p);
}

// ─── Multiplayer Death / Clear Screens ──────────────────────

let isDeadInMulti = false;

function applyDeathGrayscale() {
  isDeadInMulti = true;
  const app = document.getElementById('app');
  if (app) app.classList.add('multi-dead');
}

function removeDeathOverlay() {
  const overlay = document.getElementById('multi-end-overlay');
  if (overlay) overlay.remove();
}

function showMultiDeathScreen() {
  const roundLabel = getStageRound(state.round);
  const myName = multiPlayerNames[0] || 'Player';

  // 서버에 사망 알림
  emitPlayerDied(roundLabel, myName);

  // 전투 루프 중단
  inCombat = false;
  inCountdown = false;

  // 캔버스+상점 그레이스케일
  applyDeathGrayscale();

  // 팝업
  const overlay = document.createElement('div');
  overlay.id = 'multi-end-overlay';
  overlay.className = 'multi-end-overlay death';
  overlay.innerHTML = `
    <div class="multi-end-inner">
      <div class="multi-end-icon">💀</div>
      <h1 class="multi-end-title death">GAME OVER</h1>
      <p class="multi-end-round">최종 도달 라운드: <strong>${roundLabel}</strong></p>
      <p class="multi-end-note">※ 최종 순위 및 티어 점수는 매치 종료 후 자동 정산됩니다.</p>
      <div class="multi-end-buttons">
        <button id="btn-spectate" class="multi-end-btn spectate">👀 생존자 관전하기</button>
        <button id="btn-exit-lobby" class="multi-end-btn exit">🏠 로비로 나가기</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('btn-spectate')?.addEventListener('click', () => {
    removeDeathOverlay();
    // 흑백 유지 + 미니맵 관전 가능
  });

  document.getElementById('btn-exit-lobby')?.addEventListener('click', () => {
    removeDeathOverlay();
    isDeadInMulti = false;
    const app = document.getElementById('app');
    if (app) app.classList.remove('multi-dead');
    isMultiMode = false;
    disconnectSocket();
    returnToLobby();
  });
}

function showMultiClearScreen() {
  const roundLabel = getStageRound(state.round);
  const myName = multiPlayerNames[0] || 'Player';

  // 서버에 클리어 알림
  emitGameCleared(roundLabel, myName);

  // 전투 루프 중단
  inCombat = false;
  inCountdown = false;

  // 팝업 (골드 테마)
  const overlay = document.createElement('div');
  overlay.id = 'multi-end-overlay';
  overlay.className = 'multi-end-overlay clear';
  overlay.innerHTML = `
    <div class="multi-end-inner">
      <div class="multi-end-icon">🏆</div>
      <h1 class="multi-end-title clear">ALL CLEAR!</h1>
      <p class="multi-end-round">7-7 모든 스테이지 정복!</p>
      <p class="multi-end-note">※ 최종 순위 및 티어 점수는 매치 종료 후 자동 정산됩니다.</p>
      <div class="multi-end-buttons">
        <button id="btn-spectate" class="multi-end-btn spectate">👀 다른 플레이어 관전하기</button>
        <button id="btn-exit-lobby" class="multi-end-btn exit">🏠 로비로 나가기</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('btn-spectate')?.addEventListener('click', () => {
    removeDeathOverlay();
  });

  document.getElementById('btn-exit-lobby')?.addEventListener('click', () => {
    removeDeathOverlay();
    isMultiMode = false;
    disconnectSocket();
    returnToLobby();
  });
}

// ─── Minimap Panel ───
function renderMinimapPanel() {
  const container = document.getElementById('minimap-players');
  if (!container) return;
  container.innerHTML = '';

  const names = multiPlayerNames.length === 4
    ? multiPlayerNames
    : ['나 (Player 1)'];
  const avatars = ['🎮', '👑', '🐋', '🚀'];
  const playerCount = isMultiMode ? state.players.length : 1;

  for (let i = 0; i < playerCount; i++) {
    const p = state.players[i];
    if (!p) continue;

    const btn = document.createElement('button');
    btn.className = `minimap-player-btn ${i === currentViewId ? 'active' : ''} ${p.hp <= 0 ? 'eliminated' : ''}`;

    const hpPct = Math.max(0, (p.hp / 20) * 100);

    // 라운드 정보: 자신=현재 state.round, 상대=remoteRounds
    let roundText = '';
    if (i === 0) {
      roundText = `🚩 ${getStageRound(state.round)}`;
    } else {
      const rr = remoteRounds.get(i);
      roundText = rr ? `🚩 ${rr.label}` : '🚩 -';
    }

    btn.innerHTML = `
      <span class="mm-avatar">${avatars[i] || '🎮'}</span>
      <div class="mm-info">
        <div class="mm-name">${names[i] || `Player ${i + 1}`}</div>
        <div class="mm-hp-bar"><div class="mm-hp-fill" style="width:${hpPct}%"></div></div>
        <div class="mm-hp-text">❤️ ${p.hp} | ⚔️ ${p.board.length}유닛 | ${roundText}</div>
      </div>
    `;

    btn.addEventListener('click', () => {
      currentViewId = i;
      updateSpectateState();
      renderMinimapPanel();
      render();
    });

    container.appendChild(btn);
  }
}

// ─── Spectate State ───
function updateSpectateState() {
  const watermark = document.getElementById('spectate-watermark');
  const nameSpan = document.getElementById('spectate-name');
  const appElement = document.getElementById('app');

  if (currentViewId === 0) {
    watermark?.classList.add('hidden');
    appElement?.classList.remove('spectating');
  } else {
    const name = multiPlayerNames[currentViewId] ?? `Player ${currentViewId + 1}`;
    if (nameSpan) nameSpan.textContent = name;
    watermark?.classList.remove('hidden');
    appElement?.classList.add('spectating');
  }
}

// ─── Return to Lobby ───
const origReturnToLobby = returnToLobby;


// ─── BGM ──────────────────────────────────────────────────
const bgm = new Audio('/music/deongeon.mp3');
bgm.loop = true;
bgm.volume = 0.4;

// ─── 초기화 ─────────────────────────────────────────────────

const events = new EventBus();
const state = createGameState(['player1']);
const cmd = new CommandProcessor(events);
const combat = new CombatSystem(events);
preloadAllSprites(); // 스프라이트 미리 로드

// idle 애니메이션은 CSS @keyframes로 처리 (JS setInterval 제거됨)

// ─── 공격 애니메이션 동기화 루프 ───
setInterval(() => {
  const now = performance.now();
  const p = player();
  if (!p) return;
  for (const unit of p.board) {
    if (!unit.position) continue;
    // DOM 에서 해당 유닛 카드 찾기
    const card = document.querySelector(`[data-instance-id="${unit.instanceId}"]`) as HTMLElement | null;
    if (!card) continue;
    const sprite = card.querySelector('.board-icon') as HTMLElement | null;
    if (!sprite) continue;

    // .is-attacking 토글 (300ms 동안)
    const timeSinceAttack = now - (unit.lastAttackTime ?? 0);
    if (unit.lastAttackTime && timeSinceAttack < 300) {
      if (!sprite.classList.contains('is-attacking')) {
        sprite.classList.add('is-attacking');
      }
    } else {
      sprite.classList.remove('is-attacking');
    }

    // 시선 방향: 타겟 X vs 유닛 X
    if (unit.lastTargetX !== undefined && unit.position) {
      const facingLeft = unit.lastTargetX < unit.position.x;
      sprite.style.transform = facingLeft ? 'scaleX(-1)' : 'scaleX(1)';
    }

    // 💧 마나바 업데이트
    const udef = UNIT_MAP[unit.unitId];
    if (udef?.skill?.type === 'active') {
      const manaBar = card.querySelector('[data-mana-bar]') as HTMLElement | null;
      if (manaBar) {
        const maxMana = udef.maxMana ?? 100;
        const currentMana = Math.min(unit.currentMana ?? 0, maxMana);
        const pct = (currentMana / maxMana) * 100;
        manaBar.style.width = `${pct}%`;
        // 마나 거의 찬 때 밝게 발광
        if (pct >= 80) {
          manaBar.classList.add('mana-ready');
        } else {
          manaBar.classList.remove('mana-ready');
        }
      }
    }
  }
}, 50); // 20fps 충분
const synergy = new SynergySystem(events);
const player = () => state.players[0];

// ─── QA 봇용 Headless 백도어 API ─────────────────────────────
if (typeof window !== 'undefined') {
  // Time dilation (봇이 주입)
  (window as any).__TIME_SCALE__ = 1;

  // Endgame stats (게임 오버 시 채워짐)
  (window as any).__ENDGAME_STATS__ = null;

  // AI API
  (window as any).__AI_API__ = {
    buyExp: () => {
      const p = player();
      if (p.gold >= 4 && p.level < 10) {
        return cmd.execute(state, { type: 'BUY_XP', playerId: p.id });
      }
      return false;
    },
    rerollShop: () => {
      const p = player();
      if (p.freeRerolls > 0 || p.gold >= 2) {
        return cmd.execute(state, { type: 'REROLL', playerId: p.id });
      }
      return false;
    },
    buyShopItem: (shopIndex: number) => {
      const p = player();
      const shopId = p.shop[shopIndex];
      if (!shopId) return false;
      const def = UNIT_MAP[shopId];
      if (!def || p.gold < def.cost) return false;
      return cmd.execute(state, {
        type: 'BUY_UNIT', playerId: p.id, shopIndex,
      });
    },
    placeUnit: (instanceId: string, x: number, y: number) => {
      const p = player();
      return cmd.execute(state, {
        type: 'MOVE_UNIT', playerId: p.id,
        instanceId, to: { x, y },
      });
    },
    sellUnit: (instanceId: string) => {
      const p = player();
      return cmd.execute(state, {
        type: 'SELL_UNIT', playerId: p.id, instanceId,
      });
    },
    triggerCombine: () => {
      // 합성은 BUY_UNIT 시 CommandProcessor가 자동 처리
      // 여기서는 벤치+보드에서 3개 같은 유닛 찾아서 강제 합성
      const p = player();
      const all = [...p.board, ...p.bench];
      const counts: Record<string, typeof all> = {};
      for (const u of all) {
        const key = `${u.unitId}_${u.star}`;
        if (!counts[key]) counts[key] = [];
        counts[key].push(u);
      }
      let combined = false;
      for (const [, units] of Object.entries(counts)) {
        if (units.length >= 3) {
          // 같은 유닛 3개 → 합성 (sell 2개, 남은 1개가 별 올라감)
          // CommandProcessor는 BUY_UNIT 시 자동 합성하므로, 수동 트리거 불필요
          combined = true;
        }
      }
      return combined;
    },
    forceStartWave: () => {
      if (typeof startCombat === 'function') {
        startCombat();
        return true;
      }
      return false;
    },
    getState: () => {
      const p = player();
      const lvlDef = getLevelDef(p.level);
      return {
        gold: p.gold,
        level: p.level,
        xp: p.xp,
        xpNeeded: p.level >= 10 ? 0 : lvlDef.requiredXp,
        life: p.hp,
        benchCount: p.bench.length,
        boardCount: p.board.length,
        maxBoard: lvlDef.slots,
        round: state.round,
        shop: p.shop.map((id: string | null, i: number) => {
          if (!id) return null;
          const def = UNIT_MAP[id];
          return { index: i, unitId: id, name: def?.name, cost: def?.cost, origin: def?.origin };
        }),
        bench: p.bench.map((u: UnitInstance) => ({
          instanceId: u.instanceId, unitId: u.unitId,
          name: UNIT_MAP[u.unitId]?.name, star: u.star,
        })),
        board: p.board.map((u: UnitInstance) => ({
          instanceId: u.instanceId, unitId: u.unitId,
          name: UNIT_MAP[u.unitId]?.name, star: u.star,
          position: u.position,
        })),
        synergies: (p as any).activeSynergies || [],
        inCombat,
        isGameOver: p.hp <= 0,
        freeRerolls: p.freeRerolls || 0,
      };
    },
  };
}

// 게임 통계 추적
let totalGoldSpent = 0;
// (gameStartTime is set in multiplayer block above)

// ── 런 통계 (runFinish stats 전송용) ──
let runStats = {
  rerollCount: 0,
  highestStar: 1,
  synergyTiers: {} as Record<string, number>,
  totalBossKills: 0,
  xpBought: 0,
};

// 첫 상점 생성
cmd.execute(state, { type: 'END_ROUND' }); // round 0 → 1

// 선택 상태
let selectedUnit: { instanceId: string; from: 'board' | 'bench' } | null = null;
let inCombat = false;
let inCountdown = false;
let gamePaused = false;
let draggedUnit: { instanceId: string; from: 'board' | 'bench' } | null = null;

// ─── 터치 드래그앤드롭 ──────────────────────────────────────
let touchGhost: HTMLElement | null = null;
let touchSourceEl: HTMLElement | null = null;
let touchLongPressTimer: ReturnType<typeof setTimeout> | null = null;
const TOUCH_LONG_PRESS_MS = 180;

function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function touchDragStart(e: TouchEvent, unit: UnitInstance, location: 'board' | 'bench', card: HTMLElement): void {
  // 전투 중 보드 유닛은 드래그 불가
  if (inCombat && location === 'board') return;

  const touch = e.touches[0];
  const def = UNIT_MAP[unit.unitId];

  // 고스트 생성
  touchGhost = document.createElement('div');
  touchGhost.className = 'touch-dragging';
  touchGhost.style.cssText = `
    width:52px;height:52px;display:flex;align-items:center;justify-content:center;
    font-size:28px;background:var(--surface);border:2px solid var(--accent);border-radius:10px;
    box-shadow:0 4px 20px rgba(0,0,0,.4);
  `;
  touchGhost.textContent = def.emoji;
  touchGhost.style.left = `${touch.clientX}px`;
  touchGhost.style.top = `${touch.clientY}px`;
  document.body.appendChild(touchGhost);

  // 원본 반투명
  touchSourceEl = card;
  card.classList.add('touch-drag-source');

  draggedUnit = { instanceId: unit.instanceId, from: location };
  hideTooltip();
  // 터치 판매존 표시
  const defTouch = UNIT_MAP[unit.unitId];
  if (defTouch) {
    const sellMult = unit.star === 3 ? 9 : unit.star === 2 ? 3 : 1;
    showSellZone(defTouch.cost * sellMult);
  }
}

function touchDragMove(e: TouchEvent): void {
  if (!touchGhost || !draggedUnit) return;
  e.preventDefault();
  const touch = e.touches[0];
  touchGhost.style.left = `${touch.clientX}px`;
  touchGhost.style.top = `${touch.clientY}px`;

  // 드래그 오버 하이라이트
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
  const cell = el?.closest('.board-cell, .bench-slot') as HTMLElement | null;
  if (cell) cell.classList.add('drag-over');
}

function touchDragEnd(e: TouchEvent): void {
  if (!draggedUnit) {
    touchCleanup();
    return;
  }

  const touch = e.changedTouches[0];
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  const p = player();

  // 판매존에 드롭
  const sellTarget = el?.closest('#sell-zone');
  if (sellTarget) {
    const unit = [...p.board, ...p.bench].find(u => u.instanceId === draggedUnit!.instanceId);
    if (unit) {
      const def = UNIT_MAP[unit.unitId];
      if (def) {
        const isOnBoard = p.board.some(u => u.instanceId === unit.instanceId);
        if (!(inCombat && isOnBoard)) {
          const sellMult = unit.star === 3 ? 9 : unit.star === 2 ? 3 : 1;
          const sellPrice = def.cost * sellMult;
          cmd.execute(state, {
            type: 'SELL_UNIT', playerId: p.id, instanceId: unit.instanceId,
          });
          log(`판매: ${def.emoji} ${def.name} ★${unit.star} (+${sellPrice}G)`, 'green');
          selectedUnit = null;
          hideSellZone();
          touchCleanup();
          render();
          return;
        }
      }
    }
  }

  // 보드 셀에 드롭
  const boardCell = el?.closest('.board-cell') as HTMLElement | null;
  if (boardCell && !inCombat) {
    const x = parseInt(boardCell.dataset.x || '0');
    const y = parseInt(boardCell.dataset.y || '0');
    cmd.execute(state, {
      type: 'MOVE_UNIT', playerId: p.id,
      instanceId: draggedUnit.instanceId, to: { x, y },
    });
    selectedUnit = null;
    render();
  }

  // 벤치 슬롯에 드롭
  const benchSlot = el?.closest('.bench-slot') as HTMLElement | null;
  if (benchSlot && !(inCombat && draggedUnit.from === 'board')) {
    if (draggedUnit.from === 'board') {
      // board→bench: 유닛을 벤치로 이동
      cmd.execute(state, {
        type: 'BENCH_UNIT', playerId: p.id,
        instanceId: draggedUnit.instanceId,
      });
      selectedUnit = null;
      render();
    }
  }

  hideSellZone();
  touchCleanup();
}

function touchCleanup(): void {
  if (touchGhost) {
    touchGhost.remove();
    touchGhost = null;
  }
  if (touchSourceEl) {
    touchSourceEl.classList.remove('touch-drag-source');
    touchSourceEl = null;
  }
  draggedUnit = null;
  document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
  if (touchLongPressTimer) {
    clearTimeout(touchLongPressTimer);
    touchLongPressTimer = null;
  }
}

function setupTouchDrag(card: HTMLElement, unit: UnitInstance, location: 'board' | 'bench'): void {
  let startX = 0, startY = 0;
  let isDragging = false;

  card.addEventListener('touchstart', (e: TouchEvent) => {
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    isDragging = false;

    touchLongPressTimer = setTimeout(() => {
      isDragging = true;
      touchDragStart(e, unit, location, card);
    }, TOUCH_LONG_PRESS_MS);
  }, { passive: true });

  card.addEventListener('touchmove', (e: TouchEvent) => {
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - startX);
    const dy = Math.abs(touch.clientY - startY);

    // 아직 롱프레스 대기 중이면, 이동 감지 시 취소 (스크롤 허용)
    if (!isDragging && (dx > 10 || dy > 10)) {
      if (touchLongPressTimer) {
        clearTimeout(touchLongPressTimer);
        touchLongPressTimer = null;
      }
      return;
    }

    if (isDragging) {
      touchDragMove(e);
    }
  }, { passive: false });

  card.addEventListener('touchend', (e: TouchEvent) => {
    if (touchLongPressTimer) {
      clearTimeout(touchLongPressTimer);
      touchLongPressTimer = null;
    }
    if (isDragging) {
      touchDragEnd(e);
      isDragging = false;
    }
  }, { passive: true });

  card.addEventListener('touchcancel', () => {
    touchCleanup();
    isDragging = false;
  }, { passive: true });
}

// ─── 크립토 이름 매핑 ─────────────────────────────────────────
const CRYPTO_NAMES: Record<string, string> = {
  Bitcoin: '비트코인', DeFi: 'DeFi', Social: '소셜', Exchange: '거래소',
  VC: 'VC', FUD: 'FUD', Rugpull: '러그풀', Bear: '베어마켓',
};
function toCrypto(name: string): string {
  return CRYPTO_NAMES[name] || name;
}

// ─── UI 요소 ────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!;

// ─── 렌더링 ─────────────────────────────────────────────────

function render(): void {
  hideTooltip();
  renderHUD();
  renderBoard();
  renderBench();
  renderShop();
  renderSynergies();
  renderDPSPanel();
  updateButtonStates();
}

function renderHUD(): void {
  const p = player();
  const nextLvl = getLevelDef(p.level + 1);
  const xpNeeded = p.level >= 10 ? 'MAX' : `${p.xp}/${nextLvl.requiredXp}`;

  $('hud-round').textContent = `${getStageRound(state.round)}`;
  $('hud-level').textContent = `${p.level}`;
  $('hud-xp').textContent = `${xpNeeded} XP`;
  // Update XP fill bar
  const xpFill = document.getElementById('dock-xp-fill');
  if (xpFill && p.level < 10) {
    const pct = (p.xp / nextLvl.requiredXp) * 100;
    xpFill.style.width = `${Math.min(100, pct)}%`;
  } else if (xpFill) {
    xpFill.style.width = '100%';
  }
  $('hud-gold').textContent = `${p.gold}`;
  // HODL 이자 코인 스택 (10G당 1개, 최대 3개)
  let hodlContainer = document.getElementById('hodl-stacks');
  if (!hodlContainer) {
    hodlContainer = document.createElement('span');
    hodlContainer.id = 'hodl-stacks';
    hodlContainer.className = 'hodl-stacks';
    for (let i = 0; i < 3; i++) {
      const coin = document.createElement('span');
      coin.className = 'hodl-coin';
      coin.textContent = '🪙';
      hodlContainer.appendChild(coin);
    }
    $('hud-gold').parentElement?.appendChild(hodlContainer);
  }
  const litCount = Math.min(3, Math.floor(p.gold / 10));
  const coins = hodlContainer.children;
  for (let i = 0; i < 3; i++) {
    const c = coins[i] as HTMLElement;
    c.className = 'hodl-coin' + (i < litCount ? ' lit' : '') + (litCount >= 3 && i < litCount ? ' max-glow' : '');
  }
  $('hud-hp').textContent = `${p.hp}`;
  // Update HP fill bar
  const hpFill = document.getElementById('hud-hp-fill');
  if (hpFill) {
    const maxHp = 20; // STARTING_HP
    const pct = Math.max(0, Math.min(100, (p.hp / maxHp) * 100));
    hpFill.style.width = `${pct}%`;
  }
  // 연승 UI 제거됨 (내부 로직은 유지)
}

function renderBoard(): void {
  const p = player();
  const grid = $('board-grid');
  grid.innerHTML = '';
  $('board-count').textContent = `${p.board.length}/${getLevelDef(p.level).slots}`;

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 7; x++) {
      const cell = document.createElement('div');
      cell.className = 'board-cell';
      cell.dataset.x = `${x}`;
      cell.dataset.y = `${y}`;

      const unit = p.board.find(u => u.position?.x === x && u.position?.y === y);
      if (unit) {
        cell.classList.add('occupied');
        cell.appendChild(createUnitCard(unit, 'board'));

        // Hover: 사정거리 원 + 버프 범위 하이라이트
        cell.addEventListener('mouseenter', () => {
          showRangeCircle(x, y, unit);
          const def = UNIT_MAP[unit.unitId];
          const br = def?.skill?.params?.buffRange;
          if (br) {
            // 버프 범위 내 셀 하이라이트
            const cells = grid.querySelectorAll('.board-cell');
            cells.forEach(c => {
              const cx = parseInt((c as HTMLElement).dataset.x!);
              const cy = parseInt((c as HTMLElement).dataset.y!);
              const dist = Math.abs(cx - x) + Math.abs(cy - y); // 맨해튼 거리
              if (dist > 0 && dist <= br) {
                c.classList.add('buff-range');
              }
            });
          }
        });
        cell.addEventListener('mouseleave', () => {
          hideRangeCircle();
          grid.querySelectorAll('.buff-range').forEach(c => c.classList.remove('buff-range'));
        });
      }

      // Click fallback
      cell.addEventListener('click', () => {
        if (inCombat) return;
        handleBoardClick(x, y, unit);
      });

      // Drop target
      cell.addEventListener('dragover', (e) => {
        if (inCombat) return;
        e.preventDefault();
        cell.classList.add('drag-over');
        // 사정거리 원 표시
        if (draggedUnit) {
          const allUnits = [...player().board, ...player().bench];
          const dragUnit = allUnits.find(u => u.instanceId === draggedUnit!.instanceId);
          if (dragUnit) {
            showRangeCircle(x, y, dragUnit);
          }
        }
      });
      cell.addEventListener('dragleave', () => {
        cell.classList.remove('drag-over');
        hideRangeCircle();
      });
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        hideRangeCircle();
        if (inCombat || !draggedUnit) return;
        // MOVE_UNIT handles: bench→board, board→board (with swap)
        cmd.execute(state, {
          type: 'MOVE_UNIT', playerId: p.id,
          instanceId: draggedUnit.instanceId, to: { x, y },
        });
        draggedUnit = null;
        selectedUnit = null;
        render();
      });

      grid.appendChild(cell);
    }
  }
}

function renderBench(): void {
  const p = player();
  const slots = $('bench-slots');
  slots.innerHTML = '';
  $('bench-count').textContent = `${p.bench.length}/9`;

  for (let i = 0; i < 9; i++) {
    const slot = document.createElement('div');
    slot.className = 'bench-slot';
    slot.dataset.benchIdx = String(i);

    const unit = p.bench[i];
    if (unit) {
      slot.appendChild(createUnitCard(unit, 'bench'));
      // 벤치 내부 드래그 가능
      slot.draggable = true;
      slot.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('bench-swap-idx', String(i));
        slot.classList.add('dragging');
      });
      slot.addEventListener('dragend', () => {
        slot.classList.remove('dragging');
      });
      // Click fallback
      slot.addEventListener('click', () => {
        handleBenchClick(unit);
      });
    }

    // Drop target: board→bench or bench→bench reorder
    slot.addEventListener('dragover', (e) => {
      // 벤치 내부 스왑 허용
      if (e.dataTransfer?.types.includes('bench-swap-idx')) {
        e.preventDefault();
        slot.classList.add('drag-over');
        return;
      }
      if (inCombat && draggedUnit?.from === 'board') return;
      e.preventDefault();
      slot.classList.add('drag-over');
    });
    slot.addEventListener('dragleave', () => {
      slot.classList.remove('drag-over');
    });
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drag-over');

      // 벤치 내부 스왑
      const srcIdxStr = e.dataTransfer?.getData('bench-swap-idx');
      if (srcIdxStr !== undefined && srcIdxStr !== '') {
        const srcIdx = parseInt(srcIdxStr);
        const tgtIdx = i;
        if (srcIdx !== tgtIdx && srcIdx < p.bench.length) {
          // 빈 슬롯이면 이동, 유닛 있으면 교환
          const temp = p.bench[srcIdx];
          if (tgtIdx < p.bench.length) {
            p.bench[srcIdx] = p.bench[tgtIdx];
            p.bench[tgtIdx] = temp;
          } else {
            // 타겟이 빈 슬롯 — 이동만
            p.bench.splice(srcIdx, 1);
            p.bench.splice(tgtIdx > p.bench.length ? p.bench.length : tgtIdx, 0, temp);
          }
          render();
        }
        return;
      }

      // 기존: 보드 → 벤치
      if (!draggedUnit) return;
      if (draggedUnit.from === 'board') {
        if (inCombat) return;
        cmd.execute(state, {
          type: 'BENCH_UNIT', playerId: p.id,
          instanceId: draggedUnit.instanceId,
        });
      }
      draggedUnit = null;
      selectedUnit = null;
      render();
    });

    slots.appendChild(slot);
  }
}

function renderShop(): void {
  const p = player();
  const slots = $('shop-slots');
  slots.innerHTML = '';

  const lockBtn = $('btn-lock') as HTMLButtonElement;
  lockBtn.classList.toggle('locked', p.shopLocked);
  lockBtn.textContent = p.shopLocked ? t('hud.locked') : t('hud.lock');

  // 보유 유닛 카운트 (합성 감지용)
  const allUnits = [...p.board, ...p.bench];
  const star1Count: Record<string, number> = {};
  const star2Count: Record<string, number> = {};
  for (const u of allUnits) {
    if (u.star === 1) star1Count[u.unitId] = (star1Count[u.unitId] || 0) + 1;
    if (u.star === 2) star2Count[u.unitId] = (star2Count[u.unitId] || 0) + 1;
  }

  for (let i = 0; i < 5; i++) {
    const slot = document.createElement('div');
    const unitId = p.shop[i];

    if (unitId) {
      const def = UNIT_MAP[unitId];
      // const jobName = toCrypto(def.job); // 직업 시너지 비활성화
      const owned1 = star1Count[unitId] || 0;
      const owned2 = star2Count[unitId] || 0;
      const canMerge2 = owned1 >= 2; // 구매하면 ★2 합성 가능
      const canMerge3 = owned2 >= 2 && owned1 >= 2; // ★3 연쇄 합성
      slot.className = 'shop-slot cost-' + def.cost + (def.cost >= 4 ? ' jackpot-glow' : '') + (canMerge3 ? ' merge-ready-3' : canMerge2 ? ' merge-ready' : '');
      const mergeHint = canMerge3 ? '<span class="merge-badge">★★★</span>'
        : canMerge2 ? '<span class="merge-badge">★★</span>' : '';

      slot.innerHTML = `
        ${mergeHint}
        <span class="unit-emoji">${def.emoji}</span>
        <div class="shop-slot-info">
          <span class="unit-name">${def.name}</span>
          <span class="unit-origin">${toCrypto(def.origin)}</span>
          <span class="unit-cost">💰 ${def.cost}</span>
        </div>
      `;

      // 상점 유닛 호버 툴팁 (TFT 스타일)
      slot.addEventListener('mouseenter', (e) => {
        const range = def.attackRange ?? 2.5;
        const atkSpd = def.attackSpeed ?? 1.0;
        const dps = Math.floor(def.baseDmg * atkSpd);
        const skill = def.skill;
        const dict = UNIT_DICTIONARY[def.id];
        const dmgTypeIcon = def.dmgType === 'magic' ? '🔮' : '⚔️';
        const dmgTypeColor = def.dmgType === 'magic' ? '#c084fc' : '#fb923c';
        const skillTypeLabel: Record<string, string> = {
          active: '🔥 액티브', onHit: '⚔️ 적중 시', onKill: '💀 킬 시', passive: '🔵 패시브',
          periodic: '🔄 주기적', onCombatStart: '🟢 전투 시작'
        };
        const skillTypeColor: Record<string, string> = {
          active: '#f59e0b', onHit: '#fb923c', onKill: '#f87171', passive: '#60a5fa',
          periodic: '#c084fc', onCombatStart: '#4ade80'
        };

        // 스킬 상세 (사전 데이터 ★1)
        let skillSection = '';
        if (skill) {
          const star1Desc = dict?.skillDesc?.star1 ?? skill.desc;
          skillSection = `
            <div class="tt-skill">
              <div class="tt-skill-header" style="color:${skillTypeColor[skill.type] ?? '#fff'}">
                ${skillTypeLabel[skill.type] ?? skill.type} — ${skill.name}
              </div>
              <div class="tt-skill-desc">${star1Desc}${skill.cooldown ? ` (${skill.cooldown}초)` : ''}${skill.chance && skill.chance < 1 ? ` [${Math.round(skill.chance * 100)}%]` : ''}</div>
            </div>`;
        }

        // 마나 정보
        let manaLine = '';
        if (def.maxMana && skill?.type === 'active') {
          const startMana = def.startingMana ?? 0;
          manaLine = `<div class="tt-mana-label">⚡ 마나: ${startMana}/${def.maxMana}</div>`;
        }

        // 역할 1줄
        const roleLine = dict ? `<div class="tt-shop-role">${dict.role}</div>` : '';

        tooltipEl = document.createElement('div');
        tooltipEl.className = 'tooltip';
        tooltipEl.innerHTML = `
          <div class="tt-name">${def.emoji} ${def.name}</div>
          <div class="tt-meta">
            <span class="tt-cost">💰 ${def.cost}</span>
            <span class="tt-dmg-type" style="color:${dmgTypeColor}">${dmgTypeIcon}</span>
            <span class="tt-origin">${toCrypto(def.origin)}</span>
          </div>
          <div class="tt-stat-list">
            <div class="tt-stat-item">⚔️ DMG: ${def.baseDmg}</div>
            <div class="tt-stat-item">📏 사거리: ${range}</div>
            <div class="tt-stat-item">⚡ 공속: ${atkSpd}/s</div>
            <div class="tt-stat-item">💥 DPS: <span style="color:#fbbf24">${dps}</span></div>
          </div>
          ${manaLine}
          ${skillSection}
          ${roleLine}
        `;
        // 먼저 DOM에 추가하여 높이 측정
        tooltipEl.style.visibility = 'hidden';
        document.body.appendChild(tooltipEl);
        const ttRect = tooltipEl.getBoundingClientRect();
        const mx = (e as MouseEvent).clientX;
        const my = (e as MouseEvent).clientY;
        // 기본: 위쪽에 표시
        let tx = mx - ttRect.width / 2;
        let ty = my - ttRect.height - 12;
        // 위쪽 넘침 → 아래로
        if (ty < 4) ty = my + 12;
        // 좌우 넘침 보정
        if (tx < 4) tx = 4;
        if (tx + ttRect.width > window.innerWidth - 4) tx = window.innerWidth - ttRect.width - 4;
        tooltipEl.style.left = `${tx}px`;
        tooltipEl.style.top = `${ty}px`;
        tooltipEl.style.visibility = 'visible';
      });
      slot.addEventListener('mouseleave', hideTooltip);

      if (p.gold < def.cost) {
        slot.style.opacity = '0.4';
        slot.style.cursor = 'not-allowed';
      } else {
        slot.addEventListener('click', () => {
          const ok = cmd.execute(state, {
            type: 'BUY_UNIT', playerId: p.id, shopIndex: i,
          });
          if (ok) {
            totalGoldSpent += def.cost;
            log(`구매: ${def.emoji} ${def.name} (-${def.cost}G)`, 'gold');
          } else if (p.bench.length >= 9) {
            log(`❌ 벤치 꽉참! 합성 불가`, 'red');
          }
          render();
        });
      }
    } else {
      slot.className = 'shop-slot empty';
      slot.textContent = '—';
    }
    slots.appendChild(slot);
  }
}

function renderSynergies(): void {
  const p = player();
  const panel = $('synergy-list');
  panel.innerHTML = '';

  const originCount: Record<string, number> = {};

  const seenIds = new Set<string>();
  for (const unit of p.board) {
    if (seenIds.has(unit.unitId)) continue;
    seenIds.add(unit.unitId);
    const def = UNIT_MAP[unit.unitId];
    if (!def) continue;
    const oKey = `origin_${def.origin.toLowerCase()}`;
    originCount[oKey] = (originCount[oKey] || 0) + 1;
  }

  const sorted = [...SYNERGIES].sort((a, b) => {
    const countA = originCount[a.id] || 0;
    const countB = originCount[b.id] || 0;
    return countB - countA;
  });

  for (const syn of sorted) {

    const count = originCount[syn.id] || 0;
    if (count === 0) continue;

    const firstBp = syn.breakpoints[0]?.count || 999;
    const isActive = count >= firstBp;

    let activeBp = '';
    let nextBpCount = 0;
    for (const bp of syn.breakpoints) {
      if (count >= bp.count) {
        activeBp = bp.effect;
      } else if (nextBpCount === 0) {
        nextBpCount = bp.count;
      }
    }

    // 브레이크포인트 표시: 2/4/6 형식, 달성한 것은 강조
    const bpNums = syn.breakpoints.map(bp => {
      const reached = count >= bp.count;
      return reached ? `<b style="color:#fbbf24">${bp.count}</b>` : `${bp.count}`;
    }).join('/');

    const progressLabel = nextBpCount > 0 ? `${count}/${nextBpCount}` : `${count} ✔`;

    const row = document.createElement('div');
    row.className = `synergy-row ${isActive ? 'active' : 'inactive'}`;
    row.innerHTML = `
      <span class="synergy-count">${count}</span>
      <span>${syn.emoji}</span>
      <span class="synergy-name">${syn.cryptoName}</span>
      <span class="synergy-progress">(${progressLabel})</span>
      <span class="synergy-bp-nums">${bpNums}</span>
    `;

    // 시너지 호버 툴팁 — 상세 정보
    row.addEventListener('mouseenter', (e) => {
      removeHudTooltips();
      let bpHtml = `<div style="font-weight:700;margin-bottom:6px;font-size:14px">${syn.emoji} ${syn.cryptoName}</div>`;
      bpHtml += `<div style="margin-bottom:8px;font-size:11px;color:var(--muted)">타입: ${syn.type === 'origin' ? '특성' : '직업'} | 현재: ${count}체</div>`;
      for (const bp of syn.breakpoints) {
        const reached = count >= bp.count;
        bpHtml += `<div class="tt-row" style="${reached ? 'color:#fbbf24;font-weight:600' : 'color:#94a3b8'}">`;
        bpHtml += `<span class="tt-label">${reached ? '✅' : '⬜'} ${bp.count}체</span>`;
        bpHtml += `<span class="tt-value">${bp.effect}</span></div>`;
      }
      // 해당 시너지에 기여하는 유닛 목록
      const p = player();
      const contributingUnits = p.board.filter(u => {
        const uDef = UNIT_MAP[u.unitId];
        if (!uDef) return false;
        return `origin_${uDef.origin.toLowerCase()}` === syn.id;
      });
      if (contributingUnits.length > 0) {
        bpHtml += `<div style="margin-top:8px;padding-top:6px;border-top:1px solid #334155;font-size:11px;color:var(--muted)">보유 유닛:</div>`;
        bpHtml += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">`;
        for (const cu of contributingUnits) {
          const cuDef = UNIT_MAP[cu.unitId];
          if (cuDef) bpHtml += `<span style="background:#1e293b;padding:2px 6px;border-radius:4px;font-size:11px">${cuDef.emoji} ${cuDef.name} ${'⭐'.repeat(cu.star)}</span>`;
        }
        bpHtml += `</div>`;
      }
      const tip = document.createElement('div');
      tip.className = 'synergy-tooltip';
      tip.innerHTML = bpHtml;
      tip.style.cssText = `
        position: fixed;
        left: -9999px;
        top: -9999px;
        background-color: #0a0f1e;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 10px;
        padding: 12px 16px;
        font-size: 13px;
        color: #e2e8f0;
        z-index: 99999;
        pointer-events: none;
        white-space: normal;
        min-width: 280px;
        max-width: 380px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.8);
      `;
      document.body.appendChild(tip);
      // 뷰포트 클램핑
      const tr = tip.getBoundingClientRect();
      const mx = (e as MouseEvent).clientX;
      const my = (e as MouseEvent).clientY;
      let sx = mx + 12;
      let sy = my - 20;
      if (sx + tr.width > window.innerWidth - 4) sx = mx - tr.width - 4;
      if (sy < 4) sy = 4;
      if (sy + tr.height > window.innerHeight - 4) sy = window.innerHeight - tr.height - 4;
      if (sx < 4) sx = 4;
      tip.style.left = `${sx}px`;
      tip.style.top = `${sy}px`;

      // 보드 유닛 하이라이트 (시너지 매칭)
      const boardCells = document.querySelectorAll('#board-grid .board-cell');
      const pState = player();
      boardCells.forEach((cell, idx) => {
        const unit = pState.board.find(u => u.position && u.position.x * 4 + u.position.y === Math.floor(idx / 4) * 4 + idx % 4);
        // 비교 불가 → 셀 data-unit-id로 확인
        const cellEl = cell as HTMLElement;
        const unitInCell = pState.board.find(u => u.position && u.position.x === Math.floor(idx / 4) && u.position.y === idx % 4);
        if (unitInCell) {
          const uDef = UNIT_MAP[unitInCell.unitId];
          if (uDef && `origin_${uDef.origin.toLowerCase()}` === syn.id) {
            cellEl.classList.add('synergy-highlight');
            cellEl.classList.remove('synergy-dim');
          } else {
            cellEl.classList.add('synergy-dim');
            cellEl.classList.remove('synergy-highlight');
          }
        }
      });
    });
    row.addEventListener('mouseleave', () => {
      removeHudTooltips();
      // 보드 유닛 하이라이트 제거
      document.querySelectorAll('.synergy-highlight, .synergy-dim').forEach(el => {
        el.classList.remove('synergy-highlight', 'synergy-dim');
      });
    });

    panel.appendChild(row);
  }
}

// ─── DPS 계산 & 패널 ────────────────────────────────────────

/**
 * 유닛 위치에서 사거리 내 경로 커버리지 비율 계산
 * 보드(7x4) 내부에 유닛, 외곽을 몬스터가 돔
 * 둘레 총 ~20칸(2*(7+4)-4=18 변 + 보정)
 */
function getRangeCoverage(unit: UnitInstance): number {
  const def = UNIT_MAP[unit.unitId];
  if (!def) return 0;
  const range = def.attackRange ?? 2.5;
  if (!unit.position) return 0;

  const ux = unit.position.x;
  const uy = unit.position.y;
  const BOARD_W = 7, BOARD_H = 4;
  const PERIM = 2 * (BOARD_W + BOARD_H); // ~22칸 둘레

  // 둘레 노드를 순회하며 사거리 내 노드 수 카운트
  let inRange = 0;
  let total = 0;

  // 좌측 (x=-0.7, y=-0.5 ~ 3.5)
  for (let y = 0; y <= BOARD_H; y++) {
    const dx = ux - (-0.7), dy = uy - (y - 0.5);
    if (Math.sqrt(dx * dx + dy * dy) <= range) inRange++;
    total++;
  }
  // 하단 (x=-0.5~6.5, y=3.7)
  for (let x = 0; x <= BOARD_W; x++) {
    const dx = ux - (x - 0.5), dy = uy - (BOARD_H - 0.3);
    if (Math.sqrt(dx * dx + dy * dy) <= range) inRange++;
    total++;
  }
  // 우측 (x=6.7, y=3.5~-0.5)
  for (let y = BOARD_H; y >= 0; y--) {
    const dx = ux - (BOARD_W - 0.3), dy = uy - (y - 0.5);
    if (Math.sqrt(dx * dx + dy * dy) <= range) inRange++;
    total++;
  }
  // 상단 (x=6.5~-0.5, y=-0.7)
  for (let x = BOARD_W; x >= 0; x--) {
    const dx = ux - (x - 0.5), dy = uy - (-0.7);
    if (Math.sqrt(dx * dx + dy * dy) <= range) inRange++;
    total++;
  }

  return total > 0 ? inRange / total : 0;
}

function calculateUnitDPS(unit: UnitInstance, buffs?: { dmgMult: number; atkSpdMult: number; flatDmg: number; doubleHit: number; splash: number }): number {
  const def = UNIT_MAP[unit.unitId];
  if (!def) return 0;
  const starMult = STAR_MULTIPLIER[unit.star as 1 | 2 | 3] || 1;
  let dmg = def.baseDmg * starMult;
  let atkSpd = def.attackSpeed ?? 1.0;
  const skill = def.skill;

  // ── passive 스킬 보정 ──
  if (skill?.type === 'passive') {
    const sp = skill.params;
    // selfDmgPct + starBonus (HODLer)
    if (sp.selfDmgPct) dmg *= (1 + sp.selfDmgPct + (sp.starBonus ?? 0) * unit.star);
    // dmgBonus (GCR, ZachXBT)
    if (sp.dmgBonus) dmg *= (1 + sp.dmgBonus);
    // dmgMult (Anatoly 0.6)
    if (sp.dmgMult) dmg *= sp.dmgMult;
    // dmgPenalty (Jack Dorsey)
    if (sp.dmgPenalty) dmg *= (1 - sp.dmgPenalty);
    // critBonus 기대값 (Simon, Coplan)
    if (sp.critBonus) dmg *= (1 + sp.critBonus * (1.0 + (sp.critDmgBonus ?? 0)));
    // firstHitMult는 첫 타만이라 DPS에 미미 — 무시
    // atkSpdBonus (Wintermute, 메타마스크)
    if (sp.atkSpdBonus) atkSpd *= (1 + sp.atkSpdBonus);
    // atkSpdMult (Anatoly)
    if (sp.atkSpdMult) atkSpd *= sp.atkSpdMult;
  }

  // ── onHit 스킬 기대값 ──
  if (skill?.type === 'onHit') {
    const chance = skill.chance ?? 1.0;
    const sp = skill.params;
    // DMG 배수 (PerpDEX, Hsaka 등)
    if (sp.dmgMult) dmg *= (1 + chance * (sp.dmgMult - 1));
    // 크리 배수 (Hayes)
    if (sp.critMultiplier) dmg *= (1 + chance * (sp.critMultiplier - 1));
    // 더블히트 (WCT)
    if (sp.extraHits) dmg *= (1 + chance * sp.extraHits);
    // nextHitMult (Craig Wright: 25% miss → ×2) — 기대값
    if (sp.nextHitMult) dmg *= (1 - chance + chance * sp.nextHitMult) * (1 - chance);
  }

  // ── 시너지 버프 ──
  if (buffs) {
    dmg = dmg * buffs.dmgMult + buffs.flatDmg;
    atkSpd *= buffs.atkSpdMult;
    dmg *= (1 + buffs.doubleHit * 0.5);
  }

  let dps = dmg * atkSpd;

  // 다수공격 (에어드랍 시너지: splashDmg = 확률)
  if (buffs?.splash) {
    dps *= (1 + buffs.splash); // 확률만큼 추가 타겟 = DPS 증가
  }

  return dps;
}

function renderDPSPanel(): void {
  const p = player();
  const dpsList = $('dps-list');
  dpsList.innerHTML = '';

  if (p.board.length === 0) {
    dpsList.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:4px">유닛을 보드에 배치하세요</div>';
    $('hud-dps').textContent = '0';
    return;
  }

  const isCombatActive = combatStartTime > 0;
  const elapsedSec = isCombatActive ? Math.max(1, (performance.now() - combatStartTime) / 1000) : 0;

  // ── B등급 기준 DPS 계산 ──
  const nextRound = state.round;
  const isBoss = isBossRound(nextRound);
  const bTime = isBoss ? 35 : 30;   // B등급 시간 제한
  const aTime = 20;                  // A등급 시간 제한
  const sTime = 10;                  // S등급 시간 제한

  let monsterCount: number;
  if (isBoss) monsterCount = 1;
  else if (getStage(nextRound) === 1) monsterCount = nextRound === 1 ? 1 : nextRound === 2 ? 3 : 5;
  else monsterCount = 10;

  const monsterHp = isBoss
    ? Math.floor(nextRound * nextRound * 12 + nextRound * 150 + 300)
    : Math.floor(nextRound * nextRound * 0.52 + nextRound * 7.8 + 5);
  const totalHp = monsterHp * monsterCount;

  const bDPS = Math.ceil(totalHp / bTime);
  const aDPS = Math.ceil(totalHp / aTime);
  const sDPS = Math.ceil(totalHp / sTime);

  // ── 실시간 팀 DPS ──
  const totalRealDmg = p.board.reduce((s, u) => s + (u.totalDamageDealt ?? 0), 0);
  const teamDPS = isCombatActive ? Math.floor(totalRealDmg / elapsedSec) : 0;

  // 현재 등급 판정
  let curGrade: string, gradeColor: string;
  if (!isCombatActive) { curGrade = '-'; gradeColor = '#94a3b8'; }
  else if (teamDPS >= sDPS) { curGrade = 'S'; gradeColor = '#ffd700'; }
  else if (teamDPS >= aDPS) { curGrade = 'A'; gradeColor = '#43e97b'; }
  else if (teamDPS >= bDPS) { curGrade = 'B'; gradeColor = '#42a5f5'; }
  else { curGrade = 'F'; gradeColor = '#ef4444'; }

  $('hud-dps').textContent = isCombatActive ? teamDPS.toString() : bDPS.toString();

  // ── HUD DPS 호버 툴팁: 유닛별 DPS ──
  const hudDpsEl = ($('hud-dps').closest('.hud-btn') || $('hud-dps').parentElement) as HTMLElement | null;
  if (hudDpsEl) {
    // 기존 리스너 제거 + 재설정 (renderDPSPanel이 반복 호출되므로)
    const existingTip = document.getElementById('dps-hover-tip');
    if (existingTip && !(hudDpsEl as any)._hoverActive) existingTip.remove();

    if (!(hudDpsEl as any)._dpsTooltipBound) {
      (hudDpsEl as any)._dpsTooltipBound = true;
      hudDpsEl.style.cursor = 'pointer';
      hudDpsEl.addEventListener('mouseenter', () => {
        (hudDpsEl as any)._hoverActive = true;
        updateDpsTooltip(hudDpsEl as HTMLElement);
      });
      hudDpsEl.addEventListener('mouseleave', () => {
        (hudDpsEl as any)._hoverActive = false;
        document.getElementById('dps-hover-tip')?.remove();
      });
    }
    // 호버 중이면 툴팁 갱신
    if ((hudDpsEl as any)._hoverActive) {
      updateDpsTooltip(hudDpsEl as HTMLElement);
    }
  }

  function updateDpsTooltip(anchor: HTMLElement) {
    const p2 = player();
    const elapsed = isCombatActive ? Math.max(1, (performance.now() - combatStartTime) / 1000) : 1;
    const totalDmg = p2.board.reduce((s, u) => s + (u.totalDamageDealt ?? 0), 0);
    const entries = p2.board
      .filter(u => u.position && (u.totalDamageDealt ?? 0) > 0)
      .map(u => ({
        emoji: UNIT_MAP[u.unitId]?.emoji || '?',
        name: UNIT_MAP[u.unitId]?.name || u.unitId,
        star: u.star,
        dps: Math.floor((u.totalDamageDealt ?? 0) / elapsed),
        pct: totalDmg > 0 ? Math.round(((u.totalDamageDealt ?? 0) / totalDmg) * 100) : 0,
      }))
      .sort((a, b) => b.dps - a.dps);

    let tip = document.getElementById('dps-hover-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'dps-hover-tip';
      tip.style.cssText = `
        position:fixed; z-index:9999; pointer-events:none;
        background:rgba(15,10,25,0.95); border:1px solid rgba(255,255,255,0.15);
        border-radius:6px; padding:8px 12px; min-width:180px; max-width:260px;
        box-shadow:0 4px 20px rgba(0,0,0,0.6); font-size:12px; color:#e0e0e0;
      `;
      document.body.appendChild(tip);
    }
    const rect = anchor.getBoundingClientRect();
    tip.style.left = `${rect.left}px`;
    tip.style.top = `${rect.bottom + 6}px`;

    if (!isCombatActive || entries.length === 0) {
      tip.innerHTML = `<div style="color:#94a3b8;text-align:center">전투 시작 후 표시됩니다</div>`;
      return;
    }

    const rows = entries.map((e, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;${i === 0 ? 'color:#ffd700;' : ''}">
        <span>${e.emoji} ${e.name} ${'★'.repeat(e.star)}</span>
        <span style="font-weight:bold;margin-left:12px">${e.dps} <span style="opacity:0.5">(${e.pct}%)</span></span>
      </div>
    `).join('');

    tip.innerHTML = `
      <div style="font-weight:700;margin-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px">
        ⚔️ 유닛별 DPS
      </div>
      ${rows}
      <div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:4px;padding-top:4px;display:flex;justify-content:space-between;font-weight:bold">
        <span>합계</span>
        <span>${teamDPS} DPS</span>
      </div>
    `;
  }

  // ── 등급별 DPS 임계값 바 ──
  const gradeBar = document.createElement('div');
  gradeBar.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;';
  const grades = [
    { g: 'S', dps: sDPS, color: '#ffd700' },
    { g: 'A', dps: aDPS, color: '#43e97b' },
    { g: 'B', dps: bDPS, color: '#42a5f5' },
  ];
  for (const g of grades) {
    const reached = isCombatActive && teamDPS >= g.dps;
    const el = document.createElement('span');
    el.style.cssText = `padding:1px 6px;border-radius:3px;font-size:11px;font-weight:bold;
      background:${reached ? g.color : 'rgba(255,255,255,0.08)'};
      color:${reached ? '#000' : g.color};`;
    el.textContent = `${g.g} ≥${g.dps}`;
    gradeBar.appendChild(el);
  }
  dpsList.appendChild(gradeBar);

  // ── 팀 DPS 요약 ──
  const summary = document.createElement('div');
  summary.className = 'dps-total';
  if (isCombatActive) {
    summary.innerHTML = `<span style="color:${gradeColor};font-weight:bold;font-size:14px">${curGrade}</span>
      <span>실시간 DPS</span>
      <span style="font-weight:bold;color:${gradeColor}">${teamDPS}</span>`;
  } else {
    summary.innerHTML = `<span>B등급 필요</span><span style="font-weight:bold;color:#42a5f5">${bDPS} DPS</span>`;
  }
  dpsList.appendChild(summary);

  // ── 유닛별 기여도 (전투 중만) ──
  if (isCombatActive && totalRealDmg > 0) {
    const entries = p.board
      .map(u => ({
        name: UNIT_MAP[u.unitId]?.name || u.unitId,
        emoji: UNIT_MAP[u.unitId]?.emoji || '?',
        star: u.star,
        dmg: u.totalDamageDealt ?? 0,
        dps: Math.floor((u.totalDamageDealt ?? 0) / elapsedSec),
        pct: Math.round(((u.totalDamageDealt ?? 0) / totalRealDmg) * 100),
      }))
      .sort((a, b) => b.dmg - a.dmg)
      .slice(0, 5);

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.dmg === 0) continue;
      const row = document.createElement('div');
      row.className = 'dps-row';
      row.innerHTML = `
        <span class="dps-rank">#${i + 1}</span>
        <span class="dps-emoji">${e.emoji}</span>
        <span class="dps-name">${e.name} ${'⭐'.repeat(e.star)}</span>
        <span class="dps-value">${e.dps} <span style="color:#818cf8;font-size:10px">${e.pct}%</span></span>
      `;
      row.title = `DPS: ${e.dps} | 누적: ${Math.floor(e.dmg).toLocaleString()} | 기여: ${e.pct}%`;
      dpsList.appendChild(row);
    }
  }

  // ── 보스 경고 ──
  if (isBoss) {
    const bossWarn = document.createElement('div');
    bossWarn.className = 'dps-boss-warn';
    bossWarn.textContent = `⚠️ 보스! HP: ${monsterHp.toLocaleString()}`;
    dpsList.appendChild(bossWarn);
  }

  // ── 스테이지 예고 ──
  const currentStage = getStage(nextRound);
  const nextStage = currentStage < 7 ? currentStage + 1 : null;
  if (nextStage && STAGE_HINTS[nextStage]) {
    const previewEl = document.createElement('div');
    previewEl.className = 'stage-preview';
    previewEl.innerHTML = `
      <span style="color:#94a3b8;font-size:11px">다음 S${nextStage}</span>
      <span style="font-size:12px;font-weight:bold">${STAGE_HINTS[nextStage]}</span>
    `;
    dpsList.appendChild(previewEl);
  }
}

// ─── 골드 툴팁 (HUD 호버) ───────────────────────────────────

function showGoldTooltip(targetEl: HTMLElement): void {
  removeHudTooltips();
  const p = player();
  const nextRound = state.round;
  const isWarmup = getStage(nextRound) === 1;
  const base = getBaseIncome(nextRound);
  const interest = isWarmup ? 0 : getInterest(p.gold);

  // 토템 골드
  let totemGold = 0;
  const totemUnits: string[] = [];
  for (const u of p.board) {
    if (!u.position) continue;
    const uDef = UNIT_MAP[u.unitId];
    if (uDef?.skill?.type === 'passive' && uDef.skill.params.roundEndGold) {
      totemGold += uDef.skill.params.roundEndGold;
      totemUnits.push(`${uDef.emoji} ${uDef.name}`);
    }
  }

  // 등급별 색상
  const gc: Record<string, string> = { S: '#fbbf24', A: '#4ade80', B: '#60a5fa', C: '#fb923c', F: '#f87171' };

  // 전 라운드 실적 HTML
  const prev = lastRoundIncome;
  const prevSection = prev.total > 0 ? `
    <div style="font-weight:700;margin-bottom:4px">📊 전 라운드 수입</div>
    <div class="tt-row"><span class="tt-label">스테이지 보상</span><span class="tt-value gold">+${prev.stageGold}G</span></div>
    <div class="tt-row"><span class="tt-label">등급 <span style="color:${gc[prev.grade] || '#888'};font-weight:bold">${prev.grade}</span></span><span class="tt-value gold">+${prev.gradeGold}G</span></div>
    <div class="tt-row"><span class="tt-label">이자</span><span class="tt-value gold">+${prev.interestGold}G</span></div>
    <div class="tt-row"><span class="tt-label">전투 킬골드</span><span class="tt-value gold">+${prev.combatGold}G</span></div>
    ${prev.totemGold > 0 ? `<div class="tt-row"><span class="tt-label">⛏️ 채굴</span><span class="tt-value gold">+${prev.totemGold}G</span></div>` : ''}
    <div class="tt-row tt-total"><span>합계</span><span class="tt-value gold">+${prev.total}G</span></div>
    <hr class="tt-divider">
  ` : '';

  // 토템 행
  const totemRow = totemGold > 0
    ? `<div class="tt-row"><span class="tt-label">⛏️ 채굴 (${totemUnits.join(', ')})</span><span class="tt-value gold">+${totemGold}G</span></div>`
    : '';

  // 예상 등급 보너스 (전 라운드 등급 기준 예측)
  const isBossNext = isBossRound(nextRound);
  const gradeGoldTable: Record<string, number> = isBossNext
    ? { S: 5, A: 3, B: 2, C: 0, F: 0 }
    : { S: 4, A: 2, B: 1, C: 0, F: 0 };
  const prevGrade = prev.grade !== '-' ? prev.grade : 'B';
  const estGradeGold = gradeGoldTable[prevGrade] ?? 0;
  const predictedTotal = base + interest + estGradeGold + totemGold;

  const tip = document.createElement('div');
  tip.className = 'hud-tooltip gold-tooltip';
  tip.innerHTML = `
    ${prevSection}
    <div style="font-weight:700;margin-bottom:4px">💰 ${getStageRound(nextRound)} 예상 수입</div>
    <div class="tt-row"><span class="tt-label">스테이지 보상</span><span class="tt-value gold">+${base}G</span></div>
    <div class="tt-row"><span class="tt-label">등급 보너스 <span style="color:${gc[prevGrade] || '#888'};font-weight:bold">${prevGrade}</span> 기준</span><span class="tt-value gold">+${estGradeGold}G</span></div>
    <div class="tt-row"><span class="tt-label">이자 ${isWarmup ? '<span style="color:#ef4444;font-size:11px">(1-3 튜토리얼 미적용)</span>' : '<span style="color:#666;font-size:11px">(최대 30G)</span>'}</span><span class="tt-value gold">+${interest}G</span></div>
    ${totemRow}
    <hr class="tt-divider">
    <div class="tt-row tt-total"><span>예상</span><span class="tt-value gold">+${predictedTotal}G</span></div>
  `;
  targetEl.appendChild(tip);
}

// ─── 레벨 툴팁 (HUD 호버) ───────────────────────────────────

function showLevelTooltip(targetEl: HTMLElement): void {
  removeHudTooltips();
  const p = player();
  const curLevel = LEVELS.find(l => l.level === p.level);
  const nextLevel = LEVELS.find(l => l.level === p.level + 1);
  if (!curLevel) return;

  const costLabels = [t('shop.cost1'), t('shop.cost2'), t('shop.cost3'), t('shop.cost4')];
  const costClasses = ['c1', 'c2', 'c3', 'c4'];

  // 좌측: 현재 레벨 확률
  let leftHtml = `<div class="xp-tt-header">${t('shop.currentLevel')} Lv.${p.level}</div>`;
  for (let i = 0; i < 4; i++) {
    const pct = curLevel.shopOdds[i];
    leftHtml += `
      <div class="odds-row">
        <span class="odds-cost ${costClasses[i]}">${costLabels[i]}</span>
        <div class="odds-bar-bg"><div class="odds-bar-fill ${costClasses[i]}" style="width:${pct}%"></div></div>
        <span class="odds-pct">${pct}%</span>
      </div>`;
  }

  // 우측: 다음 레벨 확률 or MAX
  let rightHtml = '';
  if (nextLevel && p.level < 10) {
    rightHtml = `<div class="xp-tt-header next">${t('shop.nextLevel')} Lv.${nextLevel.level}</div>`;
    for (let i = 0; i < 4; i++) {
      const pct = nextLevel.shopOdds[i];
      const diff = pct - curLevel.shopOdds[i];
      const diffStr = diff > 0 ? `<span class="odds-diff up">+${diff}</span>` : diff < 0 ? `<span class="odds-diff down">${diff}</span>` : '';
      rightHtml += `
        <div class="odds-row">
          <span class="odds-cost ${costClasses[i]}">${costLabels[i]}</span>
          <div class="odds-bar-bg"><div class="odds-bar-fill ${costClasses[i]}" style="width:${pct}%"></div></div>
          <span class="odds-pct">${pct}%${diffStr}</span>
        </div>`;
    }
  } else {
    rightHtml = `<div class="xp-tt-max">🏆<br>MAX LEVEL<br>도달</div>`;
  }

  const tip = document.createElement('div');
  tip.className = 'level-tooltip';
  tip.innerHTML = `
    <div class="xp-tt-layout">
      <div class="xp-tt-col">${leftHtml}</div>
      <div class="xp-tt-arrow">➔</div>
      <div class="xp-tt-col">${rightHtml}</div>
    </div>
  `;
  tip.style.cssText = `
    position: fixed;
    z-index: 99999;
    background: rgba(20, 30, 55, .97);
    border: 1px solid rgba(255,255,255,.15);
    border-radius: 10px;
    padding: 12px 16px;
    font-size: 13px;
    color: #e2e8f0;
    pointer-events: none;
    box-shadow: 0 8px 32px rgba(0,0,0,.7);
    left: -9999px;
    top: -9999px;
  `;
  document.body.appendChild(tip);
  const rect = targetEl.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let tx = rect.left + rect.width / 2 - tipRect.width / 2;
  let ty = rect.top - tipRect.height - 8;
  if (ty < 4) ty = rect.bottom + 8;
  if (tx < 4) tx = 4;
  if (tx + tipRect.width > window.innerWidth - 4) tx = window.innerWidth - tipRect.width - 4;
  if (ty + tipRect.height > window.innerHeight - 4) ty = window.innerHeight - tipRect.height - 4;
  tip.style.left = `${tx}px`;
  tip.style.top = `${ty}px`;
}

function removeHudTooltips(): void {
  document.querySelectorAll('.hud-tooltip, .synergy-tooltip, .level-tooltip').forEach(el => el.remove());
}

function updateButtonStates(): void {
  const p = player();
  const rerollBtn = $('btn-reroll') as HTMLButtonElement;
  const hasFree = p.freeRerolls > 0;
  rerollBtn.disabled = !hasFree && p.gold < 2;
  rerollBtn.textContent = hasFree ? `🔄 무료 리롤 (${p.freeRerolls})` : '🔄 리롤 (2G)';

  const xpBtn = $('btn-buy-xp') as HTMLButtonElement;
  xpBtn.disabled = p.gold < 4 || p.level >= 10;

  const lockBtn = $('btn-lock') as HTMLButtonElement;
  lockBtn.disabled = false;

  const combatBtn = $('btn-next-round') as HTMLButtonElement;
  combatBtn.disabled = inCombat || inCountdown || p.board.length === 0;
  combatBtn.textContent = inCombat ? '⚔️ 전투 중...' : inCountdown ? '⏱️ 대기 중...' : '⚔️ 전투 시작';
}

// ─── 유닛 카드 ──────────────────────────────────────────────

function createUnitCard(unit: UnitInstance, location: 'board' | 'bench'): HTMLElement {
  const def = UNIT_MAP[unit.unitId];
  const card = document.createElement('div');
  card.className = `unit-card cost-${def.cost}`;
  if (location === 'board') card.classList.add('on-board');
  card.dataset.instanceId = unit.instanceId;
  if (selectedUnit?.instanceId === unit.instanceId) card.classList.add('selected');

  // 코스트별 글로우 이펙트
  const glow = COST_GLOW_SHADOW[def.cost];
  if (glow) card.style.boxShadow = glow;

  const stars = '⭐'.repeat(unit.star);

  if (location === 'board') {
    // 보드: 스프라이트만 (별/코스트 숨김) + idle 애니메이션 + 마나바
    const spriteInfo = getUnitSpriteInfo(unit.unitId, def.origin, def.cost);
    const ss = getUnitSpriteSheet(unit.unitId, def.origin, def.cost);
    const hasMana = def.skill?.type === 'active';
    const manaBarHtml = hasMana
      ? `<div class="mana-bar-wrap"><div class="mana-bar-fill" data-mana-bar></div></div>`
      : '';
    card.innerHTML = `<div class="unit-sprite-icon board-icon" data-cols="${ss.cols}" style="background-image:url('${spriteInfo.url}');background-size:${spriteInfo.bgSize}"></div>${manaBarHtml}`;
  } else {
    // 벤치: 이모지 + 이름
    card.innerHTML = `<span class="unit-emoji">${def.emoji}</span><span class="name">${def.name}</span><span class="star">${stars}</span><span class="cost-badge">${def.cost}</span>`;
  }

  // Drag support
  card.draggable = true;
  card.addEventListener('dragstart', (e) => {
    // 전투 중에는 보드 유닛 드래그 불가
    if (inCombat && location === 'board') {
      e.preventDefault();
      return;
    }
    draggedUnit = { instanceId: unit.instanceId, from: location };
    hideTooltip();
    // 판매존 표시
    const sellMult = unit.star === 3 ? 9 : unit.star === 2 ? 3 : 1;
    showSellZone(def.cost * sellMult);

    // 커스텀 드래그 이미지 (잔영 방지)
    const ghost = document.createElement('div');
    ghost.style.cssText = 'width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:24px;background:#1e293b;border:2px solid #3b82f6;border-radius:8px;position:absolute;top:-9999px;left:-9999px;';
    ghost.textContent = def.emoji;
    document.body.appendChild(ghost);
    e.dataTransfer!.setDragImage(ghost, 20, 20);
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', unit.instanceId);

    // 원본 반투명 처리 (약간의 딜레이 필요)
    requestAnimationFrame(() => {
      card.classList.add('dragging');
    });

    // ghost 정리
    setTimeout(() => ghost.remove(), 0);
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    draggedUnit = null;
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    hideSellZone();
  });

  if (location === 'bench') {
    // 벤치: 기존처럼 호버 툴팁
    card.addEventListener('mouseenter', (e) => { hoveredUnit = unit; showTooltip(e as MouseEvent, unit); });
    card.addEventListener('mouseleave', () => { hoveredUnit = null; hideTooltip(); });
  } else {
    // 보드: 호버 시 hoveredUnit만 트래킹 (E키 판매용)
    card.addEventListener('mouseenter', () => { hoveredUnit = unit; });
    card.addEventListener('mouseleave', () => { hoveredUnit = null; });
  }

  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showUnitInfoPanel(unit, e as MouseEvent);
  });

  // 터치 드래그 지원
  setupTouchDrag(card, unit, location);

  return card;
}

// ─── 인터랙션 (Click fallback) ───────────────────────────────

function handleBenchClick(unit: UnitInstance): void {
  if (selectedUnit?.instanceId === unit.instanceId) {
    selectedUnit = null;
  } else {
    selectedUnit = { instanceId: unit.instanceId, from: 'bench' };
    log(`선택: ${UNIT_MAP[unit.unitId].emoji} ${UNIT_MAP[unit.unitId].name}`, 'blue');
  }
  render();
}

function handleBoardClick(x: number, y: number, existing?: UnitInstance): void {
  const p = player();
  if (selectedUnit) {
    if (existing && selectedUnit.from === 'board' && selectedUnit.instanceId === existing.instanceId) {
      // 보드 유닛 다시 클릭 → 벤치로 복귀
      cmd.execute(state, {
        type: 'BENCH_UNIT', playerId: p.id,
        instanceId: selectedUnit.instanceId,
      });
      log(`벤치로 복귀`, 'blue');
      selectedUnit = null;
    } else {
      // 이동 or 스왑
      const success = cmd.execute(state, {
        type: 'MOVE_UNIT', playerId: p.id,
        instanceId: selectedUnit.instanceId, to: { x, y },
      });
      if (success) log(`배치: (${x},${y})`, 'blue');
      selectedUnit = null;
    }
  } else if (existing) {
    selectedUnit = { instanceId: existing.instanceId, from: 'board' };
    log(`선택: ${UNIT_MAP[existing.unitId].emoji} (보드)`, 'blue');
  }
  render();
}

// ─── 전투 (실제 CombatSystem) ───────────────────────────────

function startCombat(): void {
  // 준비 타이머 정리
  if ((window as any).__prepInterval) {
    clearInterval((window as any).__prepInterval);
    (window as any).__prepInterval = null;
  }
  const tb = (window as any).__prepTimerBar as HTMLElement | null;
  if (tb) tb.style.display = 'none';

  const p = player();

  // ── 런 통계: 시너지 스냅샷 (매 전투 시작마다 최고치 갱신) ──
  const seenIds = new Set<string>();
  const originCount: Record<string, number> = {};
  for (const unit of p.board) {
    if (seenIds.has(unit.unitId)) continue;
    seenIds.add(unit.unitId);
    const def = UNIT_MAP[unit.unitId];
    if (!def) continue;
    const oKey = def.origin;
    originCount[oKey] = (originCount[oKey] || 0) + 1;
  }
  for (const [origin, count] of Object.entries(originCount)) {
    if (!runStats.synergyTiers[origin] || count > runStats.synergyTiers[origin]) {
      runStats.synergyTiers[origin] = count;
    }
  }

  // 전투 시작 전 자동 배치: 보드에 빈 슬롯이 있으면 벤치에서 자동으로 합류
  const maxSlots = LEVELS.find(l => l.level === p.level)?.slots ?? 1;
  const initialBoardCount = p.board.length;
  while (p.board.length < maxSlots && p.bench.length > 0) {
    const unit = p.bench.shift()!; // 벤치 맨 위부터
    // 빈 보드 위치 찾기
    const occupied = new Set(p.board.map(u => `${u.position?.x},${u.position?.y}`));
    let placed = false;
    for (let y = 0; y < 4 && !placed; y++) {
      for (let x = 0; x < 7 && !placed; x++) {
        if (!occupied.has(`${x},${y}`)) {
          unit.position = { x, y };
          p.board.push(unit);
          placed = true;
        }
      }
    }
  }

  const autoDeployed = p.board.length - initialBoardCount;
  if (autoDeployed > 0) {
    log(`🎯 벤치에서 ${autoDeployed}개 유닛 자동 배치`, 'blue');
    render();
  }

  if (p.board.length === 0) {
    log('⚠️ 보드에 유닛이 없습니다!', 'red');
    return;
  }

  inCombat = true;
  state.phase = 'combat' as any;
  updateButtonStates();
  $('board-section').classList.add('combat-active');

  // 시너지 버프 계산
  const activeSynergies = synergy.calculateSynergies(p);
  const buffs = synergy.calculateBuffs(activeSynergies);
  const activeCount = activeSynergies.filter(s => s.activeLevel >= 0).length;
  log(`⚔️ 전투 시작! 시너지: ${activeCount}개 활성`, 'red');

  // 몬스터 정보 로그
  const round = state.round;
  const isBoss = isBossRound(round);
  let mCount: number;
  if (isBoss) mCount = 1;
  else if (getStage(round) === 1) mCount = round === 1 ? 1 : round === 2 ? 3 : 5;
  else mCount = 10;
  const mHp = isBoss
    ? Math.floor(round * round * 2.5 + round * 80 + 200)
    : Math.floor(round * round * 0.25 + round * 5 + 5);
  log(`👾 ${isBoss ? '⭐보스' : '몬스터'} ×${mCount} | HP: ${mHp} | 속도: ${(1.2 + round * 0.012).toFixed(2)}`, 'blue');

  // 전투 시작
  combatStartTime = performance.now();
  lastDpsUpdate = 0;

  // 셀 비율 계산: range circle(avgCellSize 원) ↔ 전투 판정 동기화
  {
    const mapWrapper = document.getElementById('map-wrapper');
    const grid = $('board-grid');
    if (mapWrapper && grid) {
      const { cellW, cellH, gridOffsetX, gridOffsetY } = getGridCoords(mapWrapper, grid);
      const monsterPath = document.getElementById('monster-path');
      let trackLeft: number, trackTop: number, trackW: number, trackH: number;
      if (monsterPath) {
        const s = currentScale;
        const pr = monsterPath.getBoundingClientRect();
        const wr = mapWrapper.getBoundingClientRect();
        const pathLeft = (pr.left - wr.left) / s;
        const pathTop = (pr.top - wr.top) / s;
        const pathRight = pathLeft + pr.width / s;
        const pathBottom = pathTop + pr.height / s;
        const gridRight = gridOffsetX + cellW * 7;
        const gridBottom = gridOffsetY + cellH * 4;
        // 60/40 비율 (renderCombatOverlay와 동일)
        trackLeft = pathLeft * 0.6 + gridOffsetX * 0.4;
        trackTop = pathTop * 0.6 + gridOffsetY * 0.4;
        const trackRight = pathRight * 0.6 + gridRight * 0.4;
        const trackBottom = pathBottom * 0.6 + gridBottom * 0.4;
        trackW = trackRight - trackLeft;
        trackH = trackBottom - trackTop;
      } else {
        trackLeft = gridOffsetX - cellW * 0.7;
        trackTop = gridOffsetY - cellH * 0.7;
        trackW = cellW * 8.4;
        trackH = cellH * 5.4;
      }
      combat.setLayout({ gridOffsetX, gridOffsetY, cellW, cellH, trackLeft, trackTop, trackW, trackH });
    }
  }

  combat.startCombat(
    state,
    p,
    buffs,
    // 렌더 콜백 (매 프레임)
    (combatState: CombatState) => {
      renderCombatOverlay(combatState);
      // 250ms 간격 DPS 패널 갱신
      const now = performance.now();
      if (now - lastDpsUpdate > 250) {
        lastDpsUpdate = now;
        renderDPSPanel();
      }
    },
    // 완료 콜백
    (result: CombatResult) => {
      combatStartTime = 0;
      onCombatComplete(result);
    },
  );
}

function renderCombatOverlay(cs: CombatState): void {
  // 기존 오버레이 제거 후 재생성
  const mapWrapper = document.getElementById('map-wrapper');
  if (!mapWrapper) return;

  let overlay = document.getElementById('combat-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'combat-overlay';
    mapWrapper.appendChild(overlay);
  }
  // 고성능 DOM 배치: fragment에 모아서 한번에 붙임
  while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  const frag = document.createDocumentFragment();

  // getBoundingClientRect÷scale = 정확한 논리좌표 (border/padding/scale 무관)
  const grid = $('board-grid');
  const { gridOffsetX, gridOffsetY, cellW, cellH } = getGridCoords(mapWrapper, grid);

  // 보라색 트랙 중심선 계산: #monster-path와 #board-grid 사이의 중점
  const monsterPath = document.getElementById('monster-path');
  let trackLeft: number, trackTop: number, trackRight: number, trackBottom: number;
  if (monsterPath) {
    const s = currentScale;
    const pr = monsterPath.getBoundingClientRect();
    const wr = mapWrapper.getBoundingClientRect();
    const pathLeft = (pr.left - wr.left) / s;
    const pathTop = (pr.top - wr.top) / s;
    const pathRight = pathLeft + pr.width / s;
    const pathBottom = pathTop + pr.height / s;
    const gridRight = gridOffsetX + cellW * 7;
    const gridBottom = gridOffsetY + cellH * 4;
    // 트랙 중심 = path 쪽으로 60%, grid 쪽으로 40% (조금 넓게 공전)
    trackLeft = pathLeft * 0.6 + gridOffsetX * 0.4;
    trackTop = pathTop * 0.6 + gridOffsetY * 0.4;
    trackRight = pathRight * 0.6 + gridRight * 0.4;
    trackBottom = pathBottom * 0.6 + gridBottom * 0.4;
  } else {
    // fallback: grid 기준 1셀 바깥
    trackLeft = gridOffsetX - cellW * 0.7;
    trackTop = gridOffsetY - cellH * 0.7;
    trackRight = gridOffsetX + cellW * 7.7;
    trackBottom = gridOffsetY + cellH * 4.7;
  }
  // 논리좌표 (0~8, 0~5) → 트랙 중심선 좌표
  const trackW = trackRight - trackLeft;
  const trackH = trackBottom - trackTop;
  const toPixelX = (lx: number) => trackLeft + (lx / 8) * trackW;
  const toPixelY = (ly: number) => trackTop + (ly / 5) * trackH;
  const nowMs = performance.now();

  for (const m of cs.monsters) {
    // 죽은 몬스터: deathTime 기록 + 0.5초 동안 데스 모션 표시
    const isDead = !m.alive;
    if (isDead) {
      if (!(m as any)._deathTime) (m as any)._deathTime = nowMs;
      if (nowMs - (m as any)._deathTime > 500) continue; // 0.5초 후 렌더 중단
    }
    const pos = getPositionOnPath(m.pathProgress);
    const el = document.createElement('div');
    // 피격 플래시: 최근 150ms 이내 피격이면 hit 클래스 추가
    const isHit = m.hitTime && (nowMs - m.hitTime) < 150;
    el.className = `monster ${m.isBoss ? 'boss' : ''} ${isHit ? 'hit' : ''}`;

    // HP 바
    const hpPct = Math.max(0, m.hp / m.maxHp * 100);

    // 스프라이트 시트: skeleton walk — 1024×128, 8프레임 가로 나열
    const FRAME_W = 128;  // 1024 / 8 = 128
    const FRAME_H = 128;  // 시트 높이 = 1행
    // 일반 몬스터 0.5배, 보스 0.9배
    const spriteScale = m.isBoss ? 0.9 : 0.5;
    const displayW = Math.round(FRAME_W * spriteScale);
    const displayH = Math.round(FRAME_H * spriteScale);

    // 걷기 애니메이션: 8프레임
    const row = 0;
    const totalFrames = 8;
    const monsterOffset = cs.monsters.indexOf(m) * 2;
    const frameIdx = Math.floor(((nowMs + monsterOffset * 120) / 120) % totalFrames);

    // 정수 좌표 — pixel snapping
    const bgX = Math.round(frameIdx * FRAME_W * spriteScale);
    const bgY = Math.round(row * FRAME_H * spriteScale);
    const sheetW = Math.round(1024 * spriteScale);
    const sheetH = Math.round(128 * spriteScale);

    // 스테이지별 색상: 1스테이지(튜토리얼)=하얀색, 2스테이지부터 빨주노초파남보, 보스=검정
    const STAGE_COLORS: number[] = [
      240,   // 빨 (Stage 2)
      270,   // 주 (Stage 3)
      300,   // 노 (Stage 4)
      0,     // 초 (Stage 5, 기본 녹색)
      120,   // 파 (Stage 6)
      160,   // 남 (Stage 7)
      190,   // 보 (Stage 8+)
    ];
    const currentStage = getStage(state.round);
    let spriteFilter: string;
    if (m.isBoss) {
      // 보스: 검정 (brightness 0.1 + contrast)
      spriteFilter = 'brightness(0.15) contrast(1.5) drop-shadow(0 0 6px rgba(0,0,0,.8))';
    } else if (currentStage <= 1) {
      // 튜토리얼 (1스테이지): 하얀색
      spriteFilter = 'grayscale(1) brightness(2) drop-shadow(0 0 4px rgba(255,255,255,.5))';
    } else {
      // 2스테이지부터 빨주노초파남보
      const colorIdx = (currentStage - 2) % STAGE_COLORS.length;
      const hueRotate = STAGE_COLORS[colorIdx];
      spriteFilter = `hue-rotate(${hueRotate}deg) saturate(1.3) drop-shadow(0 0 4px rgba(0,0,0,.5))`;
    }
    // 진행 방향 감지: 현재 위치 vs 직전 위치
    const prevPos = getPositionOnPath(Math.max(0, m.pathProgress - 0.005));
    const facingLeft = pos.px < prevPos.px;

    el.innerHTML = `
      <div class="monster-hp-bar"><div class="monster-hp-fill" style="width:${hpPct}%"></div></div>
      <div class="monster-sprite ${isDead ? 'is-dead' : ''}" style="
        width:${displayW}px; height:${displayH}px;
        background-image:url('/assets/monsters/Skeleton/skeleton-variation1-walk.png');
        background-size:${sheetW}px ${sheetH}px;
        background-position:-${bgX}px -${bgY}px;
        image-rendering:pixelated;
        filter: ${spriteFilter};
        transform: scaleX(${facingLeft ? -1 : 1});
      "></div>
    `;

    // 위치: 외곽 트랙 기준, 타일 정중앙
    el.style.left = `${Math.round(toPixelX(pos.px))}px`;
    el.style.top = `${Math.round(toPixelY(pos.py))}px`;

    // 스폰 페이드인: 처음 300ms 동안 opacity 0→1
    if (m.spawnTime) {
      const age = nowMs - m.spawnTime;
      if (age < 300) {
        el.style.opacity = `${Math.min(1, age / 300)}`;
      }
    }

    frag.appendChild(el);
  }

  // ── 투사체 렌더 ──
  for (const proj of cs.projectiles) {
    const t = Math.min((nowMs - proj.startTime) / proj.duration, 1.0);
    // fromX/Y = 보드 좌표 (0~6, 0~3), toX/Y = 외곽 그리드 좌표 (0~8, 0~5)
    const fromPx = gridOffsetX + (proj.fromX + 0.5) * cellW;
    const fromPy = gridOffsetY + (proj.fromY + 0.5) * cellH;
    const toPx = toPixelX(proj.toX);
    const toPy = toPixelY(proj.toY);
    const bx = fromPx + (toPx - fromPx) * t;
    const by = fromPy + (toPy - fromPy) * t;
    const bullet = document.createElement('div');
    bullet.className = 'projectile';
    bullet.style.left = `${bx}px`;
    bullet.style.top = `${by}px`;
    frag.appendChild(bullet);
  }

  // ── 이펙트 렌더 (Unity: type별 VFX Prefab 매핑) ──
  for (const fx of cs.effects) {
    const progress = (nowMs - fx.startTime) / fx.duration; // 0~1
    if (progress >= 1) continue;

    const el = document.createElement('div');
    // 모든 이펙트는 경로좌표(0~8, 0~5)로 생성 → toPixelX/Y로 통일
    const fxX = toPixelX(fx.x);
    const fxY = toPixelY(fx.y);

    if (fx.type === 'damage' || fx.type === 'crit') {
      // 데미지 숫자 — 위로 떠오르며 사라짐
      el.className = fx.type === 'crit' ? 'fx-crit' : 'fx-damage';
      const val = fx.value ?? 0;
      // 크릿 시 LIQUIDATED 연출 + 스크린 쉐이크
      if (fx.type === 'crit' && progress < 0.05) {
        el.textContent = val >= 50 ? `${val} LIQUIDATED!` : `${val}💥`;
        const wrapper = document.getElementById('game-scale-wrapper') || document.getElementById('logical-wrapper');
        if (wrapper && !wrapper.classList.contains('screen-shake')) {
          wrapper.classList.add('screen-shake');
          setTimeout(() => wrapper.classList.remove('screen-shake'), 200);
        }
      } else {
        el.textContent = val.toString();
      }
      const floatY = fxY - progress * 30; // 위로 30px 이동
      el.style.left = `${fxX}px`;
      el.style.top = `${floatY}px`;
      el.style.opacity = `${1 - progress * 0.8}`;
      frag.appendChild(el);

      // 크리티컬에만 스프라이트 버스트
      if (fx.type === 'crit') {
        const sprite = document.createElement('div');
        sprite.className = 'fx-sprite-burst';
        const spriteSize = 48 + progress * 16;
        sprite.style.left = `${fxX}px`;
        sprite.style.top = `${fxY}px`;
        sprite.style.width = `${spriteSize}px`;
        sprite.style.height = `${spriteSize}px`;
        sprite.style.opacity = `${1 - progress}`;
        // 스프라이트 시트 프레임 선택 (6열 × 8행 기준, 프레임 64×64)
        const col = (fx.frameIndex ?? 0) % 6;
        const row = Math.floor((fx.frameIndex ?? 0) / 6);
        sprite.style.backgroundPosition = `-${col * 64}px -${row * 64}px`;
        frag.appendChild(sprite);
      }
    } else if (fx.type === 'death') {
      // 사망 폭발 — 스프라이트 시트 애니메이션
      el.className = 'fx-death';
      const deathSize = 40 + progress * 20;
      el.style.left = `${fxX}px`;
      el.style.top = `${fxY}px`;
      el.style.width = `${deathSize}px`;
      el.style.height = `${deathSize}px`;
      el.style.opacity = `${1 - progress * progress}`; // ease out
      // 프레임 진행에 따라 스프라이트 시트 애니메이트
      const frameCount = 6;
      const currentFrame = Math.min(Math.floor(progress * frameCount), frameCount - 1);
      const col = (fx.frameIndex ?? 0) + currentFrame;
      el.style.backgroundPosition = `-${(col % 10) * 64}px -${Math.floor(col / 10) * 64}px`;
      frag.appendChild(el);
    } else if (fx.type === 'boss_warning') {
      // 보스 경고 — 전체 화면 플래시
      el.className = 'fx-boss-warn';
      el.textContent = '⚠️ BOSS ⚠️';
      el.style.opacity = `${1 - progress}`;
      frag.appendChild(el);

      // ═══ 스킬 이펙트 렌더링 ═══
    } else if (fx.type === 'skill_explosion') {
      // 💥 폭발 — 빨간 원형 확산
      const size = 20 + progress * 60;
      el.style.cssText = `
        position:absolute; left:${fxX - size / 2}px; top:${fxY - size / 2}px;
        width:${size}px; height:${size}px; border-radius:50%;
        background:radial-gradient(circle, rgba(255,80,50,${0.8 - progress * 0.8}) 0%, rgba(255,160,0,${0.4 - progress * 0.4}) 60%, transparent 100%);
        box-shadow:0 0 ${10 + progress * 20}px rgba(255,100,0,${0.6 - progress * 0.6});
        pointer-events:none;
      `;
      frag.appendChild(el);

    } else if (fx.type === 'skill_lightning' || fx.type === 'skill_chain') {
      // ⚡ 번개/체인 — 시안/노란 전기 버스트 + 글로우 링
      const isChain = fx.type === 'skill_chain';
      const color = isChain ? '#00e5ff' : '#ffeb3b';
      const glowColor = isChain ? '0,229,255' : '255,235,59';
      // 번개 버스트: 빠른 확산 후 페이드
      const burstSize = 10 + progress * 50;
      const ringSize = 20 + progress * 70;
      el.style.cssText = `
        position:absolute; left:${fxX}px; top:${fxY}px;
        width:0; height:0; pointer-events:none;
      `;
      // 내부 글로우
      const burst = document.createElement('div');
      burst.style.cssText = `
        position:absolute; left:${-burstSize / 2}px; top:${-burstSize / 2}px;
        width:${burstSize}px; height:${burstSize}px; border-radius:50%;
        background:radial-gradient(circle, ${color} 0%, rgba(${glowColor},0.6) 40%, transparent 80%);
        box-shadow:0 0 ${15 + progress * 25}px rgba(${glowColor},${0.9 - progress * 0.9}),
                   0 0 ${5 + progress * 10}px white;
        opacity:${1 - progress * progress};
      `;
      el.appendChild(burst);
      // 외부 링
      const ring = document.createElement('div');
      ring.style.cssText = `
        position:absolute; left:${-ringSize / 2}px; top:${-ringSize / 2}px;
        width:${ringSize}px; height:${ringSize}px; border-radius:50%;
        border:2px solid rgba(${glowColor},${0.7 - progress * 0.7});
        box-shadow:0 0 ${8}px rgba(${glowColor},${0.4 - progress * 0.4});
        opacity:${1 - progress};
      `;
      el.appendChild(ring);
      frag.appendChild(el);

    } else if (fx.type === 'skill_sniper') {
      // 🎯 저격 — 하얀 레이저 빔 효과
      const size = 16 + progress * 8;
      el.style.cssText = `
        position:absolute; left:${fxX - size / 2}px; top:${fxY - size / 2}px;
        width:${size}px; height:${size}px; border-radius:50%;
        background:radial-gradient(circle, rgba(255,255,255,${0.9 - progress * 0.9}) 0%, rgba(100,180,255,${0.5 - progress * 0.5}) 70%, transparent 100%);
        box-shadow:0 0 ${15 + progress * 10}px rgba(100,180,255,${0.8 - progress * 0.8});
        pointer-events:none;
      `;
      frag.appendChild(el);

    } else if (fx.type === 'skill_stun') {
      // 💫 스턴 — 노란 별 회전
      const rotDeg = progress * 360;
      el.style.cssText = `
        position:absolute; left:${fxX - 12}px; top:${fxY - 20}px;
        font-size:${16 + progress * 6}px; transform:rotate(${rotDeg}deg);
        text-shadow:0 0 8px rgba(255,215,0,0.8);
        opacity:${1 - progress}; pointer-events:none;
      `;
      el.textContent = '💫';
      frag.appendChild(el);

    } else if (fx.type === 'skill_aoe') {
      // 🌀 광역 — 주황 원형 파동
      const size = 30 + progress * 80;
      el.style.cssText = `
        position:absolute; left:${fxX - size / 2}px; top:${fxY - size / 2}px;
        width:${size}px; height:${size}px; border-radius:50%;
        border:2px solid rgba(255,165,0,${0.7 - progress * 0.7});
        background:radial-gradient(circle, rgba(255,165,0,${0.15 - progress * 0.15}) 0%, transparent 70%);
        pointer-events:none;
      `;
      frag.appendChild(el);

    } else if (fx.type === 'skill_buff') {
      // 💚 버프 — 녹색 상승 파티클
      const floatY = fxY - progress * 25;
      const size = 20 + Math.sin(progress * Math.PI) * 15;
      el.style.cssText = `
        position:absolute; left:${fxX - size / 2}px; top:${floatY - size / 2}px;
        width:${size}px; height:${size}px; border-radius:50%;
        background:radial-gradient(circle, rgba(100,255,150,${0.5 - progress * 0.5}) 0%, transparent 70%);
        box-shadow:0 0 ${6 + progress * 8}px rgba(100,255,150,${0.4 - progress * 0.4});
        pointer-events:none;
      `;
      frag.appendChild(el);

    } else if (fx.type === 'skill_gold') {
      // 💰 골드 — 금색 반짝
      const floatY = fxY - progress * 20;
      el.style.cssText = `
        position:absolute; left:${fxX - 10}px; top:${floatY}px;
        font-size:${18 - progress * 4}px;
        text-shadow:0 0 10px rgba(255,215,0,0.9);
        opacity:${1 - progress}; pointer-events:none;
      `;
      el.textContent = '💰';
      frag.appendChild(el);

    } else if (fx.type === 'skill_execute') {
      // 💀 처형 — 빨간 해골
      const size = 20 + Math.sin(progress * Math.PI) * 12;
      el.style.cssText = `
        position:absolute; left:${fxX - size / 2}px; top:${fxY - size / 2 - 5}px;
        font-size:${size}px; text-align:center;
        text-shadow:0 0 12px rgba(255,0,0,0.8);
        opacity:${1 - progress * 0.7}; pointer-events:none;
      `;
      el.textContent = '💀';
      frag.appendChild(el);

    } else if (fx.type === 'skill_blackhole') {
      // 🕳️ 블랙홀 — 보라색 소용돌이 + 검은 원
      const size = 40 + progress * 60;
      const rotDeg = progress * 720; // 2바퀴 회전
      el.style.cssText = `
        position:absolute; left:${fxX - size / 2}px; top:${fxY - size / 2}px;
        width:${size}px; height:${size}px; border-radius:50%;
        background:radial-gradient(circle, rgba(20,0,40,${0.9 - progress * 0.9}) 0%, rgba(100,0,200,${0.5 - progress * 0.5}) 50%, transparent 100%);
        box-shadow:0 0 ${20 + progress * 30}px rgba(150,0,255,${0.7 - progress * 0.7}), inset 0 0 ${10 + progress * 15}px rgba(0,0,0,0.8);
        transform:rotate(${rotDeg}deg);
        pointer-events:none;
      `;
      frag.appendChild(el);

    } else if (fx.type === 'freeze') {
      // ❄️ 빙결 — 파란 결정
      const size = 20 + Math.sin(progress * Math.PI) * 15;
      el.style.cssText = `
        position:absolute; left:${fxX - size / 2}px; top:${fxY - size / 2}px;
        width:${size}px; height:${size}px; border-radius:50%;
        background:radial-gradient(circle, rgba(100,200,255,${0.6 - progress * 0.6}) 0%, rgba(50,100,200,${0.3 - progress * 0.3}) 60%, transparent 100%);
        box-shadow:0 0 ${10 + progress * 15}px rgba(100,200,255,${0.5 - progress * 0.5});
        pointer-events:none;
      `;
      frag.appendChild(el);
    }
  }

  // ── 체인 라이트닝 빔 연결선 ──
  // 비슷한 타이밍의 skill_chain 이펙트끼리 시안색 빔으로 연결
  const chainFx = cs.effects.filter(fx => fx.type === 'skill_chain' && (nowMs - fx.startTime) < fx.duration);
  // 같은 시간대(50ms 이내)의 체인 이펙트를 그룹화
  const chainGroups: typeof chainFx[] = [];
  const used = new Set<number>();
  for (let i = 0; i < chainFx.length; i++) {
    if (used.has(i)) continue;
    const group = [chainFx[i]];
    used.add(i);
    for (let j = i + 1; j < chainFx.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(chainFx[j].startTime - chainFx[i].startTime) < 80) {
        group.push(chainFx[j]);
        used.add(j);
      }
    }
    if (group.length > 1) chainGroups.push(group);
  }
  for (const group of chainGroups) {
    for (let i = 0; i < group.length - 1; i++) {
      const a = group[i];
      const b = group[i + 1];
      const ax = toPixelX(a.x);
      const ay = toPixelY(a.y);
      const bx = toPixelX(b.x);
      const by = toPixelY(b.y);
      const dx = bx - ax;
      const dy = by - ay;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const progress = (nowMs - a.startTime) / a.duration;
      const beam = document.createElement('div');
      beam.style.cssText = `
        position:absolute; left:${ax}px; top:${ay}px;
        width:${dist}px; height:3px;
        background:linear-gradient(90deg, #00e5ff, #80ffff, #00e5ff);
        box-shadow:0 0 12px rgba(0,229,255,${0.9 - progress * 0.9}),
                   0 0 4px white;
        transform-origin:0 50%; transform:rotate(${angle}rad);
        opacity:${1 - progress * progress};
        z-index:999; pointer-events:none;
      `;
      frag.appendChild(beam);
    }
  }

  // DocumentFragment 한번에 DOM에 붙임 (단일 reflow)
  overlay.appendChild(frag);

  // 전투 정보 HUD
  let infoEl = document.getElementById('combat-info');
  if (!infoEl) {
    infoEl = document.createElement('div');
    infoEl.id = 'combat-info';
    $('board-section').appendChild(infoEl);
  }
  const aliveCount = cs.monsters.filter(m => m.alive).length;
  const pauseLabel = combat.isPaused ? ' ⏸️ 일시정지 (Space로 재개)' : '';
  const t = cs.elapsedTime;
  const isBossRd = isBossRound(state.round);

  // 등급 판정 (CombatSystem 로직과 동일)
  let curGrade: string, curColor: string, bonusG: number;
  if (isBossRd) {
    if (t <= 10) { curGrade = 'S'; curColor = '#ffd700'; bonusG = 5; }
    else if (t <= 20) { curGrade = 'A'; curColor = '#43e97b'; bonusG = 3; }
    else if (t <= 30) { curGrade = 'B'; curColor = '#42a5f5'; bonusG = 2; }
    else if (t <= 40) { curGrade = 'C'; curColor = '#fb923c'; bonusG = 0; }
    else { curGrade = 'F'; curColor = '#888'; bonusG = 0; }
  } else {
    if (t <= 10) { curGrade = 'S'; curColor = '#ffd700'; bonusG = 4; }
    else if (t <= 20) { curGrade = 'A'; curColor = '#43e97b'; bonusG = 2; }
    else if (t <= 30) { curGrade = 'B'; curColor = '#42a5f5'; bonusG = 1; }
    else if (t <= 40) { curGrade = 'C'; curColor = '#fb923c'; bonusG = 0; }
    else { curGrade = 'F'; curColor = '#888'; bonusG = 0; }
  }

  // 타임아웃 경고
  const timeLimit = isBossRd ? 60 : 40;
  const timeLeft = Math.max(0, timeLimit - t);
  const timeoutWarn = timeLeft <= 10 && timeLeft > 0
    ? `<span style="color:#ef4444;font-weight:bold;animation:blink 0.5s infinite">⚠️ ${timeLeft.toFixed(0)}초 후 HP 피해!</span>`
    : timeLeft <= 0
      ? `<span style="color:#ef4444;font-weight:bold">💀 오버타임! HP 감소 중</span>`
      : '';

  // 등급 가이드 바
  const grades = isBossRd
    ? [
      { g: 'S', t: 10, gold: 5, color: '#ffd700' },
      { g: 'A', t: 20, gold: 3, color: '#43e97b' },
      { g: 'B', t: 30, gold: 2, color: '#42a5f5' },
      { g: 'C', t: 40, gold: 0, color: '#fb923c' },
      { g: 'F', t: 60, gold: 0, color: '#ef4444', penalty: '❤️-5' },
    ]
    : [
      { g: 'S', t: 10, gold: 4, color: '#ffd700' },
      { g: 'A', t: 20, gold: 2, color: '#43e97b' },
      { g: 'B', t: 30, gold: 1, color: '#42a5f5' },
      { g: 'C', t: 40, gold: 0, color: '#fb923c' },
      { g: 'F', t: 50, gold: 0, color: '#ef4444', penalty: '❤️-1' },
    ];
  const gradeBar = grades.map((g: any) => {
    const active = t <= g.t;
    const passed = t > g.t;
    const label = g.penalty ? `${g.g} ${g.t}s~ ${g.penalty}` : `${g.g} ≤${g.t}s +${g.gold}G`;
    return `<span style="
      padding:1px 6px;border-radius:3px;font-size:11px;font-weight:bold;
      background:${passed ? 'rgba(80,80,80,0.5)' : active && curGrade === g.g ? g.color : 'rgba(255,255,255,0.1)'};
      color:${passed ? '#666' : active && curGrade === g.g ? '#000' : g.color};
      ${passed ? 'text-decoration:line-through;' : ''}
    ">${label}</span>`;
  }).join(' ');

  // 등급 타이머 바: 시간에 따라 줄어드는 색상 바
  const maxTime = isBossRd ? 60 : 50;
  const gradeSegments = grades.map((g: any, i: number) => {
    const prevT = i === 0 ? 0 : grades[i - 1].t;
    const segStart = prevT / maxTime * 100;
    const segEnd = g.t / maxTime * 100;
    return `${g.color} ${segStart}%, ${g.color} ${segEnd}%`;
  }).join(', ');
  const elapsedPct = Math.min(t / maxTime * 100, 100);
  const timerBar = `
    <div style="position:relative;width:100%;height:6px;border-radius:3px;overflow:hidden;margin-top:3px;
                background:linear-gradient(90deg, ${gradeSegments});">
      <div style="position:absolute;left:0;top:0;width:${elapsedPct}%;height:100%;
                  background:rgba(0,0,0,0.65);border-radius:3px 0 0 3px;
                  transition:width 0.1s linear;"></div>
    </div>`;

  infoEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="color:${curColor};font-weight:bold;font-size:14px;min-width:28px">${curGrade}</span>
      <span>${t.toFixed(1)}s</span>
      <span style="opacity:0.5">|</span>
      ⚔️ ${cs.totalKills}
      <span style="opacity:0.5">|</span>
      남은 ${aliveCount + cs.spawnQueue}
      ${cs.leakedDamage > 0 ? `<span style="opacity:0.5">|</span><span style="color:#ef4444">❤️ -${cs.leakedDamage}</span>` : ''}
      <span style="opacity:0.5">|</span>
      ${gradeBar}
      ${bonusG > 0 ? `<span style="color:${curColor}">+${bonusG}G</span>` : ''}
      ${timeoutWarn}
      ${pauseLabel}
    </div>
    ${timerBar}
  `;
}

// ─── 보스 상자 + 해금 + 증강 시스템 ─────────────────────────

function handleBossBox(round: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const p = player();
    events.emit('boss:defeated', { round });

    const dropTable = [...BOX_DROP_TABLES].reverse().find(t => t.round <= round);
    if (!dropTable || dropTable.items.length === 0) { resolve(); return; }

    // Create chest overlay
    const overlay = document.createElement('div');
    overlay.className = 'chest-overlay';
    overlay.innerHTML = `
      <div class="chest-modal">
        <div class="chest-icon" id="chest-icon">🎁</div>
        <div class="chest-label">보스 처치!</div>
        <div class="chest-sublabel">탭하여 상자 열기</div>
        <div class="chest-reward hidden" id="chest-reward"></div>
      </div>
    `;
    (document.getElementById('game-scale-wrapper') || document.body).appendChild(overlay);

    const chestIcon = overlay.querySelector('#chest-icon') as HTMLElement;
    const rewardEl = overlay.querySelector('#chest-reward') as HTMLElement;
    const sublabel = overlay.querySelector('.chest-sublabel') as HTMLElement;

    let opened = false;
    const openChest = () => {
      if (opened) return;
      opened = true;

      // Animate chest open
      chestIcon.style.transform = 'scale(1.3)';
      chestIcon.style.transition = 'transform 0.3s ease';
      sublabel.classList.add('hidden');

      setTimeout(() => {
        // Determine reward
        if (Math.random() < BOX_UNLOCK_CHANCE) {
          // 30% — KEY DROP!
          const totalWeight = dropTable.items.reduce((sum, i) => sum + i.weight, 0);
          let roll = Math.random() * totalWeight;
          let droppedItem = dropTable.items[0].itemId;
          for (const item of dropTable.items) {
            roll -= item.weight;
            if (roll <= 0) { droppedItem = item.itemId; break; }
          }

          if (!p.items.includes(droppedItem)) {
            p.items.push(droppedItem);
            chestIcon.textContent = '🔑';
            rewardEl.innerHTML = `<span style="color:#fbbf24;font-size:18px;font-weight:bold">🔑 해금 열쇠 획득!</span><br><span style="color:#e2e8f0;font-size:13px">${droppedItem}</span>`;
            log(`🔑 해금 열쇠 획득: ${droppedItem}`, 'gold');
            events.emit('boss:dropped', { itemId: droppedItem });
            checkUnlockConditions();
          } else {
            const bonusGold = 10 + round;
            p.gold += bonusGold;
            chestIcon.textContent = '💰';
            rewardEl.innerHTML = `<span style="color:#fbbf24;font-size:18px;font-weight:bold">💰 골드 +${bonusGold}</span><br><span style="color:#94a3b8;font-size:12px">이미 보유한 열쇠</span>`;
            log(`🔑 이미 보유한 열쇠! 골드+${bonusGold}`, 'gold');
          }
        } else {
          // 70% — GOLD
          const bonusGold = 5 + Math.floor(round / 5);
          p.gold += bonusGold;
          chestIcon.textContent = '💰';
          rewardEl.innerHTML = `<span style="color:#fbbf24;font-size:18px;font-weight:bold">💰 골드 +${bonusGold}</span>`;
          log(`💰 상자에서 골드+${bonusGold} 획득`, 'gold');
        }

        rewardEl.classList.remove('hidden');
        chestIcon.style.transform = 'scale(1)';

        // Auto-dismiss after 1.5s
        setTimeout(() => {
          overlay.style.opacity = '0';
          overlay.style.transition = 'opacity 0.3s';
          setTimeout(() => {
            overlay.remove();
            refreshUnlockPanel();
            resolve();
          }, 300);
        }, 1500);
      }, 400);
    };

    overlay.addEventListener('click', openChest);
    // Auto-open after 5s if not tapped
    setTimeout(() => { if (!opened) openChest(); }, 5000);
  });
}

// ─── 증강 3택 시스템 ─────────────────────────────────────────

function showAugmentPick(round: number): void {
  const p = player();
  const ownedIds = p.augments.map((a: string) => a);

  // 해당 라운드에 등장 가능한 증강 필터
  const candidates = AUGMENTS.filter(a =>
    a.minRound <= round && !ownedIds.includes(a.id)
  );
  if (candidates.length === 0) return;

  // 랜덤 3개 선택
  const shuffled = candidates.sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, Math.min(3, shuffled.length));

  // 모달 UI
  const overlay = document.createElement('div');
  overlay.id = 'augment-overlay';
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.85);
    display:flex; align-items:center; justify-content:center;
    z-index:9999; animation: fadeIn 0.3s ease;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background:linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border:2px solid #e94560; border-radius:16px;
    padding:28px; max-width:700px; width:90%;
    box-shadow:0 0 60px rgba(233,69,96,0.3);
  `;

  const title = document.createElement('h2');
  title.style.cssText = `
    color:#e94560; text-align:center; font-size:22px;
    margin:0 0 8px; text-shadow:0 0 10px rgba(233,69,96,0.5);
  `;
  title.textContent = `⚡ 증강 선택 (R${round})`;

  const subtitle = document.createElement('p');
  subtitle.style.cssText = `color:#888; text-align:center; margin:0 0 20px; font-size:13px;`;
  subtitle.textContent = '하나를 선택하세요 — 영구 적용됩니다';

  modal.appendChild(title);
  modal.appendChild(subtitle);

  const container = document.createElement('div');
  container.style.cssText = `display:flex; gap:12px; justify-content:center; flex-wrap:wrap;`;

  for (const aug of picks) {
    const card = document.createElement('div');
    const category = getCategoryLabel(aug.id);
    card.style.cssText = `
      background:linear-gradient(145deg, #0f3460 0%, #1a1a3e 100%);
      border:2px solid #333; border-radius:12px;
      padding:20px 16px; flex:1; min-width:180px; max-width:220px;
      cursor:pointer; transition:all 0.2s ease;
      text-align:center;
    `;
    card.innerHTML = `
      <div style="font-size:32px; margin-bottom:8px;">${aug.emoji}</div>
      <div style="color:#7ed6df; font-size:10px; font-weight:bold; letter-spacing:1px;
        text-transform:uppercase; margin-bottom:6px;">${category}</div>
      <div style="color:#fff; font-size:15px; font-weight:bold;
        margin-bottom:8px;">${aug.name}</div>
      <div style="color:#aaa; font-size:12px; line-height:1.5;">${aug.effect}</div>
    `;

    card.onmouseenter = () => {
      card.style.borderColor = '#e94560';
      card.style.transform = 'translateY(-4px)';
      card.style.boxShadow = '0 8px 25px rgba(233,69,96,0.3)';
    };
    card.onmouseleave = () => {
      card.style.borderColor = '#333';
      card.style.transform = 'translateY(0)';
      card.style.boxShadow = 'none';
    };

    card.onclick = () => {
      p.augments.push(aug.id);
      log(`🧬 증강 획득: ${aug.emoji} ${aug.name} — ${aug.effect}`, 'purple');

      // ── 즉시 효과 ──
      if (aug.id === 'aug_bailout') {
        // 재생의 오라: maxHP +20, 즉시 HP+5
        (p as any).maxHp = ((p as any).maxHp ?? 100) + 20;
        p.hp = Math.min(p.hp + 5, (p as any).maxHp);
        log('💚 최대 HP +20, HP +5 회복!', 'green');
      }
      if (aug.id === 'aug_cold_wallet') {
        // 벤치 확장: 벤치 슬롯 +3
        log('🪑 벤치 슬롯 +3!', 'green');
      }
      if (aug.id === 'aug_layer2') {
        // 레이어 2: 한 칸에 유닛 2마리 겹쳐 배치 가능 + 보드 슬롯 +1
        log('🥞 레이어 2 활성! 한 칸에 유닛 2마리 배치 가능 + 슬롯+1', 'green');
      }
      if (aug.id === 'aug_dex_swap') {
        // 리롤 마스터: 무료 리롤 1회 즉시 지급
        p.freeRerolls += 1;
        log('🎲 무료 리롤 +1!', 'green');
      }

      overlay.remove();
      refreshUnlockPanel();
      render();
    };

    container.appendChild(card);
  }

  modal.appendChild(container);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function getCategoryLabel(augId: string): string {
  if (['aug_zk_proof', 'aug_chain_liquidation', 'aug_margin_call', 'aug_dead_cat', 'aug_short_squeeze', 'aug_lightning_network'].includes(augId)) return '⚔️ 전투';
  if (['aug_defi_farm', 'aug_dex_swap', 'aug_pow', 'aug_bailout', 'aug_mev', 'aug_airdrop'].includes(augId)) return '💰 유틸';
  return '🧠 전략';
}

// ─── 해금/증강 UI 패널 ──────────────────────────────────────

function refreshUnlockPanel(): void {
  const p = player();
  let panel = document.getElementById('unlock-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'unlock-panel';
    panel.style.cssText = `
      border-top:1px solid rgba(255,255,255,.08);
      padding:6px 8px;
      font-size:11px; color:#ccc;
    `;
    // 오른쪽 패널에 추가
    const rightPanel = document.getElementById('right-panel');
    if (rightPanel) {
      rightPanel.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }
  }

  const keyNames: Record<string, string> = {
    'key_ethereum': '🔑 이더리움',
    'key_binance': '🔑 바이낸스',
    'key_tesla': '🔑 테슬라',
    'key_block1': '🔑 블록1',
    'key_sec': '🔑 SEC',
    'key_satoshi': '🔑 사토시',
  };

  // 보유 열쇠
  const keysHtml = p.items.length > 0
    ? p.items.map((k: string) => `<span style="background:#1a2a4a;padding:2px 8px;border-radius:4px;margin:2px;display:inline-block;border:1px solid #334;color:#ffd700;font-size:11px;">${keyNames[k] || k}</span>`).join('')
    : '<span style="color:#555;">없음</span>';

  // 해금 유닛
  const unlocked = [...p.unlocked7cost];
  if (p.unlocked10cost) unlocked.push('satoshi');
  const unlockedHtml = unlocked.length > 0
    ? unlocked.map((uid: string) => {
      const def = UNIT_MAP[uid];
      return def ? `<span style="background:#2a1a4a;padding:2px 8px;border-radius:4px;margin:2px;display:inline-block;border:1px solid #534;color:#e94560;font-size:11px;">${def.emoji} ${def.name} (${def.cost}코)</span>` : '';
    }).join('')
    : '<span style="color:#555;">없음</span>';

  // 보유 증강
  const augHtml = p.augments.length > 0
    ? p.augments.map((aid: string) => {
      const aug = AUGMENTS.find(a => a.id === aid);
      return aug ? `<span style="background:#1a3a2a;padding:2px 8px;border-radius:4px;margin:2px;display:inline-block;border:1px solid #354;color:#7ed6df;font-size:11px;" title="${aug.effect}">${aug.emoji} ${aug.name}</span>` : '';
    }).join('')
    : '<span style="color:#555;">없음</span>';

  // 10코 해금 상태
  const has7count = [...p.board, ...p.bench].filter(u => UNIT_MAP[u.unitId]?.cost === 7).length;
  const tenCostStatus = p.unlocked10cost
    ? '✅ 해금됨'
    : p.items.includes('key_satoshi')
      ? `🔑 보유 (7코 ${has7count}/1마리 필요)`
      : '🔒 key_satoshi 필요';

  panel.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div>
        <div style="color:#ffd700;font-weight:bold;margin-bottom:4px;font-size:11px;">🔑 보유 열쇠</div>
        <div style="display:flex;flex-wrap:wrap;gap:2px;">${keysHtml}</div>
      </div>
      <div>
        <div style="color:#e94560;font-weight:bold;margin-bottom:4px;font-size:11px;">⭐ 해금 유닛</div>
        <div style="display:flex;flex-wrap:wrap;gap:2px;">${unlockedHtml}</div>
      </div>
      <div>
        <div style="color:#7ed6df;font-weight:bold;margin-bottom:4px;font-size:11px;">🧬 보유 증강</div>
        <div style="display:flex;flex-wrap:wrap;gap:2px;">${augHtml}</div>
      </div>
      <div>
        <div style="color:#c0c0c0;font-weight:bold;margin-bottom:4px;font-size:11px;">🌟 10코 해금</div>
        <div style="font-size:11px;">${tenCostStatus}</div>
      </div>
    </div>
  `;
}

function checkUnlockConditions(): void {
  const p = player();

  for (const cond of UNLOCK_CONDITIONS) {
    const unitDef = UNIT_MAP[cond.unitId];
    if (!unitDef) continue;

    // 이미 해금된 경우 스킵
    if (unitDef.cost === 10 && p.unlocked10cost) continue;
    if (unitDef.cost === 7 && p.unlocked7cost.includes(cond.unitId)) continue;

    // 열쇠 보유 확인
    if (!p.items.includes(cond.requiredItem)) continue;

    // 10코 추가 조건: 7코 유닛 1마리 이상 보유
    if (unitDef.cost === 10) {
      const owned7cost = [...p.board, ...p.bench].filter(u => {
        const def = UNIT_MAP[u.unitId];
        return def && def.cost === 7;
      });
      if (owned7cost.length < 1) continue;
    }

    // 해금!
    if (unitDef.cost === 10) {
      p.unlocked10cost = true;
    } else {
      p.unlocked7cost.push(cond.unitId);
    }

    // 유닛 풀에 추가 (1개만 — 중복 구매 불가)
    state.unitPool[cond.unitId] = 1;

    log(`⭐ ${unitDef.name} (${unitDef.cost}코) 해금 완료! 상점에서 등장합니다!`, 'purple');
    events.emit('unlock:activated', { unitId: cond.unitId });
  }
}

// ── 전투 후 자동 합성 ──────────────────────────────────────
// 보드+벤치 전체를 스캔하여 같은 유닛 3장이면 자동 합성
function autoMergeAll(p: PlayerState): void {
  let merged = true;
  while (merged) {
    merged = false;
    const allUnits = [...p.board, ...p.bench];
    // 유닛별 그룹핑 (unitId + star)
    const groups = new Map<string, UnitInstance[]>();
    for (const u of allUnits) {
      const key = `${u.unitId}:${u.star}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(u);
    }
    for (const [, units] of groups) {
      if (units.length < 3) continue;
      // 3장 이상 → 합성
      // 보드 유닛 우선 keep (위치 유지)
      const boardUnit = units.find(u => p.board.includes(u));
      const keep = boardUnit ?? units[0];
      const remove = units.filter(u => u.instanceId !== keep.instanceId).slice(0, 2);
      const newStar = (keep.star + 1) as 1 | 2 | 3;
      keep.star = newStar;

      // 제거 대상 삭제
      for (const rem of remove) {
        const bIdx = p.board.findIndex(u => u.instanceId === rem.instanceId);
        if (bIdx >= 0) p.board.splice(bIdx, 1);
        const eIdx = p.bench.findIndex(u => u.instanceId === rem.instanceId);
        if (eIdx >= 0) p.bench.splice(eIdx, 1);
      }
      // 보드 유닛이 keep → 위치 유지, 벤치 유닛이 keep → 벤치에 그대로

      const def = UNIT_MAP[keep.unitId];
      log(`⭐ 자동 합성! ${def?.name ?? keep.unitId} → ★${newStar}`, 'purple');
      events.emit('unit:merged', { unitId: keep.unitId, newStar, instanceId: keep.instanceId });
      // 런 통계: 최고 ★ 갱신
      if (newStar > runStats.highestStar) runStats.highestStar = newStar;
      merged = true;
      break; // 다시 처음부터 스캔 (연쇄 합성)
    }
  }
}

function onCombatComplete(result: CombatResult): void {
  inCombat = false;
  state.phase = 'prep' as any;
  const p = player();

  // 오버레이 제거 + combat-active 해제
  document.getElementById('combat-overlay')?.remove();
  document.getElementById('combat-info')?.remove();
  $('board-section').classList.remove('combat-active');

  // 결과 반영
  cmd.getEconomy().processStreaks(p, result.won);

  // 등급별 보너스 골드
  const combatGold = result.goldEarned;
  const gradeGold = result.bonusGold;
  const totalGold = combatGold + gradeGold;

  // 전 라운드 수입 기록 (processIncome은 END_ROUND에서 호출됨)
  const curRound = state.round;
  const isWarmup = getStage(curRound) === 1;
  const baseGold = getBaseIncome(curRound);
  const interestGold = isWarmup ? 0 : getInterest(p.gold);

  // 토템 골드
  let totemG = 0;
  for (const u of p.board) {
    if (!u.position) continue;
    const uDef = UNIT_MAP[u.unitId];
    if (uDef?.skill?.type === 'passive' && uDef.skill.params.roundEndGold) {
      totemG += uDef.skill.params.roundEndGold;
    }
  }

  lastRoundIncome = {
    stageGold: baseGold,
    gradeGold,
    grade: result.grade,
    interestGold,
    combatGold,
    totemGold: totemG,
    total: baseGold + interestGold + totalGold + totemG,
  };

  const gradeColors: Record<string, string> = { S: '#fbbf24', A: '#4ade80', B: '#60a5fa', C: '#fb923c', F: '#f87171' };
  const gradeColor = gradeColors[result.grade] || '#94a3b8';
  const gradeLabel = gradeGold > 0 ? ` [${result.grade}등급 +${gradeGold}G]` : ` [${result.grade}등급]`;

  if (result.won) {
    p.gold += totalGold;
    log(`✅ 승리! 킬:${result.kills} 골드+${totalGold}${gradeLabel} (${result.elapsedTime.toFixed(1)}s)`, 'green');
  } else {
    cmd.getEconomy().applyDamage(p, result.damage);
    p.gold += totalGold;
    log(`💀 패배! 킬:${result.kills} -${result.damage}HP 골드+${totalGold}${gradeLabel}`, 'red');
  }

  // 등급 표시 스탬프 (대형 애니메이션)
  const gradeBadge = document.createElement('div');
  gradeBadge.style.cssText = `
    position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) scale(5);
    font-size:120px; font-weight:900; color:${gradeColor};
    text-shadow:0 0 60px ${gradeColor}, 0 0 120px ${gradeColor}80, 0 8px 16px rgba(0,0,0,0.7);
    z-index:9999; pointer-events:none; animation:gradeStamp 2.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    font-family:'neodgm', monospace; letter-spacing:8px;
  `;
  gradeBadge.textContent = result.grade;
  document.body.appendChild(gradeBadge);
  setTimeout(() => gradeBadge.remove(), 2600);

  // 보스 S등급: 무료 리롤 2회 추가
  if (isBossRound(state.round) && result.grade === 'S') {
    p.freeRerolls += 2;
    log('⭐ 보스 S등급! 무료 리롤 +2', 'gold');
  }

  // PRO: 보스 등급 수집 (서버 전송용)
  if (isBossRound(state.round)) {
    collectedBossGrades[`R${state.round}`] = result.grade;
  }

  // 게임 오버 체크
  if (p.hp <= 0) {
    if (isMultiMode) {
      showMultiDeathScreen();
    } else {
      showGameOver();
    }
    return;
  }

  // 7-7 최종 클리어 체크 (싱글 + 멀티 공통)
  if (getStageRound(state.round) === '7-7' && result.won) {
    if (isMultiMode) {
      showMultiClearScreen();
    } else {
      log('🏆 7-7 ALL CLEAR! 축하합니다!', 'gold');
      showGameOver();
    }
    return;
  }

  // 보스 라운드 체크 → 상자 드랍 + 해금
  if (isBossRound(state.round) && result.won) {
    runStats.totalBossKills++;
    // 보스 처치 시 무료 리롤 1회
    p.freeRerolls += 1;
    log('🎁 보스 처치! 무료 리롤 +1', 'gold');

    // ⚡ Speedrun Bounty 판정 (멀티 모드에서 2-7 보스 클리어 시)
    if (isMultiMode && getStageRound(state.round) === SPEEDRUN_TARGET_LABEL && result.won) {
      const elapsed = (Date.now() - gameStartTime) / 1000;
      if (elapsed <= SPEEDRUN_TIME_LIMIT) {
        p.gold += SPEEDRUN_BONUS_GOLD;
        log(`⚡ SPEEDRUN BONUS! +${SPEEDRUN_BONUS_GOLD}G (${elapsed.toFixed(1)}s)`, 'gold');
        showSpeedrunFlash();
        emitTimeAttack({
          playerName: multiPlayerNames[0] || 'Player',
          stage: getStage(state.round),
          elapsed,
        });
      }
    }
    handleBossBox(state.round).then(() => {
      // ★ 캔페인 클리어 체크 (stageId+1의 x-7 도달 시) — 멀티에서는 스킵
      if (!isMultiMode) {
        const targetStage = currentStageId + 1;
        const targetLabel = `${targetStage}-7`;
        if (getStage(state.round) >= targetStage && getStageRound(state.round) === targetLabel) {
          log(`🏆 스테이지 ${targetStage} 클리어! 축하합니다!`, 'gold');
          showGameOver();
          return;
        }
      }
      // 🃏 드래프트 룸: 2-7 보스 승리 후 멀티 모드에서 드래프트 오버레이 표시
      if (isMultiMode && getStageRound(state.round) === '2-7') {
        showDraftScreen();
        return; // 드래프트 완료 후 applyDraftReward → afterCombatCleanup 호출됨
      }

      afterCombatCleanup(p);
    });
    return; // chest popup handles the flow
  }

  // ★ 캔페인 클리어 체크 (보스가 아닌 경우에도) — 멀티에서는 스킵
  if (!isMultiMode) {
    const targetStage2 = currentStageId + 1;
    const targetLabel2 = `${targetStage2}-7`;
    if (getStage(state.round) >= targetStage2 && getStageRound(state.round) === targetLabel2) {
      log(`🏆 스테이지 ${targetStage2} 클리어! 축하합니다!`, 'gold');
      showGameOver();
      return;
    }
  }

  afterCombatCleanup(p);
}

function afterCombatCleanup(p: typeof state.players[0]): void {
  // 전투 후 자동 합성
  autoMergeAll(p);

  // 다음 라운드 진행
  cmd.execute(state, { type: 'END_ROUND' });

  // 렌더 (골드 변경 반영, 상점 조작 가능)
  render();
  refreshUnlockPanel();

  // 새 스테이지 시작(n-1) 처리
  const newStage = getStage(state.round);
  const sr = getStageRound(state.round);
  if (sr.endsWith('-1') && newStage >= 2) {
    player().freeRerolls += 1;
    log(`🔄 S${newStage} 시작! 무료 리롤 +1`, 'gold');
  }
  if (newStage >= 3 && sr.endsWith('-1')) {
    showAugmentPick(state.round);
  }

  // ── 30초 준비 타이머 바 ──
  const PREP_TIME = 30;
  const mapWrapper = document.getElementById('map-wrapper');
  let timerBar = document.getElementById('prep-timer-bar');
  if (!timerBar && mapWrapper) {
    timerBar = document.createElement('div');
    timerBar.id = 'prep-timer-bar';
    mapWrapper.appendChild(timerBar);
  }
  if (timerBar) {
    timerBar.style.width = '100%';
    timerBar.style.display = 'block';
    timerBar.classList.remove('emergency');
  }

  const prepStart = performance.now();
  const prepInterval = setInterval(() => {
    const elapsed = (performance.now() - prepStart) / 1000;
    const remaining = Math.max(0, PREP_TIME - elapsed);
    const pct = (remaining / PREP_TIME) * 100;

    if (timerBar) {
      timerBar.style.width = `${pct}%`;
      if (remaining <= 5) {
        timerBar.classList.add('emergency');
      }
    }

    if (remaining <= 0) {
      clearInterval(prepInterval);
      if (timerBar) timerBar.style.display = 'none';
      if (!inCombat) startCombat();
    }
  }, 100);

  // 수동 전투 시작 시 타이머 정리용 글로벌
  (window as any).__prepInterval = prepInterval;
  (window as any).__prepTimerBar = timerBar;
}

// ─── 게임 오버 화면 ──────────────────────────────────────────

async function showGameOver(): Promise<void> {
  const p = player();
  const reachedRound = state.round;
  const targetStage = currentStageId + 1;
  const cleared = getStage(reachedRound) >= targetStage && getStageRound(reachedRound) === `${targetStage}-7`;
  inCountdown = false;

  // RUG PULL 연출 (HP 0 패배 — 클리어 시 비표시)
  // ── AI 텔레메트리 덤프 ──
  (window as any).__ENDGAME_STATS__ = {
    maxWaveReached: reachedRound,
    playerLevel: p.level,
    finalGold: p.gold,
    finalHp: p.hp,
    cleared,
    stageId: currentStageId,
    unitPerformance: p.board.map(u => ({
      unitId: u.unitId,
      name: UNIT_MAP[u.unitId]?.name ?? u.unitId,
      star: u.star,
      totalDamageDealt: u.totalDamageDealt ?? 0,
      position: u.position,
    })),
    bossGrades: collectedBossGrades,
    runStats,
    timestamp: new Date().toISOString(),
  };
  if (!cleared) {
    // 게임 화면 즉시 숨기기 (RUG PULL 뒤에서 보이지 않도록)
    appEl?.classList.add('hidden');
    const rugPull = document.createElement('div');
    rugPull.className = 'rug-pull-overlay';
    rugPull.innerHTML = `
      <div class="rug-pull-title">RUG PULL</div>
      <div class="rug-pull-sub">Your liquidity has been drained.</div>
      <div style="margin-top:20px;font-size:14px;color:rgba(255,255,255,0.4)">
        라운드 ${getStageRound(reachedRound)} 도달
      </div>
    `;
    document.body.appendChild(rugPull);
    // 2.5초 후 자동 제거
    await new Promise(r => setTimeout(r, 2500));
    rugPull.remove();
  } else {
    // 클리어 시 게임 화면 숨기기
    appEl?.classList.add('hidden');
  }

  // 결과 화면 먼저 표시 (로딩 중 빈 화면 방지)
  const resultData = {
    rewards: { soft: 0, shards7: 0, shards10: 0 },
    newUnlocks: [] as string[],
    missionProgress: [] as string[],
    reachedRound,
    cleared,
    bossGrades: collectedBossGrades,
    stageId: currentStageId,
  };

  // 서버에 결과 전송
  if (currentRunId) {
    try {
      const serverResult = await runFinish({
        runId: currentRunId,
        stageId: currentStageId,
        reachedRound,
        cleared,
        bossGrades: collectedBossGrades,
        stats: runStats,
      });
      // 서버 응답으로 결과 업데이트
      resultData.rewards = serverResult.rewards;
      resultData.newUnlocks = serverResult.newUnlocks ?? [];
      resultData.missionProgress = serverResult.missionProgress ?? [];
      setCachedState(serverResult.me);
    } catch (e) {
      console.warn('[Run] Finish failed, showing offline result:', e);
    }
  }

  // 결과 화면 표시
  if (resultViewEl) {
    resultViewEl.classList.remove('hidden');
    renderResult(resultViewEl, resultData,
      // 다시하기
      () => {
        location.reload();
      },
      // 로비로
      () => {
        returnToLobby();
      }
    );
  }
}

// ─── 로그 ───────────────────────────────────────────────────

function log(msg: string, cls: string = ''): void {
  const el = document.createElement('div');
  el.className = `log-line ${cls}`;
  el.textContent = `[${getStageRound(state.round)}] ${msg}`;
  $('log-content').prepend(el);
  const lines = $('log-content').children;
  while (lines.length > 50) lines[lines.length - 1].remove();
}

// ─── 사정거리 시각화 ─────────────────────────────────────────

function showRangeCircle(cellX: number, cellY: number, unit: UnitInstance): void {
  hideRangeCircle();
  const def = UNIT_MAP[unit.unitId];
  if (!def) return;

  let range = def.attackRange ?? 2.5;
  if (def.skill?.type === 'passive' && def.skill.params.rangeBonus) {
    range += def.skill.params.rangeBonus;
  }

  const grid = $('board-grid');
  if (!grid) return;

  // 해당 셀 찾기
  const cell = grid.querySelector(`.board-cell[data-x="${cellX}"][data-y="${cellY}"]`) as HTMLElement;
  if (!cell) return;

  // 셀 크기에서 반지름 계산
  const cellW = cell.offsetWidth;
  const cellH = cell.offsetHeight;
  const avgCellSize = (cellW + cellH) / 2;
  const radius = range * avgCellSize;

  const circle = document.createElement('div');
  circle.id = 'range-circle';
  circle.style.width = `${radius * 2}px`;
  circle.style.height = `${radius * 2}px`;
  // 셀의 자식으로 추가 → CSS로 정확히 중앙 정렬
  circle.style.position = 'absolute';
  circle.style.left = '50%';
  circle.style.top = '50%';
  circle.style.transform = 'translate(-50%, -50%)';
  cell.appendChild(circle);
}

function hideRangeCircle(): void {
  document.getElementById('range-circle')?.remove();
}

// ─── 툴팁 ───────────────────────────────────────────────────

let tooltipEl: HTMLElement | null = null;

function showTooltip(e: MouseEvent, unit: UnitInstance): void {
  const def = UNIT_MAP[unit.unitId];
  const starMult = STAR_MULTIPLIER[unit.star];
  let range = def.attackRange ?? 2.5;
  const baseAtkSpd = def.attackSpeed ?? 1.0;
  const baseDmg = Math.floor(def.baseDmg * starMult);
  const skill = def.skill;

  // passive 스킬 사거리 보정
  if (skill?.type === 'passive' && skill.params.rangeBonus) {
    range += skill.params.rangeBonus;
  }

  // 시너지 버프 계산
  const p = player();
  const activeSynergies = synergy.calculateSynergies(p);
  const buffs = synergy.calculateBuffs(activeSynergies);
  const buffedDmg = Math.floor((def.baseDmg * starMult * buffs.dmgMultiplier) + buffs.flatDmgBonus);
  let buffedAtkSpd = +(baseAtkSpd * buffs.atkSpeedMultiplier).toFixed(2);
  // passive 공속 보정
  if (skill?.type === 'passive') {
    if (skill.params.atkSpdBonus) buffedAtkSpd = +(buffedAtkSpd * (1 + skill.params.atkSpdBonus)).toFixed(2);
    if (skill.params.atkSpdMult) buffedAtkSpd = +(buffedAtkSpd * skill.params.atkSpdMult).toFixed(2);
  }

  const hasDmgBuff = buffedDmg > baseDmg;
  const hasAtkBuff = buffedAtkSpd > baseAtkSpd + 0.01;

  const dmgText = hasDmgBuff
    ? `${baseDmg} → <span style="color:#4ade80">${buffedDmg}</span>`
    : `${baseDmg}`;
  const atkText = hasAtkBuff
    ? `${baseAtkSpd} → <span style="color:#4ade80">${buffedAtkSpd}</span>/s`
    : `${baseAtkSpd}/s`;

  // DPS 계산
  const dps = Math.floor(buffedDmg * buffedAtkSpd);

  // 데미지 타입
  const dmgTypeIcon = def.dmgType === 'magic' ? '🔮 마법' : '⚔️ 물리';
  const dmgTypeColor = def.dmgType === 'magic' ? '#c084fc' : '#fb923c';

  // 마나 정보
  let manaHtml = '';
  if (def.maxMana && skill?.type === 'active') {
    const currentMana = Math.floor(unit.currentMana ?? 0);
    const maxMana = def.maxMana;
    const startMana = def.startingMana ?? 0;
    const manaPct = Math.min(100, (currentMana / maxMana) * 100);
    manaHtml = `<div class="tt-mana">
      <div class="tt-mana-label">⚡ 마나: ${currentMana}/${maxMana} ${startMana > 0 ? `(시작: ${startMana})` : ''}</div>
      <div class="tt-mana-bar-bg"><div class="tt-mana-bar-fill" style="width:${manaPct}%"></div></div>
    </div>`;
  }

  // 스킬 정보
  const skillTypeLabel: Record<string, string> = {
    active: '🔥 액티브', onHit: '⚔️ 적중 시', onKill: '💀 킬 시', passive: '🔵 패시브',
    periodic: '🔄 주기적', onCombatStart: '🟢 전투 시작'
  };
  const skillTypeColor: Record<string, string> = {
    active: '#f59e0b', onHit: '#fb923c', onKill: '#f87171', passive: '#60a5fa',
    periodic: '#c084fc', onCombatStart: '#4ade80'
  };
  let skillHtml = '';
  if (skill) {
    // 스킬 파라미터 상세 태그
    const sp = skill.params;
    const tags: string[] = [];
    if (sp.chainTargets) tags.push(`⚡체인 ${sp.chainTargets}회`);
    if (sp.chainPct) tags.push(`체인딜 ${Math.round(sp.chainPct * 100)}%`);
    if (sp.splashPct) tags.push(`💥스플래시 ${Math.round(sp.splashPct * 100)}%`);
    if (sp.splashTargets) tags.push(`범위 ${sp.splashTargets}체`);
    if (sp.executeThreshold) tags.push(`🪓처형 HP${Math.round(sp.executeThreshold * 100)}%↓`);
    if (sp.executeManaRefund) tags.push(`마나환급 ${Math.round(sp.executeManaRefund * 100)}%`);
    if (sp.freezeDuration) tags.push(`❄️빙결 ${sp.freezeDuration}초`);
    if (sp.freezeTargets) tags.push(`빙결 ${sp.freezeTargets}체`);
    if (sp.stunDuration) tags.push(`💫기절 ${sp.stunDuration}초`);
    if (sp.stunTargets) tags.push(`기절 ${sp.stunTargets}체`);
    if (sp.pierceTargets) tags.push(`🎯관통 ${sp.pierceTargets}체`);
    if (sp.piercePct) tags.push(`관통딜 ${Math.round(sp.piercePct * 100)}%`);
    if (sp.dotPct) tags.push(`🔥도트 ${Math.round(sp.dotPct * 100)}%`);
    if (sp.dotDuration) tags.push(`${sp.dotDuration}초`);
    if (sp.burstMult) tags.push(`💥버스트 ×${sp.burstMult}`);
    if (sp.burstDmg) tags.push(`💥고정딜 ${sp.burstDmg}`);
    if (sp.hpPct) tags.push(`HP비례 ${Math.round(sp.hpPct * 100)}%`);
    if (sp.hpPctDmg) tags.push(`HP비례딜 ${Math.round(sp.hpPctDmg * 100)}%`);
    if (sp.defShred) tags.push(`🛡️방깎 ${sp.defShred}`);
    if (sp.slowPct) tags.push(`🐌감속 ${Math.round(sp.slowPct * 100)}%`);
    if (sp.knockback !== undefined) tags.push(`🔙넉백`);
    if (sp.blackhole) tags.push(`🕳️블랙홀`);
    if (sp.superCycle) tags.push(`🌀슈퍼사이클`);
    if (sp.marsRocket) tags.push(`🚀로켓`);
    if (sp.genesisBlock) tags.push(`🌟제네시스`);
    if (sp.theMerge) tags.push(`🔮더 머지`);
    if (sp.gold) tags.push(`💰골드 +${sp.gold}`);
    if (sp.allyManaHeal) tags.push(`🔋마나충전 +${sp.allyManaHeal}`);
    if (sp.atkSpdBuff) tags.push(`⚡공속↑ ${Math.round(sp.atkSpdBuff * 100)}%`);
    if (sp.allyDmgBuff) tags.push(`📈아군딜↑`);
    if (sp.guaranteedCrit) tags.push(`💎확정크리`);
    if (sp.critMultiplier) tags.push(`크리 ×${sp.critMultiplier}`);
    if (sp.dmgMult) tags.push(`딜배 ×${sp.dmgMult}`);
    if (sp.multiHit) tags.push(`🔨${sp.multiHit}연타`);

    const tagsHtml = tags.length > 0
      ? `<div class="tt-skill-tags">${tags.map(t => `<span class="tt-tag">${t}</span>`).join('')}</div>`
      : '';

    skillHtml = `<div class="tt-skill">
      <div class="tt-skill-header" style="color:${skillTypeColor[skill.type] ?? '#fff'}">
        ${skillTypeLabel[skill.type] ?? skill.type} — ${skill.name}
      </div>
      <div class="tt-skill-desc">${skill.desc}${skill.cooldown ? ` (${skill.cooldown}초)` : ''}${skill.chance && skill.chance < 1 ? ` [${Math.round(skill.chance * 100)}%]` : ''}</div>
      ${tagsHtml}
    </div>`;
  }

  // 활성 시너지 버프 요약
  let buffSummary = '';
  const buffLines: string[] = [];
  if (buffs.dmgMultiplier > 1.01) buffLines.push(`DMG ×${buffs.dmgMultiplier.toFixed(2)}`);
  if (buffs.atkSpeedMultiplier > 1.01) buffLines.push(`공속 ×${buffs.atkSpeedMultiplier.toFixed(2)}`);
  if (buffs.critChance > 0) buffLines.push(`크리 ${Math.round(buffs.critChance * 100)}%`);
  if (buffs.stunChance > 0) buffLines.push(`스턴 ${Math.round(buffs.stunChance * 100)}%`);
  if (buffs.splashDmg > 0) buffLines.push(`스플래시 ${Math.round(buffs.splashDmg * 100)}%`);
  if (buffs.doubleHitChance > 0) buffLines.push(`추가타 ${Math.round(buffs.doubleHitChance * 100)}%`);
  if (buffs.armorIgnore > 0) buffLines.push(`방무시 ${Math.round(buffs.armorIgnore * 100)}%`);
  if (buffs.slowPercent > 0) buffLines.push(`슬로우 ${Math.round(buffs.slowPercent * 100)}%`);
  if (buffs.bonusKillGold > 0) buffLines.push(`킬골드 +${buffs.bonusKillGold}`);
  if (buffs.bonusRoundGold > 0) buffLines.push(`라운드골드 +${buffs.bonusRoundGold}`);
  if (buffs.flatDmgBonus > 0) buffLines.push(`고정DMG +${buffs.flatDmgBonus}`);
  if (buffs.singleTargetMultiplier > 1.01) buffLines.push(`보스DMG ×${buffs.singleTargetMultiplier.toFixed(2)}`);
  if (buffLines.length > 0) {
    buffSummary = `<div class="tt-buffs">
      <div class="tt-buffs-label">🛡️ 시너지 버프</div>
      <div class="tt-buffs-list">${buffLines.join(' · ')}</div>
    </div>`;
  }

  tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';
  tooltipEl.innerHTML = `
    <div class="tt-name">${def.emoji} ${def.name} ${'⭐'.repeat(unit.star)}</div>
    <div class="tt-meta">
      <span class="tt-cost">코스트: ${def.cost}</span>
      <span class="tt-dmg-type" style="color:${dmgTypeColor}">${dmgTypeIcon}</span>
      <span class="tt-origin">${toCrypto(def.origin)}</span>
    </div>

    <div class="tt-stats">
      <div class="tt-stat-row">
        <span>⚔️ DMG: ${dmgText}</span>
        <span>📏 사거리: ${range}</span>
      </div>
      <div class="tt-stat-row">
        <span>⚡ 공속: ${atkText}</span>
        <span>💥 DPS: <span style="color:#fbbf24">${dps}</span></span>
      </div>
    </div>
    ${manaHtml}
    ${skillHtml}
    ${(() => {
      const dict = UNIT_DICTIONARY[unit.unitId];
      if (!dict) return '';
      let html = `<div class="tt-dict">`;
      html += `<div class="tt-role">${dict.role}</div>`;
      html += `<div class="tt-flavor">${dict.flavorText}</div>`;
      const showStars = dict.skillDesc.star2 !== '-';
      html += `<div class="tt-star-descs">`;
      if (showStars) {
        const descs = [
          { label: '★', text: dict.skillDesc.star1, star: 1 },
          { label: '★★', text: dict.skillDesc.star2, star: 2 },
          { label: '★★★', text: dict.skillDesc.star3, star: 3 },
        ];
        for (const sd of descs) {
          const cls = sd.star === unit.star ? 'tt-star-desc active' : 'tt-star-desc';
          html += `<div class="${cls}"><span class="tt-star-label">${sd.label}</span> ${sd.text}</div>`;
        }
      } else {
        html += `<div class="tt-star-desc active"><span class="tt-star-label">🌟</span> ${dict.skillDesc.star1}</div>`;
      }
      html += `</div></div>`;
      return html;
    })()}
    ${def.uniqueEffect ? `<div class="tt-effect">${def.uniqueEffect}</div>` : ''}
    ${buffSummary}
  `;
  // 뷰포트 클램핑
  tooltipEl.style.left = '-9999px';
  tooltipEl.style.top = '-9999px';
  document.body.appendChild(tooltipEl);
  const ttR = tooltipEl.getBoundingClientRect();
  let ttX = e.clientX + 12;
  let ttY = e.clientY + 12;
  if (ttX + ttR.width > window.innerWidth - 4) ttX = e.clientX - ttR.width - 4;
  if (ttY + ttR.height > window.innerHeight - 4) ttY = e.clientY - ttR.height - 12;
  if (ttX < 4) ttX = 4;
  if (ttY < 4) ttY = 4;
  tooltipEl.style.left = `${ttX}px`;
  tooltipEl.style.top = `${ttY}px`;
}

function hideTooltip(): void {
  tooltipEl?.remove();
  tooltipEl = null;
}

// ─── 우클릭 유닛 정보 패널 ─────────────────────────────────────
let unitInfoPanel: HTMLElement | null = null;
let unitInfoDetailOpen = false;

function showUnitInfoPanel(unit: UnitInstance, evt?: MouseEvent): void {
  hideUnitInfoPanel();
  hideTooltip();
  const def = UNIT_MAP[unit.unitId];
  if (!def) return;
  const dict = UNIT_DICTIONARY[unit.unitId];
  const starMult = STAR_MULTIPLIER[unit.star];
  const baseDmg = Math.floor(def.baseDmg * starMult);
  let range = def.attackRange ?? 2.5;
  const atkSpd = def.attackSpeed ?? 1.0;
  const dps = Math.floor(baseDmg * atkSpd);
  const skill = def.skill;
  const dmgTypeIcon = def.dmgType === 'magic' ? '🔮 마법' : '⚔️ 물리';
  const dmgTypeColor = def.dmgType === 'magic' ? '#c084fc' : '#fb923c';

  // passive 사거리 보정
  if (skill?.type === 'passive' && skill.params.rangeBonus) {
    range += skill.params.rangeBonus;
  }

  // 마나 바
  let manaHtml = '';
  if (def.maxMana && skill?.type === 'active') {
    const currentMana = Math.floor(unit.currentMana ?? 0);
    const maxMana = def.maxMana;
    const manaPct = Math.min(100, (currentMana / maxMana) * 100);
    manaHtml = `
      <div class="uip-mana">
        <span class="uip-mana-text">마나: ${currentMana}/${maxMana}</span>
        <div class="uip-mana-bar"><div class="uip-mana-fill" style="width:${manaPct}%"></div></div>
      </div>`;
  }

  // 스킬 영역
  let skillHtml = '';
  if (skill) {
    const typeLabels: Record<string, string> = {
      active: '🔥 액티브', onHit: '⚔️ 적중 시', onKill: '💀 킬 시',
      passive: '🔵 패시브', periodic: '🔄 주기적', onCombatStart: '🟢 전투 시작'
    };
    const starDesc = dict?.skillDesc;
    const currentDesc = starDesc
      ? (unit.star === 3 ? starDesc.star3 : unit.star === 2 ? starDesc.star2 : starDesc.star1)
      : skill.desc;

    skillHtml = `
      <div class="uip-skill">
        <div class="uip-skill-name">${typeLabels[skill.type] ?? skill.type} — ${skill.name}</div>
        <div class="uip-skill-desc">${currentDesc}</div>
      </div>`;
  }

  // ★별 설명
  let starDescsHtml = '';
  if (dict && dict.skillDesc.star2 !== '-') {
    const descs = [
      { label: '★1', text: dict.skillDesc.star1, star: 1 },
      { label: '★2', text: dict.skillDesc.star2, star: 2 },
      { label: '★3', text: dict.skillDesc.star3, star: 3 },
    ];
    starDescsHtml = '<div class="uip-stars">';
    for (const sd of descs) {
      const cls = sd.star === unit.star ? 'uip-star active' : 'uip-star';
      starDescsHtml += `<div class="${cls}"><span class="uip-star-label">${sd.label}</span> ${sd.text}</div>`;
    }
    starDescsHtml += '</div>';
  }

  // 역할
  const roleLine = dict ? `<div class="uip-role">${dict.role}</div>` : '';

  // 판매 가격
  const sellMult = unit.star === 3 ? 9 : unit.star === 2 ? 3 : 1;
  const sellPrice = def.cost * sellMult;
  const isOnBoard = player().board.some(u => u.instanceId === unit.instanceId);

  // 상세보기 컨텐츠 (숨김)
  let detailHtml = '';
  if (dict) {
    detailHtml = `
      <div class="uip-detail" style="display:none">
        <div class="uip-lore">${dict.lore}</div>
        <div class="uip-detail-flavor">"${dict.flavorText}"</div>
        ${starDescsHtml}
      </div>`;
  }

  unitInfoPanel = document.createElement('div');
  unitInfoPanel.className = 'unit-info-panel';
  unitInfoPanel.innerHTML = `
    <div class="uip-header">
      <span class="uip-name">${def.emoji} ${def.name} ${'⭐'.repeat(unit.star)}</span>
      <span class="uip-cost">💰 ${def.cost}</span>
    </div>
    <div class="uip-traits">
      <span style="color:${dmgTypeColor}">${dmgTypeIcon}</span>
      <span class="uip-origin">${toCrypto(def.origin)}</span>
    </div>
    <div class="uip-stats">
      <div class="uip-stat">공격: <span class="uip-val">${baseDmg}</span></div>
      <div class="uip-stat">사거리: <span class="uip-val">${range}</span></div>
      <div class="uip-stat">공속: <span class="uip-val">${atkSpd}/s</span></div>
      <div class="uip-stat">DPS: <span class="uip-val uip-gold">${dps}</span></div>
    </div>
    ${manaHtml}
    ${skillHtml}
    ${roleLine}
    ${detailHtml}
    <div class="uip-actions">
      <button class="uip-btn uip-btn-detail" data-uid="${unit.instanceId}">📖 상세보기</button>
    </div>
    <div class="uip-sell-hint">🗑️ 판매: E키 또는 드래그 → 판매존 (${sellPrice}G)</div>
  `;

  // 상세보기 토글
  unitInfoPanel.querySelector('.uip-btn-detail')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const detailEl = unitInfoPanel?.querySelector('.uip-detail') as HTMLElement;
    if (detailEl) {
      unitInfoDetailOpen = !unitInfoDetailOpen;
      detailEl.style.display = unitInfoDetailOpen ? 'block' : 'none';
      const btn = unitInfoPanel?.querySelector('.uip-btn-detail') as HTMLElement;
      if (btn) btn.textContent = unitInfoDetailOpen ? '📖 접기' : '📖 상세보기';
      // 펼쳤을 때 화면 밖 넘침 자동 보정
      if (unitInfoDetailOpen && unitInfoPanel) {
        requestAnimationFrame(() => {
          const rect = unitInfoPanel!.getBoundingClientRect();
          if (rect.bottom > window.innerHeight - 4) {
            const newTop = Math.max(4, window.innerHeight - rect.height - 4);
            unitInfoPanel!.style.top = `${newTop}px`;
          }
        });
      }
    }
  });

  // 패널 클릭 시 이벤트 전파 방지
  unitInfoPanel.addEventListener('click', (e) => e.stopPropagation());
  unitInfoPanel.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });

  // 클릭 위치에 패널 표시 (화면 밖 넘침 방지)
  if (evt) {
    const pad = 12;
    // 먼저 숨겨서 DOM에 추가 후 실제 크기 측정
    unitInfoPanel.style.left = '-9999px';
    unitInfoPanel.style.top = '-9999px';
    unitInfoPanel.style.transform = 'none';
    document.body.appendChild(unitInfoPanel);
    const panelRect = unitInfoPanel.getBoundingClientRect();
    const pw = panelRect.width;
    const ph = panelRect.height;
    let px = evt.clientX + pad;
    let py = evt.clientY + pad;
    // 우측 넘침
    if (px + pw > window.innerWidth - 4) px = evt.clientX - pw - pad;
    // 하단 넘침
    if (py + ph > window.innerHeight - 4) py = Math.max(4, window.innerHeight - ph - 4);
    // 좌측/상단 넘침
    if (px < 4) px = 4;
    if (py < 4) py = 4;
    unitInfoPanel.style.left = `${px}px`;
    unitInfoPanel.style.top = `${py}px`;
  }
  if (!unitInfoPanel.parentNode) document.body.appendChild(unitInfoPanel);
  unitInfoDetailOpen = false;
}

function hideUnitInfoPanel(): void {
  unitInfoPanel?.remove();
  unitInfoPanel = null;
  unitInfoDetailOpen = false;
}

// 전역: 빈 공간 클릭/우클릭 시 패널 닫기
document.addEventListener('click', () => {
  if (unitInfoPanel) hideUnitInfoPanel();
});
document.addEventListener('contextmenu', (e) => {
  // 패널이 열려 있고, 유닛 카드가 아닌 곳을 우클릭하면 패널 닫기
  const target = e.target as HTMLElement;
  if (unitInfoPanel && !target.closest('.unit-card') && !target.closest('.unit-info-panel')) {
    e.preventDefault();
    hideUnitInfoPanel();
  }
});

// ─── 판매존 (드래그 판매) ────────────────────────────────────
let hoveredUnit: UnitInstance | null = null;

function showSellZone(price: number): void {
  const zone = $('sell-zone');
  zone.classList.remove('hidden');
  $('sell-zone-price').textContent = String(price);
}

function hideSellZone(): void {
  const zone = $('sell-zone');
  zone.classList.add('hidden');
  zone.classList.remove('sell-zone-hover');
}

// 판매존 드래그 핸들러
const sellZone = $('sell-zone');
sellZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  sellZone.classList.add('sell-zone-hover');
});
sellZone.addEventListener('dragleave', () => {
  sellZone.classList.remove('sell-zone-hover');
});
sellZone.addEventListener('drop', (e) => {
  e.preventDefault();
  sellZone.classList.remove('sell-zone-hover');
  if (!draggedUnit) return;
  const p = player();
  const unit = [...p.board, ...p.bench].find(u => u.instanceId === draggedUnit!.instanceId);
  if (!unit) return;
  const def = UNIT_MAP[unit.unitId];
  if (!def) return;
  // 전투 중 보드 유닛 판매 불가
  const isOnBoard = p.board.some(u => u.instanceId === unit.instanceId);
  if (inCombat && isOnBoard) return;
  const sellMult = unit.star === 3 ? 9 : unit.star === 2 ? 3 : 1;
  const sellPrice = def.cost * sellMult;
  cmd.execute(state, {
    type: 'SELL_UNIT', playerId: p.id, instanceId: unit.instanceId,
  });
  log(`판매: ${def.emoji} ${def.name} ★${unit.star} (+${sellPrice}G)`, 'green');
  draggedUnit = null;
  selectedUnit = null;
  hideSellZone();
  render();
});

// 터치 드래그 판매존 지원
function checkTouchSellZone(touch: Touch): boolean {
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  const zone = el?.closest('#sell-zone');
  if (zone) {
    sellZone.classList.add('sell-zone-hover');
    return true;
  }
  sellZone.classList.remove('sell-zone-hover');
  return false;
}

// E키 판매 (롤토체스 방식)
document.addEventListener('keydown', (e) => {
  if (e.key === 'e' || e.key === 'E') {
    if (!hoveredUnit) return;
    const p = player();
    const unit = hoveredUnit;
    const def = UNIT_MAP[unit.unitId];
    if (!def) return;
    const isOnBoard = p.board.some(u => u.instanceId === unit.instanceId);
    if (inCombat && isOnBoard) return;
    const sellMult = unit.star === 3 ? 9 : unit.star === 2 ? 3 : 1;
    const sellPrice = def.cost * sellMult;
    cmd.execute(state, {
      type: 'SELL_UNIT', playerId: p.id, instanceId: unit.instanceId,
    });
    log(`판매: ${def.emoji} ${def.name} ★${unit.star} (+${sellPrice}G)`, 'green');
    selectedUnit = null;
    hoveredUnit = null;
    hideTooltip();
    hideUnitInfoPanel();
    render();
  }
});

// ─── 버튼 이벤트 ────────────────────────────────────────────

$('btn-reroll').addEventListener('click', () => {
  const p = player();
  const wasFree = p.freeRerolls > 0;
  const success = cmd.execute(state, { type: 'REROLL', playerId: p.id });
  if (success) {
    runStats.rerollCount++;
    if (wasFree) {
      log(`🔄 무료 리롤! (남은: ${p.freeRerolls})`, 'gold');
    } else {
      totalGoldSpent += 2;
      log('🔄 리롤 (-2G)', 'gold');
    }
  }
  render();
});

$('btn-buy-xp').addEventListener('click', () => {
  const success = cmd.execute(state, { type: 'BUY_XP', playerId: player().id });
  if (success) {
    runStats.xpBought++;
    totalGoldSpent += 4;
    log('📈 XP 구매 (-4G)', 'purple');
  }
  render();
});

$('btn-lock').addEventListener('click', () => {
  cmd.execute(state, { type: 'LOCK_SHOP', playerId: player().id });
  log(player().shopLocked ? '🔒 상점 잠금' : '🔓 상점 해제', 'blue');
  render();
});

$('btn-next-round').addEventListener('click', () => {
  if (!inCombat) startCombat();
});

// ─── 키보드 단축키 ──────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  const p = player();
  switch (e.key.toLowerCase()) {
    case 'd':
      const dOk = cmd.execute(state, { type: 'REROLL', playerId: p.id });
      if (dOk) {
        totalGoldSpent += 2;
        log('🔄 리롤 (D키)', 'gold');
      }
      render();
      break;
    case 'f':
      const fOk = cmd.execute(state, { type: 'BUY_XP', playerId: p.id });
      if (fOk) {
        totalGoldSpent += 4;
        log('📈 XP 구매 (F키)', 'purple');
      }
      render();
      break;
    case 'e':
      if (selectedUnit) {
        // 전투 중에는 보드 위 유닛 판매 불가
        const isOnBoard = p.board.some(u => u.instanceId === selectedUnit!.instanceId);
        if (inCombat && isOnBoard) break;
        cmd.execute(state, { type: 'SELL_UNIT', playerId: p.id, instanceId: selectedUnit.instanceId });
        log('판매 (E키)', 'green');
        selectedUnit = null;
        render();
      }
      break;
    case 's':
      break;
    case 'k':
      // Ctrl+K: 게임 오버 테스트
      if (e.ctrlKey) {
        e.preventDefault();
        p.hp = 0;
        showGameOver();
        log('💀 [DEBUG] 게임 오버 강제 트리거', 'red');
      }
      break;
    case ' ':
      e.preventDefault();
      if (!inCombat) {
        startCombat();
      } else {
        // 전투 중 Space = 일시정지/재개
        if (combat.isPaused) {
          combat.resume();
          gamePaused = false;
          log('▶️ 전투 재개 (Space)', 'blue');
        } else {
          combat.pause();
          gamePaused = true;
          log('⏸️ 전투 일시정지 (Space)', 'blue');
        }
        const pauseBtn = $('settings-pause') as HTMLButtonElement;
        pauseBtn.textContent = gamePaused ? '▶️ 재개' : '⏸️ 일시정지';
      }
      break;
    case 'escape':
      if (selectedUnit) {
        selectedUnit = null;
        render();
      }
      break;
  }
});

// ─── HUD 툴팁 이벤트 ────────────────────────────────────────

// 골드 호버
const goldHudItem = $('hud-gold').closest('.gold-pill') || $('hud-gold').closest('.hud-pill');
if (goldHudItem) {
  (goldHudItem as HTMLElement).style.position = 'relative';
  goldHudItem.addEventListener('mouseenter', () => showGoldTooltip(goldHudItem as HTMLElement));
  goldHudItem.addEventListener('mouseleave', removeHudTooltips);
}

// level hover — XP 구매 버튼 + 레벨 표시 + XP바 호버
const xpBuyBtn = document.getElementById('btn-buy-xp');
if (xpBuyBtn) {
  (xpBuyBtn as HTMLElement).style.position = 'relative';
  xpBuyBtn.addEventListener('mouseenter', () => showLevelTooltip(xpBuyBtn as HTMLElement));
  xpBuyBtn.addEventListener('mouseleave', removeHudTooltips);
}
// 레벨 영역 + XP바에도 확률 툴팁
document.querySelectorAll('.cb-level, .cb-xp').forEach(el => {
  (el as HTMLElement).style.position = 'relative';
  (el as HTMLElement).style.cursor = 'help';
  el.addEventListener('mouseenter', () => showLevelTooltip(el as HTMLElement));
  el.addEventListener('mouseleave', removeHudTooltips);
});

// ─── 유닛 정보 페이지 ────────────────────────────────────────
$('btn-info').addEventListener('click', () => {
  window.open('/dashboard.html', '_blank');
});

// ─── 게임 속도 토글 ──────────────────────────────────────────
$('btn-speed').addEventListener('click', () => {
  if (isMultiMode) return; // 경쟁전에서는 배속 비활성화
  const newSpeed = combat.toggleSpeed();
  const speedIcons = { 1: '▶', 2: '⏩', 3: '⚡' };
  const icon = speedIcons[newSpeed as 1 | 2 | 3] || '▶';
  $('btn-speed').textContent = `${icon} ${newSpeed}x`;
  $('btn-speed').classList.toggle('speed-fast', newSpeed >= 2);
  $('btn-speed').classList.toggle('speed-turbo', newSpeed >= 3);
});

// ─── 설정 모달 ──────────────────────────────────────────────

function openSettings(): void {
  $('settings-overlay').classList.remove('hidden');
  const pauseBtn = $('settings-pause') as HTMLButtonElement;
  pauseBtn.textContent = gamePaused ? '▶️ 재개' : '⏸️ 일시정지';
  // BGM 슬라이더 현재값 동기화
  ($('settings-bgm') as HTMLInputElement).value = String(Math.round(bgm.volume * 100));
  $('settings-bgm-val').textContent = `${Math.round(bgm.volume * 100)}%`;
  // 언어 드롭다운 동기화
  const langSelect = document.getElementById('settings-lang') as HTMLSelectElement;
  if (langSelect) langSelect.value = getLang();
}

function closeSettings(): void {
  $('settings-overlay').classList.add('hidden');
}

$('btn-settings').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', closeSettings);

$('settings-overlay').addEventListener('click', (e) => {
  if (e.target === $('settings-overlay')) closeSettings();
});

// 인게임 언어 전환
const settingsLangEl = document.getElementById('settings-lang') as HTMLSelectElement;
if (settingsLangEl) {
  settingsLangEl.addEventListener('change', () => {
    setLang(settingsLangEl.value as Lang);
    render();
  });
}

$('settings-restart').addEventListener('click', () => {
  if (!confirm('정말 다시 시작하시겠습니까? 모든 진행이 초기화됩니다.')) return;
  closeSettings();
  // 전투 중이면 중단
  if (inCombat) {
    combat.stopCombat();
    inCombat = false;
    document.getElementById('combat-overlay')?.remove();
    document.getElementById('combat-info')?.remove();
    $('board-section').classList.remove('combat-active');
  }
  // 상태 초기화
  const newState = createGameState(['player1']);
  Object.assign(state, newState);
  cmd.execute(state, { type: 'END_ROUND' }); // round 0 → 1
  selectedUnit = null;
  gamePaused = false;
  log('🔄 게임을 다시 시작합니다!', 'green');
  render();
});

$('settings-pause').addEventListener('click', () => {
  if (!inCombat) {
    log('⚠️ 전투 중에만 일시정지할 수 있습니다.', 'gold');
    return;
  }
  if (combat.isPaused) {
    combat.resume();
    gamePaused = false;
    log('▶️ 전투 재개', 'blue');
  } else {
    combat.pause();
    gamePaused = true;
    log('⏸️ 전투 일시정지', 'blue');
  }
  const pauseBtn = $('settings-pause') as HTMLButtonElement;
  pauseBtn.textContent = gamePaused ? '▶️ 재개' : '⏸️ 일시정지';
});

// 볼륨 슬라이더
($('settings-sfx') as HTMLInputElement).addEventListener('input', (e) => {
  const val = (e.target as HTMLInputElement).value;
  $('settings-sfx-val').textContent = `${val}%`;
  // 오디오 시스템 연동 시 여기에 추가
});

($('settings-bgm') as HTMLInputElement).addEventListener('input', (e) => {
  const val = (e.target as HTMLInputElement).value;
  $('settings-bgm-val').textContent = `${val}%`;
  bgm.volume = parseInt(val) / 100;
});

// Escape로 설정 모달 닫기
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('settings-overlay').classList.contains('hidden')) {
    closeSettings();
    e.stopPropagation();
  }
});

// ─── 우측 패널 탭 전환 ──────────────────────────────────────
document.querySelectorAll('.right-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    // 탭 버튼 활성화
    document.querySelectorAll('.right-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // 패널 전환
    const targetId = (btn as HTMLElement).dataset.tab;
    document.querySelectorAll('.tab-pane').forEach(pane => {
      (pane as HTMLElement).style.display = pane.id === targetId ? 'block' : 'none';
    });
  });
});

// ─── Dock Shop Bar — expand/collapse ───────────────────────

(function setupDockExpand() {
  const handle = document.getElementById('dock-expand-handle');
  const bar = document.getElementById('dock-shop-bar');
  const panel = document.getElementById('dock-expand-panel');
  if (!handle || !bar || !panel) return;

  handle.addEventListener('click', () => {
    bar.classList.toggle('expanded');
    panel.classList.toggle('hidden');
  });
})();

// ─── 첫 렌더 ────────────────────────────────────────────────

log('🎮 CoinRandomDefense v3.5 시작!', 'green');
log('D=리롤, F=XP구매, E=판매, Space=전투, 우클릭=판매', 'blue');
render();

// ═══════════════════════════════════════════════════════════
// PHASE 7: AI BRIDGE — Headless Puppeteer API
// ═══════════════════════════════════════════════════════════

// Task 2: 시간 가속 기본값
(window as any).__TIME_SCALE__ = 1;

// Task 1: AI Remote Control API (통합 버전)
(window as any).__AI_API__ = {
  /** XP 구매 (-4G, +4XP) */
  buyExp(): boolean {
    const ok = cmd.execute(state, { type: 'BUY_XP', playerId: player().id });
    if (ok) { totalGoldSpent += 4; render(); }
    return ok;
  },

  /** 상점 리롤 (-2G) */
  rerollShop(): boolean {
    const p = player();
    const ok = cmd.execute(state, { type: 'REROLL', playerId: p.id });
    if (ok) { totalGoldSpent += 2; render(); }
    return ok;
  },

  /** 상점 index번째 유닛 구매 → 벤치 */
  buyShopItem(index: number): boolean {
    const ok = cmd.execute(state, { type: 'BUY_UNIT', playerId: player().id, shopIndex: index });
    if (ok) render();
    return ok;
  },

  /** 벤치 index번째 유닛을 보드 (gridX, gridY)에 배치 */
  placeUnit(benchIndex: number, gridX: number, gridY: number): boolean {
    const p = player();
    if (benchIndex < 0 || benchIndex >= p.bench.length) return false;
    const unit = p.bench[benchIndex];
    const maxSlots = LEVELS.find(l => l.level === p.level)?.slots ?? 1;
    if (p.board.length >= maxSlots) return false;
    if (p.board.some(u => u.position?.x === gridX && u.position?.y === gridY)) return false;
    p.bench.splice(benchIndex, 1);
    unit.position = { x: gridX, y: gridY };
    p.board.push(unit);
    render();
    return true;
  },

  /** 자동 합성 실행 */
  triggerCombine(): number {
    const p = player();
    const before = p.board.length + p.bench.length;
    autoMergeAll(p);
    render();
    return before - (p.board.length + p.bench.length);
  },

  /** 즉시 전투 시작 */
  forceStartWave(): boolean {
    if (inCombat) return false;
    startCombat();
    return true;
  },

  /** 유닛 판매 */
  sellUnit(instanceId: string): boolean {
    return cmd.execute(state, {
      type: 'SELL_UNIT', playerId: player().id, instanceId,
    });
  },

  /** 현재 게임 상태 스냅샷 (상세 버전) */
  getState() {
    const p = player();
    const lvlDef = getLevelDef(p.level);
    return {
      round: state.round,
      phase: state.phase,
      gold: p.gold,
      life: p.hp,
      hp: p.hp,
      level: p.level,
      xp: p.xp,
      xpNeeded: p.level >= 10 ? 0 : lvlDef.requiredXp,
      boardCount: p.board.length,
      benchCount: p.bench.length,
      maxBoard: lvlDef.slots,
      shop: p.shop.map((id: string | null, i: number) => {
        if (!id) return null;
        const def = UNIT_MAP[id];
        return { index: i, unitId: id, name: def?.name, cost: def?.cost, origin: def?.origin };
      }),
      bench: p.bench.map((u: UnitInstance) => ({
        instanceId: u.instanceId, unitId: u.unitId,
        name: UNIT_MAP[u.unitId]?.name, star: u.star, benchIndex: p.bench.indexOf(u),
      })),
      board: p.board.map((u: UnitInstance) => ({
        instanceId: u.instanceId, unitId: u.unitId,
        name: UNIT_MAP[u.unitId]?.name, star: u.star,
        position: u.position,
      })),
      inCombat,
      isGameOver: p.hp <= 0,
      freeRerolls: p.freeRerolls || 0,
    };
  },

  /** 시간 가속 설정 */
  setTimeScale(scale: number) {
    (window as any).__TIME_SCALE__ = Math.max(1, scale);
  },
};

