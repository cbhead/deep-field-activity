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
import { TOWERS } from '../src/content/towers.ts';
import { placementError } from '../src/sim/build.ts';
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
    const w = soloWorld();
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
    const w = soloWorld();
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
    const w = soloWorld();
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

  const scale = planWave(77, 9)[0]!.hp / planWave(77, 0)[0]!.hp;
  check(scale > 4 && scale < 8, 'hp compounds across the arc', `wave 10 is ${scale.toFixed(1)}x wave 1`);
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
section('build — placement rules');

{
  const w = createWorld(map, 4242);
  w.wave.phase = 'done';

  check(placementError(w, 'arrow', 0, 0) === null, 'open ground accepts a tower');
  check(placementError(w, 'arrow', 5, 2) === 'notBuildable', 'the road refuses a tower');
  check(placementError(w, 'arrow', 3, 5) === 'notBuildable', 'scenery refuses a tower');
  check(placementError(w, 'arrow', -1, 0) === 'offBoard', 'off-board is rejected');
  check(placementError(w, 'arrow', map.cols, 0) === 'offBoard', 'past the right edge is rejected');
  check(placementError(w, 'arrow', 0.5, 0) === 'offBoard', 'a fractional tile is rejected');

  const before = w.money;
  w.commands.push({ type: 'placeTower', defId: 'arrow', col: 0, row: 0 });
  stepWorld(w, DT);
  check(w.towers.length === 1, 'a valid command builds exactly one tower');
  check(w.money === before - TOWERS.arrow.cost, 'the cost is deducted once', `$${before} → $${w.money}`);
  check(placementError(w, 'arrow', 0, 0) === 'occupied', 'the tile is now occupied');

  // The same tile twice in one tick is the double-click case, and it must not
  // build two towers or charge twice.
  const moneyBefore = w.money;
  w.commands.push({ type: 'placeTower', defId: 'arrow', col: 1, row: 1 });
  w.commands.push({ type: 'placeTower', defId: 'arrow', col: 1, row: 1 });
  stepWorld(w, DT);
  check(w.towers.length === 2, 'a duplicate command in the same tick is rejected', `${w.towers.length} towers`);
  check(w.money === moneyBefore - TOWERS.arrow.cost, 'and is not charged for');

  // Spend down to nothing and confirm the wallet cannot go negative.
  let built = 2;
  for (let col = 2; col < 20 && w.money >= 0; col++) {
    w.commands.push({ type: 'placeTower', defId: 'arrow', col, row: 0 });
    stepWorld(w, DT);
    if (w.towers.length > built) built = w.towers.length;
  }
  check(w.money >= 0, 'money never goes negative', `$${w.money} after ${w.towers.length} towers`);
  check(placementError(w, 'cannon', 21, 0) === 'tooPoor', 'unaffordable towers are refused');
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
      const shown = placementError(w, 'arrow', col, row) === null;
      w.commands.push({ type: 'placeTower', defId: 'arrow', col, row });
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
  // One arrow tower beside the entry lane, one creep walking into it.
  const w = createWorld(map, 4242);
  w.wave.phase = 'done';
  w.money = 1000;
  w.commands.push({ type: 'placeTower', defId: 'arrow', col: 3, row: 3 });
  stepWorld(w, DT);

  const c = spawnCreep(w, 'grunt');
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
  check(w.projectiles.length === 0, 'spent projectiles are swept up');
}

{
  // Overkill: many towers, one creep. The bounty must still be paid once, and
  // the death event must fire once, however many shots land on the same tick.
  const w = createWorld(map, 4242);
  w.wave.phase = 'done';
  w.money = 100_000;
  for (const [col, row] of [[6, 6], [8, 6], [6, 8], [8, 8], [7, 9], [5, 7]] as const) {
    w.commands.push({ type: 'placeTower', defId: 'cannon', col, row });
  }
  stepWorld(w, DT);
  check(w.towers.length === 6, 'six towers cover one stretch of road');

  const c = spawnCreep(w, 'grunt');
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
  w.commands.push({ type: 'placeTower', defId: 'arrow', col: 3, row: 3 });
  stepWorld(w, DT);

  // A creep that cannot die and crawls, so it stays in range long enough to
  // measure many intervals rather than the three or four a normal-speed creep
  // allows. Timestamping every shot is the only way to see drift; a shot
  // *count* would pass even if the rate were wrong by a tick each time.
  const c = spawnCreep(w, 'grunt', 1e9, 0);
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
  const idealTicks = TOWERS.arrow.fireInterval / DT;
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
  w.commands.push({ type: 'placeTower', defId: 'cannon', col: 3, row: 3 });
  stepWorld(w, DT);
  for (let i = 0; i < 60 * 30; i++) stepWorld(w, DT); // 30s with nothing to shoot

  const t = w.towers[0]!;
  check(t.cooldown === 0, 'an idle tower clamps its cooldown at zero', `cooldown=${t.cooldown}`);

  spawnCreep(w, 'grunt', 1e9, 0);
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
  w.commands.push({ type: 'placeTower', defId: 'frost', col: 3, row: 3 });
  stepWorld(w, DT);
  for (let i = 0; i < 6; i++) spawnCreep(w, 'grunt');
  for (let i = 0; i < 60 * 60; i++) stepWorld(w, DT);
  check(w.projectiles.length === 0, 'no projectile is left in flight', `${w.projectiles.length} stragglers`);
  check(w.creeps.length === 0, 'the board empties');
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
  const probe = (towerId: 'arrow' | 'cannon' | 'frost'): string => {
    const spots = rankedSpots(TOWERS[towerId].range);
    const w = createWorld(map, 4242);
    const acc: Accumulator = { debt: 0 };
    let next = 0;
    let leaked = 0;

    for (let i = 0; i < 400_000 && w.phase === 'playing'; i++) {
      if (next < spots.length && w.money >= TOWERS[towerId].cost) {
        w.commands.push({ type: 'placeTower', defId: towerId, col: spots[next]![0], row: spots[next]![1] });
        next++;
      }
      advance(w, acc, 1000 / TICK_HZ, 1);
      for (const ev of w.events) if (ev.type === 'creepLeaked') leaked++;
      w.events.length = 0;
    }

    const reached = w.phase === 'won' ? waveCount() : w.wave.index + 1;
    return (
      `${towerId.padEnd(6)} → ${w.phase === 'won' ? 'WON ' : 'lost'} on wave ${String(reached).padStart(2)}/${waveCount()}` +
      ` · ${String(w.towers.length).padStart(2)} towers built · ${String(w.lives).padStart(2)} lives · ${leaked} leaked`
    );
  };

  console.log('  \x1b[2mgreedy auto-builder, real starting money, best-coverage tiles\x1b[0m');
  for (const id of ['arrow', 'cannon', 'frost'] as const) {
    console.log(`  \x1b[2m${probe(id)}\x1b[0m`);
  }
}

// ---------------------------------------------------------------------------
// Throwing rather than setting process.exitCode: it exits non-zero all the same
// and avoids pulling @types/node into the project, which would put Node globals
// in scope for src/ and quietly weaken the purity boundary.
if (failures > 0) throw new Error(`${failures} gate failure(s)`);
console.log('\n\x1b[32mall gates pass\x1b[0m\n');
