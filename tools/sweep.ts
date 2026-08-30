/**
 * Balance sweep. `npm run sweep`.
 *
 * Runs whole matches headlessly under different numbers and reports how each
 * strategy fared. It exists because balance is the part of this game that is
 * actually hard, and eyeballing a table of stats does not answer it.
 *
 * **Read the marginal block, not the mono-build rows.** "Can a defence built
 * entirely around one station win?" was the original question and it is the
 * wrong one: it is only answerable by a station that kills things, so asking it
 * of a slow guarantees a false failure. Singularity wins 0/5 alone and is worth
 * more to a real build than either of the others — tuning it until it wins alone
 * means handing it damage, which collapses three stations back into three ways
 * to do the same thing. The mono rows are still printed, but as a check for a
 * *dominant* station; a weak one there means nothing on its own.
 *
 * It mutates BALANCE / TOWERS / ENEMIES between runs. `as const` is compile-time
 * only and every consumer reads these objects at call time, so this drives the
 * real simulation with different values rather than a copy of it.
 *
 * Deliberately not a gate. `tools/check.ts` asserts things that must be true;
 * this reports things a human has to judge.
 */
import { LEVEL01 } from '../src/content/maps/level01.ts';
import { BALANCE } from '../src/content/balance.ts';
import { TOWERS, type TowerId } from '../src/content/towers.ts';
import { ENEMIES, type EnemyId } from '../src/content/enemies.ts';
import { parseMap } from '../src/sim/util/grid.ts';
import { createWorld } from '../src/sim/world.ts';
import { stepWorld } from '../src/sim/step.ts';
import { waveCount } from '../src/sim/wavePlan.ts';

const map = parseMap(LEVEL01);

/** Same heuristic as the probe in check.ts: a competent player's tile ranking. */
const spotCache = new Map<number, [number, number][]>();
function rankedSpots(range: number): [number, number][] {
  const key = Math.round(range * 10);
  const hit = spotCache.get(key);
  if (hit !== undefined) return hit;

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
  const out = scored.map((s) => [s.col, s.row] as [number, number]);
  spotCache.set(key, out);
  return out;
}

interface Result {
  won: boolean;
  cleared: number;
  lives: number;
  towers: number;
}

/**
 * Play one match with a repeating build order, buying the next tile whenever it
 * becomes affordable. Starting money is the real one — handing the sweep an
 * unlimited budget measures tower damage and says nothing about whether bounty
 * income can fund a defence, which is usually the actual constraint.
 */
function run(build: TowerId[], rush: boolean, seed: number): Result {
  // Ranked by the widest reach in the build, so every strategy shares one
  // notion of a good tile and none is flattered by its own ordering.
  const spots = rankedSpots(Math.max(...build.map((b) => TOWERS[b].range)));
  const w = createWorld(map, seed);
  let next = 0;

  for (let i = 0; i < 300_000 && w.phase === 'playing'; i++) {
    const want = build[next % build.length]!;
    if (next < spots.length && w.money >= TOWERS[want].cost) {
      w.commands.push({ type: 'placeTower', defId: want, col: spots[next]![0], row: spots[next]![1] });
      next++;
    }
    if (rush) w.commands.push({ type: 'startWave' });
    stepWorld(w, 1 / 60);
    w.events.length = 0;
  }

  return {
    won: w.phase === 'won',
    cleared: w.wave.clearedThrough + 1,
    lives: w.lives,
    towers: w.towers.length,
  };
}

const STRATEGIES: [string, TowerId[]][] = [
  ['lance', ['lance']],
  ['nova', ['nova']],
  ['singularity', ['singularity']],
  ['nova+2lance', ['nova', 'lance', 'lance']],
  ['all three', ['nova', 'lance', 'singularity']],
];

const SEEDS = [4242, 7, 999, 31337, 12345];

function sweep(label: string, apply: () => void): void {
  apply();
  console.log(`\n\x1b[1m${label}\x1b[0m`);
  for (const rush of [false, true]) {
    for (const [name, build] of STRATEGIES) {
      const rs = SEEDS.map((s) => run(build, rush, s));
      const wins = rs.filter((r) => r.won).length;
      const lives = rs.reduce((a, r) => a + r.lives, 0) / rs.length;
      const cleared = rs.reduce((a, r) => a + r.cleared, 0) / rs.length;
      const towers = rs.reduce((a, r) => a + r.towers, 0) / rs.length;
      // A win on 3 lives and a win on 19 are different games; the lives column
      // is the one that says whether the arc has any tension in it.
      console.log(
        `  ${rush ? 'rush' : 'wait'} ${name.padEnd(12)}` +
          ` won ${wins}/${SEEDS.length}` +
          `  waves ${cleared.toFixed(1).padStart(4)}/${waveCount()}` +
          `  lives ${lives.toFixed(1).padStart(5)}/${BALANCE.startingLives}` +
          `  towers ${towers.toFixed(0).padStart(3)}`,
      );
    }
  }
}

/** Patch helpers. The casts are the point of this file — see the header. */
const patch = (o: object, values: Record<string, number>): void => {
  for (const [k, v] of Object.entries(values)) (o as Record<string, number>)[k] = v;
};
export const tower = (id: TowerId, values: Record<string, number>): void => patch(TOWERS[id], values);
export const enemy = (id: EnemyId, values: Record<string, number>): void => patch(ENEMIES[id], values);
export const balance = (values: Record<string, number>): void => patch(BALANCE, values);


/**
 * A candidate set of numbers.
 *
 * Absolute, not cumulative. An earlier pass chained deltas — each set applied
 * on top of the last — which made a promising row impossible to reproduce on
 * its own and quietly turned "B plus a tweak" into "A plus B plus a tweak".
 *
 * To tune: declare a Candidate, call `sweep('label', apply(c))`, run
 * `npm run sweep`, then delete the candidates once the winner is applied to
 * `content/`. They are scaffolding, not a record — the numbers in `content/`
 * are the record.
 */
interface Candidate {
  lance: { cost: number; damage: number };
  nova: { cost: number; splashRadius: number };
  singularity: { cost: number; damage: number; slowFactor: number; slowSeconds: number };
  hpGrowth: number;
  monolithHp: number;
}

const apply = (c: Candidate) => () => {
  tower('lance', { cost: c.lance.cost, damage: c.lance.damage, range: 2.8, fireInterval: 0.5 });
  tower('nova', {
    cost: c.nova.cost,
    splashRadius: c.nova.splashRadius,
    damage: 22,
    range: 2.5,
    fireInterval: 1.4,
  });
  tower('singularity', {
    cost: c.singularity.cost,
    damage: c.singularity.damage,
    slowFactor: c.singularity.slowFactor,
    slowSeconds: c.singularity.slowSeconds,
    range: 3.3,
    fireInterval: 0.28,
  });
  balance({ hpGrowth: c.hpGrowth });
  enemy('monolith', { hp: c.monolithHp });
};

/**
 * What each station is worth *to a build that already has the others*.
 *
 * This is the question S4 actually wants answered. Dropping one station from
 * the full build leaves the survivors in the proportion they had before — a
 * 1:1:1 cycle minus one slot is still 1:1 — so the delta is the station's
 * contribution and not an artefact of a changed build order.
 *
 * A station earning near zero here is the real "non-viable", and a station
 * whose absence barely registers is the real "decorative". Neither shows up in
 * the mono-build rows, which is why those rows kept saying Singularity was
 * broken while it was quietly carrying the strongest build in the game.
 *
 * `wait` only. Rushing is a separate axis and mixing it in here would fold two
 * questions into one number.
 */
const REFERENCE: TowerId[] = ['nova', 'lance', 'singularity'];

function marginal(): void {
  const score = (build: TowerId[]) => {
    const rs = SEEDS.map((s) => run(build, false, s));
    return {
      wins: rs.filter((r) => r.won).length,
      lives: rs.reduce((a, r) => a + r.lives, 0) / rs.length,
    };
  };

  console.log(`\n\x1b[1mmarginal contribution\x1b[0m`);
  console.log(`  \x1b[2mwhat each station adds to a build that already has the other two\x1b[0m`);

  const base = score(REFERENCE);
  console.log(
    `  all three${' '.repeat(11)}won ${base.wins}/${SEEDS.length}` +
      `  lives ${base.lives.toFixed(1).padStart(5)}/${BALANCE.startingLives}`,
  );

  for (const drop of REFERENCE) {
    const s = score(REFERENCE.filter((t) => t !== drop));
    const delta = base.lives - s.lives;
    console.log(
      `  without ${drop.padEnd(12)}` +
        ` won ${s.wins}/${SEEDS.length}` +
        `  lives ${s.lives.toFixed(1).padStart(5)}/${BALANCE.startingLives}` +
        `  \x1b[1m${drop} is worth ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}\x1b[0m`,
    );
  }
}

sweep('as shipped', () => {});
marginal();

export { sweep, run, apply, marginal };
export type { Candidate };
