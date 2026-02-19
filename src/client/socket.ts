// ============================================================
// Socket Client — multiplayer connection & state sync
// Pure relay — NO round sync (async racing mode)
// ============================================================

import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

// ── Types ──

export interface GameStartData {
    roomId: string;
    myIndex: number;
    isHost: boolean;
    players: { name: string; isBot: boolean; slotIndex: number }[];
}

export interface SyncStateData {
    slotIndex: number;
    hp: number;
    gold: number;
    level: number;
    round: number;       // 현재 라운드 번호
    roundLabel: string;   // 예: "2-4", "3-1" 등
    boardUnits: any[];
    benchUnits: any[];
}

export interface QueueUpdateData {
    count: number;
    isHost: boolean;
    players: string[];
}

// ── Connection ──

export function connectSocket(): Socket {
    if (socket?.connected) return socket;

    socket = io(window.location.origin, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => console.log('[Socket] Connected:', socket!.id));
    socket.on('disconnect', () => console.log('[Socket] Disconnected'));
    socket.on('connect_error', (err) => console.warn('[Socket] Error:', err.message));

    return socket;
}

// ── Queue ──

export function joinQueue(name: string) {
    if (!socket) connectSocket();
    socket!.emit('join_queue', { name });
}

export function leaveQueue() { socket?.emit('leave_queue'); }
export function startWithBots() { socket?.emit('start_with_bots'); }

// ── State Sync ──

export function emitSyncState(data: SyncStateData) {
    socket?.emit('sync_state', data);
}

// ── Event Listeners ──

export function onQueueUpdate(cb: (data: QueueUpdateData) => void) { socket?.on('queue_update', cb); }
export function onGameStart(cb: (data: GameStartData) => void) { socket?.on('game_start', cb); }
export function onSyncState(cb: (data: SyncStateData) => void) { socket?.on('sync_state', cb); }
export function onPlayerDisconnected(cb: (data: { socketId: string; slotIndex: number }) => void) {
    socket?.on('player_disconnected', cb);
}

// ── Speedrun Bounty ──

export function emitTimeAttack(data: { playerName: string; stage: number; elapsed: number }) {
    socket?.emit('time_attack_cleared', data);
}

export function onTimeAttack(cb: (data: { playerName: string; stage: number; elapsed: number }) => void) {
    socket?.on('time_attack_cleared', cb);
}

// ── Draft Room ──

export interface DraftCard {
    id: number;
    text: string;
    type: 'gold' | 'reroll' | 'hp' | 'unit';
    val: number;
    owner: string | null;
}

export function emitClaimDraft(cardId: number, playerName: string) {
    socket?.emit('claim_draft', { cardId, playerName });
}

export function emitGetDraft() {
    socket?.emit('get_draft');
}

export function onUpdateDraft(cb: (data: { cards: DraftCard[] }) => void) {
    socket?.on('update_draft', cb);
}

// ── Death / Clear / Match End ──

export function emitPlayerDied(round: string, playerName: string) {
    socket?.emit('player_died', { round, playerName });
}

export function emitGameCleared(round: string, playerName: string) {
    socket?.emit('game_cleared', { round, playerName });
}

export function onPlayerDiedBroadcast(cb: (data: { playerName: string; round: string }) => void) {
    socket?.on('player_died_broadcast', cb);
}

export function onPlayerClearedBroadcast(cb: (data: { playerName: string; round: string }) => void) {
    socket?.on('player_cleared_broadcast', cb);
}

export interface MatchRanking { rank: number; name: string; round: string; status: string; }

export function onMatchEnd(cb: (data: { rankings: MatchRanking[] }) => void) {
    socket?.on('match_end', cb);
}

// ── Cleanup ──

export function disconnectSocket() { socket?.disconnect(); socket = null; }
export function getSocket(): Socket | null { return socket; }
