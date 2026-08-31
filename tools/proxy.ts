/**
 * Does the relay serve the app the way Discord's proxy will ask for it?
 * `npm run proxy`.
 *
 * The Activity handshake itself cannot be tested here — it needs a real
 * Discord client, a registered application and a public HTTPS origin. What
 * *can* be tested is everything underneath it, and it is the half that fails
 * silently: whether a `/.proxy`-prefixed request reaches the same file, whether
 * the socket upgrades on both paths, and whether the token route behaves like a
 * route rather than a crash when it is unconfigured.
 *
 * Starts the built server on its own port and drives it with plain HTTP, so it
 * needs no browser. Run `npm run build` first; the server serves `dist/`.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { sleep } from './cdp.ts';

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  const mark = ok ? '\x1b[32mok \x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${mark} ${label}${detail === '' ? '' : `  \x1b[2m${detail}\x1b[0m`}`);
  if (!ok) failures++;
}

/** Resolves to the close code, or 'open' if the socket connected. */
const dialSocket = (path: string): Promise<string> =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}`);
    const done = (v: string): void => {
      ws.close();
      resolve(v);
    };
    ws.on('open', () => done('open'));
    ws.on('error', () => resolve('refused'));
    setTimeout(() => resolve('timeout'), 3000);
  });

async function main(): Promise<void> {
  const server = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      fileURLToPath(new URL('../server/index.ts', import.meta.url)),
    ],
    { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' },
  );

  try {
    // Wait for the port rather than guessing at a delay.
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await sleep(150);
      up = await fetch(`${BASE}/info`).then(
        (r) => r.ok,
        () => false,
      );
    }
    if (!up) throw new Error('the relay never came up');

    console.log('\nthe proxy prefix is optional, both ways');
    const plain = await fetch(`${BASE}/index.html`);
    const proxied = await fetch(`${BASE}/.proxy/index.html`);
    check('/index.html is served', plain.ok, String(plain.status));
    check('/.proxy/index.html is served', proxied.ok, String(proxied.status));
    check(
      'and they are the same document',
      plain.ok && proxied.ok && (await plain.text()) === (await proxied.text()),
    );

    const rootPlain = await fetch(`${BASE}/`);
    const rootProxied = await fetch(`${BASE}/.proxy`);
    check('/ and /.proxy both resolve to the app', rootPlain.ok && rootProxied.ok);

    const infoProxied = await fetch(`${BASE}/.proxy/info`);
    check('/.proxy/info reaches the info route', infoProxied.ok, String(infoProxied.status));

    console.log('\nthe relay socket answers on both paths');
    check('ws://…/ws upgrades', (await dialSocket('/ws')) === 'open');
    check('ws://…/.proxy/ws upgrades', (await dialSocket('/.proxy/ws')) === 'open');
    // Still a socket server, not an open door: anything else must be refused
    // rather than upgraded, which is what passing `path` to ws used to buy.
    check('ws://…/nope is refused', (await dialSocket('/nope')) !== 'open');

    console.log('\nthe token route is a route, not a crash');
    const unconfigured = await fetch(`${BASE}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'whatever' }),
    });
    const body = (await unconfigured.json()) as { error?: string };
    check(
      'says so plainly when there are no credentials',
      unconfigured.status === 503 && typeof body.error === 'string',
      `${unconfigured.status} ${JSON.stringify(body)}`,
    );

    const wrongMethod = await fetch(`${BASE}/.proxy/api/token`);
    check(
      'refuses GET, and does so on the prefixed path too',
      wrongMethod.status === 405 || wrongMethod.status === 503,
      String(wrongMethod.status),
    );

    // The one that matters for secrecy: nothing the endpoint says should ever
    // contain the secret, whatever it is asked.
    const leaked = JSON.stringify(body).includes('secret') && JSON.stringify(body).length > 200;
    check('and leaks nothing', !leaked);

    console.log(
      failures === 0
        ? '\n\x1b[32mthe relay is proxy-ready\x1b[0m'
        : `\n\x1b[31m${failures} check${failures === 1 ? '' : 's'} failed\x1b[0m`,
    );
  } finally {
    server.kill();
  }

  if (failures > 0) process.exitCode = 1;
}

await main();
