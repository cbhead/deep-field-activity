/**
 * Race-mode relay server — N1: rooms, lobby, ready → start.
 *
 * The server never runs game logic. Its whole job, even when finished
 * (~250 lines), is: agree on a seed, ferry status blobs between two clients,
 * decide who won. In-memory rooms, zero validation — cheating is a non-goal
 * between two trusted friends.
 *
 * Binds 0.0.0.0 so the friend's machine can reach it over Tailscale — binding
 * localhost is the single most common first failure. The bare HTTP response
 * exists so reachability can be checked from a browser before any game client
 * exists: http://<tailscale-ip>:8787 should say the server is up.
 */
import http from 'node:http';
import process from 'node:process';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_PORT, WS_PATH, decodeC2S, encode, type S2C, type Standing } from '../src/net/protocol.ts';

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
const COUNTDOWN_MS = 3000;

/** Rematch reloads the page, so an emptied room must outlive its sockets. */
const EMPTY_ROOM_TTL_MS = 60_000;

type Player = { id: string; name: string; ready: boolean; ws: WebSocket };
type Room = {
  code: string;
  players: Player[];
  started: boolean;
  /** Final figures per playerId — kept on the room, not the player, so a
   *  finished player who disconnects still counts toward the result. */
  finals: Map<string, Standing>;
};

const rooms = new Map<string, Room>();

// No lookalikes (O/0, I/1/L) — these get read aloud over a call.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newRoom(): Room {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  const room: Room = { code, players: [], started: false, finals: new Map() };
  rooms.set(code, room);
  return room;
}

/** Ranking order: waves cleared, then lives remaining, then elapsed time. */
function rank(a: Standing, b: Standing): number {
  return b.wave - a.wave || b.lives - a.lives || a.elapsedMs - b.elapsedMs;
}

function settle(room: Room): void {
  const standings = [...room.finals.values()].sort(rank);
  const [first, second] = standings;
  const tie = first && second && rank(first, second) === 0;
  const winnerId = tie || !first ? null : first.playerId;
  console.log(`[result] room ${room.code} winner=${winnerId ?? 'tie'}`);
  broadcast(room, { t: 'result', winnerId, standings });
  // Reset for a rematch: same room, fresh readies, next start deals a new seed.
  room.started = false;
  room.finals.clear();
  room.players.forEach((p) => {
    p.ready = false;
  });
}

const send = (ws: WebSocket, msg: S2C): void => ws.send(encode(msg));

const broadcast = (room: Room, msg: S2C): void => room.players.forEach((p) => send(p.ws, msg));

const broadcastLobby = (room: Room): void =>
  broadcast(room, {
    t: 'lobby',
    players: room.players.map(({ id, name, ready }) => ({ playerId: id, name, ready })),
  });

const httpServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('tower-defense race server is up\n');
});

const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

let nextPlayer = 1;

wss.on('connection', (ws: WebSocket, req) => {
  const from = req.socket.remoteAddress ?? '?';
  let me: Player | null = null;
  let room: Room | null = null;
  console.log(`[conn] ${from}`);

  ws.on('message', (data) => {
    const msg = decodeC2S(String(data));
    if (!msg) return;

    switch (msg.t) {
      case 'hello': {
        if (me) return;
        if (msg.room !== undefined) {
          const wanted = rooms.get(msg.room.toUpperCase());
          if (!wanted) return send(ws, { t: 'error', reason: `no room ${msg.room.toUpperCase()}` });
          if (wanted.players.length >= 2 || wanted.started) return send(ws, { t: 'error', reason: 'room is full' });
          room = wanted;
        } else {
          room = newRoom();
        }
        me = { id: `p${nextPlayer++}`, name: msg.name, ready: false, ws };
        room.players.push(me);
        console.log(`[hello] "${me.name}" → ${me.id} in room ${room.code} (${from})`);
        send(ws, { t: 'joined', playerId: me.id, room: room.code });
        broadcastLobby(room);
        break;
      }

      case 'ready': {
        if (!me || !room || room.started) return;
        console.log(`[ready] ${me.name} (${me.id}) in room ${room.code}`);
        me.ready = true;
        broadcastLobby(room);
        if (room.players.length === 2 && room.players.every((p) => p.ready)) {
          room.started = true;
          const seed = (Math.random() * 0x100000000) >>> 0;
          console.log(`[start] room ${room.code} seed=${seed}`);
          broadcast(room, { t: 'start', seed, countdownMs: COUNTDOWN_MS });
        }
        break;
      }

      // Relay, verbatim and unvalidated: the opponent's client is the only
      // consumer, and cheating is a non-goal between trusted friends.
      case 'status': {
        if (!me || !room) return;
        const other = room.players.find((p) => p !== me);
        if (other) send(other.ws, { t: 'peer', wave: msg.wave, lives: msg.lives, elapsedMs: msg.elapsedMs });
        break;
      }

      case 'dead': {
        if (!me || !room || !room.started) return;
        console.log(`[dead] ${me.name} (${me.id}) wave=${msg.wave} lives=${msg.lives}`);
        room.finals.set(me.id, {
          playerId: me.id, name: me.name,
          wave: msg.wave, lives: msg.lives, elapsedMs: msg.elapsedMs,
        });
        if (room.finals.size === 2) settle(room);
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log(`[gone] ${me ? `${me.name} (${me.id})` : from}`);
    if (!room || !me) return;
    const r = room;
    r.players = r.players.filter((p) => p !== me);
    if (r.players.length === 0) {
      // Both sides reload to rematch, so hold the room open briefly.
      r.started = false;
      setTimeout(() => {
        if (r.players.length === 0) rooms.delete(r.code);
      }, EMPTY_ROOM_TTL_MS);
    } else {
      broadcastLobby(r);
    }
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`race server on 0.0.0.0:${port} — ws at ${WS_PATH}, http sanity line at /`);
});
