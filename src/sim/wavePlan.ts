import { BALANCE } from '../content/balance.ts';
import { ENEMIES, type EnemyId } from '../content/enemies.ts';
import type { WaveDef } from '../content/types.ts';
import { DEFAULT_RULES, type Rules } from './rules.ts';
import type { MapRoute } from './types.ts';
import { randRange, streamFor, STREAM } from './util/rng.ts';

export interface PlannedSpawn {
  /** Seconds after the wave starts. */
  at: number;
  enemy: EnemyId;
  hp: number;
  bounty: number;
  shield: number;
  /** Which lane this one walks, as an index into `MapDef.routes`. */
  route: number;
}

/**
 * A contact's stats at a given wave.
 *
 * Split children go through this too, so a Mote from a wave-9 Cluster is worth
 * exactly what a wave-9 Mote is worth. Having one function rather than two
 * copies of the same arithmetic is what stops the spawner and the splitter
 * quietly disagreeing after a balance change.
 *
 * Shield scales with hp rather than on a dial of its own: a shield is a second
 * pool of effective health, and letting the two curves diverge would make
 * Wardens either irrelevant or unkillable at the ends of the arc.
 */
export function scaledStats(
  enemy: EnemyId,
  waveIndex: number,
  rules: Rules = DEFAULT_RULES,
): { hp: number; bounty: number; shield: number } {
  const base = ENEMIES[enemy];
  const hpScale = Math.pow(BALANCE.hpGrowth, waveIndex) * rules.hpFactor;
  return {
    hp: Math.round(base.hp * hpScale),
    bounty: Math.round(base.bounty * Math.pow(BALANCE.bountyGrowth, waveIndex) * rules.bountyFactor),
    shield: Math.round(base.shield * hpScale),
  };
}

/**
 * How many waves this run has, or `Infinity` if it never runs out.
 *
 * Returning `Infinity` is what makes the endless arc need no other change: the
 * wave machine's "park in done" test (`index + 1 >= waveCount`) and the victory
 * test (`clearedThrough >= waveCount - 1`) are both comparisons against this,
 * and neither can ever hold. A duel therefore has no won state at all — only a
 * lost one, which is exactly the rule the mode wants.
 */
export const waveCount = (rules: Rules = DEFAULT_RULES): number =>
  rules.endless ? Infinity : rules.waves.length;

/**
 * The complete content of one wave, as a pure function of (seed, waveIndex).
 *
 * This signature is the single most load-bearing decision for Race mode. The
 * tempting alternative — draw from one long-lived PRNG as the game runs — is a
 * trap: one extra roll on one machine (a crit, a particle, a re-render) shifts
 * the whole stream, and every later wave silently diverges. Deriving a fresh
 * stream from (seed, WAVE, waveIndex) makes wave 23 byte-identical no matter
 * what happened in waves 1-22.
 *
 * It also means the N2 fairness gate is trivial: call this for 20 waves on two
 * machines, JSON.stringify, diff.
 */
export function planWave(
  seed: number,
  waveIndex: number,
  rules: Rules = DEFAULT_RULES,
  routes: readonly MapRoute[] = SINGLE_ROUTE,
): PlannedSpawn[] {
  const def = defFor(rules, waveIndex);
  if (def === undefined) return [];

  // The *true* index, never the wrapped one. This is the whole of the endless
  // arc: composition repeats, difficulty does not. Wrapping the stream too
  // would make wave 25 a byte-identical replay of wave 13 — same jitter, same
  // lane deal — and the board would visibly loop.
  const rng = streamFor(seed, STREAM.WAVE, waveIndex);

  const plan: PlannedSpawn[] = [];
  for (const group of def.groups) {
    const enemy = group.enemy as EnemyId;
    const stats = scaledStats(enemy, waveIndex, rules);
    const jitter = group.every * BALANCE.spawnJitter;
    const lane = laneDealer(group.route, routes, waveIndex);

    for (let i = 0; i < group.count; i++) {
      plan.push({
        // Clamped at 0 so jitter can't pull the first spawn of a group before
        // the group is meant to begin.
        at: Math.max(0, group.after + i * group.every + randRange(rng, -jitter, jitter)),
        enemy,
        ...stats,
        // Dealt by position *within the group*, before the sort below. Sort is
        // stable, so jitter reordering neighbours cannot reshuffle lanes.
        route: lane(i),
      });
    }
  }

  // Groups may overlap in time, and jitter can reorder neighbours. The spawner
  // walks this list in order, so sorting is what makes it correct rather than
  // merely tidy.
  plan.sort((a, b) => a.at - b.at);
  return plan;
}

/**
 * The composition table entry for a wave index.
 *
 * Past the end of a finite table this is `undefined` and the wave is empty,
 * which is the old behaviour and the reason the campaign is untouched. An
 * endless arc wraps instead — the table becomes a cycle of shapes rather than a
 * list, and `scaledStats` on the true index is what stops that cycle from being
 * a difficulty plateau.
 */
function defFor(rules: Rules, waveIndex: number): WaveDef | undefined {
  if (!rules.endless) return rules.waves[waveIndex];
  const n = rules.waves.length;
  if (n === 0) return undefined;
  return rules.waves[waveIndex % n];
}

/**
 * What lane the i-th contact of a group walks.
 *
 * `'split'` deals round-robin in index order, and that is the whole rule —
 * no RNG stream is drawn, so there is nothing here that can drift between two
 * clients replaying the same seed. It also means 12 across two lanes is always
 * 6 and 6 rather than *approximately* half each, which is what lets a designer
 * reason about a wave table instead of measuring it.
 *
 * A named lane that the map does not have is a throw, not a fallback to 0. A
 * wave table naming 'rim' on a board whose lanes are 'over' and 'under' is an
 * authoring mistake, and silently walking everything up the first lane would
 * hide it behind a board that merely plays oddly.
 */
function laneDealer(
  route: string | undefined,
  routes: readonly MapRoute[],
  waveIndex: number,
): (i: number) => number {
  if (route === undefined) return () => 0;
  if (route === 'split') {
    const n = routes.length;
    return (i) => i % n;
  }

  const idx = routes.findIndex((r) => r.id === route);
  if (idx < 0) {
    const known = routes.map((r) => r.id).join(', ');
    throw new Error(`wave ${waveIndex + 1} names route "${route}", which this map does not have (${known})`);
  }
  return () => idx;
}

/**
 * The default lane list: one unnamed lane.
 *
 * Not a guess. Every group on a one-route board resolves to index 0 whatever
 * it says, so this is the correct answer for the callers that pass no map —
 * the wave-determinism gates, which are measuring composition and timing and
 * have no board in hand at all.
 */
const SINGLE_ROUTE: readonly MapRoute[] = [{ id: 'main', waypoints: [], length: 0 }];
