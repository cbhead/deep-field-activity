/**
 * Does a run actually let go of the page? `npm run teardown`.
 *
 * Until now the answer never mattered: every navigation was `location.reload()`,
 * and a reload frees everything whether the code meant to or not. The Discord
 * Activity port removes that safety net — inside the iframe the app has to swap
 * screens in place — so `dispose()` becomes load-bearing, and the failure mode
 * is nasty: a surviving `window` listener goes on pushing commands into a world
 * nobody ticks, and a surviving ResizeObserver refits a destroyed Application
 * and throws. Neither is visible in a screenshot, and neither is a type error.
 *
 * So this asserts the invariant directly, against a real browser, using the
 * DevTools protocol to read the listener table that no page API exposes. It
 * needs the dev server up: `npm run dev` in another terminal.
 */
import process from 'node:process';
import { type Cdp, launch, sleep } from './cdp.ts';

const DEBUG_PORT = 9334;
const BASE = process.env['TEARDOWN_BASE'] ?? 'http://localhost:5173';
const URL = `${BASE}/?level=level01&difficulty=standard&seed=teardown`;

/**
 * Bound by the game, and therefore owed back on dispose.
 *
 * `orientationchange` is watchViewport's, and the one whose absence matters
 * most: it schedules a refit 300ms late, which is comfortably after a
 * navigation has destroyed the Application it would measure.
 *
 * `document`'s `pointermove` is Pixi's own, not ours. It is asserted anyway —
 * it is the evidence that `app.destroy()` really ran, which no listener of ours
 * can prove. What survives on `window` is Vite's HMR client (beforeunload,
 * error, unhandledrejection), which is the dev server's and outlives any run.
 */
const WINDOW_TYPES = [
  'pointermove', 'pointerup', 'pointercancel', 'pointerdown', 'keydown', 'resize', 'orientationchange',
];
const DOCUMENT_TYPES = ['visibilitychange', 'pointermove'];
const HUD_TYPES = ['pointerdown', 'click'];
/**
 * Checked only *before* dispose, and only for presence.
 *
 * These go away with the canvas rather than by being unbound, so there is
 * nothing to assert afterwards — the node is detached and unreachable. The
 * reason to assert them at all is that every one of them is bound through the
 * tracked `on` helper, and a mistyped event name there would bind nothing,
 * silently, in a way no other check here would notice: the game would simply
 * stop responding to the mouse.
 */
const CANVAS_TYPES = ['pointermove', 'pointerleave', 'pointerdown', 'contextmenu'];

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  const mark = ok ? '\x1b[32mok \x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${mark} ${label}${detail === '' ? '' : `  \x1b[2m${detail}\x1b[0m`}`);
  if (!ok) failures++;
}

/** Listener types bound on one object, counted. `expression` is evaluated first. */
async function listeners(cdp: Cdp, expression: string): Promise<Record<string, number>> {
  const evaluated = await cdp.send('Runtime.evaluate', { expression });
  const { objectId } = evaluated['result'] as { objectId?: string };
  if (objectId === undefined) throw new Error(`${expression} did not evaluate to an object`);
  const got = await cdp.send('DOMDebugger.getEventListeners', { objectId });
  const out: Record<string, number> = {};
  for (const l of (got['listeners'] ?? []) as { type: string }[]) {
    out[l.type] = (out[l.type] ?? 0) + 1;
  }
  return out;
}

const evaluate = async (cdp: Cdp, expression: string): Promise<unknown> => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return (r['result'] as { value?: unknown }).value;
};

/** Poll until `expression` is true, or give up and let the caller's check fail. */
async function until(cdp: Cdp, expression: string, tries = 40): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if ((await evaluate(cdp, expression)) === true) return true;
    await sleep(150);
  }
  return false;
}

const RUN_ROUTE = `{ k: 'run', level: 'level01', difficulty: 'standard', seed: 'nav', bank: null }`;

/**
 * The half of the refactor that teardown exists to serve: navigating between
 * scenes repeatedly, in place, without accumulating anything.
 *
 * A single dispose being clean is necessary but not sufficient — leaks of this
 * kind are cumulative, and one of anything is invisible. So the shape of the
 * test is a loop, and the assertion is that the listener table is *identical*
 * after several round trips, not merely small.
 */
async function navigationPhase(cdp: Cdp, thrown: string[]): Promise<void> {
  console.log('\nnavigation');

  // A foreign query parameter, standing in for Discord's launch parameters.
  // Everything the router writes has to carry it through untouched; losing it
  // inside the iframe means losing the SDK handshake, which is the single
  // failure this whole refactor exists to prevent.
  await cdp.send('Page.navigate', { url: `${BASE}/?frame_id=abc123&instance_id=xyz789` });
  const ready = await until(cdp, 'typeof globalThis.tdApp === "object"');
  check('the app boots at the front door', ready);
  if (!ready) return;

  // That URL carries a `frame_id`, so the app just tried the Discord handshake
  // and failed — there is no client id in a dev build and no Discord on the
  // other end. It has to fail *soft*: a misconfigured Activity should be a
  // playable game missing a name, not a black screen. This asserts the
  // half of that contract observable from here.
  check(
    'a failed Discord handshake leaves the game playable',
    (await evaluate(cdp, 'tdApp.activity')) === null,
  );

  const before = thrown.length;
  const winBase = await listeners(cdp, 'window');
  const docBase = await listeners(cdp, 'document');

  const CYCLES = 6;
  let peakCanvases = 0;
  for (let i = 0; i < CYCLES; i++) {
    await evaluate(cdp, `tdApp.router.go(${RUN_ROUTE})`);
    if (!(await until(cdp, 'document.querySelectorAll("#game-root canvas").length === 1'))) break;
    peakCanvases = Math.max(
      peakCanvases,
      Number(await evaluate(cdp, 'document.querySelectorAll("#game-root canvas").length')),
    );
    await evaluate(cdp, `tdApp.router.go({ k: 'home' })`);
    if (!(await until(cdp, 'document.querySelectorAll("#game-root canvas").length === 0'))) break;
  }

  check(`${CYCLES} round trips never stack a second canvas`, peakCanvases === 1, `peak ${peakCanvases}`);

  const winAfter = await listeners(cdp, 'window');
  const docAfter = await listeners(cdp, 'document');
  const drift = (a: Record<string, number>, b: Record<string, number>): string[] =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((t) => (a[t] ?? 0) !== (b[t] ?? 0))
      .map((t) => `${t} ${a[t] ?? 0}→${b[t] ?? 0}`);

  const winDrift = drift(winBase, winAfter);
  const docDrift = drift(docBase, docAfter);
  check(`window's listener table is unchanged after ${CYCLES} round trips`, winDrift.length === 0, winDrift.join(', '));
  check(`document's listener table is unchanged after ${CYCLES} round trips`, docDrift.length === 0, docDrift.join(', '));

  // Restart is `remount`, and remount has to mean what `location.reload()`
  // meant: re-resolve the seed. An unpinned run must deal a new board and a
  // pinned one must not, which is the difference between "play it again" and
  // "play that again" — and the reason remount is not just go(route).
  await evaluate(cdp, `tdApp.router.go({ k: 'run', level: 'level01', difficulty: 'standard', seed: null, bank: null })`);
  await until(cdp, 'typeof globalThis.td === "object"');
  const loose = await evaluate(cdp, 'td.world.seed');
  await evaluate(cdp, 'tdApp.router.remount()');
  await until(cdp, `typeof globalThis.td === "object" && td.world.seed !== ${String(loose)}`);
  check(
    'restart deals a fresh board when no seed is pinned',
    (await evaluate(cdp, 'td.world.seed')) !== loose,
    `${String(loose)} → ${String(await evaluate(cdp, 'td.world.seed'))}`,
  );

  await evaluate(cdp, `tdApp.router.go(${RUN_ROUTE})`);
  await until(cdp, 'typeof globalThis.td === "object"');
  const pinned = await evaluate(cdp, 'td.world.seed');
  await evaluate(cdp, 'tdApp.router.remount()');
  await sleep(1200);
  check(
    'and the same board when one is',
    (await evaluate(cdp, 'td.world.seed')) === pinned,
    `seed=nav → ${String(pinned)}`,
  );

  // The lobby is the one scene with no canvas, and the one whose teardown has
  // the most to let go of — a socket, a countdown timer and a reconnect loop.
  // No relay is running here, so this only proves it mounts and unmounts; the
  // match path still needs two clients and a server to exercise.
  await evaluate(cdp, `tdApp.router.go({ k: 'race', room: null })`);
  check('the race lobby mounts', await until(cdp, 'document.querySelector("#race-create") !== null'));
  await evaluate(cdp, `tdApp.router.go({ k: 'home' })`);
  check('and unmounts', await until(cdp, 'document.querySelector("#race-create") === null'));
  const winRace = await listeners(cdp, 'window');
  const raceDrift = drift(winBase, winRace);
  check('a lobby round trip leaves no listeners behind', raceDrift.length === 0, raceDrift.join(', '));

  // The Discord-critical one.
  await evaluate(cdp, `tdApp.router.go(${RUN_ROUTE})`);
  await until(cdp, 'document.querySelectorAll("#game-root canvas").length === 1');
  const search = String(await evaluate(cdp, 'location.search'));
  check(
    'foreign query parameters survive a navigation',
    search.includes('frame_id=abc123') && search.includes('instance_id=xyz789'),
    search,
  );
  check('and the route is in there too', search.includes('level=level01') && search.includes('seed=nav'), search);

  // Back must return to the front door rather than leaving the app, which it
  // could never do when every navigation was a document load.
  await evaluate(cdp, 'history.back()');
  const backHome = await until(cdp, 'document.querySelectorAll("#game-root canvas").length === 0');
  check('Back leaves the run and returns to the front door', backHome);

  check('navigating throws nothing', thrown.length === before, thrown.slice(before).join(' | '));
}

async function main(): Promise<void> {
  const { cdp, chrome } = await launch({
    port: DEBUG_PORT,
    width: 1280,
    height: 800,
    profileDir: '/tmp/td-teardown-profile',
    // Software GL is fine here: nothing is being looked at, only counted.
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
  });

  const thrown: string[] = [];
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p['exceptionDetails'] as { text?: string; exception?: { description?: string } };
    thrown.push(d.exception?.description ?? d.text ?? 'unknown');
  });

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: URL });

    // Wait for the run to exist rather than sleeping a guessed interval.
    let booted = false;
    for (let i = 0; i < 40 && !booted; i++) {
      await sleep(250);
      booted = (await evaluate(cdp, 'typeof globalThis.td === "object" && td.world !== undefined')) === true;
    }
    if (!booted) throw new Error(`the game never booted at ${URL} — is \`npm run dev\` running?`);

    // Let it render and tick a while, so every lazily-bound listener is bound
    // and the renderer has actually fitted.
    await sleep(1200);

    console.log('\nbefore dispose');
    const winBefore = await listeners(cdp, 'window');
    const docBefore = await listeners(cdp, 'document');
    const hudBefore = await listeners(cdp, 'document.getElementById("hud")');
    check('a canvas is mounted', (await evaluate(cdp, 'document.querySelectorAll("#game-root canvas").length')) === 1);
    check('the in-game class is set', (await evaluate(cdp, 'document.documentElement.classList.contains("td-ingame")')) === true);
    check(
      'the game bound the listeners it is about to owe back',
      WINDOW_TYPES.every((t) => (winBefore[t] ?? 0) > 0) && DOCUMENT_TYPES.every((t) => (docBefore[t] ?? 0) > 0),
      `window ${JSON.stringify(winBefore)} document ${JSON.stringify(docBefore)} #hud ${JSON.stringify(hudBefore)}`,
    );

    const canvasBefore = await listeners(cdp, 'document.querySelector("#game-root canvas")');
    check(
      'the board itself is listening',
      CANVAS_TYPES.every((t) => (canvasBefore[t] ?? 0) > 0),
      JSON.stringify(canvasBefore),
    );

    const beforeCount = thrown.length;
    await evaluate(cdp, 'td.dispose()');
    await sleep(600);

    console.log('\nafter dispose');
    const winAfter = await listeners(cdp, 'window');
    const docAfter = await listeners(cdp, 'document');
    const hudAfter = await listeners(cdp, 'document.getElementById("hud")');

    for (const t of WINDOW_TYPES) {
      check(`window has no ${t} listener`, (winAfter[t] ?? 0) === 0, `${winBefore[t] ?? 0} → ${winAfter[t] ?? 0}`);
    }
    for (const t of DOCUMENT_TYPES) {
      check(`document has no ${t} listener`, (docAfter[t] ?? 0) === 0, `${docBefore[t] ?? 0} → ${docAfter[t] ?? 0}`);
    }
    for (const t of HUD_TYPES) {
      check(`#hud has no ${t} listener`, (hudAfter[t] ?? 0) === 0, `${hudBefore[t] ?? 0} → ${hudAfter[t] ?? 0}`);
    }
    check('the canvas is gone', (await evaluate(cdp, 'document.querySelectorAll("#game-root canvas").length')) === 0);
    check('#hud is empty', (await evaluate(cdp, 'document.getElementById("hud").innerHTML')) === '');
    check(
      'the layout classes are surrendered',
      (await evaluate(cdp, 'document.documentElement.className')) === '',
      `className = ${JSON.stringify(await evaluate(cdp, 'document.documentElement.className'))}`,
    );
    check('the dev handle is gone', (await evaluate(cdp, 'typeof globalThis.td')) === 'undefined');

    // The point of the whole exercise: a torn-down run must not react to input.
    // A stale keydown handler would push a command into a dead world, and the
    // dead world is exactly where that is invisible.
    await evaluate(
      cdp,
      'window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space" })), ' +
        'window.dispatchEvent(new Event("resize")), ' +
        'document.dispatchEvent(new Event("visibilitychange")), 1',
    );
    await sleep(400);
    check(
      'poking the dead page throws nothing',
      thrown.length === beforeCount,
      thrown.slice(beforeCount).join(' | '),
    );

    await navigationPhase(cdp, thrown);

    console.log(
      failures === 0
        ? '\n\x1b[32mteardown is clean\x1b[0m'
        : `\n\x1b[31m${failures} check${failures === 1 ? '' : 's'} failed\x1b[0m`,
    );
  } finally {
    cdp.close();
    chrome.kill();
  }

  if (failures > 0) process.exitCode = 1;
}

await main();
