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
import { DEFAULT_PORT, WS_PATH, decodeC2S, encode, type S2C } from '../src/net/protocol.ts';

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
const COUNTDOWN_MS = 3000;

type Player = { id: string; name: string; ready: boolean; ws: WebSocket };
type Room = { code: string; players: Player[]; started: boolean };

const rooms = new Map<string, Room>();

// No lookalikes (O/0, I/1/L) — these get read aloud over a call.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newRoom(): Room {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  const room: Room = { code, players: [], started: false };
  rooms.set(code, room);
  return room;
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

      // status/dead relay lands at N3/N4.
      case 'status':
      case 'dead':
        break;
    }
  });

  ws.on('close', () => {
    console.log(`[gone] ${me ? `${me.name} (${me.id})` : from}`);
    if (!room || !me) return;
    room.players = room.players.filter((p) => p !== me);
    if (room.players.length === 0) rooms.delete(room.code);
    else broadcastLobby(room);
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`race server on 0.0.0.0:${port} — ws at ${WS_PATH}, http sanity line at /`);
});
