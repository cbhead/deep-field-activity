/**
 * Race-mode relay server — N5: heartbeat, forfeit, resume.
 *
 * The server never runs game logic. Its whole job is: agree on a seed, ferry
 * status blobs between two clients, decide who won. In-memory rooms, zero
 * validation — cheating is a non-goal between two trusted friends.
 *
 * Binds 0.0.0.0 so the friend's machine can reach it over Tailscale — binding
 * localhost is the single most common first failure. The bare HTTP response
 * exists so reachability can be checked from a browser before any game client
 * exists: http://<tailscale-ip>:8787 should say the server is up.
 *
 * Connection lifecycle over the internet: sockets drop. A ws ping every 15s
 * finds dead ones; a dropped player's seat is held (roster survives players),
 * the opponent sees a peerConn badge, and a 90s timer settles the match for
 * the survivor if the seat stays empty. A client reclaims its seat by sending
 * hello with resume=<playerId>.
 */
import http from 'node:http';
import os from 'node:os';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_PORT, WS_PATH, decodeC2S, encode, type LobbyPlayer, type S2C, type Standing } from '../src/net/protocol.ts';
import { matchReport } from '../src/net/report.ts';
import { CAMPAIGN, levelById } from '../src/content/levels.ts';
import { DIFFICULTIES, DEFAULT_DIFFICULTY, type DifficultyId } from '../src/content/difficulty.ts';

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);

/**
 * Discord's proxy, and the `/.proxy` prefix.
 *
 * An Activity's network requests are sandboxed through `<app_id>.discordsays.com`.
 * The prefix used to be mandatory on same-origin requests — `/.proxy/ws` rather
 * than `/ws` — and as of Discord's 2025-07-30 change both forms work
 * identically. This server accepts either, which costs one string operation and
 * means the client never has to know which world it is in. Nothing on the
 * client writes the prefix; this exists so that an older client, a hand-typed
 * URL, or a reversal of that policy all still resolve.
 */
const PROXY_PREFIX = '/.proxy';
const stripProxy = (path: string): string =>
  path === PROXY_PREFIX
    ? '/'
    : path.startsWith(`${PROXY_PREFIX}/`)
      ? path.slice(PROXY_PREFIX.length)
      : path;

/**
 * OAuth2 credentials for the Activity handshake, from the environment only.
 *
 * The id is public — it ships in the client bundle as VITE_DISCORD_CLIENT_ID —
 * but the secret is not, never reaches the browser, and must never reach the
 * repo. Both absent is the normal case: a plain Tailscale match needs neither,
 * and the token route below says so rather than pretending to work.
 */
// The id falls back to the VITE_-prefixed one so `.env` needs two values, not
// three. They are always the same string — the application id — and asking for
// it twice under two names was a trap rather than a feature. The unprefixed
// name still wins if it is set, for a deployment that separates them.
const DISCORD_CLIENT_ID =
  process.env['DISCORD_CLIENT_ID'] ?? process.env['VITE_DISCORD_CLIENT_ID'] ?? '';
const DISCORD_CLIENT_SECRET = process.env['DISCORD_CLIENT_SECRET'] ?? '';

/**
 * Where match reports go, if anywhere. A Discord channel webhook URL.
 *
 * Set here rather than pasted into a browser, which is where it used to live.
 * Two reasons, one of them fatal: inside a Discord Activity the page cannot
 * reach `discord.com/api/webhooks` at all, because the iframe's CSP forbids it.
 * And a single sender means a single message — the old arrangement had to warn
 * you to configure exactly one machine or receive every result twice.
 *
 * Unset is the normal case, and means no reports. The channel is then simply
 * not a match ledger, which is a fine way to run.
 */
const DISCORD_WEBHOOK_URL = process.env['DISCORD_WEBHOOK_URL'] ?? '';

/** Env-overridable, like FORFEIT_MS: visual checks need to hold the countdown. */
const COUNTDOWN_MS = Number(process.env['COUNTDOWN_MS'] ?? 3000);
const HEARTBEAT_MS = 15_000;
/** Env-overridable so the forfeit path can be exercised in seconds in tests. */
const FORFEIT_MS = Number(process.env['FORFEIT_MS'] ?? 90_000);

/** Rematch reloads the page, so an emptied room must outlive its sockets. */
const EMPTY_ROOM_TTL_MS = 60_000;

type Player = { id: string; name: string; ready: boolean; ws: WebSocket };
type Room = {
  code: string;
  players: Player[];
  /**
   * Everyone in the room without a seat, in the order they will get one.
   *
   * A voice channel routinely holds five people and the relay seats two. Being
   * turned away was the first thing three of them met, which is a poor greeting
   * from a game they just opened together — so the rest wait here, watch the
   * race live, and are seated in turn.
   */
  watchers: Player[];
  started: boolean;
  /** The creator's pick, re-dealt in every lobby and start. Unvalidated —
   *  clients fall back to the baseline if they don't recognise it. */
  level: string;
  diff: string;
  /** Everyone who ever joined — a dropped player's seat, held for resume. */
  roster: Map<string, string>;
  /** Final figures per playerId — kept on the room, not the player, so a
   *  finished player who disconnects still counts toward the result. */
  finals: Map<string, Standing>;
  /** Last relayed status per playerId; the forfeit standings come from here. */
  lastStatus: Map<string, { wave: number; lives: number; elapsedMs: number }>;
  forfeitTimer: ReturnType<typeof setTimeout> | null;
  /** The Discord instance this room belongs to, so expiry can unindex it. */
  instance: string | null;
  /** The seed dealt for the match in progress — the report's reproduction handle. */
  seed: number;
};

const rooms = new Map<string, Room>();

/**
 * Discord instance id → room code.
 *
 * A second index rather than keying rooms by instance directly, because the
 * room code stays useful even when nobody had to read it out: it is what the
 * logs, the results card and the match report identify a game by, and a
 * snowflake would be a poor substitute in all three. The instance is how you
 * find the room; the code is what the room is called.
 */
const byInstance = new Map<string, string>();

// No lookalikes (O/0, I/1/L) — these get read aloud over a call.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newRoom(instance: string | null = null): Room {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  const room: Room = {
    code, players: [], watchers: [], started: false, level: 'level01', diff: 'standard',
    roster: new Map(), finals: new Map(), lastStatus: new Map(), forfeitTimer: null,
    instance, seed: 0,
  };
  rooms.set(code, room);
  if (instance !== null) byInstance.set(instance, code);
  return room;
}

/** Forget a room, and the instance pointing at it. */
function dropRoom(room: Room): void {
  rooms.delete(room.code);
  if (room.instance !== null && byInstance.get(room.instance) === room.code) {
    byInstance.delete(room.instance);
  }
}

/**
 * Fill an empty seat from the head of the queue, if there is one of each.
 *
 * Deliberately does nothing mid-match: a seat vacated while a race is running
 * belongs to the player who left until the forfeit timer decides otherwise, and
 * handing it to a stranger would drop them into a board already in progress
 * with someone else's lives.
 */
function seatNext(room: Room): boolean {
  if (room.started || room.players.length >= 2) return false;
  const next = room.watchers.shift();
  if (next === undefined) return false;
  next.ready = false;
  room.players.push(next);
  room.roster.set(next.id, next.name);
  console.log(`[seat] ${next.name} (${next.id}) takes a seat in room ${room.code}`);
  return true;
}

/** Ranking order: waves cleared, then lives remaining, then elapsed time. */
function rank(a: Standing, b: Standing): number {
  return b.wave - a.wave || b.lives - a.lives || a.elapsedMs - b.elapsedMs;
}

const send = (ws: WebSocket, msg: S2C): void => ws.send(encode(msg));

const broadcast = (room: Room, msg: S2C): void => room.players.forEach((p) => send(p.ws, msg));

/** Players and watchers alike — the room, not just the match. */
const broadcastAll = (room: Room, msg: S2C): void =>
  [...room.players, ...room.watchers].forEach((p) => send(p.ws, msg));

const seatOf = ({ id, name, ready }: Player): LobbyPlayer => ({ playerId: id, name, ready });

const broadcastLobby = (room: Room): void =>
  broadcastAll(room, {
    t: 'lobby',
    players: room.players.map(seatOf),
    watchers: room.watchers.map(seatOf),
    level: room.level,
    diff: room.diff,
  });

const standingFor = (room: Room, id: string): Standing =>
  room.finals.get(id) ?? {
    playerId: id,
    name: room.roster.get(id) ?? '?',
    ...(room.lastStatus.get(id) ?? { wave: 0, lives: 0, elapsedMs: 0 }),
  };

/**
 * Send the match report, if a webhook is configured. Never throws, never
 * blocks: the result is already on its way to both clients and a channel post
 * that fails is a missing line in a log, not a lost game.
 */
function postReport(
  room: Room,
  winnerId: string | null,
  standings: Standing[],
  forfeit: boolean,
): void {
  if (DISCORD_WEBHOOK_URL === '') return;

  const level = levelById(room.level) ?? CAMPAIGN[0]!;
  const diffId: DifficultyId = Object.hasOwn(DIFFICULTIES, room.diff)
    ? (room.diff as DifficultyId)
    : DEFAULT_DIFFICULTY;
  const content = matchReport(
    `${level.name} · ${DIFFICULTIES[diffId].name}`,
    room.code,
    room.seed,
    winnerId,
    standings,
    forfeit,
  );

  void fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  }).then(
    (r) => {
      if (r.ok) console.log(`[report] room ${room.code} posted to Discord`);
      else console.error(`[report] room ${room.code} rejected by Discord: ${r.status}`);
    },
    (err: unknown) => {
      console.error(`[report] room ${room.code} could not be sent`, err);
    },
  );
}

function settle(room: Room, forfeitWinner?: string): void {
  const standings = [...room.roster.keys()].map((id) => standingFor(room, id)).sort(rank);
  let winnerId: string | null;
  if (forfeitWinner !== undefined) {
    winnerId = forfeitWinner;
    standings.sort((a, b) => (a.playerId === forfeitWinner ? -1 : b.playerId === forfeitWinner ? 1 : 0));
  } else {
    const [first, second] = standings;
    winnerId = first && second && rank(first, second) === 0 ? null : (first?.playerId ?? null);
  }
  console.log(`[result] room ${room.code} winner=${winnerId ?? 'tie'}${forfeitWinner ? ' (forfeit)' : ''}`);
  // Everyone, not just the seats: the queue watched this and wants the result.
  broadcastAll(room, {
    t: 'result', winnerId, standings,
    ...(forfeitWinner !== undefined ? { reason: 'forfeit' as const } : {}),
  });
  // After the broadcast, deliberately: the players' results card should not
  // wait on a round trip to Discord.
  postReport(room, winnerId, standings, forfeitWinner !== undefined);
  // Reset for a rematch: same room, fresh readies, next start deals a new seed.
  room.started = false;
  room.finals.clear();
  room.lastStatus.clear();
  if (room.forfeitTimer !== null) clearTimeout(room.forfeitTimer);
  room.forfeitTimer = null;
  room.players.forEach((p) => {
    p.ready = false;
  });

  /**
   * Winner stays on.
   *
   * Only when somebody is actually waiting — with an empty queue nothing moves
   * and a rematch works exactly as it always did. But a queue that never
   * advances is not a queue, and two friends rematching forever while three
   * others watch is precisely the situation this was built to fix. So the loser
   * goes to the back and the head of the queue takes the seat.
   *
   * The loser is the *last* standing, which is already the ranking's answer,
   * and on a forfeit is the player who walked away — who is by then usually
   * gone anyway.
   */
  if (room.watchers.length > 0 && room.players.length === 2) {
    const loserId = standings[standings.length - 1]?.playerId;
    const loser = room.players.find((p) => p.id === loserId);
    if (loser !== undefined) {
      room.players = room.players.filter((p) => p !== loser);
      room.watchers.push(loser);
      seatNext(room);
      console.log(`[rotate] ${loser.name} yields the seat in room ${room.code}`);
    }
  }
  broadcastLobby(room);
}

// N6: the same process serves the built client, so one URL on one port is the
// whole deployment: http://<tailscale-ip>:8787/?race for both players, and the
// ws URL derives from the page's own host. No CDN, no second process, and both
// clients always run the same build because it comes from here.
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.map': 'application/json', '.woff2': 'font/woff2', '.json': 'application/json',
};

/**
 * The machine's Tailscale IPv4 (CGNAT range 100.64.0.0/10), if any. The lobby
 * asks via /info so invite links carry the address the *friend* can reach,
 * even when the host opened the page as localhost.
 */
function tailscaleIp(): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4') continue;
      const [first, second] = a.address.split('.').map(Number);
      if (first === 100 && second !== undefined && second >= 64 && second <= 127) return a.address;
    }
  }
  return null;
}

const readBody = async (req: http.IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * Trade the Activity's one-time OAuth code for an access token.
 *
 * This route exists for exactly one reason: the exchange needs the client
 * secret, and a secret in a browser is not a secret. The client posts a code
 * and gets a token back. Nothing else from the upstream response is forwarded —
 * it also carries a refresh token and the granted scopes, and the client needs
 * neither — and failures are logged here rather than echoed, so a misconfigured
 * secret cannot be diagnosed by anyone poking at the endpoint.
 */
async function handleToken(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (DISCORD_CLIENT_ID === '' || DISCORD_CLIENT_SECRET === '') {
    console.warn('[activity] /api/token called, but DISCORD_CLIENT_ID/SECRET are not in the environment');
    return json(503, { error: 'this server is not configured as a Discord Activity' });
  }

  let code: unknown;
  try {
    code = (JSON.parse(await readBody(req)) as { code?: unknown }).code;
  } catch {
    return json(400, { error: 'body must be JSON' });
  }
  if (typeof code !== 'string' || code === '') return json(400, { error: 'no code' });

  try {
    const upstream = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
      }),
    });
    const data = (await upstream.json()) as { access_token?: string };
    if (!upstream.ok || typeof data.access_token !== 'string') {
      console.error(`[activity] token exchange failed: ${upstream.status} ${JSON.stringify(data)}`);
      return json(502, { error: 'token exchange rejected' });
    }
    json(200, { access_token: data.access_token });
  } catch (err) {
    console.error('[activity] token exchange threw', err);
    json(502, { error: 'token exchange failed' });
  }
}

const httpServer = http.createServer((req, res) => {
  void (async () => {
    // Strip the query, then the proxy prefix, then any traversal; everything
    // must resolve inside dist/.
    const rawPath = stripProxy((req.url ?? '/').split('?')[0] ?? '/');
    if (rawPath === '/api/token') {
      await handleToken(req, res);
      return;
    }
    if (rawPath === '/info') {
      res.writeHead(200, { 'content-type': 'application/json' });
      // `app` identifies which checkout is answering.
      //
      // This fork and its upstream both default to 8787, and both are cloned on
      // the same machine, so whichever was started last owns the port. That has
      // now silently swapped the served game three times — and the symptom is
      // baffling: the Activity loads, plays, and asks for a callsign and a room
      // code, because it is upstream's build, which has never heard of Discord.
      // One field turns twenty minutes of that into one curl.
      res.end(JSON.stringify({ app: 'deep-field-activity', tailscaleIp: tailscaleIp(), port }));
      return;
    }
    let path = normalize(decodeURIComponent(rawPath)).replace(/^(\.\.[/\\])+|^[/\\]+/, '');
    if (path === '' || path === '.') path = 'index.html';
    // Extensionless paths get a `.html` if one exists, so the legal pages can be
    // `/terms` and `/privacy`. Those two URLs go into Discord's verification
    // form and get read by humans, and `.html` in a pasted URL is a small ugly
    // thing that lasts as long as the application does.
    if (extname(path) === '') {
      const asHtml = `${path}.html`;
      if (await readFile(join(DIST, asHtml)).then(() => true, () => false)) path = asHtml;
    }
    try {
      const body = await readFile(join(DIST, path));
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      // Before the first build (or for a stray path) keep the N0 sanity line:
      // reachability over Tailscale must be checkable with zero client built.
      res.writeHead(path === 'index.html' ? 200 : 404, { 'content-type': 'text/plain' });
      res.end(path === 'index.html' ? 'tower-defense race server is up — run `npm run play` to serve the game\n' : 'not found\n');
    }
  })();
});

// `noServer` rather than handing `ws` the path, because the path is now two
// paths: Discord may address the relay as `/.proxy/ws`. Everything else is
// refused rather than upgraded, which is what passing `path` used to buy.
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  if (stripProxy((req.url ?? '').split('?')[0] ?? '') !== WS_PATH) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

let nextPlayer = 1;

wss.on('connection', (ws: WebSocket, req) => {
  const from = req.socket.remoteAddress ?? '?';
  let me: Player | null = null;
  let room: Room | null = null;
  /** True while this connection holds no seat — it is in the queue, watching. */
  let watching = false;
  console.log(`[conn] ${from}`);

  // Heartbeat: browsers answer pings automatically, so a silent socket is a
  // dead one. Terminate fires 'close', which starts the forfeit clock.
  let alive = true;
  ws.on('pong', () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, HEARTBEAT_MS);

  ws.on('message', (data) => {
    const msg = decodeC2S(String(data));
    if (!msg) return;

    switch (msg.t) {
      case 'hello': {
        if (me) return;

        // Resume: reclaim a held seat after a drop, before the forfeit fires.
        if (msg.resume !== undefined && msg.room !== undefined) {
          const wanted = rooms.get(msg.room.toUpperCase());
          const seatHeld = wanted?.roster.has(msg.resume) === true &&
            !wanted.players.some((p) => p.id === msg.resume);
          if (wanted && seatHeld) {
            room = wanted;
            me = { id: msg.resume, name: msg.name, ready: room.started, ws };
            room.players.push(me);
            if (room.forfeitTimer !== null) clearTimeout(room.forfeitTimer);
            room.forfeitTimer = null;
            console.log(`[resume] "${me.name}" reclaims ${me.id} in room ${room.code}`);
            send(ws, { t: 'joined', playerId: me.id, room: room.code });
            room.players.filter((p) => p !== me).forEach((p) => send(p.ws, { t: 'peerConn', connected: true }));
            if (!room.started) broadcastLobby(room);
            return;
          }
          // Seat gone (forfeit fired, room expired) — fall through to a normal
          // join attempt so the client gets an honest error.
        }

        if (msg.instance !== undefined) {
          // Join-or-create, atomically, because both players press play at the
          // same moment and whichever socket lands first is arbitrary. A
          // missing room is the normal first case, not an error — which is the
          // whole difference between an instance and a typed room code.
          const existing = byInstance.get(msg.instance);
          const wanted = existing !== undefined ? rooms.get(existing) : undefined;
          if (wanted && !wanted.started && wanted.players.length < 2) {
            room = wanted;
          } else if (wanted) {
            // No longer a refusal. The room is busy — mid-match, or both seats
            // filled — so this connection joins the queue instead, watches, and
            // is seated in turn. Being turned away was the first thing three of
            // five people met.
            room = wanted;
            me = { id: `p${nextPlayer++}`, name: msg.name, ready: false, ws };
            room.watchers.push(me);
            watching = true;
            console.log(`[watch] "${me.name}" → ${me.id} waiting in room ${room.code} (${from})`);
            send(ws, { t: 'joined', playerId: me.id, room: room.code });
            broadcastLobby(room);
            return;
          } else {
            room = newRoom(msg.instance);
            if (msg.level !== undefined) room.level = msg.level;
            if (msg.diff !== undefined) room.diff = msg.diff;
            console.log(`[instance] ${msg.instance} → room ${room.code}`);
          }
        } else if (msg.room !== undefined) {
          const wanted = rooms.get(msg.room.toUpperCase());
          if (!wanted) return send(ws, { t: 'error', reason: `no room ${msg.room.toUpperCase()}` });
          if (wanted.players.length >= 2 || wanted.started) return send(ws, { t: 'error', reason: 'room is full' });
          room = wanted;
        } else {
          room = newRoom();
          if (msg.level !== undefined) room.level = msg.level;
          if (msg.diff !== undefined) room.diff = msg.diff;
        }
        me = { id: `p${nextPlayer++}`, name: msg.name, ready: false, ws };
        room.players.push(me);
        room.roster.set(me.id, me.name);
        console.log(`[hello] "${me.name}" → ${me.id} in room ${room.code} (${from})`);
        send(ws, { t: 'joined', playerId: me.id, room: room.code });
        broadcastLobby(room);
        break;
      }

      case 'ready': {
        // A watcher has no seat to ready. Without this their flag would show in
        // the queue as though they were about to play.
        if (!me || !room || room.started || watching) return;
        me.ready = msg.ready ?? true;
        console.log(`[ready] ${me.name} (${me.id}) ${me.ready ? 'ready' : 'un-readied'} in room ${room.code}`);
        broadcastLobby(room);
        if (room.players.length === 2 && room.players.every((p) => p.ready)) {
          room.started = true;
          // A fresh match: only current seat-holders count toward the result.
          room.roster = new Map(room.players.map((p) => [p.id, p.name]));
          const seed = (Math.random() * 0x100000000) >>> 0;
          // Kept on the room, not just broadcast: the match report names the
          // seed, and by the time a result settles the start message is long
          // gone.
          room.seed = seed;
          console.log(`[start] room ${room.code} seed=${seed} ${room.level}/${room.diff}`);
          broadcast(room, { t: 'start', seed, countdownMs: COUNTDOWN_MS, level: room.level, diff: room.diff });
        }
        break;
      }

      case 'pick': {
        // First seat only, and only before the countdown. Not a trust boundary
        // — cheating is a non-goal here as everywhere — but two clients each
        // believing they chose is a real bug rather than an exploit, so the
        // room has exactly one chooser and re-deals the result to both.
        if (!me || !room || room.started || room.players[0] !== me) return;
        room.level = msg.level;
        room.diff = msg.diff;
        console.log(`[pick] ${me.name} set room ${room.code} to ${room.level}/${room.diff}`);
        broadcastLobby(room);
        break;
      }

      // Relay, verbatim and unvalidated: the opponent's client is the only
      // consumer, and cheating is a non-goal between trusted friends.
      case 'status': {
        // A watcher has no board, so a status frame from one is meaningless —
        // and would put a spectator into the standings they are watching.
        if (!me || !room || watching) return;
        room.lastStatus.set(me.id, { wave: msg.wave, lives: msg.lives, elapsedMs: msg.elapsedMs });
        const other = room.players.find((p) => p !== me);
        if (other) {
          send(other.ws, {
            t: 'peer', wave: msg.wave, lives: msg.lives, elapsedMs: msg.elapsedMs,
            ...(msg.hidden !== undefined ? { hidden: msg.hidden } : {}),
            ...(msg.towers !== undefined ? { towers: msg.towers } : {}),
          });
        }
        // The queue sees both sides. Sent on each relayed frame rather than on a
        // timer of its own, so it inherits the pump's 2Hz and costs nothing when
        // nobody is waiting.
        if (room.watchers.length > 0) {
          // Captured, because the closure below loses the null-narrowing.
          const r = room;
          const live = r.players.map((p) => ({
            playerId: p.id,
            name: p.name,
            ...(r.lastStatus.get(p.id) ?? { wave: 0, lives: 0, elapsedMs: 0 }),
          }));
          r.watchers.forEach((w) => send(w.ws, { t: 'watchStatus', standings: live }));
        }
        break;
      }

      case 'dead': {
        // Guarded against watchers for a sharper reason than tidiness: `finals`
        // is settled on reaching two entries, so a watcher reporting a run would
        // end the match with one real player's figures and a spectator's.
        if (!me || !room || !room.started || watching) return;
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
    clearInterval(heartbeat);
    console.log(`[gone] ${me ? `${me.name} (${me.id})` : from}`);
    if (!room || !me) return;
    const r = room;
    const gone = me;

    if (watching) {
      // Somebody left the queue. Nothing about the match changes; the people
      // behind them simply move up, which the roster broadcast conveys.
      r.watchers = r.watchers.filter((p) => p !== gone);
      broadcastLobby(r);
      return;
    }

    r.players = r.players.filter((p) => p !== gone);

    if (r.players.length === 0 && r.watchers.length === 0) {
      // Both sides reload to rematch, so hold the room open briefly.
      r.started = false;
      if (r.forfeitTimer !== null) clearTimeout(r.forfeitTimer);
      r.forfeitTimer = null;
      setTimeout(() => {
        // dropRoom, not rooms.delete: an instance room that vanished from the
        // code table while still indexed by instance would send the next pair
        // in that channel to a room nobody can reach.
        if (r.players.length === 0 && r.watchers.length === 0) dropRoom(r);
      }, EMPTY_ROOM_TTL_MS);
      return;
    }

    // A seat opened outside a match — the queue fills it rather than the room
    // sitting one short while people wait.
    if (!r.started && seatNext(r)) {
      broadcastLobby(r);
      return;
    }

    if (r.started && !r.finals.has(gone.id)) {
      // Mid-match drop with an unfinished run: badge the survivor and start
      // the forfeit clock. A resume before it fires cancels it.
      broadcast(r, { t: 'peerConn', connected: false });
      if (r.forfeitTimer !== null) clearTimeout(r.forfeitTimer);
      r.forfeitTimer = setTimeout(() => {
        r.forfeitTimer = null;
        const survivor = r.players[0];
        if (r.started && survivor) {
          console.log(`[forfeit] ${gone.name} (${gone.id}) never returned to room ${r.code}`);
          settle(r, survivor.id);
        }
      }, FORFEIT_MS);
    } else {
      broadcastLobby(r);
    }
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  const ts = tailscaleIp();
  console.log(`race server listening on 0.0.0.0:${port} (ws at ${WS_PATH})`);
  console.log(`  Single-player:       http://localhost:${port}`);
  if (ts) {
    console.log(`  Race with a friend:  http://${ts}:${port}/?race`);
    console.log(`                       open that, then send the invite link the lobby shows you`);
  } else {
    console.log(`  Race with a friend:  no Tailscale IP detected — invite links will only work on`);
    console.log(`                       this machine. Start Tailscale and restart the server.`);
  }
});
