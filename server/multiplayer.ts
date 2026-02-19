// ============================================================
// Multiplayer Module — Socket.io matchmaking & state relay
// Pure relay server — NO game logic, NO round sync
// ============================================================

import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';

interface QueueEntry {
    socket: Socket;
    name: string;
}

interface RoomPlayer {
    socketId: string;
    name: string;
    isBot: boolean;
    slotIndex: number;
}

interface DraftCard {
    id: number;
    text: string;
    type: 'gold' | 'reroll' | 'hp' | 'unit';
    val: number;
    owner: string | null;
}

interface PlayerResult {
    name: string;
    round: string;
    status: 'alive' | 'dead' | 'cleared';
}

interface Room {
    id: string;
    players: RoomPlayer[];
    hostSocketId: string;
    sharedDraft: DraftCard[];
    playerResults: Map<string, PlayerResult>;
}

function createDraftPool(): DraftCard[] {
    return [
        { id: 1, text: '💰 15G', type: 'gold', val: 15, owner: null },
        { id: 2, text: '🔄 무료 리롤 5회', type: 'reroll', val: 5, owner: null },
        { id: 3, text: '💖 HP 20 회복', type: 'hp', val: 20, owner: null },
        { id: 4, text: '🎲 4~5코 유닛', type: 'unit', val: 4, owner: null },
    ];
}

const queue: QueueEntry[] = [];
const rooms: Map<string, Room> = new Map();
const socketToRoom: Map<string, string> = new Map();

let roomCounter = 0;

function checkMatchEnd(room: Room, io: Server) {
    const realPlayers = room.players.filter(p => !p.isBot);
    const allDone = realPlayers.every(p => {
        const result = room.playerResults.get(p.socketId);
        return result && (result.status === 'dead' || result.status === 'cleared');
    });
    if (!allDone) return;

    // 랭킹 계산 (cleared > dead, 같은 상태면 round가 높은 순)
    const rankings = [...room.playerResults.values()].sort((a, b) => {
        if (a.status === 'cleared' && b.status !== 'cleared') return -1;
        if (b.status === 'cleared' && a.status !== 'cleared') return 1;
        return b.round.localeCompare(a.round);
    });

    console.log(`[MP] ═══ MATCH END: ${room.id} ═══`);
    rankings.forEach((r, i) => {
        const medal = ['🥇', '🥈', '🥉', '4️⃣'][i] || `${i + 1}`;
        console.log(`[MP] ${medal} ${r.name} — ${r.round} (${r.status})`);
    });

    io.in(room.id).emit('match_end', {
        rankings: rankings.map((r, i) => ({ rank: i + 1, name: r.name, round: r.round, status: r.status })),
    });
}

export function setupMultiplayer(httpServer: HttpServer) {
    const io = new Server(httpServer, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
        path: '/socket.io',
    });

    io.on('connection', (socket) => {
        console.log(`[MP] Connected: ${socket.id}`);

        // ── Join matchmaking queue ──
        socket.on('join_queue', (data: { name: string }) => {
            const name = data.name || `Player_${socket.id.slice(0, 4)}`;
            console.log(`[MP] ${name} joined queue`);

            const existing = queue.findIndex(q => q.socket.id === socket.id);
            if (existing >= 0) queue.splice(existing, 1);

            queue.push({ socket, name });
            broadcastQueueState();
        });

        // ── Leave queue ──
        socket.on('leave_queue', () => {
            const idx = queue.findIndex(q => q.socket.id === socket.id);
            if (idx >= 0) {
                queue.splice(idx, 1);
                broadcastQueueState();
            }
        });

        // ── Host starts game with bots filling remaining slots ──
        socket.on('start_with_bots', () => {
            if (queue.length === 0) return;
            if (queue[0].socket.id !== socket.id) return;

            const taken = queue.splice(0, Math.min(4, queue.length));
            roomCounter++;
            const roomId = `room_${roomCounter}`;
            const roomPlayers: RoomPlayer[] = [];

            taken.forEach((entry, i) => {
                roomPlayers.push({
                    socketId: entry.socket.id,
                    name: entry.name,
                    isBot: false,
                    slotIndex: i,
                });
                entry.socket.join(roomId);
                socketToRoom.set(entry.socket.id, roomId);
            });

            const botNames = ['BotAlpha', 'BotBravo', 'BotCharlie'];
            for (let i = taken.length; i < 4; i++) {
                roomPlayers.push({
                    socketId: `bot_${roomId}_${i}`,
                    name: botNames[i - taken.length] || `Bot${i}`,
                    isBot: true,
                    slotIndex: i,
                });
            }

            const room: Room = {
                id: roomId, players: roomPlayers, hostSocketId: socket.id,
                sharedDraft: createDraftPool(),
                playerResults: new Map(),
            };
            rooms.set(roomId, room);

            // 실제 플레이어 초기 결과 등록
            for (const rp of roomPlayers) {
                if (!rp.isBot) {
                    room.playerResults.set(rp.socketId, { name: rp.name, round: '1-1', status: 'alive' });
                }
            }

            console.log(`[MP] Room ${roomId}: ${taken.length} real + ${4 - taken.length} bots`);

            for (const rp of roomPlayers) {
                if (rp.isBot) continue;
                io.sockets.sockets.get(rp.socketId)?.emit('game_start', {
                    roomId,
                    myIndex: rp.slotIndex,
                    isHost: rp.socketId === room.hostSocketId,
                    players: roomPlayers.map(p => ({
                        name: p.name,
                        isBot: p.isBot,
                        slotIndex: p.slotIndex,
                    })),
                });
            }

            broadcastQueueState();
        });

        // ── Pure state relay — just forward to room ──
        socket.on('sync_state', (data: any) => {
            const roomId = socketToRoom.get(socket.id);
            if (!roomId) return;
            socket.to(roomId).emit('sync_state', data);
        });

        // ── Speedrun Bounty: broadcast time attack clear to room ──
        socket.on('time_attack_cleared', (data: { playerName: string; stage: number; elapsed: number }) => {
            const roomId = socketToRoom.get(socket.id);
            if (!roomId) return;
            console.log(`[MP] ⚡ ${data.playerName} speedrun stage ${data.stage} in ${data.elapsed.toFixed(1)}s`);
            socket.to(roomId).emit('time_attack_cleared', data);
        });

        // ── Draft Room: send current draft state on request ──
        socket.on('get_draft', () => {
            const roomId = socketToRoom.get(socket.id);
            if (!roomId) return;
            const room = rooms.get(roomId);
            if (!room) return;
            socket.emit('update_draft', { cards: room.sharedDraft });
        });

        // ── Draft Room: claim a reward card (atomic race-condition check) ──
        socket.on('claim_draft', (data: { cardId: number; playerName: string }) => {
            const roomId = socketToRoom.get(socket.id);
            if (!roomId) return;
            const room = rooms.get(roomId);
            if (!room) return;

            const card = room.sharedDraft.find(c => c.id === data.cardId);
            if (!card || card.owner !== null) {
                // Already claimed — send current state back to requester
                socket.emit('update_draft', { cards: room.sharedDraft });
                return;
            }

            // Atomic claim
            card.owner = data.playerName;
            console.log(`[MP] 🃏 ${data.playerName} claimed draft card: ${card.text}`);

            // Broadcast updated draft to entire room (including sender)
            io.in(roomId).emit('update_draft', { cards: room.sharedDraft });
        });

        // ── Player died — save result & broadcast ──
        socket.on('player_died', (data: { round: string; playerName: string }) => {
            const roomId = socketToRoom.get(socket.id);
            if (!roomId) return;
            const room = rooms.get(roomId);
            if (!room) return;

            room.playerResults.set(socket.id, { name: data.playerName, round: data.round, status: 'dead' });
            console.log(`[MP] ☠️ ${data.playerName} died at round ${data.round}`);
            socket.to(roomId).emit('player_died_broadcast', { playerName: data.playerName, round: data.round });
            checkMatchEnd(room, io);
        });

        // ── Player cleared 7-7 ──
        socket.on('game_cleared', (data: { round: string; playerName: string }) => {
            const roomId = socketToRoom.get(socket.id);
            if (!roomId) return;
            const room = rooms.get(roomId);
            if (!room) return;

            room.playerResults.set(socket.id, { name: data.playerName, round: data.round, status: 'cleared' });
            console.log(`[MP] 🏆 ${data.playerName} ALL CLEAR at ${data.round}!`);
            socket.to(roomId).emit('player_cleared_broadcast', { playerName: data.playerName, round: data.round });
            checkMatchEnd(room, io);
        });

        // ── Disconnect ──
        socket.on('disconnect', () => {
            console.log(`[MP] Disconnected: ${socket.id}`);

            const qIdx = queue.findIndex(q => q.socket.id === socket.id);
            if (qIdx >= 0) { queue.splice(qIdx, 1); broadcastQueueState(); }

            const roomId = socketToRoom.get(socket.id);
            if (roomId) {
                socketToRoom.delete(socket.id);
                const room = rooms.get(roomId);
                if (room) {
                    socket.to(roomId).emit('player_disconnected', {
                        socketId: socket.id,
                        slotIndex: room.players.find(p => p.socketId === socket.id)?.slotIndex,
                    });
                    if (room.players.filter(p => !p.isBot && p.socketId !== socket.id).length === 0) {
                        rooms.delete(roomId);
                    }
                }
            }
        });
    });

    function broadcastQueueState() {
        for (let i = 0; i < queue.length; i++) {
            queue[i].socket.emit('queue_update', {
                count: queue.length,
                isHost: i === 0,
                players: queue.map(q => q.name),
            });
        }
    }

    console.log('[MP] Multiplayer relay server attached');
    return io;
}
