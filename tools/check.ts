/**
 * Headless simulation gates. `npm run check`.
 *
 * These exist because `src/sim/` is pure — no PixiJS, no DOM, no wall-clock
 * time — so Node can run the real gameplay code with nothing stubbed. Every
 * assertion below drives the *actual* production functions, not a
 * reimplementation of them; that distinction is the whole point.
 *
 * Milestone gates from the plan land here as they come due. M10 adds the
 * determinism gate (same seed → byte-identical wave log).
 */
import { LEVEL01 } from '../src/content/maps/level01.ts';
import { BALANCE } from '../src/content/balance.ts';
import { parseMap, isBuildableTile, tileAt } from '../src/sim/util/grid.ts';
import { mulberry32, streamFor, STREAM, hashSeed } from '../src/sim/util/rng.ts';
import { createWorld, spawnCreep } from '../src/sim/world.ts';
import { advance, DT, TICK_HZ, type Accumulator } from '../src/app/loop.ts';
import type { MapSource } from '../src/content/types.ts';

let failures = 0;

function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? '\x1b[32mok \x1b[0m' : '\x1b[31mBAD\x1b[0m'} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
}

const section = (name: string): void => console.log(`\n\x1b[1m${name}\x1b[0m`);

const map = parseMap(LEVEL01);

// ---------------------------------------------------------------------------
section('map — parsing');

check(map.tiles.length === map.cols * map.rows, 'tile count matches dimensions', `${map.cols}x${map.rows}`);
check(map.pathLength > 0, 'route has length', `${map.pathLength} tiles, ${map.waypoints.length} waypoints`);
check(!isBuildableTile(map, 0, 2), 'spawn tile is not buildable');
check(!isBuildableTile(map, 3, 5), 'scenery is not buildable', `kind=${tileAt(map, 3, 5)}`);
check(isBuildableTile(map, 0, 0), 'open ground is buildable');
check(tileAt(map, -1, 0) === undefined, 'off-board lookups return undefined');

// ---------------------------------------------------------------------------
// The ASCII board and the waypoint route are two representations of one thing,
// so they can drift. Each mutation below is a drift mode that must crash at
// load rather than produce creeps gliding over grass.
section('map — drift detection');

function expectReject(label: string, mutate: (rows: string[], waypoints: number[][]) => void): void {
  const rows = [...LEVEL01.rows];
  const waypoints = LEVEL01.waypoints.map((w) => [...w]);
  mutate(rows, waypoints);
  try {
    parseMap({ id: 'mutant', name: 'mutant', rows, waypoints } as unknown as MapSource);
    check(false, label, 'accepted — should have thrown');
  } catch (e) {
    check(true, label, (e as Error).message.replace('map "mutant": ', ''));
  }
}

expectReject('route over an erased path tile', (rows) => { rows[7] = rows[7]!.replace('#######', '#.#####'); });
expectReject('path art nothing walks on', (rows) => { rows[0] = rows[0]!.replace('..', '##'); });
expectReject('waypoint moved off the road', (_r, wps) => { wps[3] = [14, 8]; });
expectReject('ragged row length', (rows) => { rows[4] = rows[4]! + '.'; });
expectReject('missing spawn', (rows) => { rows[2] = rows[2]!.replace('S', '.'); });
expectReject('unknown legend character', (rows) => { rows[0] = 'Z' + rows[0]!.slice(1); });

// ---------------------------------------------------------------------------
// Race mode rests entirely on this: both players must face identical waves.
section('rng — determinism');

{
  const a = streamFor(42, STREAM.WAVE, 7);
  const b = streamFor(42, STREAM.WAVE, 7);
  check(a() === b() && a() === b(), 'same (seed, purpose, index) reproduces');

  // The trap the plan calls out: with one global stream, an extra roll in an
  // early wave shifts every later wave. Per-wave streams make that impossible.
  const clean = streamFor(42, STREAM.WAVE, 23);
  const noisy = streamFor(42, STREAM.WAVE, 3);
  for (let i = 0; i < 500; i++) noisy();
  const after = streamFor(42, STREAM.WAVE, 23);
  check(clean() === after(), 'wave 23 is unaffected by extra draws in wave 3');

  const w1 = streamFor(42, STREAM.WAVE, 0);
  const c1 = streamFor(42, STREAM.COMBAT, 0);
  check(w1() !== c1(), 'purposes do not correlate');

  const r = mulberry32(7);
  let sum = 0;
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < 200_000; i++) {
    const v = r();
    sum += v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const mean = sum / 200_000;
  check(Math.abs(mean - 0.5) < 0.005 && lo >= 0 && hi < 1, 'uniform over [0,1)', `mean=${mean.toFixed(5)}`);
  check(hashSeed('hunter2') === hashSeed('hunter2') && hashSeed('a') !== hashSeed('b'), 'string seeds hash stably');
}

// ---------------------------------------------------------------------------
section('loop — traversal');

{
  const w = createWorld(map, 1234);
  const c = spawnCreep(w, 'grunt');
  const acc: Accumulator = { debt: 0 };
  const expected = map.pathLength / c.speed;

  while (w.lives === BALANCE.startingLives && w.time < 60) advance(w, acc, 1000 / TICK_HZ, 1);

  check(w.lives === BALANCE.startingLives - 1, 'a leak costs exactly one life', `lives=${w.lives}`);
  check(w.creeps.length === 0, 'the leaked creep is swept up', `creeps=${w.creeps.length}`);
  check(
    Math.abs(w.time - expected) < DT * 2,
    'traversal takes pathLength / speed seconds',
    `sim=${w.time.toFixed(4)}s expected=${expected.toFixed(4)}s`,
  );
}

// ---------------------------------------------------------------------------
// THE M2 GATE: the same wall clock must produce the same game, whatever the
// monitor is doing. A variable-timestep loop fails this, and in Race mode that
// would be a fairness bug rather than just a wobble.
section('loop — M2 gate: refresh-rate independence');

{
  // Deliberately shorter than the ~24s traversal so creeps are compared
  // mid-leg. Run it past the end and every case has parked on the goal tile,
  // and the position check passes for the wrong reason.
  const TOTAL_MS = 12_000;

  // Every pattern must total EXACTLY the same wall clock, short final frame
  // included — otherwise a rate whose period doesn't divide TOTAL_MS silently
  // gets less simulated time and "fails" for a reason that isn't the loop.
  const atRate = (hz: number): number[] => {
    const step = 1000 / hz;
    const out: number[] = [];
    for (let t = 0; t < TOTAL_MS; ) {
      const d = Math.min(step, TOTAL_MS - t);
      out.push(d);
      t += d;
    }
    return out;
  };

  // Deterministic jitter, kept under the 83ms five-tick cap so this exercises
  // the normal path rather than the hitch guard.
  const jittery = (): number[] => {
    const r = mulberry32(99);
    const out: number[] = [];
    for (let t = 0; t < TOTAL_MS; ) {
      const d = Math.min(4 + r() * 60, TOTAL_MS - t);
      out.push(d);
      t += d;
    }
    return out;
  };

  const run = (frames: number[]): { tick: number; x: number; y: number } => {
    const w = createWorld(map, 1234);
    const c = spawnCreep(w, 'grunt');
    const acc: Accumulator = { debt: 0 };
    for (const d of frames) advance(w, acc, d, 1);
    return { tick: w.tick, x: c.x, y: c.y };
  };

  const cases: [string, number[]][] = [
    ['60Hz', atRate(60)],
    ['144Hz', atRate(144)],
    ['30Hz', atRate(30)],
    ['75Hz', atRate(75)],
    ['jittery', jittery()],
  ];

  const base = run(cases[0]![1]);
  for (const [label, frames] of cases) {
    const got = run(frames);
    const dTick = Math.abs(got.tick - base.tick);
    const dPos = Math.hypot(got.x - base.x, got.y - base.y);
    // One tick of slack: TICK_MS is 16.666…, so summing frame deltas can
    // legitimately land either side of a tick boundary. One tick of creep
    // movement is 0.03 tiles — 1.2px, which is why v1 skips interpolation.
    check(
      dTick <= 1 && dPos <= 0.031,
      label,
      `${frames.length} frames, tick=${got.tick} (±${dTick}), drift=${(dPos * 40).toFixed(2)}px`,
    );
  }
}

// ---------------------------------------------------------------------------
section('loop — hitch guards');

{
  for (const speed of [1, 2, 4]) {
    const w = createWorld(map, 1234);
    spawnCreep(w, 'grunt');
    const acc: Accumulator = { debt: 0 };
    // A backgrounded tab returns with a delta like this. Without the guards the
    // sim would try to run 300 seconds of ticks in one frame and lock the page.
    const ticks = advance(w, acc, 5_000, speed);
    check(
      ticks === 5 * speed && acc.debt === 0,
      `${speed}x: a 5s stall is capped and its debt dropped`,
      `ticks=${ticks}`,
    );
  }

  const at = (speed: number): number => {
    const w = createWorld(map, 1234);
    spawnCreep(w, 'grunt');
    const acc: Accumulator = { debt: 0 };
    for (let i = 0; i < 300; i++) advance(w, acc, 1000 / 60, speed);
    return w.tick;
  };
  const [x1, x2, x4] = [at(1), at(2), at(4)];
  check(
    Math.abs(x2 - x1 * 2) <= 1 && Math.abs(x4 - x1 * 4) <= 1,
    'speed multiplier scales simulated time',
    `1x=${x1} 2x=${x2} 4x=${x4}`,
  );
}

// ---------------------------------------------------------------------------
// Throwing rather than setting process.exitCode: it exits non-zero all the same
// and avoids pulling @types/node into the project, which would put Node globals
// in scope for src/ and quietly weaken the purity boundary.
if (failures > 0) throw new Error(`${failures} gate failure(s)`);
console.log('\n\x1b[32mall gates pass\x1b[0m\n');
