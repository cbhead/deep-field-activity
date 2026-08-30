import { stepWorld } from '../sim/step.ts';
import type { World } from '../sim/world.ts';

export const TICK_HZ = 60;
const TICK_MS = 1000 / TICK_HZ;

/** The only dt the simulation ever sees. */
export const DT = 1 / TICK_HZ;

/** Unspent simulated milliseconds carried between frames. */
export interface Accumulator {
  debt: number;
}

/**
 * The pure half of the loop: given a real elapsed time, run the right number of
 * fixed ticks. Split out from the rAF plumbing so the headless harness can
 * drive the *actual* frame-pacing code rather than a reimplementation of it —
 * which is the only way the "identical behaviour at any refresh rate" property
 * is really tested. Returns the tick count for that call.
 */
export function advance(w: World, acc: Accumulator, elapsedMs: number, speed: number): number {
  // Guard 1: clamp the input delta. A backgrounded tab stops firing rAF
  // entirely and comes back with a multi-minute delta; without this the sim
  // would try to catch up on ten minutes of ticks in one frame and lock up.
  acc.debt += Math.min(elapsedMs, 250) * speed;

  // Guard 2: bound the work per frame, so a slow frame cannot cause an even
  // slower next frame.
  const maxTicks = 5 * speed;
  let ticks = 0;
  while (acc.debt >= TICK_MS && ticks < maxTicks) {
    stepWorld(w, DT);
    acc.debt -= TICK_MS;
    ticks++;
  }

  // Guard 3: if we hit the cap we are running behind. Drop the debt rather than
  // carrying it forward, which is what turns a hitch into a spiral of death.
  // The game runs momentarily slow instead of freezing.
  if (ticks === maxTicks) acc.debt = 0;

  return ticks;
}

export interface GameLoop {
  /** 1 / 2 / 4. Scales simulated time, never the render rate. */
  speed: number;
  /** Explicit player pause, distinct from the automatic tab-hidden pause. */
  paused: boolean;
  start(): void;
  stop(): void;
}

/**
 * Fixed-timestep accumulator, decoupled from rendering.
 *
 * The naive `update(now - last)` loop is variable timestep, which is wrong in
 * three ways that all bite: behaviour differs between a 60Hz laptop and a 144Hz
 * monitor (a fairness bug in Race mode), nothing is reproducible or headlessly
 * testable, and a large dt lets a fast projectile tunnel straight through its
 * target in one step.
 *
 * 60Hz rather than 30 because it tracks display refresh closely enough to skip
 * render interpolation entirely at v1 — the positional error is sub-pixel. If
 * judder on a high-refresh monitor ever shows up, interpolation is a purely
 * additive change here and nowhere else.
 */
export function createLoop(world: World, onRender: () => void): GameLoop {
  const acc: Accumulator = { debt: 0 };
  let last = 0;
  let rafId = 0;
  let hidden = false;

  const loop: GameLoop = { speed: 1, paused: false, start, stop };

  function frame(now: number): void {
    rafId = requestAnimationFrame(frame);

    const elapsed = now - last;
    last = now;

    if (!loop.paused && !hidden) advance(world, acc, elapsed, loop.speed);

    // Render every frame regardless — the HUD and hover feedback must stay
    // responsive while paused.
    onRender();
  }

  function start(): void {
    if (rafId !== 0) return;
    last = performance.now();
    acc.debt = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop(): void {
    if (rafId === 0) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // Auto-pause when the tab is hidden. Correct tower defense behaviour on its
  // own, and in Race mode it is free fairness: ranking is waves cleared first
  // and elapsed time only third, so a hidden tab simply resumes later against
  // an identical board rather than being punished.
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (!hidden) {
      // Returning from hidden: discard the debt accrued while away.
      last = performance.now();
      acc.debt = 0;
    }
  });

  return loop;
}
