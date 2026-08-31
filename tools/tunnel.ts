/**
 * Serve the Activity on a public HTTPS origin, so Discord's proxy has
 * somewhere real to forward to. `npm run tunnel`.
 *
 * Discord loads an Activity through `<app_id>.discordsays.com`, which reverse-
 * proxies to whatever the URL Mapping points at. That target must be public
 * HTTPS: a tailnet address is not reachable from Discord's infrastructure, and
 * plain http is refused. This is gap #1 in docs/DISCORD-ACTIVITY.md, in its
 * cheap form — a real host later, a tunnel now.
 *
 * **Tailscale Funnel rather than a quick tunnel**, because the hostname is
 * stable. `cloudflared tunnel --url` issues a fresh random name every run, and
 * Discord's URL Mapping is configured by hand in a web form: a changing URL
 * means re-editing that form before every single session. Funnel's name is
 * derived from the machine, so the mapping is set once. Tailscale is also
 * already installed here and already signed in, which the alternative is not.
 *
 * While this runs, that hostname serves the game to anyone on the internet who
 * knows it. It stops when this stops.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { sleep } from './cdp.ts';

const PORT = Number(process.env['PORT'] ?? 8787);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const red = (s: string): string => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`;

function die(message: string, detail = ''): never {
  console.error(`\n${red('✗')} ${message}`);
  if (detail !== '') console.error(detail);
  process.exit(1);
}

/**
 * The machine's public Funnel hostname, from Tailscale itself rather than
 * assembled from parts — the tailnet name is not guessable and the trailing
 * dot on the DNS name is easy to carry into the URL by accident.
 */
function funnelHost(): string {
  const status = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8' });
  if (status.status !== 0) {
    die('tailscale is not running, or not signed in.', dim(status.stderr || status.stdout));
  }
  const self = (JSON.parse(status.stdout) as { Self?: { DNSName?: string } }).Self;
  const dns = self?.DNSName ?? '';
  if (dns === '') die('could not read this machine\'s tailnet DNS name from `tailscale status`.');
  return dns.replace(/\.$/, '');
}

/**
 * Is the built bundle capable of the Discord handshake?
 *
 * VITE_DISCORD_CLIENT_ID is substituted at build time, so a build made without
 * it has the whole handshake — including the dynamic SDK import — eliminated as
 * dead code. The bundle still works as a game and silently cannot sign anyone
 * in, which is a miserable thing to discover from inside Discord. The SDK's own
 * error string is the evidence: present means the chunk is there, which means
 * the id was set when this was built.
 */
function bundleHasSdk(): boolean {
  const assets = `${ROOT}dist/assets`;
  if (!existsSync(assets)) return false;
  return readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .some((f) => readFileSync(`${assets}/${f}`, 'utf8').includes('frame_id query param'));
}

async function main(): Promise<void> {
  if (spawnSync('tailscale', ['version'], { stdio: 'ignore' }).status !== 0) {
    die('tailscale is not on PATH.', '  Install it from https://tailscale.com/download');
  }

  if (!existsSync(`${ROOT}.env`)) {
    die(
      'no .env — the Activity handshake needs credentials.',
      `  ${dim('cp .env.example .env')}  then fill in the two values it names.`,
    );
  }

  const children: ChildProcess[] = [];
  const stop = (): void => {
    for (const c of children) c.kill();
  };
  process.on('SIGINT', () => {
    console.log('\n\nshutting down — the public URL is going away with it.');
    stop();
    process.exit(0);
  });

  const host = funnelHost();

  console.log(`\n${bold('building and starting the relay')}…`);
  children.push(spawn('zsh', ['scripts/play.sh'], { cwd: ROOT, stdio: 'inherit' }));

  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    await sleep(250);
    up = await fetch(`http://127.0.0.1:${PORT}/info`).then(
      (r) => r.ok,
      () => false,
    );
  }
  if (!up) {
    stop();
    die(`the relay never came up on :${PORT}.`);
  }

  // After the build, because play.sh is what produces dist/.
  if (!bundleHasSdk()) {
    console.warn(
      `\n${red('⚠')} the built bundle has no Discord SDK in it, which means it was built\n` +
        `  without VITE_DISCORD_CLIENT_ID. It will load in Discord and play fine, but\n` +
        `  nobody will be signed in. Check .env, then run this again.\n`,
    );
  }

  console.log(`\n${bold('opening the funnel')}…`);
  const funnel = spawn('tailscale', ['funnel', String(PORT)], { stdio: 'inherit' });
  children.push(funnel);
  funnel.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      // Funnel refuses until HTTPS certs and the funnel node attribute are
      // enabled for the tailnet. Tailscale prints a link to do exactly that,
      // which has already gone to stdout above — pointing at it beats
      // paraphrasing it.
      console.error(
        `\n${red('✗')} tailscale funnel exited (${code}). If it asked you to enable something,\n` +
          `  follow the link it printed — Funnel needs HTTPS certificates and the\n` +
          `  funnel node attribute enabled for your tailnet, both one-time.\n`,
      );
      stop();
      process.exit(1);
    }
  });

  await sleep(1500);
  console.log(
    `\n${'─'.repeat(72)}\n` +
      `  ${bold('Public origin')}   https://${host}\n\n` +
      `  Set this ${bold('once')} at https://discord.com/developers/applications\n` +
      `    → your app → Activities → URL Mappings\n\n` +
      `        PREFIX   /\n` +
      `        TARGET   ${host}\n\n` +
      `  ${dim('Target is the hostname only — no https://, no trailing slash.')}\n` +
      `  ${dim('Also enable Activities → Settings for the app.')}\n\n` +
      `  Then launch the activity from a voice channel in your test server.\n` +
      `  ${dim('While this runs, that URL serves the game to anyone who knows it.')}\n` +
      `  ${dim('Ctrl-C takes it down.')}\n` +
      `${'─'.repeat(72)}\n`,
  );
}

await main();
