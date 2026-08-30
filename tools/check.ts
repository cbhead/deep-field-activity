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
import { planWave, scaledStats, waveCount } from '../src/sim/wavePlan.ts';
import { TOWERS, TOWER_IDS, type TowerId } from '../src/content/towers.ts';
import { ENEMIES, ENEMY_IDS, type EnemyId } from '../src/content/enemies.ts';
import { damageAtTier, placementError, upgradeCost, visualTier } from '../src/sim/build.ts';
import { coverage, formatDamage, toughestArmour } from '../src/sim/analysis.ts';
import type { TargetMode } from '../src/sim/types.ts';
import { stepWorld } from '../src/sim/step.ts';
import { damageCreep, effectiveDamage } from '../src/sim/damage.ts';
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
  const c = spawnCreep(w, 'drifter', { hp: 1e9, bounty: 0 });
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

  spawnCreep(w, 'drifter', { hp: 1e9, bounty: 0 });
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
    const c = spawnCreep(w, 'drifter', { hp: 1e6, bounty: 0 });
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
    const c = spawnCreep(w, 'drifter', { hp: 1e6, bounty: 0 });
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
  const direct = spawnCreep(w, 'drifter', { hp: 1e6, bounty: 0 });
  direct.x = t.x + 1.5;
  direct.y = t.y;
  const near = spawnCreep(w, 'drifter', { hp: 1e6, bounty: 0 });
  near.x = t.x + 1.5;
  near.y = t.y + 0.9;
  const far = spawnCreep(w, 'drifter', { hp: 1e6, bounty: 0 });
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
    const c = spawnCreep(w, 'drifter', { hp: 1e6, bounty: 0 });
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

  const c = spawnCreep(w, 'drifter', { hp: 1e6, bounty: 0 });
  c.x = t.x + 1;
  c.y = t.y + 1;
  for (let i = 0; i < 60; i++) stepWorld(w, DT);

  check(
    c.slowFactor >= TOWERS.singularity.slowFactor,
    'two wells do not compound below a single one',
    `x${c.slowFactor.toFixed(2)}`,
  );
  check(c.speed === ENEMIES[c.defId].speed, 'and base speed is never mutated', `${c.speed}`);
}

{
  // The slow must expire, or one hit would hold a contact forever.
  const { w, t } = stationWorld('singularity', 3, 3, 914);
  const c = spawnCreep(w, 'drifter', { hp: 1e6, bounty: 0 });
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
  check(
    t.tiers.damage === 1 && t.tiers.range === 1 && t.tiers.effect === 1,
    'a new station is Mk I on all three paths',
  );
  check(t.spent === base.cost, 'and has its cost recorded', `$${t.spent}`);
  check(t.targeting === 'first', 'and targets the leader by default');

  const before = w.money;
  const cost = upgradeCost(t, 'damage')!;
  w.commands.push({ type: 'upgradeTower', id: t.id, path: 'damage' });
  stepWorld(w, DT);
  check(t.tiers.damage === 2, 'upgrading a path raises that path');
  check(
    t.stats.damage === damageAtTier('lance', 2),
    'and the damage',
    `${base.damage} → ${t.stats.damage}`,
  );
  check(w.money === before - cost, 'and charges exactly once', `−$${cost}`);
  check(t.spent === base.cost + cost, 'and adds to the sunk total', `$${t.spent}`);

  // The escalating curve is what stops stacking one path from dominating, so
  // it is worth asserting rather than trusting the formula.
  check(
    upgradeCost(t, 'damage')! > cost,
    'the next tier of a path costs more than the last',
    `$${cost} → $${upgradeCost(t, 'damage')!}`,
  );

  // The paths are independent: buying one must not move the others' stats,
  // costs, or tiers. This is the property the whole redesign is for.
  check(
    t.stats.range === base.range && t.stats.pierce === base.pierce,
    'a damage purchase leaves range and effect untouched',
  );
  check(
    upgradeCost(t, 'range')! === Math.round(base.cost * BALANCE.upgrade.costFactor),
    'and the other paths still price from their own tier',
    `$${upgradeCost(t, 'range')!}`,
  );

  const beforeRange = t.stats.range;
  w.commands.push({ type: 'upgradeTower', id: t.id, path: 'range' });
  stepWorld(w, DT);
  check(
    t.stats.range > beforeRange && t.tiers.range === 2,
    'a range purchase grows reach',
    `${beforeRange.toFixed(2)} → ${t.stats.range.toFixed(2)}`,
  );
  check(t.stats.damage === damageAtTier('lance', 2), 'without touching damage');

  const beforePierce = t.stats.pierce;
  w.commands.push({ type: 'upgradeTower', id: t.id, path: 'effect' });
  stepWorld(w, DT);
  check(
    t.stats.pierce === beforePierce + TOWERS.lance.effectUpgrade.perTier.pierce!,
    "an effect purchase deepens the station's mechanic",
    `pierce ${beforePierce} → ${t.stats.pierce}`,
  );
  check(t.stats.damage === damageAtTier('lance', 2), 'and also leaves damage alone');

  while (upgradeCost(t, 'damage') !== null) {
    w.money = 10_000;
    w.commands.push({ type: 'upgradeTower', id: t.id, path: 'damage' });
    stepWorld(w, DT);
  }
  check(
    t.tiers.damage === BALANCE.upgrade.maxTier,
    'a path stops at the ceiling',
    `damage Mk ${t.tiers.damage}`,
  );
  check(
    upgradeCost(t, 'effect') !== null,
    'while the other paths remain buyable',
    `effect next: $${upgradeCost(t, 'effect')!}`,
  );
  check(
    visualTier(t) === BALANCE.upgrade.maxTier,
    'and the art tier is capped at the baked set',
    `Mk ${visualTier(t)}`,
  );

  const moneyAtMax = w.money;
  w.commands.push({ type: 'upgradeTower', id: t.id, path: 'damage' });
  stepWorld(w, DT);
  check(w.money === moneyAtMax, 'a purchase past the ceiling is refused, not charged');
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
  w.commands.push({ type: 'upgradeTower', id: t.id, path: 'damage' });
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

/**
 * Rank buildable tiles by how much road they cover. A competent player finds
 * these tiles by eye; ranking them here means a gate or a probe measures the
 * design rather than my ability to guess coordinates.
 *
 * Module scope because both the determinism gate and the balance probe want a
 * plausible defence, and two copies of this heuristic would be two things to
 * keep in step.
 */
function rankedSpots(range: number): [number, number][] {
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
}

// ---------------------------------------------------------------------------
section('contacts — content');

{
  const used = new Set<string>();
  for (const wv of WAVES) for (const gr of wv.groups) used.add(gr.enemy);
  const missing = ENEMY_IDS.filter((id) => !used.has(id));
  check(
    missing.length === 0,
    'every contact type appears in the wave table',
    missing.length ? `unused: ${missing.join(', ')}` : `${ENEMY_IDS.length} types`,
  );

  const unknown = [...used].filter((id) => !(ENEMY_IDS as string[]).includes(id));
  check(unknown.length === 0, 'and no wave references a type that does not exist');

  // The one property that makes runaway splitting impossible rather than
  // merely unlikely: whatever a type splits into must not itself split.
  const recursive = ENEMY_IDS.filter((id) => {
    const s = ENEMIES[id].splitInto;
    return s !== null && ENEMIES[s.enemy as typeof id].splitInto !== null;
  });
  check(recursive.length === 0, 'nothing splits into something that splits', recursive.join(', '));
}

// ---------------------------------------------------------------------------
// A Warden is a test of *coverage*, not of damage: sustained fire holds its
// shield down, a gap hands it back. These gates pin both halves.
section('contacts — shields');

{
  const w = soloWorld();
  const c = spawnCreep(w, 'warden');
  const base = ENEMIES.warden;
  check(c.shield === base.shield && c.maxShield === base.shield, 'a warden spawns shielded', `${c.shield}`);

  // Absorbed by the shield, not the hull.
  damageCreep(w, c, 10);
  check(c.hp === c.maxHp && c.shield === base.shield - 10, 'the shield absorbs first', `hull ${c.hp}, shield ${c.shield}`);

  // Overflow carries through rather than being wasted on a thin shield.
  const before = c.hp;
  damageCreep(w, c, base.shield - 10 + 7);
  check(c.shield === 0 && c.hp === before - 7, 'overflow carries into the hull', `hull ${c.hp}, shield ${c.shield}`);
}

{
  const w = soloWorld();
  const c = spawnCreep(w, 'warden');
  const base = ENEMIES.warden;
  damageCreep(w, c, 10);
  const dented = c.shield;

  // Nothing comes back while the delay is still running.
  for (let i = 0; i < Math.floor((base.shieldRegenDelay - 0.2) * 60); i++) stepWorld(w, DT);
  check(c.shield === dented, 'no regen during the delay', `${c.shield}`);

  for (let i = 0; i < 60 * 6; i++) stepWorld(w, DT);
  check(c.shield === c.maxShield, 'and it returns to full, never past it', `${c.shield}/${c.maxShield}`);
}

{
  // The property that matters in play: a shield is extra effective health.
  const kill = (defId: 'drifter' | 'warden'): number => {
    const w = soloWorld();
    const c = spawnCreep(w, defId, { hp: 30, shield: defId === 'warden' ? 30 : 0 });
    let ticks = 0;
    // Steady chip, faster than regen, so the shield only ever delays the kill.
    while (!c.dead && ticks < 60 * 120) {
      damageCreep(w, c, 1);
      stepWorld(w, DT);
      ticks++;
    }
    return ticks;
  };
  const plain = kill('drifter');
  const shielded = kill('warden');
  check(shielded > plain, 'a shielded contact takes longer to kill', `${shielded} vs ${plain} ticks`);
}

// ---------------------------------------------------------------------------
section('contacts — armour');

{
  const w = soloWorld();
  const c = spawnCreep(w, 'bulwark');
  const armor = ENEMIES.bulwark.armor;
  const before = c.hp;

  damageCreep(w, c, 20);
  check(
    c.hp === before - (20 - armor),
    'armour comes off every hit',
    `−${20 - armor} of 20 raw`,
  );
}

{
  // Never immunity. A station whose shots literally cannot scratch something
  // reads as a bug, and it would make a bad build unrecoverable rather than
  // merely bad — no chipping your way to the money for the station you need.
  const w = soloWorld();
  const c = spawnCreep(w, 'bulwark');
  const before = c.hp;
  const raw = 2; // Singularity's damage, far under the armour value.

  damageCreep(w, c, raw);
  const landed = before - c.hp;
  check(landed > 0, 'a hit smaller than the armour still lands something', `${landed.toFixed(2)}`);
  check(
    Math.abs(landed - raw * BALANCE.armorFloor) < 1e-9,
    'and lands exactly the floor, not the difference',
    `${landed.toFixed(2)} = ${raw} × ${BALANCE.armorFloor}`,
  );
}

{
  // Everything unarmoured must be bit-identical to before armour existed.
  const w = soloWorld();
  const c = spawnCreep(w, 'drifter');
  const before = c.hp;
  damageCreep(w, c, 7);
  check(c.hp === before - 7, 'an unarmoured contact takes the whole hit', '−7 of 7');
}

{
  // The defining property, and the one that a "simplification" to percentage
  // armour would silently destroy: the same damage total is worth more
  // delivered as one heavy hit than as chip. That asymmetry is the entire
  // reason this mechanic exists — it is the axis Nova is strong on and the
  // Lance/Singularity pair is weak on.
  const spend = 60;
  const hullAfter = (hits: number): number => {
    const w = soloWorld();
    const c = spawnCreep(w, 'bulwark', { hp: 500 });
    for (let i = 0; i < hits; i++) damageCreep(w, c, spend / hits);
    return c.hp;
  };

  const heavy = hullAfter(1);
  const chip = hullAfter(10);
  check(heavy < chip, 'one heavy hit beats the same total as chip', `hull ${heavy.toFixed(1)} vs ${chip.toFixed(1)}`);
}

{
  // Armour must not distort attribution or bounty: a kill still pays once, and
  // a tower is credited what it actually landed rather than what it fired.
  const w = soloWorld();
  const c = spawnCreep(w, 'bulwark', { hp: 10, bounty: 9 });
  const money = w.money;

  damageCreep(w, c, 1e6);
  check(c.dead && w.money === money + 9, 'an armoured kill pays its bounty once', `+$9`);
}

// ---------------------------------------------------------------------------
// The inspector prints effective damage, and the sim applies it. They call the
// same function so they cannot disagree — this is the analogue of the "ghost
// cannot lie" sweep, for the same failure mode in a new place.
section('inspector — armour readout');

{
  check(effectiveDamage(20, 0) === 20, 'no armour is identity');
  check(effectiveDamage(20, 5) === 15, 'armour comes off the hit', `${effectiveDamage(20, 5)}`);
  check(effectiveDamage(3, 5) > 0, 'armour is never immunity', `${effectiveDamage(3, 5)}`);
  check(
    Math.abs(effectiveDamage(3, 5) - 3 * BALANCE.armorFloor) < 1e-9,
    'and floors at armorFloor rather than going negative',
    `${effectiveDamage(3, 5).toFixed(2)} = 3 × ${BALANCE.armorFloor}`,
  );

  let floorHolds = true;
  for (let amount = 0; amount <= 60; amount += 0.5) {
    for (const armor of [0, 1, 5, 40]) {
      const e = effectiveDamage(amount, armor);
      if (e < 0 || e > amount || e < amount * BALANCE.armorFloor - 1e-9) floorHolds = false;
    }
  }
  check(floorHolds, 'never negative, never above the raw hit, never under the floor');
}

{
  // What the panel would print must equal what the sim actually removes, for
  // every station at every tier. Drift here would mislead a player at the exact
  // moment they are spending money on an upgrade.
  const w = soloWorld();
  let worst = 0;
  for (const defId of TOWER_IDS) {
    for (let tier = 1; tier <= BALANCE.upgrade.maxTier; tier++) {
      const raw = damageAtTier(defId, tier);
      const shown = effectiveDamage(raw, ENEMIES.bulwark.armor);

      const c = spawnCreep(w, 'bulwark', { hp: 1e6 });
      const before = c.hp;
      damageCreep(w, c, raw);
      const actual = before - c.hp;
      c.dead = true;

      worst = Math.max(worst, Math.abs(actual - shown));
    }
  }
  check(worst < 1e-9, 'the panel figure equals what the sim removes', `worst delta ${worst}`);

  // A floored hit is small, not absent. Rounding it to a whole number renders
  // "0", which tells the player the station did nothing at all.
  const floored = effectiveDamage(damageAtTier('singularity', 1), ENEMIES.bulwark.armor);
  check(
    Number(formatDamage(floored)) > 0,
    'a floored hit never renders as zero',
    `${floored.toFixed(3)} → "${formatDamage(floored)}"`,
  );
}

{
  const w = soloWorld();
  check(toughestArmour(w) === null, 'no armour reference on an empty board');

  spawnCreep(w, 'drifter');
  check(toughestArmour(w) === null, 'and none when nothing alive is armoured');

  spawnCreep(w, 'bulwark');
  const ref = toughestArmour(w);
  check(
    ref !== null && ref.defId === 'bulwark' && !ref.inbound,
    'a live armoured contact is picked, and not flagged inbound',
    `${ref?.defId}`,
  );
}

{
  // The intermission fallback: upgrades get bought when the board is empty, and
  // a readout that vanished exactly then would be useless.
  const w = createWorld(map, 4242);
  // Wave index 6 is the first that contains a bulwark.
  w.wave.index = 6;
  w.wave.phase = 'intermission';
  check(w.creeps.length === 0, 'board is empty during the intermission');
  const ref = toughestArmour(w);
  check(
    ref !== null && ref.defId === 'bulwark' && ref.inbound,
    'the inbound wave supplies the reference, flagged as inbound',
    `${ref?.defId} inbound=${ref?.inbound}`,
  );
}

// ---------------------------------------------------------------------------
section('contacts — splits');

{
  const w = soloWorld();
  const parent = spawnCreep(w, 'cluster', { wave: 4 });
  // Walk it onto the board so the children have a real position to inherit.
  for (let i = 0; i < 120; i++) stepWorld(w, DT);
  const px = parent.x;
  const pProgress = parent.progress;

  damageCreep(w, parent, 1e6);
  check(w.creeps.includes(parent), 'the parent is still in the array before cleanup');
  check(w.pendingSplits.length === 1, 'the split is queued, not spawned inline');

  stepWorld(w, DT);
  const kids = w.creeps.filter((c) => c.defId === 'mote');
  const expected = ENEMIES.cluster.splitInto!.count;
  check(kids.length === expected, 'a cluster yields exactly its child count', `${kids.length}`);
  check(kids.every((k) => k.wave === 4), "children carry the PARENT's wave tag", `${kids.map((k) => k.wave).join(',')}`);
  check(
    kids.every((k) => Math.abs(k.x - px) < 1 && k.progress > 0 && k.progress <= pProgress + 1),
    'and appear where the parent died, not back at the entry',
    `progress ${kids.map((k) => k.progress.toFixed(1)).join(', ')} vs parent ${pProgress.toFixed(1)}`,
  );

  // Kill the children too; nothing further may appear.
  for (const k of kids) damageCreep(w, k, 1e6);
  stepWorld(w, DT);
  check(w.creeps.length === 0, 'children do not split again', `${w.creeps.length} left`);
}

{
  // The sharpest one. Splits are the obvious way to break wave settlement:
  // a child tagged with the wrong wave would let its parent's wave settle
  // early, paying the reward while contacts were still walking — and at the
  // end of a run, declaring victory with the board occupied.
  const w = createWorld(map, 4242);
  w.lives = 1_000_000;
  let cleared = 0;
  let splits = 0;

  for (let i = 0; i < 400_000 && w.phase === 'playing'; i++) {
    // Kill everything the moment it is fully spawned, so every wave settles.
    if (w.wave.phase !== 'spawning') for (const c of w.creeps) damageCreep(w, c, 1e6);
    w.commands.push({ type: 'startWave' });
    stepWorld(w, DT);
    for (const ev of w.events) {
      if (ev.type === 'waveCleared') cleared++;
      if (ev.type === 'creepSplit') splits++;
    }
    w.events.length = 0;
  }

  check(splits > 0, 'the run actually produced splits', `${splits}`);
  check(w.phase === 'won', 'a run full of splits still reaches victory');
  check(cleared === waveCount(), 'and every wave settles exactly once', `${cleared}/${waveCount()}`);
  check(w.creeps.length === 0, 'with nothing left on the board');
}

{
  // Splits draw no random numbers, so a whole match must replay identically.
  const run = (): string => {
    const w = createWorld(map, 8888);
    w.money = 100_000;
    for (const [col, row] of rankedSpots(3).slice(0, 14)) {
      w.commands.push({ type: 'placeTower', defId: 'nova', col, row });
    }
    const log: string[] = [];
    for (let i = 0; i < 60 * 400 && w.phase === 'playing'; i++) {
      stepWorld(w, DT);
      for (const ev of w.events) {
        if (ev.type === 'creepSplit') log.push(`${w.tick}:${ev.into}x${ev.count}@${ev.x.toFixed(3)},${ev.y.toFixed(3)}`);
      }
      w.events.length = 0;
    }
    return log.join('|');
  };
  const a = run();
  check(a.length > 0, 'the determinism run produced splits', `${a.split('|').length} events`);
  check(a === run(), 'one seed replays split-for-split identically');
}

// ---------------------------------------------------------------------------
// Not assertions — a readout. The plan calls M5 the point where we find out
// whether the game is fun, and this is the cheapest way to see whether the
// numbers are anywhere near sane before playing it.
section('matchup matrix (informational)');

{
  /**
   * Every station against every contact, in isolation.
   *
   * The whole-run probe below answers "does this build survive the arc", which
   * stopped being diagnostic the moment there were five contact types — a
   * station can beat Drifters comfortably and still be helpless against
   * Monoliths, and the run probe reports both as one number.
   *
   * This asks the design question instead: **is each station the answer to
   * something, and is anything unanswerable?** A row of zeros is a station that
   * beats everything; a column that nothing clears is a contact with no counter.
   * Both are balance failures, and neither is visible from win rates.
   *
   * Money is unlimited here on purpose. This measures combat, not economy —
   * the run probe is where affordability gets tested.
   */
  const DUEL_WAVE = 5;
  const DUEL_STATIONS = 8;

  /**
   * Counts and spacing per contact, taken from how each actually appears in
   * `WAVES` rather than a flat ten of everything.
   *
   * The flat version was tried first and was actively misleading: ten Motes
   * read as zero leaks against every station, which says Motes are trivial.
   * They are not — they arrive fourteen and sixteen at a time, and the swarm is
   * the entire point of them. Measuring a contact at a pressure it never occurs
   * at measures nothing.
   */
  const PRESSURE: Record<EnemyId, { count: number; every: number }> = {
    drifter: { count: 10, every: 0.9 },
    mote: { count: 15, every: 0.27 },
    monolith: { count: 3, every: 2.5 },
    warden: { count: 4, every: 1.6 },
    cluster: { count: 4, every: 1.6 },
    bulwark: { count: 4, every: 1.9 },
  };

  const duel = (tower: TowerId, enemy: EnemyId): number => {
    const w = createWorld(map, 4242);
    w.wave.phase = 'done';
    // The duel measures wave-DUEL_WAVE stats, so the world has to *be* at that
    // wave — stations gate on `wave.index >= unlockWave`, and at index 0 every
    // station that unlocks later silently failed to place. The matrix then read
    // as "leaks everything", which is indistinguishable from a useless station
    // and is exactly the false signal this table exists to avoid.
    w.wave.index = DUEL_WAVE;
    w.money = 1_000_000;
    // Deep enough that a leak never ends the run — we want the count, not a loss.
    w.lives = 9999;

    for (const [col, row] of rankedSpots(TOWERS[tower].range).slice(0, DUEL_STATIONS)) {
      w.commands.push({ type: 'placeTower', defId: tower, col, row });
    }
    stepWorld(w, DT);

    const stats = scaledStats(enemy, DUEL_WAVE);
    const { count, every } = PRESSURE[enemy];
    let spawned = 0;
    let t = 0;

    for (let i = 0; i < 60 * 300; i++) {
      if (spawned < count && t >= spawned * every) {
        spawnCreep(w, enemy, { ...stats, wave: DUEL_WAVE });
        spawned++;
      }
      stepWorld(w, DT);
      w.events.length = 0;
      t += DT;
      if (spawned >= count && w.creeps.length === 0) break;
    }
    return 9999 - w.lives;
  };

  const pad = (s: string, n: number): string => s.padStart(n);
  console.log(
    `  \x1b[2m${DUEL_STATIONS} stations vs a representative group at wave ${DUEL_WAVE} stats · unlimited money · leaks of N sent (lower is better)\x1b[0m`,
  );
  console.log(`  \x1b[2m${pad('', 13)}${ENEMY_IDS.map((e) => pad(e, 10)).join('')}\x1b[0m`);

  for (const t of TOWER_IDS) {
    const cells = ENEMY_IDS.map((e) => pad(`${duel(t, e)}/${PRESSURE[e].count}`, 10)).join('');
    console.log(`  \x1b[2m${t.padEnd(13)}${cells}\x1b[0m`);
  }
}

// ---------------------------------------------------------------------------
section('balance probe (informational)');

{
  /**
   * Play a real economy: start with the real budget and buy the best remaining
   * tile whenever it becomes affordable. Handing the probe unlimited money
   * measures tower damage but says nothing about whether bounty income can
   * fund a defence, which is the actual question at M5.
   */
  const SEEDS = [4242, 7, 999, 31337, 12345];

  const play = (
    build: TowerId[],
    rush: boolean,
    seed: number,
  ): { won: boolean; lives: number; towers: number; wave: number; earned: number } => {
    // Rank by the widest range in the build so every strategy shares one notion
    // of "good tile" and none is flattered by its own ordering.
    const spots = rankedSpots(Math.max(...build.map((b) => TOWERS[b].range)));
    const w = createWorld(map, seed);
    const acc: Accumulator = { debt: 0 };
    let next = 0;

    for (let i = 0; i < 400_000 && w.phase === 'playing'; i++) {
      const want = build[next % build.length]!;
      // `next` advances only when the command can actually succeed. It used to
      // advance on every attempt, so a station rejected for being locked burned
      // one of the ranked tiles and the build quietly came out short.
      if (
        next < spots.length &&
        w.money >= TOWERS[want].cost &&
        w.wave.index >= TOWERS[want].unlockWave
      ) {
        w.commands.push({ type: 'placeTower', defId: want, col: spots[next]![0], row: spots[next]![1] });
        next++;
      }
      if (rush) w.commands.push({ type: 'startWave' });
      advance(w, acc, 1000 / TICK_HZ, 1);
      w.events.length = 0;
    }
    return {
      won: w.phase === 'won',
      lives: w.lives,
      // How far the economy got, not just whether it survived. A run that dies
      // with four stations built is an income problem; one that dies with
      // twenty is a station-power problem, and the win rate alone cannot tell
      // those apart.
      towers: w.towers.length,
      wave: w.wave.clearedThrough + 1,
      earned: w.stats.bounty,
    };
  };

  const mean = (ns: number[]): number => ns.reduce((a, b) => a + b, 0) / ns.length;

  const row = (label: string, build: TowerId[], rush: boolean): string => {
    const rs = SEEDS.map((s) => play(build, rush, s));
    const wins = rs.filter((r) => r.won).length;
    return (
      `${rush ? 'rush' : 'wait'} ${label.padEnd(13)}` +
      ` won ${wins}/${SEEDS.length}` +
      `  lives ${mean(rs.map((r) => r.lives)).toFixed(1).padStart(4)}/${BALANCE.startingLives}` +
      `  waves ${mean(rs.map((r) => r.wave)).toFixed(1).padStart(4)}/${waveCount()}` +
      `  built ${mean(rs.map((r) => r.towers)).toFixed(1).padStart(4)}` +
      `  bounty $${Math.round(mean(rs.map((r) => r.earned)))}`
    );
  };

  /**
   * Mixed builds matter more than pure ones now.
   *
   * A pure Singularity build cannot win by construction — it is a support
   * station, and slowing without killing just delays a leak. `singularity` at
   * 0/5 is therefore not evidence of a weak station; the question is whether
   * adding one to a working build *helps*, which only a mix can answer.
   */
  const builds: [string, TowerId[]][] = [
    ['lance', ['lance']],
    ['nova', ['nova']],
    ['singularity', ['singularity']],
    ['arc', ['arc']],
    ['filament', ['filament']],
    ['nova+2lance', ['nova', 'lance', 'lance']],
    ['arc+filament', ['arc', 'filament']],
    ['all five', ['nova', 'lance', 'singularity', 'arc', 'filament']],
    ['nova+lance+sing', ['nova', 'lance', 'singularity']],
    ['2nova+sing', ['nova', 'nova', 'singularity']],
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
