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
import { WAVES } from '../src/content/waves.ts';
import { planWave, waveCount } from '../src/sim/wavePlan.ts';
import { TOWERS, type TowerId } from '../src/content/towers.ts';
import { ENEMIES } from '../src/content/enemies.ts';
import { damageAtTier, placementError, upgradeCost } from '../src/sim/build.ts';
import { coverage } from '../src/sim/analysis.ts';
import type { TargetMode } from '../src/sim/types.ts';
import { stepWorld } from '../src/sim/step.ts';
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

/**
 * A world with the wave machine parked, so the loop gates measure the loop.
 * Without this, wave 1 auto-starts partway through and the board fills with
 * creeps the assertion never meant to count.
 */
function soloWorld(): ReturnType<typeof createWorld> {
  const w = createWorld(map, 1234);
  w.wave.phase = 'done';
  return w;
}

{
  const w = soloWorld();
  const c = spawnCreep(w, 'drifter');
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
    const w = soloWorld();
    const c = spawnCreep(w, 'drifter');
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
    const w = soloWorld();
    spawnCreep(w, 'drifter');
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
    const w = soloWorld();
    spawnCreep(w, 'drifter');
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
// The plan's N2 fairness gate in embryo: wave content must be a pure function
// of (seed, waveIndex). If this holds, two machines in a Race face identical
// boards, and it holds without any networking existing yet.
section('waves — content is a pure function of (seed, wave)');

{
  const dump = (seed: number): string =>
    JSON.stringify(Array.from({ length: waveCount() }, (_, i) => planWave(seed, i)));

  check(dump(4242) === dump(4242), 'same seed reproduces every wave byte-for-byte');
  check(dump(4242) !== dump(4243), 'a different seed gives a different match');

  // The specific trap: with one global stream, drawing extra numbers early
  // shifts every later wave. Planning waves out of order must change nothing.
  const forward = JSON.stringify(Array.from({ length: waveCount() }, (_, i) => planWave(77, i)));
  const shuffled: string[] = [];
  for (const i of [7, 2, 9, 0, 5, 1, 8, 3, 6, 4]) shuffled[i] = JSON.stringify(planWave(77, i));
  check(forward === `[${shuffled.join(',')}]`, 'planning waves out of order changes nothing');

  const totalPlanned = Array.from({ length: waveCount() }, (_, i) => planWave(77, i).length)
    .reduce((a, b) => a + b, 0);
  const totalAuthored = WAVES.reduce(
    (sum, wv) => sum + wv.groups.reduce((s, gr) => s + gr.count, 0),
    0,
  );
  check(totalPlanned === totalAuthored, 'plan spawns exactly what the table authors', `${totalPlanned} creeps over ${waveCount()} waves`);

  const w9 = planWave(77, 9);
  check(
    w9.every((s, i) => i === 0 || s.at >= w9[i - 1]!.at),
    'spawns are ordered by time even with overlapping groups',
  );
  check(w9.every((s) => s.at >= 0), 'jitter never pulls a spawn before its group starts');

  // Checked against the configured growth rate rather than a hardcoded range,
  // so tuning the curve cannot silently invalidate the gate.
  const scale = planWave(77, 9)[0]!.hp / planWave(77, 0)[0]!.hp;
  const expected = Math.pow(BALANCE.hpGrowth, waveCount() - 1);
  check(
    Math.abs(scale - expected) / expected < 0.02,
    'hp compounds at the configured growth rate',
    `wave 10 is ${scale.toFixed(1)}x wave 1 (${BALANCE.hpGrowth}^9 = ${expected.toFixed(1)})`,
  );
}

// ---------------------------------------------------------------------------
// A full match, headlessly, at a speed no browser could render. This is the
// seed of M9's balance harness, and it exists only because the sim is pure.
section('waves — full match');

{
  const play = (opts: { invincible: boolean }): { w: ReturnType<typeof createWorld>; waves: number } => {
    const w = createWorld(map, 4242);
    const acc: Accumulator = { debt: 0 };
    let cleared = 0;
    for (let i = 0; i < 200_000 && w.phase === 'playing'; i++) {
      advance(w, acc, 1000 / TICK_HZ, 1);
      // Stand in for the towers M5 will bring: vaporise everything on the path.
      if (opts.invincible) for (const c of w.creeps) c.dead = true;
      for (const ev of w.events) if (ev.type === 'waveCleared') cleared++;
      w.events.length = 0;
    }
    return { w, waves: cleared };
  };

  const lost = play({ invincible: false });
  check(lost.w.phase === 'lost', 'undefended, the match is lost', `wave ${lost.w.wave.index + 1}, ${lost.w.time.toFixed(0)}s`);
  check(lost.w.lives === 0, 'lives bottom out at zero, never negative', `lives=${lost.w.lives}`);

  const won = play({ invincible: true });
  check(won.w.phase === 'won', 'with everything killed, the match is won', `${won.w.time.toFixed(0)}s`);
  check(won.waves === waveCount(), 'every wave reports cleared exactly once', `${won.waves}/${waveCount()}`);
  check(won.w.lives === BALANCE.startingLives, 'a perfect run loses no lives');
  check(won.w.wave.phase === 'done', 'the wave machine parks in done');

  // Sending waves early must not skip or duplicate them.
  {
    const w = createWorld(map, 4242);
    const acc: Accumulator = { debt: 0 };
    let started = 0;
    for (let i = 0; i < 200_000 && w.phase === 'playing'; i++) {
      w.commands.push({ type: 'startWave' });
      advance(w, acc, 1000 / TICK_HZ, 1);
      for (const c of w.creeps) c.dead = true;
      for (const ev of w.events) if (ev.type === 'waveStarted') started++;
      w.events.length = 0;
    }
    check(
      started === waveCount() && w.phase === 'won',
      'spamming startWave neither skips nor repeats a wave',
      `${started} starts, ${w.time.toFixed(0)}s vs ${won.w.time.toFixed(0)}s idle`,
    );
  }
}

// ---------------------------------------------------------------------------
// Sending early is the mechanic the wave machine was restructured around, and
// the thing that was silently broken before: startWave only acted during the
// intermission, which is a minority of the runtime.
section('waves — sending early');

{
  // Overlap: with no defence, wave 0's creeps are still walking when wave 1 is
  // sent. Two waves on the board at once is the whole point.
  const w = createWorld(map, 4242);
  w.lives = 1_000_000;
  w.commands.push({ type: 'startWave' });
  while (w.wave.phase === 'spawning' || w.wave.dispatchedThrough < 0) stepWorld(w, DT);
  w.events.length = 0;

  w.commands.push({ type: 'startWave' });
  stepWorld(w, DT);
  for (let i = 0; i < 60 * 3; i++) stepWorld(w, DT);

  const livingWaves = new Set(w.creeps.map((c) => c.wave));
  check(livingWaves.size >= 2, 'two waves can be on the board at once', `waves alive: ${[...livingWaves].join(', ')}`);
  check(w.wave.clearedThrough === -1, 'neither counts as cleared while creeps live');
}

{
  // The bonus must be payment for time actually forfeited, and nothing else.
  const w = createWorld(map, 4242);
  const beforeMoney = w.money;
  const secondsLeft = w.wave.timer;
  w.commands.push({ type: 'startWave' });
  stepWorld(w, DT);

  const rushed = w.events.find((e) => e.type === 'waveRushed');
  const expected = Math.round(secondsLeft * BALANCE.rushBonusPerSecond);
  check(rushed !== undefined, 'rushing emits an event');
  check(
    w.money === beforeMoney + expected,
    'the bonus matches the time forfeited',
    `${secondsLeft.toFixed(1)}s → +$${w.money - beforeMoney}`,
  );
}

{
  // Letting the timer run out must pay nothing, or the "bonus" is just income.
  const w = createWorld(map, 4242);
  const beforeMoney = w.money;
  let rushEvents = 0;
  while (w.wave.phase === 'intermission') {
    stepWorld(w, DT);
    for (const ev of w.events) if (ev.type === 'waveRushed') rushEvents++;
    w.events.length = 0;
  }
  check(rushEvents === 0 && w.money === beforeMoney, 'waiting it out earns no bonus', `$${w.money - beforeMoney}`);
}

{
  // Refusals must be audible. Silence here is exactly the bug that was reported.
  const w = createWorld(map, 4242);
  w.lives = 1_000_000;
  w.commands.push({ type: 'startWave' });
  stepWorld(w, DT);
  w.events.length = 0;

  w.commands.push({ type: 'startWave' });
  stepWorld(w, DT);
  const midSpawn = w.events.find((e) => e.type === 'waveRejected');
  check(
    midSpawn !== undefined && midSpawn.reason === 'spawning',
    'a wave sent mid-spawn is refused out loud',
    `phase=${w.wave.phase}`,
  );

  // Drive every wave out, then ask for one more.
  for (let i = 0; i < 400_000 && w.wave.phase !== 'done'; i++) {
    w.commands.push({ type: 'startWave' });
    stepWorld(w, DT);
    w.events.length = 0;
  }
  w.commands.push({ type: 'startWave' });
  stepWorld(w, DT);
  const exhausted = w.events.find((e) => e.type === 'waveRejected');
  check(
    exhausted !== undefined && exhausted.reason === 'done',
    'and so is one sent after the last wave',
  );
}

{
  // Victory is about the board being clear, not about the spawner being
  // finished. Under the old model those were the same thing; now they are not.
  const w = createWorld(map, 4242);
  w.lives = 1_000_000;
  for (let i = 0; i < 400_000 && w.wave.phase !== 'done'; i++) {
    w.commands.push({ type: 'startWave' });
    stepWorld(w, DT);
    w.events.length = 0;
  }
  check(w.creeps.length > 0, 'the last wave is dispatched with creeps still walking', `${w.creeps.length} alive`);
  check(w.phase === 'playing', 'and the match is NOT yet won');

  // Settling several stacked waves at once must pay for each exactly once.
  const clearedBefore = w.wave.clearedThrough;
  for (const c of w.creeps) c.dead = true;
  let cleared = 0;
  for (let i = 0; i < 60 && w.phase === 'playing'; i++) {
    stepWorld(w, DT);
    for (const ev of w.events) if (ev.type === 'waveCleared') cleared++;
    w.events.length = 0;
  }
  check(w.phase === 'won', 'clearing the board wins it');
  check(
    cleared === waveCount() - 1 - clearedBefore,
    'each stacked wave settles exactly once',
    `${cleared} waves settled together`,
  );
}

// ---------------------------------------------------------------------------
section('build — placement rules');

{
  const w = createWorld(map, 4242);
  w.wave.phase = 'done';

  check(placementError(w, 'lance', 0, 0) === null, 'open ground accepts a tower');
  check(placementError(w, 'lance', 5, 2) === 'onRoute', 'the road refuses a tower');
  check(placementError(w, 'lance', 3, 5) === 'blocked', 'scenery refuses a tower');
  check(placementError(w, 'lance', -1, 0) === 'offBoard', 'off-board is rejected');
  check(placementError(w, 'lance', map.cols, 0) === 'offBoard', 'past the right edge is rejected');
  check(placementError(w, 'lance', 0.5, 0) === 'offBoard', 'a fractional tile is rejected');

  const before = w.money;
  w.commands.push({ type: 'placeTower', defId: 'lance', col: 0, row: 0 });
  stepWorld(w, DT);
  check(w.towers.length === 1, 'a valid command builds exactly one tower');
  check(w.money === before - TOWERS.lance.cost, 'the cost is deducted once', `$${before} → $${w.money}`);
  check(placementError(w, 'lance', 0, 0) === 'occupied', 'the tile is now occupied');

  // The same tile twice in one tick is the double-click case, and it must not
  // build two towers or charge twice.
  const moneyBefore = w.money;
  w.commands.push({ type: 'placeTower', defId: 'lance', col: 1, row: 1 });
  w.commands.push({ type: 'placeTower', defId: 'lance', col: 1, row: 1 });
  stepWorld(w, DT);
  check(w.towers.length === 2, 'a duplicate command in the same tick is rejected', `${w.towers.length} towers`);
  check(w.money === moneyBefore - TOWERS.lance.cost, 'and is not charged for');

  // Spend down to nothing and confirm the wallet cannot go negative.
  let built = 2;
  for (let col = 2; col < 20 && w.money >= 0; col++) {
    w.commands.push({ type: 'placeTower', defId: 'lance', col, row: 0 });
    stepWorld(w, DT);
    if (w.towers.length > built) built = w.towers.length;
  }
  check(w.money >= 0, 'money never goes negative', `$${w.money} after ${w.towers.length} towers`);
  check(placementError(w, 'nova', 21, 0) === 'tooPoor', 'unaffordable towers are refused');
}

// ---------------------------------------------------------------------------
// The placement ghost calls placementError and so does applyCommands. If they
// could disagree, the player would be shown a green tile that then refuses the
// build. Sweeping every tile proves they cannot.
section('build — the ghost cannot lie');

{
  let mismatches = 0;
  let legal = 0;
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const w = createWorld(map, 4242);
      w.wave.phase = 'done';
      const shown = placementError(w, 'lance', col, row) === null;
      w.commands.push({ type: 'placeTower', defId: 'lance', col, row });
      stepWorld(w, DT);
      const built = w.towers.length === 1;
      if (shown !== built) mismatches++;
      if (built) legal++;
    }
  }
  check(mismatches === 0, 'every tile agrees between ghost and sim', `${map.cols * map.rows} tiles swept`);
  check(legal === 339, 'the buildable tile count matches the map', `${legal} legal tiles`);
}

// ---------------------------------------------------------------------------
section('combat — the loop closes');

{
  // One Lance station beside the entry lane, one creep walking into it.
  const w = createWorld(map, 4242);
  w.wave.phase = 'done';
  w.money = 1000;
  w.commands.push({ type: 'placeTower', defId: 'lance', col: 3, row: 3 });
  stepWorld(w, DT);

  const c = spawnCreep(w, 'drifter');
  const startMoney = w.money;
  let sawProjectile = false;
  for (let i = 0; i < 60 * 30 && w.creeps.length > 0; i++) {
    stepWorld(w, DT);
    if (w.projectiles.length > 0) sawProjectile = true;
  }

  check(sawProjectile, 'a tower in range fires');
  check(c.dead && c.hp <= 0, 'the creep dies of damage, not of leaking', `hp=${c.hp}`);
  check(w.lives === BALANCE.startingLives, 'a killed creep never reaches the goal');
  check(w.money === startMoney + c.bounty, 'bounty is paid exactly once', `+$${w.money - startMoney}`);

  // The loop above exits the tick the contact dies, and a *piercing* shot
  // deliberately outlives its target — it carries on to the edge of reach. So
  // the property worth asserting is that nothing leaks, not that a shot
  // vanishes the instant its target does, which was only ever true of homing.
  for (let i = 0; i < 60 * 2; i++) stepWorld(w, DT);
  check(w.projectiles.length === 0, 'spent projectiles are swept up');
}

{
  // Overkill: many towers, one creep. The bounty must still be paid once, and
  // the death event must fire once, however many shots land on the same tick.
  const w = createWorld(map, 4242);
  w.wave.phase = 'done';
  w.money = 100_000;
  for (const [col, row] of [[6, 6], [8, 6], [6, 8], [8, 8], [7, 9], [5, 7]] as const) {
    w.commands.push({ type: 'placeTower', defId: 'nova', col, row });
  }
  stepWorld(w, DT);
  check(w.towers.length === 6, 'six towers cover one stretch of road');

  const c = spawnCreep(w, 'drifter');
  const before = w.money;
  let kills = 0;
  for (let i = 0; i < 60 * 30 && !c.dead; i++) {
    stepWorld(w, DT);
    for (const ev of w.events) if (ev.type === 'creepKilled') kills++;
    w.events.length = 0;
  }
  check(kills === 1, 'a creep dies exactly once under concentrated fire', `${kills} death events`);
  check(w.money === before + c.bounty, 'and pays exactly one bounty', `+$${w.money - before}`);
}

{
  // Fire rate must be exact. `cooldown = fireInterval` would round every
  // tower's rate up to a tick multiple and quietly falsify every balance
  // number; `cooldown += fireInterval` does not.
  const w = createWorld(map, 4242);
  w.wave.phase = 'done';
  w.money = 1000;
  w.commands.push({ type: 'placeTower', defId: 'lance', col: 3, row: 3 });
  stepWorld(w, DT);

  // A creep that cannot die and crawls, so it stays in range long enough to
  // measure many intervals rather than the three or four a normal-speed creep
  // allows. Timestamping every shot is the only way to see drift; a shot
  // *count* would pass even if the rate were wrong by a tick each time.
  const c = spawnCreep(w, 'drifter', 1e9, 0);
  c.speed = 0.15;

  const shotTicks: number[] = [];
  for (let i = 0; i < 60 * 60; i++) {
    const before = w.projectiles.length;
    stepWorld(w, DT);
    if (w.projectiles.length > before) shotTicks.push(w.tick);
  }
  c.dead = true;

  const gaps: number[] = [];
  for (let i = 1; i < shotTicks.length; i++) gaps.push(shotTicks[i]! - shotTicks[i - 1]!);
  const idealTicks = TOWERS.lance.fireInterval / DT;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const worst = Math.max(...gaps.map((g) => Math.abs(g - idealTicks)));

  check(gaps.length > 30, 'the tower fired steadily', `${shotTicks.length} shots`);
  check(
    Math.abs(mean - idealTicks) < 0.05,
    'mean interval matches fireInterval — no drift',
    `${mean.toFixed(3)} ticks vs ${idealTicks} ideal`,
  );
  check(worst <= 1, 'and no individual gap is off by more than a tick', `worst ±${worst}`);
}

{
  // A tower that idles through an intermission must not bank cooldown and fire
  // a burst when the next wave arrives.
  const w = createWorld(map, 4242);
  w.wave.phase = 'done';
  w.money = 1000;
  w.commands.push({ type: 'placeTower', defId: 'nova', col: 3, row: 3 });
  stepWorld(w, DT);
  for (let i = 0; i < 60 * 30; i++) stepWorld(w, DT); // 30s with nothing to shoot

  const t = w.towers[0]!;
  check(t.cooldown === 0, 'an idle tower clamps its cooldown at zero', `cooldown=${t.cooldown}`);

  spawnCreep(w, 'drifter', 1e9, 0);
  let shotsInFirstSecond = 0;
  for (let i = 0; i < 60; i++) {
    const before = w.projectiles.length;
    stepWorld(w, DT);
    if (w.projectiles.length > before) shotsInFirstSecond++;
  }
  check(shotsInFirstSecond <= 1, 'and does not burst when a target appears', `${shotsInFirstSecond} shots`);
}

{
  // No projectile may outlive its target's death or the flight guard.
  const w = createWorld(map, 4242);
  w.wave.phase = 'done';
  w.money = 1000;
  w.commands.push({ type: 'placeTower', defId: 'singularity', col: 3, row: 3 });
  stepWorld(w, DT);
  for (let i = 0; i < 6; i++) spawnCreep(w, 'drifter');
  for (let i = 0; i < 60 * 60; i++) stepWorld(w, DT);
  check(w.projectiles.length === 0, 'no projectile is left in flight', `${w.projectiles.length} stragglers`);
  check(w.creeps.length === 0, 'the board empties');
}

// ---------------------------------------------------------------------------
// M7's three identities. Each station now does something the others cannot, and
// these are the assertions that say so.
section('stations — pierce, splash, slow');

/** A station with no wave machine running, so the gate measures the mechanic. */
function stationWorld(defId: TowerId, col: number, row: number, seed = 909) {
  const w = createWorld(map, seed);
  w.wave.phase = 'done';
  w.money = 5000;
  w.commands.push({ type: 'placeTower', defId, col, row });
  stepWorld(w, DT);
  return { w, t: w.towers[0]! };
}

{
  // Lance pierces. Three contacts strung along the firing line: one shot must
  // damage all three, and each exactly once.
  const { w, t } = stationWorld('lance', 3, 3);
  const line = [0.8, 1.5, 2.2].map((d) => {
    const c = spawnCreep(w, 'drifter', 1e6, 0);
    c.x = t.x + d;
    c.y = t.y;
    return c;
  });

  t.cooldown = 0;
  for (let i = 0; i < 60; i++) stepWorld(w, DT);

  const dmg = TOWERS.lance.damage;
  const hurt = line.filter((c) => c.hp < c.maxHp).length;
  check(hurt === 3, 'one Lance shot reaches every contact in the line', `${hurt}/3`);
  check(
    line.every((c) => (c.maxHp - c.hp) % dmg === 0),
    'and damages each a whole number of times — never twice per pass',
  );
  check(TOWERS.lance.pierce === 2, 'pierce budget is 2 extra contacts', `${TOWERS.lance.pierce}`);
}

{
  // The budget is finite: a fourth contact in the same line must be untouched
  // by a shot that has already spent its two passes.
  const { w, t } = stationWorld('lance', 3, 3, 910);
  const line = [0.6, 1.1, 1.6, 2.1].map((d) => {
    const c = spawnCreep(w, 'drifter', 1e6, 0);
    c.x = t.x + d;
    c.y = t.y;
    return c;
  });

  t.cooldown = 0;
  stepWorld(w, DT);
  // Exactly one shot is in flight; run it out without letting the station refire.
  t.cooldown = 999;
  for (let i = 0; i < 60; i++) stepWorld(w, DT);

  const touched = line.filter((c) => c.hp < c.maxHp).length;
  check(touched === 3, 'a single shot stops after pierce is spent', `${touched} of 4 hit`);
}

{
  // Nova detonates. A cluster off to one side of the target must still take
  // damage, and less of it than the direct hit.
  const { w, t } = stationWorld('nova', 3, 3, 911);
  const direct = spawnCreep(w, 'drifter', 1e6, 0);
  direct.x = t.x + 1.5;
  direct.y = t.y;
  const near = spawnCreep(w, 'drifter', 1e6, 0);
  near.x = t.x + 1.5;
  near.y = t.y + 0.9;
  const far = spawnCreep(w, 'drifter', 1e6, 0);
  far.x = t.x + 1.5;
  far.y = t.y + 4;

  t.cooldown = 0;
  for (let i = 0; i < 120; i++) stepWorld(w, DT);

  check(direct.hp < direct.maxHp, 'Nova damages its target');
  check(near.hp < near.maxHp, 'and everything inside the blast');
  check(
    direct.maxHp - direct.hp > near.maxHp - near.hp,
    'with falloff — the rim takes less than the centre',
    `${direct.maxHp - direct.hp} vs ${near.maxHp - near.hp}`,
  );
  check(far.hp === far.maxHp, 'and nothing outside the radius');
}

{
  // Singularity slows. Same contact, same stretch, with and without a station.
  const travel = (withStation: boolean): number => {
    const w = createWorld(map, 912);
    w.wave.phase = 'done';
    if (withStation) {
      w.money = 5000;
      w.commands.push({ type: 'placeTower', defId: 'singularity', col: 3, row: 3 });
    }
    stepWorld(w, DT);
    const c = spawnCreep(w, 'drifter', 1e6, 0);
    for (let i = 0; i < 60 * 4; i++) stepWorld(w, DT);
    return c.progress;
  };

  const free = travel(false);
  const held = travel(true);
  check(held < free, 'a contact in a gravity well covers less ground', `${held.toFixed(2)} vs ${free.toFixed(2)} tiles`);
  check(
    TOWERS.singularity.slowFactor < 1 && TOWERS.singularity.slowSeconds > 0,
    'and the slow is real content, not a no-op',
    `x${TOWERS.singularity.slowFactor} for ${TOWERS.singularity.slowSeconds}s`,
  );
}

{
  // Slows refresh, never stack — two wells must not compound into a stop.
  const { w, t } = stationWorld('singularity', 3, 3, 913);
  w.commands.push({ type: 'placeTower', defId: 'singularity', col: 3, row: 5 });
  stepWorld(w, DT);

  const c = spawnCreep(w, 'drifter', 1e6, 0);
  c.x = t.x + 1;
  c.y = t.y + 1;
  for (let i = 0; i < 60; i++) stepWorld(w, DT);

  check(
    c.slowFactor >= TOWERS.singularity.slowFactor,
    'two wells do not compound below a single one',
    `x${c.slowFactor.toFixed(2)}`,
  );
  check(c.speed === ENEMIES.drifter.speed, 'and base speed is never mutated', `${c.speed}`);
}

{
  // The slow must expire, or one hit would hold a contact forever.
  const { w, t } = stationWorld('singularity', 3, 3, 914);
  const c = spawnCreep(w, 'drifter', 1e6, 0);
  c.x = t.x + 1;
  c.y = t.y;
  t.cooldown = 0;
  // Several ticks, not one: even at 40 tiles/sec a shot covers 0.67 tiles per
  // tick, so a contact a tile away is struck on the second tick at the earliest.
  for (let i = 0; i < 10; i++) stepWorld(w, DT);
  check(c.slowTimer > 0, 'a hit applies the slow', `${c.slowTimer.toFixed(2)}s left`);

  // Move it out of reach and let the timer run down.
  c.x = t.x + 40;
  for (let i = 0; i < 60 * 3; i++) stepWorld(w, DT);
  check(c.slowTimer === 0, 'and it expires', `${c.slowTimer}`);
  check(c.slowFactor === 1, 'leaving the factor reset so the fields cannot disagree');
}

// ---------------------------------------------------------------------------
section('stations — upgrade, sell, targeting');

{
  const w = createWorld(map, 77);
  w.wave.phase = 'done';
  w.money = 1000;
  w.commands.push({ type: 'placeTower', defId: 'lance', col: 3, row: 3 });
  stepWorld(w, DT);

  const t = w.towers[0]!;
  const base = TOWERS.lance;
  check(t.tier === 1, 'a new station is Mk I');
  check(t.spent === base.cost, 'and has its cost recorded', `$${t.spent}`);
  check(t.targeting === 'first', 'and targets the leader by default');

  const before = w.money;
  const cost = upgradeCost(t)!;
  w.commands.push({ type: 'upgradeTower', id: t.id });
  stepWorld(w, DT);
  check(t.tier === 2, 'upgrading raises the tier');
  check(t.damage === damageAtTier('lance', 2), 'and the damage', `${base.damage} → ${t.damage}`);
  check(w.money === before - cost, 'and charges exactly once', `−$${cost}`);
  check(t.spent === base.cost + cost, 'and adds to the sunk total', `$${t.spent}`);

  // The escalating curve is what stops stacking one tile from dominating, so
  // it is worth asserting rather than trusting the formula.
  check(
    upgradeCost(t)! > cost,
    'the next tier costs more than the last',
    `$${cost} → $${upgradeCost(t)!}`,
  );

  while (upgradeCost(t) !== null) {
    w.money = 10_000;
    w.commands.push({ type: 'upgradeTower', id: t.id });
    stepWorld(w, DT);
  }
  check(t.tier === BALANCE.upgrade.maxTier, 'tiers stop at the ceiling', `Mk ${t.tier}`);

  const moneyAtMax = w.money;
  w.commands.push({ type: 'upgradeTower', id: t.id });
  stepWorld(w, DT);
  check(w.money === moneyAtMax, 'and a further upgrade is refused, not charged');
  check(
    w.events.some((e) => e.type === 'towerActionRejected' && e.reason === 'maxTier'),
    'with a reason, not silence',
  );
}

{
  const w = createWorld(map, 78);
  w.wave.phase = 'done';
  w.money = 1000;
  w.commands.push({ type: 'placeTower', defId: 'nova', col: 4, row: 4 });
  stepWorld(w, DT);
  const t = w.towers[0]!;
  w.money = 1000;
  w.commands.push({ type: 'upgradeTower', id: t.id });
  stepWorld(w, DT);

  const expected = Math.floor(t.spent * BALANCE.sellRefund);
  const before = w.money;
  w.commands.push({ type: 'sellTower', id: t.id });
  stepWorld(w, DT);

  check(w.towers.length === 0, 'selling removes the station');
  check(w.money === before + expected, 'and refunds a cut of everything sunk in', `+$${expected}`);
  check(placementError(w, 'lance', 4, 4) === null, 'and frees the tile');

  // A stale id must be refused rather than crash or refund twice.
  const afterSale = w.money;
  w.commands.push({ type: 'sellTower', id: t.id });
  stepWorld(w, DT);
  check(w.money === afterSale, 'selling the same station twice pays nothing');
}

{
  // Each mode must actually pick a different creep. Two in reach: one far along
  // and nearly dead, one fresh, healthier and closer — so every mode but
  // `first` should prefer the straggler, and for a different reason each time.
  const modes: [TargetMode, string][] = [
    ['first', 'the leader'],
    ['last', 'the straggler'],
    ['strong', 'the healthiest'],
    ['close', 'the nearest'],
  ];

  for (const [mode, label] of modes) {
    const w = createWorld(map, 79);
    w.wave.phase = 'done';
    w.money = 1000;
    w.commands.push({ type: 'placeTower', defId: 'lance', col: 3, row: 3 });
    stepWorld(w, DT);
    const t = w.towers[0]!;
    w.commands.push({ type: 'setTargeting', id: t.id, mode });
    stepWorld(w, DT);

    const leader = spawnCreep(w, 'drifter');
    leader.x = t.x + 1.6;
    leader.y = t.y;
    leader.progress = 30;
    leader.hp = 5;
    const straggler = spawnCreep(w, 'drifter');
    straggler.x = t.x + 0.4;
    straggler.y = t.y;
    straggler.progress = 2;
    straggler.hp = 40;

    t.cooldown = 0;
    stepWorld(w, DT);
    const shot = w.projectiles[0];
    const hit =
      shot?.target === leader ? 'leader' : shot?.target === straggler ? 'straggler' : 'none';
    check(hit === (mode === 'first' ? 'leader' : 'straggler'), `targeting "${mode}" picks ${label}`, hit);
  }
}

{
  // Counters must survive a full match and agree with each other. These feed
  // the wave-clear, defeat and victory screens, and a screen that reports a
  // number nobody checked is worse than one that reports nothing.
  const w = createWorld(map, 4141);
  w.money = 2000;
  for (const [c, r] of [
    [3, 1],
    [7, 3],
    [12, 8],
    [18, 4],
    [22, 10],
  ] as [number, number][]) {
    w.commands.push({ type: 'placeTower', defId: 'lance', col: c, row: r });
  }
  for (let i = 0; i < 60 * 60 * 6 && w.phase === 'playing'; i++) stepWorld(w, DT);

  const perWaveKills = w.perWave.reduce((a, s) => a + (s?.kills ?? 0), 0);
  const perWaveLeaks = w.perWave.reduce((a, s) => a + (s?.leaked ?? 0), 0);
  check(perWaveKills === w.stats.kills, 'per-wave kills sum to the run total', `${w.stats.kills}`);
  check(perWaveLeaks === w.stats.leaks, 'and so do leaks', `${w.stats.leaks}`);
  check(
    w.lives === Math.max(0, BALANCE.startingLives - w.stats.leaks),
    'lives lost matches leaks counted',
    `${w.lives} lives, ${w.stats.leaks} leaks`,
  );

  const towerKills = w.towers.reduce((a, t) => a + t.kills, 0);
  check(towerKills <= w.stats.kills, 'no station claims a kill nobody made', `${towerKills}/${w.stats.kills}`);

  const cov = coverage(w);
  check(
    cov.covered + cov.gaps.length === cov.total,
    'coverage partitions the route',
    `${cov.total} tiles`,
  );
  check(
    cov.total === map.pathLength,
    'and counts every route tile exactly once',
    `${cov.total} vs ${map.pathLength}`,
  );
}

// ---------------------------------------------------------------------------
// Not assertions — a readout. The plan calls M5 the point where we find out
// whether the game is fun, and this is the cheapest way to see whether the
// numbers are anywhere near sane before playing it.
section('balance probe (informational)');

{
  /**
   * Rank buildable tiles by how much road they cover. A competent player finds
   * these tiles by eye; ranking them here means the probe measures the design
   * rather than my ability to guess coordinates.
   */
  const rankedSpots = (range: number): [number, number][] => {
    const scored: { col: number; row: number; covered: number }[] = [];
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        if (map.tiles[row * map.cols + col] !== 'ground') continue;
        let covered = 0;
        for (let r = 0; r < map.rows; r++) {
          for (let c = 0; c < map.cols; c++) {
            if (map.tiles[r * map.cols + c] !== 'path') continue;
            const dx = c - col;
            const dy = r - row;
            if (dx * dx + dy * dy <= range * range) covered++;
          }
        }
        scored.push({ col, row, covered });
      }
    }
    scored.sort((a, b) => b.covered - a.covered || a.col - b.col || a.row - b.row);
    return scored.map((s) => [s.col, s.row]);
  };

  /**
   * Play a real economy: start with the real budget and buy the best remaining
   * tile whenever it becomes affordable. Handing the probe unlimited money
   * measures tower damage but says nothing about whether bounty income can
   * fund a defence, which is the actual question at M5.
   */
  const SEEDS = [4242, 7, 999, 31337, 12345];

  const play = (build: TowerId[], rush: boolean, seed: number): { won: boolean; lives: number } => {
    // Rank by the widest range in the build so every strategy shares one notion
    // of "good tile" and none is flattered by its own ordering.
    const spots = rankedSpots(Math.max(...build.map((b) => TOWERS[b].range)));
    const w = createWorld(map, seed);
    const acc: Accumulator = { debt: 0 };
    let next = 0;

    for (let i = 0; i < 400_000 && w.phase === 'playing'; i++) {
      const want = build[next % build.length]!;
      if (next < spots.length && w.money >= TOWERS[want].cost) {
        w.commands.push({ type: 'placeTower', defId: want, col: spots[next]![0], row: spots[next]![1] });
        next++;
      }
      if (rush) w.commands.push({ type: 'startWave' });
      advance(w, acc, 1000 / TICK_HZ, 1);
      w.events.length = 0;
    }
    return { won: w.phase === 'won', lives: w.lives };
  };

  const row = (label: string, build: TowerId[], rush: boolean): string => {
    const rs = SEEDS.map((s) => play(build, rush, s));
    const wins = rs.filter((r) => r.won).length;
    const lives = rs.reduce((a, r) => a + r.lives, 0) / rs.length;
    return `${rush ? 'rush' : 'wait'} ${label.padEnd(9)} won ${wins}/${SEEDS.length}  avg lives ${lives.toFixed(1).padStart(5)}/${BALANCE.startingLives}`;
  };

  const builds: [string, TowerId[]][] = [
    ['lance', ['lance']],
    ['nova', ['nova']],
    ['singularity', ['singularity']],
    ['nova+2lance', ['nova', 'lance', 'lance']],
  ];

  console.log(`  \x1b[2mgreedy auto-builder · real starting money · ${SEEDS.length} seeds\x1b[0m`);
  console.log('  \x1b[2m"wait" lets each intermission run out; "rush" sends every wave early\x1b[0m');
  for (const rush of [false, true]) {
    for (const [label, build] of builds) console.log(`  \x1b[2m${row(label, build, rush)}\x1b[0m`);
  }
}

// ---------------------------------------------------------------------------
// Throwing rather than setting process.exitCode: it exits non-zero all the same
// and avoids pulling @types/node into the project, which would put Node globals
// in scope for src/ and quietly weaken the purity boundary.
if (failures > 0) throw new Error(`${failures} gate failure(s)`);
console.log('\n\x1b[32mall gates pass\x1b[0m\n');
