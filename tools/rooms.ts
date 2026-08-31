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
import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { sleep } from './cdp.ts';
import { WS_PATH, PROTOCOL_VERSION, type C2S, type S2C } from '../src/net/protocol.ts';

const PORT = 8795;

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
  const relay = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      fileURLToPath(new URL('../server/index.ts', import.meta.url)),
    ],
    { env: { ...process.env, PORT: String(PORT), COUNTDOWN_MS: '50' }, stdio: 'ignore' },
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

    console.log('\na third pilot in the same channel');
    const c = await Client.open();
    clients.push(c);
    c.hello('Cy', 'instance-alpha');
    const refused = await c.next('error');
    check(
      'is refused, and told which kind of full',
      refused?.reason === 'both seats in this channel are taken',
      refused?.reason ?? 'no error at all',
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

    console.log(
      failures === 0
        ? '\n\x1b[32minstance rooms hold together\x1b[0m'
        : `\n\x1b[31m${failures} check${failures === 1 ? '' : 's'} failed\x1b[0m`,
    );
  } finally {
    for (const c of clients) c.close();
    relay.kill();
  }

  if (failures > 0) process.exitCode = 1;
}

await main();
