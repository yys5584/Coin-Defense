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
import { GameState, PlayerState, UnitInstance, CombatState, ActiveSynergy } from './core/types';
import { createUnitVisual, preloadAllSprites, COST_GLOW, COST_GLOW_SHADOW, hasSpriteFor } from './client/sprites';

import './client/style.css';

// ─── PRO 로비 ──────────────────────────────────────────────────

import { initUserState, setCachedState, refreshState } from './client/userState';
import { renderLobby, setOnStartGame, renderResult } from './client/lobby';
import { runStart, runFinish } from './client/api';

const lobbyProEl = document.getElementById('lobby-pro');
const resultViewEl = document.getElementById('result-view');
const appEl = document.getElementById('app');

// 런 추적 변수
let currentRunId: string | null = null;
let currentStageId: number = 1;
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

  // BGM 시작
  bgm.play().catch(() => { });
});

// 결과→로비 복귀
function returnToLobby() {
  appEl?.classList.add('hidden');
  resultViewEl?.classList.add('hidden');
  lobbyProEl?.classList.remove('hidden');
  // 상태 새로고침 후 로비 다시 렌더
  refreshState().then(() => {
    if (lobbyProEl) renderLobby(lobbyProEl);
  }).catch(() => { });
}

initProLobby();


// ─── BGM ──────────────────────────────────────────────────
const bgm = new Audio('/music/v3song.mp3');
bgm.loop = true;
bgm.volume = 0.4;

// ─── 초기화 ─────────────────────────────────────────────────

const events = new EventBus();
const state = createGameState(['player1']);
const cmd = new CommandProcessor(events);
const combat = new CombatSystem(events);
preloadAllSprites(); // 스프라이트 미리 로드
const synergy = new SynergySystem(events);
const player = () => state.players[0];

// 게임 통계 추적
let totalGoldSpent = 0;
let gameStartTime = Date.now();

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

    const unit = p.bench[i];
    if (unit) {
      slot.appendChild(createUnitCard(unit, 'bench'));
      // Click fallback
      slot.addEventListener('click', () => {
        handleBenchClick(unit);
      });
    }

    // Drop target: board→bench or bench→bench reorder
    slot.addEventListener('dragover', (e) => {
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
      if (!draggedUnit) return;

      if (draggedUnit.from === 'board') {
        // 보드 → 벤치
        if (inCombat) return;
        cmd.execute(state, {
          type: 'BENCH_UNIT', playerId: p.id,
          instanceId: draggedUnit.instanceId,
        });
      }
      // bench→bench는 특별한 처리 없음 (순서는 상관없음)
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
  lockBtn.textContent = p.shopLocked ? '🔒 잠금중' : '🔓 잠금해제';

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
      slot.className = 'shop-slot cost-' + def.cost + (canMerge3 ? ' merge-ready-3' : canMerge2 ? ' merge-ready' : '');
      const mergeHint = canMerge3 ? '<span class="merge-badge">★★★</span>'
        : canMerge2 ? '<span class="merge-badge">★★</span>' : '';
      slot.innerHTML = `
        ${mergeHint}
        <span class="unit-emoji">${def.emoji}</span>
        <span class="unit-name">${def.name}</span>
        <span class="unit-origin">${toCrypto(def.origin)}</span>
        <span class="unit-cost">💰 ${def.cost}</span>
      `;

      // 상점 유닛 호버 툴팁
      slot.addEventListener('mouseenter', (e) => {
        const range = def.attackRange ?? 2.5;
        const atkSpd = def.attackSpeed ?? 1.0;
        const skill = def.skill;
        const skillTypeLabel: Record<string, string> = {
          onHit: '⚔️ 적중 시', onKill: '💀 킬 시', passive: '🔵 패시브',
          periodic: '🔄 주기적', onCombatStart: '🟢 전투 시작'
        };
        const skillTypeColor: Record<string, string> = {
          onHit: '#fb923c', onKill: '#f87171', passive: '#60a5fa',
          periodic: '#c084fc', onCombatStart: '#4ade80'
        };
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'tooltip';
        tooltipEl.innerHTML = `
          <div class="tt-name">${def.emoji} ${def.name}</div>
          <div class="tt-cost">코스트: ${def.cost}</div>
          <div class="tt-origin">특성: ${toCrypto(def.origin)}</div>

          <div class="tt-dmg">DMG: ${def.baseDmg} | 사거리: ${range} | 공속: ${atkSpd}/s</div>
          ${skill ? `<div class="tt-skill">
            <div class="tt-skill-header" style="color:${skillTypeColor[skill.type] ?? '#fff'}">
              ${skillTypeLabel[skill.type] ?? skill.type} — ${skill.name}
            </div>
            <div class="tt-skill-desc">${skill.desc}${skill.cooldown ? ` (${skill.cooldown}초)` : ''}${skill.chance && skill.chance < 1 ? ` [${Math.round(skill.chance * 100)}%]` : ''}</div>
          </div>` : ''}
          ${def.uniqueEffect ? `<div class="tt-effect">${def.uniqueEffect}</div>` : ''}
        `;
        tooltipEl.style.left = `${(e as MouseEvent).clientX + 12}px`;
        tooltipEl.style.top = `${(e as MouseEvent).clientY - 120}px`;
        document.body.appendChild(tooltipEl);
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
      tip.className = 'hud-tooltip synergy-tooltip';
      tip.innerHTML = bpHtml;
      tip.style.left = `${(e as MouseEvent).clientX + 12}px`;
      tip.style.top = `${(e as MouseEvent).clientY - 20}px`;
      tip.style.position = 'fixed';
      document.body.appendChild(tip);
    });
    row.addEventListener('mouseleave', removeHudTooltips);

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

  // 시너지 버프 계산
  const activeSynergies = synergy.calculateSynergies(p);
  const buffs = synergy.calculateBuffs(activeSynergies);
  const buffData = {
    dmgMult: buffs.dmgMultiplier,
    atkSpdMult: buffs.atkSpeedMultiplier,
    flatDmg: buffs.flatDmgBonus,
    doubleHit: buffs.doubleHitChance,
    splash: buffs.splashDmg,
  };
  const hasBuff = buffs.dmgMultiplier > 1.01 || buffs.atkSpeedMultiplier > 1.01 || buffs.flatDmgBonus > 0 || buffs.doubleHitChance > 0 || buffs.splashDmg > 0;

  const dpsEntries = p.board.map(unit => {
    const def = UNIT_MAP[unit.unitId];
    const baseDps = calculateUnitDPS(unit);
    const buffedDps = calculateUnitDPS(unit, buffData);
    const coverage = getRangeCoverage(unit);
    const effectiveDps = buffedDps * coverage;
    return {
      name: def?.name || unit.unitId,
      emoji: def?.emoji || '?',
      star: unit.star,
      baseDps,
      buffedDps,
      effectiveDps,
      coverage: Math.round(coverage * 100),
    };
  }).sort((a, b) => b.effectiveDps - a.effectiveDps);

  const totalEffDPS = dpsEntries.reduce((sum, e) => sum + e.effectiveDps, 0);
  $('hud-dps').textContent = Math.floor(totalEffDPS).toString();

  // TOP5 표시 (유효 DPS 기준)
  const top5 = dpsEntries.slice(0, 5);
  for (let i = 0; i < top5.length; i++) {
    const e = top5[i];
    const row = document.createElement('div');
    row.className = 'dps-row';
    const baseEff = Math.floor(e.baseDps * e.coverage / 100);
    const bonus = Math.floor(e.effectiveDps) - baseEff;
    const dpsDisplay = bonus > 0
      ? `${baseEff} <span class="dps-bonus">+${bonus}</span>`
      : `${Math.floor(e.effectiveDps)}`;
    row.innerHTML = `
      <span class="dps-rank">#${i + 1}</span>
      <span class="dps-emoji">${e.emoji}</span>
      <span class="dps-name">${e.name} ${'⭐'.repeat(e.star)}</span>
      <span class="dps-value">${dpsDisplay}</span>
    `;
    row.title = `기본: ${baseEff} | 시너지: +${bonus} | 유효: ${Math.floor(e.effectiveDps)} | 커버리지: ${e.coverage}%`;
    dpsList.appendChild(row);
  }

  // 총 유효 DPS
  const total = document.createElement('div');
  total.className = 'dps-total';
  total.innerHTML = `<span>유효 DPS</span><span>${Math.floor(totalEffDPS)}</span>`;
  dpsList.appendChild(total);

  if (hasBuff) {
    const buffRow = document.createElement('div');
    buffRow.className = 'dps-buff-info';
    buffRow.textContent = `시너지: DMG×${buffs.dmgMultiplier.toFixed(1)} 공속×${buffs.atkSpeedMultiplier.toFixed(1)}`;
    dpsList.appendChild(buffRow);
  }

  // 다음 스테이지 필요 DPS (커버리지 반영)
  const nextRound = state.round;
  const isBoss = nextRound % 10 === 0;
  let monsterCount: number;
  if (isBoss) {
    monsterCount = 1;
  } else if (getStage(nextRound) === 1) {
    monsterCount = nextRound === 1 ? 1 : nextRound === 2 ? 3 : 5;
  } else {
    monsterCount = 10;
  }
  // CombatSystem과 동일한 HP 공식 사용
  const monsterHp = isBoss
    ? Math.floor(nextRound * nextRound * 12 + nextRound * 150 + 300)
    : Math.floor(nextRound * nextRound * 0.52 + nextRound * 7.8 + 5);
  const totalHp = monsterHp * monsterCount;

  // 몬스터가 1바퀴 도는 시간
  const PATH_LEN = 28;
  const baseSpeed = 1.2 + nextRound * 0.012;
  const speed = baseSpeed * (1 - (buffs.slowPercent ?? 0));
  const onelapTime = PATH_LEN / speed;

  // 필요 유효 DPS = 총 HP ÷ 1바퀴 시간
  // 유효 DPS와 직접 비교 가능 (둘 다 커버리지 반영)
  const requiredEffDPS = Math.ceil(totalHp / onelapTime);
  const isEnough = totalEffDPS >= requiredEffDPS;

  const req = document.createElement('div');
  req.className = 'dps-required';
  req.innerHTML = `
    <span>${getStageRound(nextRound)} 필요</span>
    <span style="color:${isEnough ? '#4ade80' : '#f87171'}">${requiredEffDPS} DPS</span>
  `;
  dpsList.appendChild(req);

  if (isBoss) {
    const bossWarn = document.createElement('div');
    bossWarn.className = 'dps-boss-warn';
    bossWarn.textContent = `⚠️ 보스! HP: ${monsterHp.toLocaleString()}`;
    dpsList.appendChild(bossWarn);
  }

  // ── 다음 스테이지 방어 경향 예고 ──
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

  if (!isEnough) {
    const deficit = document.createElement('div');
    deficit.className = 'dps-deficit';
    deficit.textContent = `⚠ ${Math.ceil(requiredEffDPS - totalEffDPS)} DPS 부족`;
    dpsList.appendChild(deficit);
  }
}

// ─── 골드 툴팁 (HUD 호버) ───────────────────────────────────

function showGoldTooltip(targetEl: HTMLElement): void {
  removeHudTooltips();
  const p = player();
  const nextRound = state.round + 1;
  const isWarmup = getStage(nextRound) === 1;
  const base = getBaseIncome(nextRound);
  const interest = isWarmup ? 0 : getInterest(p.gold);
  const streakCount = Math.max(p.winStreak, p.lossStreak);
  const streak = isWarmup ? 0 : getStreakBonus(streakCount);

  // 토템 골드 (보드 위 roundEndGold passive 스킬 유닛)
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

  const total = base + interest + streak + totemGold;

  const streakLabel = p.winStreak > 0 ? `🔥 ${p.winStreak}연승` : p.lossStreak > 0 ? `💀 ${p.lossStreak}연패` : '없음';

  const totemRow = totemGold > 0
    ? `<div class="tt-row"><span class="tt-label">⛏️ 채굴 (${totemUnits.join(', ')})</span><span class="tt-value gold">+${totemGold}G</span></div>`
    : '';

  const tip = document.createElement('div');
  tip.className = 'hud-tooltip gold-tooltip';
  tip.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px">💰 ${getStageRound(nextRound)} 예상 수입</div>
    <div class="tt-row"><span class="tt-label">기본급</span><span class="tt-value gold">+${base}G</span></div>
    <div class="tt-row"><span class="tt-label">이자 (${p.gold}G / 10)</span><span class="tt-value gold">+${interest}G</span></div>
    <div class="tt-row"><span class="tt-label">연승보너스 (${streakLabel})</span><span class="tt-value green">+${streak}G</span></div>
    ${totemRow}
    <hr class="tt-divider">
    <div class="tt-row tt-total"><span>합계</span><span class="tt-value gold">+${total}G</span></div>
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

  const costLabels = ['1코', '2코', '3코', '4코', '5코'];

  let html = `<div style="font-weight:700;margin-bottom:6px">📊 Lv.${p.level} 상점 확률</div>`;

  for (let i = 0; i < 5; i++) {
    const pct = curLevel.shopOdds[i];
    html += `
      <div class="odds-row">
        <span class="odds-cost c${i + 1}">${costLabels[i]}</span>
        <div class="odds-bar-bg"><div class="odds-bar-fill c${i + 1}" style="width:${pct}%"></div></div>
        <span class="odds-pct">${pct}%</span>
      </div>`;
  }

  if (nextLevel && p.level < 10) {
    html += `<div class="tt-next-label">▶ Lv.${nextLevel.level} 확률</div>`;
    for (let i = 0; i < 5; i++) {
      const pct = nextLevel.shopOdds[i];
      const diff = pct - curLevel.shopOdds[i];
      const diffStr = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '';
      html += `
        <div class="odds-row">
          <span class="odds-cost c${i + 1}">${costLabels[i]}</span>
          <div class="odds-bar-bg"><div class="odds-bar-fill c${i + 1}" style="width:${pct}%"></div></div>
          <span class="odds-pct">${pct}%${diffStr ? ` (${diffStr})` : ''}</span>
        </div>`;
    }
  }

  const tip = document.createElement('div');
  tip.className = 'hud-tooltip level-tooltip';
  tip.innerHTML = html;
  targetEl.appendChild(tip);
}

function removeHudTooltips(): void {
  document.querySelectorAll('.hud-tooltip').forEach(el => el.remove());
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
  if (selectedUnit?.instanceId === unit.instanceId) card.classList.add('selected');

  // 코스트별 글로우 이펙트
  const glow = COST_GLOW_SHADOW[def.cost];
  if (glow) card.style.boxShadow = glow;

  const stars = '⭐'.repeat(unit.star);

  // 스프라이트 또는 이모지 시각 요소
  const visual = createUnitVisual(def.origin, def.emoji, 32);
  visual.classList.add('unit-visual');

  card.innerHTML = `
    <span class="name">${def.name}</span>
    <span class="star">${stars}</span>
    <span class="cost-badge">${def.cost}</span>
  `;
  card.insertBefore(visual, card.firstChild);

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
  });

  card.addEventListener('mouseenter', (e) => showTooltip(e as MouseEvent, unit));
  card.addEventListener('mouseleave', hideTooltip);

  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 전투 중에는 보드 위 유닛 판매 불가 (벤치 유닛은 가능)
    const isOnBoard = player().board.some(u => u.instanceId === unit.instanceId);
    if (inCombat && isOnBoard) return;
    const sellMultiplier = unit.star === 3 ? 9 : unit.star === 2 ? 3 : 1;
    cmd.execute(state, {
      type: 'SELL_UNIT', playerId: player().id, instanceId: unit.instanceId,
    });
    log(`판매: ${def.emoji} ${def.name} ★${unit.star} (+${def.cost * sellMultiplier}G)`, 'green');
    selectedUnit = null;
    render();
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
  if (inCountdown) return; // 카운트다운 중 전투 시작 방지
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
  combat.startCombat(
    state,
    p,
    buffs,
    // 렌더 콜백 (매 프레임)
    (combatState: CombatState) => {
      renderCombatOverlay(combatState);
    },
    // 완료 콜백
    (result: CombatResult) => {
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
  overlay.innerHTML = '';

  // 몬스터 렌더
  const grid = $('board-grid');
  const gridRect = grid.getBoundingClientRect();
  const wrapperRect = mapWrapper.getBoundingClientRect();
  // grid 내부 좌표 → wrapper 기준 좌표 계산
  const gridOffsetX = gridRect.left - wrapperRect.left;
  const gridOffsetY = gridRect.top - wrapperRect.top;
  const cellW = gridRect.width / 7;
  const cellH = gridRect.height / 4;
  const nowMs = performance.now();

  for (const m of cs.monsters) {
    if (!m.alive) continue;
    const pos = getPositionOnPath(m.pathProgress);
    const el = document.createElement('div');
    // 피격 플래시: 최근 150ms 이내 피격이면 hit 클래스 추가
    const isHit = m.hitTime && (nowMs - m.hitTime) < 150;
    el.className = `monster ${m.isBoss ? 'boss' : ''} ${isHit ? 'hit' : ''}`;

    // HP 바
    const hpPct = Math.max(0, m.hp / m.maxHp * 100);

    // 스프라이트 시트 분석값: 1024×258, 프레임 60×52, 8프레임/행
    const FRAME_W = 60;   // 실측: 프레임 간격 60px
    const FRAME_H = 52;   // 258 / 5행 ≈ 52
    // 일반 몬스터 1.0배, 보스 1.6배
    const spriteScale = m.isBoss ? 1.6 : 1.0;
    const displayW = Math.round(FRAME_W * spriteScale);
    const displayH = Math.round(FRAME_H * spriteScale);

    // 걷기 애니메이션: row 0, 8프레임
    const row = 0;
    const totalFrames = 8;
    const monsterOffset = cs.monsters.indexOf(m) * 2;
    const frameIdx = Math.floor(((nowMs + monsterOffset * 120) / 120) % totalFrames);

    // 정수 좌표 — pixel snapping
    const bgX = Math.round(frameIdx * FRAME_W * spriteScale);
    const bgY = Math.round(row * FRAME_H * spriteScale);
    const sheetW = Math.round(1024 * spriteScale);
    const sheetH = Math.round(258 * spriteScale);

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

    el.innerHTML = `
      <div class="monster-hp-bar"><div class="monster-hp-fill" style="width:${hpPct}%"></div></div>
      <div class="monster-sprite" style="
        width:${displayW}px; height:${displayH}px;
        background-image:url('/sprites/monster_goblin.png');
        background-size:${sheetW}px ${sheetH}px;
        background-position:-${bgX}px -${bgY}px;
        image-rendering:pixelated;
        filter: ${spriteFilter};
      "></div>
    `;

    // 위치: 정수 pixel snap (no sub-pixel positioning)
    el.style.left = `${Math.round(gridOffsetX + (pos.px + 0.5) * cellW)}px`;
    el.style.top = `${Math.round(gridOffsetY + (pos.py + 0.5) * cellH)}px`;

    overlay.appendChild(el);
  }

  // ── 투사체 렌더 ──
  for (const proj of cs.projectiles) {
    const t = Math.min((nowMs - proj.startTime) / proj.duration, 1.0);
    // 선형 보간: 유닛 위치 → 몬스터 위치
    const px = proj.fromX + (proj.toX - proj.fromX) * t;
    const py = proj.fromY + (proj.toY - proj.fromY) * t;
    const bullet = document.createElement('div');
    bullet.className = 'projectile';
    bullet.style.left = `${gridOffsetX + (px + 0.5) * cellW}px`;
    bullet.style.top = `${gridOffsetY + (py + 0.5) * cellH}px`;
    overlay.appendChild(bullet);
  }

  // ── 이펙트 렌더 (Unity: type별 VFX Prefab 매핑) ──
  for (const fx of cs.effects) {
    const progress = (nowMs - fx.startTime) / fx.duration; // 0~1
    if (progress >= 1) continue;

    const el = document.createElement('div');
    const fxX = gridOffsetX + (fx.x + 0.5) * cellW;
    const fxY = gridOffsetY + (fx.y + 0.5) * cellH;

    if (fx.type === 'damage' || fx.type === 'crit') {
      // 데미지 숫자 — 위로 떠오르며 사라짐
      el.className = fx.type === 'crit' ? 'fx-crit' : 'fx-damage';
      el.textContent = fx.value?.toString() ?? '';
      const floatY = fxY - progress * 30; // 위로 30px 이동
      el.style.left = `${fxX}px`;
      el.style.top = `${floatY}px`;
      el.style.opacity = `${1 - progress * 0.8}`;
      overlay.appendChild(el);

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
        overlay.appendChild(sprite);
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
      overlay.appendChild(el);
    } else if (fx.type === 'boss_warning') {
      // 보스 경고 — 전체 화면 플래시
      el.className = 'fx-boss-warn';
      el.textContent = '⚠️ BOSS ⚠️';
      el.style.opacity = `${1 - progress}`;
      overlay.appendChild(el);
    }
  }

  // 전투 정보 HUD
  let infoEl = document.getElementById('combat-info');
  if (!infoEl) {
    infoEl = document.createElement('div');
    infoEl.id = 'combat-info';
    $('board-section').appendChild(infoEl);
  }
  const aliveCount = cs.monsters.filter(m => m.alive).length;
  const pauseLabel = combat.isPaused ? ' ⏸️ 일시정지 (Space로 재개)' : '';
  infoEl.innerHTML = `
    ⚔️ 킬: ${cs.totalKills} | 남은: ${aliveCount + cs.spawnQueue} | 통과: ${cs.leakedDamage} | ${cs.elapsedTime.toFixed(1)}s${pauseLabel}
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
      if (aug.id === 'aug_heal') {
        // 재생의 오라: maxHP +20, 즉시 HP+5
        (p as any).maxHp = ((p as any).maxHp ?? 100) + 20;
        p.hp = Math.min(p.hp + 5, (p as any).maxHp);
        log('💚 최대 HP +20, HP +5 회복!', 'green');
      }
      if (aug.id === 'aug_bench_expand') {
        // 벤치 확장: 벤치 슬롯 +3
        log('🪑 벤치 슬롯 +3!', 'green');
      }
      if (aug.id === 'aug_extra_slot') {
        // 진격력: 보드 배치 슬롯 +1 (레벨 제한 완화)
        log('📶 보드 슬롯 +1!', 'green');
      }
      if (aug.id === 'aug_reroll_master') {
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
  if (['aug_crit_master', 'aug_splash_all', 'aug_berserker', 'aug_armor_break', 'aug_boss_slayer', 'aug_chain_light'].includes(augId)) return '⚔️ 전투';
  if (['aug_interest_king', 'aug_reroll_master', 'aug_xp_boost', 'aug_heal', 'aug_gold_rush', 'aug_lucky'].includes(augId)) return '💰 유틸';
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
  const totalGold = result.goldEarned + result.bonusGold;
  const gradeColors: Record<string, string> = { S: '#fbbf24', A: '#4ade80', B: '#60a5fa', F: '#f87171' };
  const gradeColor = gradeColors[result.grade] || '#94a3b8';
  const gradeLabel = result.bonusGold > 0 ? ` [${result.grade}등급 +${result.bonusGold}G]` : ` [${result.grade}등급]`;

  if (result.won) {
    p.gold += totalGold;
    log(`✅ 승리! 킬:${result.kills} 골드+${totalGold}${gradeLabel} (${result.elapsedTime.toFixed(1)}s)`, 'green');
  } else {
    cmd.getEconomy().applyDamage(p, result.damage);
    p.gold += totalGold;
    log(`💀 패배! 킬:${result.kills} -${result.damage}HP 골드+${totalGold}${gradeLabel}`, 'red');
  }

  // 등급 표시 플래시
  const gradeBadge = document.createElement('div');
  gradeBadge.style.cssText = `
    position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
    font-size:64px; font-weight:900; color:${gradeColor};
    text-shadow:0 0 30px ${gradeColor}80, 0 4px 8px rgba(0,0,0,0.5);
    z-index:9999; pointer-events:none; animation:gradeFlash 1.2s ease-out forwards;
  `;
  gradeBadge.textContent = result.grade;
  document.body.appendChild(gradeBadge);
  setTimeout(() => gradeBadge.remove(), 1300);

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
    showGameOver();
    return;
  }

  // 보스 라운드 체크 → 상자 드랍 + 해금
  if (isBossRound(state.round) && result.won) {
    runStats.totalBossKills++;
    // 보스 처치 시 무료 리롤 1회
    p.freeRerolls += 1;
    log('🎁 보스 처치! 무료 리롤 +1', 'gold');
    handleBossBox(state.round).then(() => {
      // ★ 캔페인 클리어 체크 (stageId+1의 x-7 도달 시)
      const targetStage = currentStageId + 1;
      const targetLabel = `${targetStage}-7`;
      if (getStage(state.round) >= targetStage && getStageRound(state.round) === targetLabel) {
        log(`🏆 스테이지 ${targetStage} 클리어! 축하합니다!`, 'gold');
        showGameOver();
        return;
      }
      afterCombatCleanup(p);
    });
    return; // chest popup handles the flow
  }

  // ★ 캔페인 클리어 체크 (보스가 아닌 경우에도)
  const targetStage2 = currentStageId + 1;
  const targetLabel2 = `${targetStage2}-7`;
  if (getStage(state.round) >= targetStage2 && getStageRound(state.round) === targetLabel2) {
    log(`🏆 스테이지 ${targetStage2} 클리어! 축하합니다!`, 'gold');
    showGameOver();
    return;
  }

  afterCombatCleanup(p);
}

function afterCombatCleanup(p: typeof state.players[0]): void {
  // ── 전투 후 자동 합성 (보드 1 + 벤치 2 = 2성 등) ──
  autoMergeAll(p);

  // 카운트다운 시작 — 전투 버튼 비활성화
  inCountdown = true;

  // 렌더 (골드 변경 반영, 상점 조작 가능)
  render();
  refreshUnlockPanel();

  // 3초 카운트다운 후 다음 라운드 (이자 판단 시간)
  let countdown = 3;
  const countdownEl = document.createElement('div');
  countdownEl.id = 'round-countdown';
  countdownEl.style.cssText = `
    position:fixed; bottom:120px; left:50%; transform:translateX(-50%);
    background:linear-gradient(135deg, #1a1a2e, #16213e);
    border:2px solid #e94560; border-radius:12px;
    padding:12px 24px; color:#fff; font-size:16px; font-weight:bold;
    z-index:999; text-align:center; box-shadow:0 4px 20px rgba(233,69,96,0.3);
    animation: fadeIn 0.2s ease;
  `;
  countdownEl.innerHTML = `⏱️ 다음 라운드까지 <span style="color:#e94560;font-size:20px">${countdown}</span>초`;
  document.body.appendChild(countdownEl);

  const timer = setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      clearInterval(timer);
      countdownEl.remove();
      inCountdown = false;
      // 다음 라운드
      cmd.execute(state, { type: 'END_ROUND' });
      render();
      refreshUnlockPanel();

      // 새 스테이지 시작(n-1) + stage 3 이상이면 증강 3택 표시
      const newStage = getStage(state.round);
      const sr = getStageRound(state.round);
      // 스테이지 시작 시 무료 리롤 1회
      if (sr.endsWith('-1') && newStage >= 2) {
        player().freeRerolls += 1;
        log(`🔄 S${newStage} 시작! 무료 리롤 +1`, 'gold');
      }
      if (newStage >= 3 && sr.endsWith('-1')) {
        showAugmentPick(state.round);
      }
    } else {
      countdownEl.innerHTML = `⏱️ 다음 라운드까지 <span style="color:#e94560;font-size:20px">${countdown}</span>초`;
    }
  }, 1000);
}

// ─── 게임 오버 화면 ──────────────────────────────────────────

async function showGameOver(): Promise<void> {
  const p = player();
  const reachedRound = state.round;
  const targetStage = currentStageId + 1;
  const cleared = getStage(reachedRound) >= targetStage && getStageRound(reachedRound) === `${targetStage}-7`;
  inCountdown = false;

  // 게임 화면 즉시 숨기기
  appEl?.classList.add('hidden');

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
  // passive 스킬 사거리 보정
  if (def.skill?.type === 'passive' && def.skill.params.rangeBonus) {
    range += def.skill.params.rangeBonus;
  }

  const grid = $('board-grid');
  const mapWrapper = document.getElementById('map-wrapper');
  if (!grid || !mapWrapper) return;

  const gridRect = grid.getBoundingClientRect();
  const wrapperRect = mapWrapper.getBoundingClientRect();
  const cellW = gridRect.width / 7;
  const cellH = gridRect.height / 4;

  // 셀 중심 (wrapper 기준)
  const centerX = (gridRect.left - wrapperRect.left) + (cellX + 0.5) * cellW;
  const centerY = (gridRect.top - wrapperRect.top) + (cellY + 0.5) * cellH;

  // 범위 = range * 셀 평균 크기
  const avgCellSize = (cellW + cellH) / 2;
  const radius = range * avgCellSize;

  const circle = document.createElement('div');
  circle.id = 'range-circle';
  circle.style.width = `${radius * 2}px`;
  circle.style.height = `${radius * 2}px`;
  circle.style.left = `${centerX - radius}px`;
  circle.style.top = `${centerY - radius}px`;
  mapWrapper.appendChild(circle);
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

  // 스킬 정보
  const skillTypeLabel: Record<string, string> = {
    onHit: '⚔️ 적중 시', onKill: '💀 킬 시', passive: '🔵 패시브',
    periodic: '🔄 주기적', onCombatStart: '🟢 전투 시작'
  };
  const skillTypeColor: Record<string, string> = {
    onHit: '#fb923c', onKill: '#f87171', passive: '#60a5fa',
    periodic: '#c084fc', onCombatStart: '#4ade80'
  };
  let skillHtml = '';
  if (skill) {
    skillHtml = `<div class="tt-skill">
      <div class="tt-skill-header" style="color:${skillTypeColor[skill.type] ?? '#fff'}">
        ${skillTypeLabel[skill.type] ?? skill.type} — ${skill.name}
      </div>
      <div class="tt-skill-desc">${skill.desc}${skill.cooldown ? ` (${skill.cooldown}초)` : ''}${skill.chance && skill.chance < 1 ? ` [${Math.round(skill.chance * 100)}%]` : ''}</div>
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

  // const jobName = toCrypto(def.job); // 직업 시너지 비활성화
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';
  tooltipEl.innerHTML = `
    <div class="tt-name">${def.emoji} ${def.name} ${'⭐'.repeat(unit.star)}</div>
    <div class="tt-cost">코스트: ${def.cost}</div>
    <div class="tt-origin">특성: ${toCrypto(def.origin)}</div>

    <div class="tt-dmg">DMG: ${dmgText} | 사거리: ${range} | 공속: ${atkText}</div>
    ${skillHtml}
    ${def.uniqueEffect ? `<div class="tt-effect">${def.uniqueEffect}</div>` : ''}
    ${buffSummary}
  `;
  tooltipEl.style.left = `${e.clientX + 12}px`;
  tooltipEl.style.top = `${e.clientY + 12}px`;
  document.body.appendChild(tooltipEl);
}

function hideTooltip(): void {
  tooltipEl?.remove();
  tooltipEl = null;
}

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

// level hover  
const levelHudItem = document.getElementById('floating-ctrl-panel') || $('hud-level').closest('.hud-pill');
if (levelHudItem) {
  (levelHudItem as HTMLElement).style.position = 'relative';
  levelHudItem.addEventListener('mouseenter', () => showLevelTooltip(levelHudItem as HTMLElement));
  levelHudItem.addEventListener('mouseleave', removeHudTooltips);
}

// ─── 유닛 정보 페이지 ────────────────────────────────────────
$('btn-info').addEventListener('click', () => {
  window.open('/dashboard.html', '_blank');
});

// ─── 게임 속도 토글 ──────────────────────────────────────────
$('btn-speed').addEventListener('click', () => {
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
}

function closeSettings(): void {
  $('settings-overlay').classList.add('hidden');
}

$('btn-settings').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', closeSettings);

$('settings-overlay').addEventListener('click', (e) => {
  if (e.target === $('settings-overlay')) closeSettings();
});

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
