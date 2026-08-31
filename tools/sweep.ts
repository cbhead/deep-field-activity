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
import { CAMPAIGN } from '../src/content/levels.ts';
import { BALANCE } from '../src/content/balance.ts';
import { TOWERS, type TowerId } from '../src/content/towers.ts';
import { ENEMIES, type EnemyId } from '../src/content/enemies.ts';
import { parseMap } from '../src/sim/util/grid.ts';
import type { MapDef } from '../src/sim/types.ts';
import { DEFAULT_RULES, resolveRules, type Rules } from '../src/sim/rules.ts';
import type { DifficultyId } from '../src/content/difficulty.ts';
import { createWorld } from '../src/sim/world.ts';
import { stepWorld } from '../src/sim/step.ts';
import { waveCount } from '../src/sim/wavePlan.ts';

const map = parseMap(LEVEL01);

/**
 * Two tile rankings, because on a multi-lane board they disagree and the
 * disagreement is the finding — see the same pair in `tools/campaign.ts`.
 *
 * `cluster` scores every tile against the whole road and sorts, which packs the
 * busiest stretch. `spread` is a greedy set cover: each pick reaches the most
 * road *nothing has covered yet*. On one lane `cluster` wins comfortably; on
 * lanes of unequal length it piles everything onto the long one, because a tile
 * beside a 50-tile coil always outscores a tile beside a 20-tile chute.
 */
type Ranking = 'cluster' | 'spread';

const spotCache = new Map<string, [number, number][]>();

function rankedSpots(board: MapDef, range: number, how: Ranking = 'cluster'): [number, number][] {
  const key = `${board.id}:${Math.round(range * 10)}:${how}`;
  const hit = spotCache.get(key);
  if (hit !== undefined) return hit;

  const road: number[] = [];
  for (let i = 0; i < board.tiles.length; i++) if (board.tiles[i] === 'path') road.push(i);

  const ground: { col: number; row: number; reach: number[] }[] = [];
  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) {
      if (board.tiles[row * board.cols + col] !== 'ground') continue;
      const reach = road.filter((i) => {
        const dx = (i % board.cols) - col;
        const dy = ((i / board.cols) | 0) - row;
        return dx * dx + dy * dy <= range * range;
      });
      ground.push({ col, row, reach });
    }
  }

  let out: [number, number][];
  if (how === 'cluster') {
    out = ground
      .slice()
      .sort((a, b) => b.reach.length - a.reach.length || a.col - b.col || a.row - b.row)
      .map((s) => [s.col, s.row] as [number, number]);
  } else {
    out = [];
    const covered = new Set<number>();
    const taken = new Set<number>();
    for (;;) {
      let best = -1;
      let bestGain = -1;
      for (let i = 0; i < ground.length; i++) {
        if (taken.has(i)) continue;
        let gain = 0;
        for (const t of ground[i]!.reach) if (!covered.has(t)) gain++;
        if (gain > bestGain) {
          best = i;
          bestGain = gain;
        }
      }
      if (best < 0 || bestGain <= 0) break;
      taken.add(best);
      out.push([ground[best]!.col, ground[best]!.row]);
      for (const t of ground[best]!.reach) covered.add(t);
    }
    // Once the road is covered, doubling up on the busiest stretch is what a
    // player with money left over would do.
    for (const s of ground
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => !taken.has(i))
      .sort((a, b) => b.s.reach.length - a.s.reach.length || a.s.col - b.s.col || a.s.row - b.s.row)) {
      out.push([s.s.col, s.s.row]);
    }
  }

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
function run(
  build: TowerId[],
  rush: boolean,
  seed: number,
  board: MapDef = map,
  rules: Rules = DEFAULT_RULES,
  how: Ranking = 'cluster',
): Result {
  // Ranked by the widest reach in the build, so every strategy shares one
  // notion of a good tile and none is flattered by its own ordering.
  const spots = rankedSpots(board, Math.max(...build.map((b) => TOWERS[b].range)), how);
  const w = createWorld(board, seed, rules);
  let next = 0;

  for (let i = 0; i < 300_000 && w.phase === 'playing'; i++) {
    const want = build[next % build.length]!;
    // Locked stations are skipped rather than attempted. Advancing `next` on a
    // command the sim will reject burns one of the ranked tiles and leaves the
    // build measuring less coverage than it was asked to.
    if (
      next < spots.length &&
      w.money >= TOWERS[want].cost &&
      w.wave.index >= TOWERS[want].unlockWave
    ) {
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

/**
 * What each of the five stations is worth, board by board.
 *
 * The map spec's §4 made five predictions about what routes do to the roster,
 * and said plainly that none of it needs a number changed — that the geometry
 * does the work on its own. This is the block that checks that, because the
 * claim is falsifiable and was never tested:
 *
 *   Lance (pierce)      down, sharply — pierce pays by file length and a split
 *                       halves every file. Braid should be its floor.
 *   Nova (splash)       roughly flat — a lane still clumps, there are just two.
 *   Arc (chain)         up — chain needs proximity, not alignment, and it is
 *                       the only thing that reads a merge well.
 *   Singularity (slow)  down as a force multiplier — it no longer manufactures
 *                       the file Lance wants.
 *   Filament (ramp)     up on Delta, down elsewhere — a ramp wants one target
 *                       held, and only Delta's trunk gives that.
 *
 * Method is the same as the three-station block above: drop one station from
 * the full build and read the lives delta. Dropping one slot from a 1:1:1:1:1
 * cycle leaves the survivors in the proportion they had, so the delta is the
 * station's contribution rather than an artefact of a changed build order.
 *
 * **Difficulty is chosen per board, and that is the measurement, not a
 * convenience.** A lives delta only has resolution in a band. Below it the base
 * build already finishes on zero, the drop finishes on zero too, and every
 * station reads `+0.0`; above it the base finishes untouched on full lives and
 * every station reads `+0.0` again. Both look like data and neither is: the
 * first says the instrument is on its floor, the second that it is on its
 * ceiling.
 *
 * Run at Standard, the five new boards floor. Run at Recon, the first four
 * saturate at 30/30. There is no single tier that puts all eight inside the
 * band — so each board is measured at the hardest tier its reference build
 * still clears while actually losing something, and the tier is printed in the
 * row. A row that could not find one is marked, because "no tier works" is a
 * fact about the board worth seeing rather than a gap to fill with zeroes.
 *
 * The ranking is chosen per board by running the full build both ways and
 * keeping the better — a player is allowed to pick the right strategy, and on
 * these boards picking it is most of the game.
 */
const FIVE: TowerId[] = ['nova', 'lance', 'singularity', 'arc', 'filament'];

function boardMarginal(): void {
  console.log(`\n\x1b[1mmarginal contribution across eight boards\x1b[0m`);
  console.log(`  \x1b[2mlives each station adds to a build that already has the other four\x1b[0m`);
  console.log(
    `  \x1b[2mmeasured at the hardest tier whose reference build still wins and still bleeds —` +
      ` on the floor or the ceiling every column reads zero\x1b[0m`,
  );
  console.log(
    `  \x1b[2m${'board'.padEnd(11)}${'tier'.padEnd(10)}${'build'.padEnd(8)}` +
      FIVE.map((t) => t.slice(0, 5).padStart(7)).join('') +
      `\x1b[0m`,
  );

  for (const level of CAMPAIGN) {
    const board = parseMap(level.map);
    const lanes = board.routes.length;

    const score = (build: TowerId[], rules: Rules, how: Ranking) => {
      const rs = SEEDS.map((s) => run(build, false, s, board, rules, how));
      return {
        wins: rs.filter((r) => r.won).length,
        lives: rs.reduce((a, r) => a + r.lives, 0) / rs.length,
        cleared: rs.reduce((a, r) => a + r.cleared, 0) / rs.length,
      };
    };

    // Hardest first. The band is "wins most seeds" and "does not finish
    // untouched" — the second half is what rejects Recon on the older boards,
    // where the reference build never loses a life and the drops cannot either.
    type Probe = { tier: DifficultyId; rules: Rules; how: Ranking; base: ReturnType<typeof score> };
    let picked: Probe | null = null;
    let fallback: Probe | null = null;

    for (const tier of ['blackout', 'standard', 'recon'] as const) {
      const rules = resolveRules(level, tier);
      const cl = score(FIVE, rules, 'cluster');
      const sp = score(FIVE, rules, 'spread');
      const how: Ranking = sp.wins > cl.wins || (sp.wins === cl.wins && sp.lives > cl.lives) ? 'spread' : 'cluster';
      const base = how === 'spread' ? sp : cl;
      const here = { tier, rules, how, base };

      if (fallback === null || base.wins > fallback.base.wins) fallback = here;
      if (base.wins >= 3 && base.lives < rules.startingLives) {
        picked = here;
        break;
      }
    }

    const chosen = picked ?? fallback!;
    const { rules, how, base } = chosen;
    const worth = FIVE.map((drop) => base.lives - score(FIVE.filter((t) => t !== drop), rules, how).lives);

    const note =
      picked === null
        ? base.lives >= rules.startingLives
          ? 'never bled — ceiling'
          : 'never cleared — floor'
        : `${lanes} lane${lanes > 1 ? 's' : ''}`;

    console.log(
      `  ${level.name.padEnd(11)}${chosen.tier.padEnd(10)}${how.padEnd(8)}` +
        worth.map((d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}`.padStart(7)).join('') +
        `   \x1b[2m${note} · base ${base.wins}/${SEEDS.length} won,` +
        ` ${base.cleared.toFixed(1)}/${waveCount(rules)} waves, ${base.lives.toFixed(1)}/${rules.startingLives} lives\x1b[0m`,
    );
  }
}

sweep('as shipped', () => {});
marginal();
boardMarginal();

export { sweep, run, apply, marginal, boardMarginal };
export type { Candidate };
