/**
 * Do two clients who launched the same Discord Activity end up in the same
 * race? `npm run rooms`.
 *
 * That question is the whole of gap #5, and it cannot be answered by the
 * browser gates: it needs two clients and a relay between them, which is why
 * every race path in this repo has been "reasoned about rather than observed"
 * up to now. It does not, however, need a browser — the relay speaks JSON over
 * a socket, so a pair of `ws` clients can exercise the real server and the real
 * protocol without any of the rendering.
 *
 * What it deliberately does not cover: the game. This asserts room identity,
 * the chooser rule and seed fairness — the parts an instance changed. Whether
 * the match then plays correctly is what a real match night is for.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { sleep } from './cdp.ts';
import { WS_PATH, PROTOCOL_VERSION, type C2S, type S2C } from '../src/net/protocol.ts';

const PORT = 8795;
/** Stands in for Discord: the relay posts match reports here. */
const HOOK_PORT = 8796;

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  const mark = ok ? '\x1b[32mok \x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${mark} ${label}${detail === '' ? '' : `  \x1b[2m${detail}\x1b[0m`}`);
  if (!ok) failures++;
}

/** One test client: send typed messages, await the next of a given kind. */
class Client {
  private ws: WebSocket;
  private inbox: S2C[] = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (raw: Buffer) => this.inbox.push(JSON.parse(raw.toString()) as S2C));
  }

  static async open(): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${WS_PATH}`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new Client(ws);
  }

  send(msg: C2S): void {
    this.ws.send(JSON.stringify(msg));
  }

  hello(name: string, instance: string, level?: string, diff?: string): void {
    this.send({
      t: 'hello', v: PROTOCOL_VERSION, name, instance,
      ...(level === undefined ? {} : { level }),
      ...(diff === undefined ? {} : { diff }),
    });
  }

  /** The next message of this type, or null if it never arrives. */
  async next<T extends S2C['t']>(type: T, tries = 40): Promise<Extract<S2C, { t: T }> | null> {
    for (let i = 0; i < tries; i++) {
      const hit = this.inbox.find((m) => m.t === type);
      if (hit) {
        this.inbox = this.inbox.filter((m) => m !== hit);
        return hit as Extract<S2C, { t: T }>;
      }
      await sleep(50);
    }
    return null;
  }

  /** The most recent message of a type, letting earlier ones settle first. */
  async settled<T extends S2C['t']>(type: T, ms = 400): Promise<Extract<S2C, { t: T }> | null> {
    await sleep(ms);
    const all = this.inbox.filter((m) => m.t === type);
    this.inbox = this.inbox.filter((m) => m.t !== type);
    return (all[all.length - 1] as Extract<S2C, { t: T }>) ?? null;
  }

  close(): void {
    this.ws.close();
  }
}

async function main(): Promise<void> {
  // A webhook the relay can actually reach, so the report path is exercised end
  // to end rather than mocked. Discord's real endpoint would reject us and, more
  // to the point, would post to a channel.
  const posted: string[] = [];
  const hook = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      posted.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => hook.listen(HOOK_PORT, '127.0.0.1', r));

  const relay = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      fileURLToPath(new URL('../server/index.ts', import.meta.url)),
    ],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        COUNTDOWN_MS: '50',
        DISCORD_WEBHOOK_URL: `http://127.0.0.1:${HOOK_PORT}/hook`,
      },
      stdio: 'ignore',
    },
  );

  const clients: Client[] = [];
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await sleep(150);
      up = await fetch(`http://127.0.0.1:${PORT}/info`).then((r) => r.ok, () => false);
    }
    if (!up) throw new Error('the relay never came up');

    console.log('\ntwo pilots, one channel');
    const a = await Client.open();
    const b = await Client.open();
    clients.push(a, b);

    // Both at once, deliberately: whichever socket the server sees first is
    // arbitrary, and "creates it" versus "joins it" must not depend on that.
    a.hello('Ada', 'instance-alpha', 'level02', 'blackout');
    b.hello('Bo', 'instance-alpha', 'level01', 'recon');

    const joinedA = await a.next('joined');
    const joinedB = await b.next('joined');
    check('both are admitted', joinedA !== null && joinedB !== null);
    check(
      'and land in the same room, with no code exchanged',
      joinedA !== null && joinedB !== null && joinedA.room === joinedB.room,
      `${joinedA?.room ?? '—'} / ${joinedB?.room ?? '—'}`,
    );

    const rosterA = await a.settled('lobby');
    check(
      'the roster shows both pilots',
      rosterA?.players.length === 2,
      (rosterA?.players ?? []).map((p) => p.name).join(' + ') || 'empty',
    );

    console.log('\nthe room has exactly one chooser');
    // Whoever holds seat one — the roster's order is the server's.
    const seatOne = rosterA?.players[0]?.playerId;
    const chooser = seatOne === joinedA?.playerId ? a : b;
    const other = chooser === a ? b : a;

    chooser.send({ t: 'pick', level: 'level03', diff: 'standard' });
    const afterPick = await other.settled('lobby');
    check(
      "seat one's pick reaches the other client",
      afterPick?.level === 'level03' && afterPick.diff === 'standard',
      `${afterPick?.level ?? '—'}/${afterPick?.diff ?? '—'}`,
    );

    other.send({ t: 'pick', level: 'level01', diff: 'recon' });
    const afterIgnored = await chooser.settled('lobby');
    check(
      "and seat two's is ignored rather than obeyed",
      afterIgnored === null || (afterIgnored.level === 'level03' && afterIgnored.diff === 'standard'),
      afterIgnored === null ? 'no broadcast at all' : `${afterIgnored.level}/${afterIgnored.diff}`,
    );

    console.log('\nthe channel chooses its game');
    // The gap this closes: on a plain URL you pick the game by opening `?race`
    // or `?versus`, but inside an Activity everyone arrives at the same address
    // and there is no such moment. So the game becomes something the room is
    // *set to*, by the same seat and the same message that sets the board.
    check('a room opens on Race, as a v1 client would have meant', afterPick?.mode === 'race', afterPick?.mode ?? '—');

    chooser.send({ t: 'pick', level: 'level03', diff: 'standard', mode: 'versus' });
    const toVersus = await other.settled('lobby');
    check(
      "seat one's choice of game reaches the other client",
      toVersus?.mode === 'versus',
      toVersus?.mode ?? '—',
    );

    other.send({ t: 'pick', level: 'level03', diff: 'standard', mode: 'race' });
    const notTheirs = await chooser.settled('lobby');
    check(
      'and seat two cannot switch it back',
      notTheirs === null || notTheirs.mode === 'versus',
      notTheirs === null ? 'no broadcast at all' : notTheirs.mode,
    );

    // The reason `mode` is optional on the wire: a client that predates the
    // picker sends level and diff only, and must not knock the room out of
    // Versus by choosing a sector.
    chooser.send({ t: 'pick', level: 'level02', diff: 'standard' });
    const modeless = await other.settled('lobby');
    check(
      'a pick with no mode leaves the game alone',
      modeless?.mode === 'versus' && modeless.level === 'level02',
      `${modeless?.mode ?? '—'} ${modeless?.level ?? '—'}`,
    );

    // Put it back, so the sections below still describe a race.
    chooser.send({ t: 'pick', level: 'level03', diff: 'standard', mode: 'race' });
    await other.settled('lobby');

    console.log('\na third and fourth pilot join the queue, not a wall');
    const c = await Client.open();
    const d2 = await Client.open();
    clients.push(c, d2);
    c.hello('Cy', 'instance-alpha');
    await c.next('joined');
    d2.hello('Dee', 'instance-alpha');
    await d2.next('joined');

    const queued = await c.settled('lobby');
    check('they are admitted rather than refused', queued !== null);
    check(
      'seated as watchers, in arrival order',
      (queued?.watchers ?? []).map((w) => w.name).join(', ') === 'Cy, Dee',
      (queued?.watchers ?? []).map((w) => w.name).join(', ') || 'none',
    );
    check(
      'and the seats are still the original two',
      (queued?.players ?? []).map((p) => p.name).sort().join(', ') === 'Ada, Bo',
      (queued?.players ?? []).map((p) => p.name).join(', '),
    );

    console.log('\na different channel is a different race');
    const d = await Client.open();
    clients.push(d);
    d.hello('Di', 'instance-beta');
    const joinedD = await d.next('joined');
    check(
      'and gets a room of its own',
      joinedD !== null && joinedD.room !== joinedA?.room,
      `${joinedD?.room ?? '—'} vs ${joinedA?.room ?? '—'}`,
    );

    console.log('\none seed, two boards');
    a.send({ t: 'ready' });
    b.send({ t: 'ready' });
    const startA = await a.next('start');
    const startB = await b.next('start');
    check('both are started', startA !== null && startB !== null);
    check(
      'on the same seed — the fairness the whole mode rests on',
      startA !== null && startB !== null && startA.seed === startB.seed,
      `0x${(startA?.seed ?? 0).toString(16)} / 0x${(startB?.seed ?? 0).toString(16)}`,
    );
    check(
      'and the same board, as chosen from inside the room',
      startA?.level === 'level03' && startB?.level === 'level03' && startA.diff === startB.diff,
      `${startA?.level ?? '—'} / ${startB?.level ?? '—'}`,
    );
    check(
      'and the same game — what boots is settled here, not read off a URL',
      startA?.mode === 'race' && startB?.mode === 'race',
      `${startA?.mode ?? '—'} / ${startB?.mode ?? '—'}`,
    );

    console.log('\nthe queue watches the race');
    a.send({ t: 'status', wave: 4, lives: 18, elapsedMs: 30_000 });
    b.send({ t: 'status', wave: 2, lives: 9, elapsedMs: 30_000 });
    const live = await c.settled('watchStatus');
    check('a watcher is sent both sides, not one', live?.standings.length === 2, `${live?.standings.length ?? 0} side(s)`);
    check(
      'with names, since a watcher has no board to read',
      (live?.standings ?? []).every((s) => s.name !== '') &&
        (live?.standings ?? []).some((s) => s.name === 'Ada' && s.wave === 4),
      (live?.standings ?? []).map((s) => `${s.name} w${s.wave}`).join(' / '),
    );

    let postedLen = 0;

    console.log('\nthe relay files the match report');
    // Both finish, which settles the match and triggers the post.
    const done = { wave: 7, lives: 12, elapsedMs: 84_000 };
    a.send({ t: 'dead', ...done });
    b.send({ t: 'dead', wave: 5, lives: 3, elapsedMs: 91_000 });
    await a.next('result');
    await sleep(600);

    check('a report was sent, without any browser holding a webhook', posted.length === 1, `${posted.length} post(s)`);
    const body = posted[0] === undefined ? null : (JSON.parse(posted[0]) as { content?: string });
    const content = body?.content ?? '';
    check('it names the winner', content.includes('Ada defeats Bo'), content.split('\n')[0] ?? '(empty)');
    check(
      'the board by its name, not its id, and the seed to reproduce it',
      content.includes('Pincer') && !content.includes('level03') && content.includes('seed 0x'),
      content.split('\n')[1] ?? '',
    );
    check('and both pilots’ figures', content.includes('Ada — wave 7') && content.includes('Bo — wave 5'));

    console.log('\nwinner stays on');
    const rotated = await c.settled('lobby');
    check(
      'the loser yields their seat to the head of the queue',
      (rotated?.players ?? []).map((p) => p.name).sort().join(', ') === 'Ada, Cy',
      (rotated?.players ?? []).map((p) => p.name).join(' + ') || 'none',
    );
    check(
      'and goes to the back of it, behind whoever was waiting',
      (rotated?.watchers ?? []).map((w) => w.name).join(', ') === 'Dee, Bo',
      (rotated?.watchers ?? []).map((w) => w.name).join(', ') || 'none',
    );
    check(
      'the winner keeps playing',
      (rotated?.players ?? []).some((p) => p.name === 'Ada'),
    );

    console.log('\na channel that chose Versus plays Versus');
    // A fresh channel, so none of the rotation above is in the way. This is the
    // path the Activity actually takes: nobody typed a URL, nobody sent a link,
    // and the game was decided from inside the room.
    const e = await Client.open();
    const f = await Client.open();
    clients.push(e, f);
    e.hello('Eve', 'instance-gamma');
    const joinedE = await e.next('joined');
    f.hello('Fin', 'instance-gamma');
    await f.next('joined');

    const vRoster = await e.settled('lobby');
    const vSeatOne = vRoster?.players[0]?.playerId === joinedE?.playerId ? e : f;
    vSeatOne.send({ t: 'pick', level: 'level01', diff: 'standard', mode: 'versus' });
    await f.settled('lobby');

    e.send({ t: 'ready' });
    f.send({ t: 'ready' });
    const vStartE = await e.next('start');
    const vStartF = await f.next('start');
    check(
      'both clients are told to boot Versus',
      vStartE?.mode === 'versus' && vStartF?.mode === 'versus',
      `${vStartE?.mode ?? '—'} / ${vStartF?.mode ?? '—'}`,
    );

    // The difference that matters, set up so the two rules disagree: Fin dies on
    // wave 9 having held longer than Eve, who is only on wave 3. A race would
    // rank Fin first. Versus ends the instant a core does, and the survivor
    // wins — so if this returned Fin, the room would have settled as a race.
    postedLen = posted.length;
    e.send({ t: 'status', wave: 3, lives: 20, elapsedMs: 110_000 });
    await sleep(100);
    f.send({ t: 'dead', wave: 9, lives: 0, elapsedMs: 120_000 });
    const vResult = await e.next('result');
    check('one core going dark ends it, without waiting for the other run', vResult !== null);
    check(
      'and the survivor wins, though the dead player held the deeper board',
      vResult?.winnerId !== null && vResult?.winnerId === joinedE?.playerId,
      `winner=${vResult?.winnerId ?? 'tie'}, Eve=${joinedE?.playerId ?? '—'} (w3) vs Fin (w9, dead)`,
    );
    check('settled by the core, and it says so', vResult?.reason === 'core', vResult?.reason ?? '—');

    await sleep(600);
    const vBody = posted[postedLen] === undefined ? null : (JSON.parse(posted[postedLen]!) as { content?: string });
    const vContent = vBody?.content ?? '';
    check(
      'and the report names Front Line, not the sector the lobby was showing',
      vContent.includes('Front Line') && !vContent.includes('Switchback'),
      vContent.split('\n')[1] ?? '(nothing posted)',
    );

    console.log(
      failures === 0
        ? '\n\x1b[32minstance rooms hold together\x1b[0m'
        : `\n\x1b[31m${failures} check${failures === 1 ? '' : 's'} failed\x1b[0m`,
    );
  } finally {
    for (const c of clients) c.close();
    relay.kill();
    hook.close();
  }

  if (failures > 0) process.exitCode = 1;
}

await main();
