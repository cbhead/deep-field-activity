/**
 * Campaign arc probe. `npm run campaign`.
 *
 * The same greedy auto-builder the balance probe uses, pointed at every
 * (level × difficulty) pair instead of just Switchback at standard. It answers
 * one question the single-level sweep cannot: **is each new board winnable, and
 * does the campaign actually get harder in the order it claims to?**
 *
 * Read it as a shape, not as scores. What should be true:
 *
 * - Standard is winnable on every level with a mixed build, with fewer lives
 *   kept as the campaign goes on.
 * - Recon is comfortable everywhere — it is the tier for learning a board.
 * - Blackout is a real threat on level 3 and survivable on level 1.
 *
 * A level nobody can clear on Standard is a content bug; a level cleared at
 * full lives on Blackout is a level that is not pulling its weight.
 *
 * Deliberately not a gate, for the same reason `tools/sweep.ts` is not: this
 * reports numbers a human has to judge. The one thing it *does* assert is that
 * every campaign map parses, because a malformed board is unambiguously wrong.
 */
import { CAMPAIGN } from '../src/content/levels.ts';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../src/content/difficulty.ts';
import { TOWERS, type TowerId } from '../src/content/towers.ts';
import { parseMap } from '../src/sim/util/grid.ts';
import type { MapDef } from '../src/sim/types.ts';
import { buildOrder, type Ranking } from './buildOrder.ts';
import { createWorld } from '../src/sim/world.ts';
import { resolveRules } from '../src/sim/rules.ts';
import { stepWorld } from '../src/sim/step.ts';
import { waveCount } from '../src/sim/wavePlan.ts';

const BUILD: TowerId[] = ['nova', 'lance', 'singularity', 'arc', 'filament'];
const SEEDS = [4242, 7, 999, 31337, 12345];

interface Result {
  won: boolean;
  cleared: number;
  lives: number;
  /** Cash on the board when the run settled — the bank carried to the next sector. */
  money: number;
}

/**
 * `stopBuyingAfter` models the one behaviour the carry rule is meant to create:
 * a player who stops spending near the end of a sector so they arrive at the
 * next one solvent. The default greedy builder never does this — it buys
 * whenever it can afford to — which makes it the worst possible reader of a
 * rule about saving.
 */
function run(
  map: MapDef,
  rules: ReturnType<typeof resolveRules>,
  seed: number,
  stopBuyingAfter = Infinity,
  strategy: Ranking = 'cluster',
): Result {
  const reach = Math.max(...BUILD.map((b) => TOWERS[b].range));
  const spots = buildOrder(map, reach, strategy);
  const w = createWorld(map, seed, rules);
  let next = 0;

  for (let i = 0; i < 600_000 && w.phase === 'playing'; i++) {
    const want = BUILD[next % BUILD.length]!;
    // Locked stations are skipped rather than attempted — advancing `next` on a
    // rejected command would burn one of the ranked tiles and quietly leave the
    // build short of the coverage it was supposed to be measuring.
    if (
      next < spots.length &&
      w.money >= TOWERS[want].cost &&
      w.wave.index >= TOWERS[want].unlockWave &&
      w.wave.clearedThrough + 1 < stopBuyingAfter
    ) {
      w.commands.push({ type: 'placeTower', defId: want, col: spots[next]![0], row: spots[next]![1] });
      next++;
    }
    stepWorld(w, 1 / 60);
    w.events.length = 0;
  }

  return {
    won: w.phase === 'won',
    cleared: w.wave.clearedThrough + 1,
    lives: w.lives,
    money: Math.floor(w.money),
  };
}

console.log('\n\x1b[1mcampaign arc\x1b[0m');
console.log('  \x1b[2mgreedy mixed build (all five stations) · real starting money · 5 seeds · no rushing\x1b[0m');
console.log(
  '  \x1b[2mtwo build strategies: "cluster" packs the busiest stretch, "spread" shuts the widest gap\x1b[0m',
);

for (const level of CAMPAIGN) {
  // Parsing is the assertion: parseMap throws on a malformed board, and a
  // campaign that ships an unwalkable map is broken in a way no score shows.
  const map = parseMap(level.map);
  console.log(
    `\n  \x1b[1m${level.name}\x1b[0m \x1b[2m${map.cols}x${map.rows}, ` +
      `${map.routes.map((r) => `${r.id} ${r.length}t`).join(' / ')}, ${level.waves.length} waves\x1b[0m`,
  );

  for (const id of DIFFICULTY_ORDER) {
    const rules = resolveRules(level, id);
    const both = (['cluster', 'spread'] as const).map((strategy) => {
      const rs = SEEDS.map((s) => run(map, rules, s, Infinity, strategy));
      return {
        strategy,
        wins: rs.filter((r) => r.won).length,
        lives: rs.reduce((a, r) => a + r.lives, 0) / rs.length,
        cleared: rs.reduce((a, r) => a + r.cleared, 0) / rs.length,
      };
    });
    // The board's difficulty is the *better* strategy, not the average of the
    // two — a player is allowed to pick the right one, and on a multi-lane
    // board picking it is most of the game.
    // Wins, then lives, then waves. The third key matters more than it looks:
    // when both strategies lose every seed the first two tie at zero, and
    // without it the report names whichever was tried first — on Sluice that
    // meant printing `cluster` reaching wave 8.8 while `spread`, the strategy
    // the board is built for, was reaching wave 11.
    const better = (x: { wins: number; lives: number; cleared: number }, y: typeof x): boolean =>
      x.wins !== y.wins ? x.wins > y.wins : x.lives !== y.lives ? x.lives > y.lives : x.cleared > y.cleared;
    const best = both.reduce((a, b) => (better(b, a) ? b : a));
    const { wins, lives, cleared } = best;

    console.log(
      `    ${DIFFICULTIES[id].name.padEnd(10)}` +
        ` won ${wins}/${SEEDS.length}` +
        `  waves ${cleared.toFixed(1).padStart(4)}/${waveCount(rules)}` +
        `  lives ${lives.toFixed(1).padStart(5)}/${rules.startingLives}` +
        `  \x1b[2m${best.strategy}${both[0]!.wins === both[1]!.wins ? '' : ` beats ${both[0] === best ? 'spread' : 'cluster'}`}\x1b[0m`,
    );
  }
}

/**
 * The campaign as one continuous run, with cash carried between sectors.
 *
 * This is the harshest possible reading of the carry rule, and deliberately so:
 * the greedy builder buys whenever it can afford to, so it arrives at every
 * hand-off with close to nothing. A human who knows the bank exists will hold
 * some back — that is the decision the rule is for — so treat these numbers as
 * the floor, not the expectation.
 *
 * What matters here is whether a spend-everything player is *stranded*. Being
 * poorer is the intended cost; being unable to clear the next sector at all
 * would mean the rule needs a floor after all.
 */
const STOP_BUYING_AFTER = Number(process.env['STOP_AFTER'] ?? Infinity);

console.log('\n\x1b[1mcontinuous run — cash carried between sectors\x1b[0m');
console.log(
  `  \x1b[2mstops buying after wave ${STOP_BUYING_AFTER === Infinity ? '\u221e (never — spends to zero)' : STOP_BUYING_AFTER}\x1b[0m`,
);
console.log('  \x1b[2mgreedy builder spends to zero, so this is the worst case for banking\x1b[0m');

for (const id of DIFFICULTY_ORDER) {
  const parts: string[] = [];
  let broke = false;

  for (const seed of SEEDS.slice(0, 3)) {
    let bank: number | undefined;
    const legs: string[] = [];
    for (const level of CAMPAIGN) {
      const rules = resolveRules(level, id, bank);
      const r = run(parseMap(level.map), rules, seed, STOP_BUYING_AFTER);
      legs.push(`${r.won ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'}${String(r.cleared).padStart(2)}w $${r.money}`);
      if (!r.won) { broke = true; break; }
      bank = r.money;
    }
    parts.push(legs.join('  →  '));
  }

  console.log(`  \x1b[1m${DIFFICULTIES[id].name}\x1b[0m${broke ? ' \x1b[31m(run broke)\x1b[0m' : ''}`);
  for (const line of parts) console.log(`    ${line}`);
}

console.log('');
