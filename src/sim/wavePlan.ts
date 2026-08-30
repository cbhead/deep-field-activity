import { BALANCE } from '../content/balance.ts';
import { ENEMIES, type EnemyId } from '../content/enemies.ts';
import { WAVES } from '../content/waves.ts';
import { randRange, streamFor, STREAM } from './util/rng.ts';

export interface PlannedSpawn {
  /** Seconds after the wave starts. */
  at: number;
  enemy: EnemyId;
  hp: number;
  bounty: number;
  shield: number;
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
): { hp: number; bounty: number; shield: number } {
  const base = ENEMIES[enemy];
  const hpScale = Math.pow(BALANCE.hpGrowth, waveIndex);
  return {
    hp: Math.round(base.hp * hpScale),
    bounty: Math.round(base.bounty * Math.pow(BALANCE.bountyGrowth, waveIndex)),
    shield: Math.round(base.shield * hpScale),
  };
}

export const waveCount = (): number => WAVES.length;

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
export function planWave(seed: number, waveIndex: number): PlannedSpawn[] {
  const def = WAVES[waveIndex];
  if (def === undefined) return [];

  const rng = streamFor(seed, STREAM.WAVE, waveIndex);

  const plan: PlannedSpawn[] = [];
  for (const group of def.groups) {
    const enemy = group.enemy as EnemyId;
    const stats = scaledStats(enemy, waveIndex);
    const jitter = group.every * BALANCE.spawnJitter;

    for (let i = 0; i < group.count; i++) {
      plan.push({
        // Clamped at 0 so jitter can't pull the first spawn of a group before
        // the group is meant to begin.
        at: Math.max(0, group.after + i * group.every + randRange(rng, -jitter, jitter)),
        enemy,
        ...stats,
      });
    }
  }

  // Groups may overlap in time, and jitter can reorder neighbours. The spawner
  // walks this list in order, so sorting is what makes it correct rather than
  // merely tidy.
  plan.sort((a, b) => a.at - b.at);
  return plan;
}
