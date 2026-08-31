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

    console.log(
      failures === 0
        ? '\n\x1b[32mteardown is clean\x1b[0m'
        : `\n\x1b[31m${failures} teardown check${failures === 1 ? '' : 's'} failed\x1b[0m`,
    );
  } finally {
    cdp.close();
    chrome.kill();
  }

  if (failures > 0) process.exitCode = 1;
}

await main();
