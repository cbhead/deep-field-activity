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
  const hpScale = Math.pow(BALANCE.hpGrowth, waveIndex);
  const bountyScale = Math.pow(BALANCE.bountyGrowth, waveIndex);

  const plan: PlannedSpawn[] = [];
  for (const group of def.groups) {
    const enemy = group.enemy as EnemyId;
    const base = ENEMIES[enemy];
    const jitter = group.every * BALANCE.spawnJitter;

    for (let i = 0; i < group.count; i++) {
      plan.push({
        // Clamped at 0 so jitter can't pull the first spawn of a group before
        // the group is meant to begin.
        at: Math.max(0, group.after + i * group.every + randRange(rng, -jitter, jitter)),
        enemy,
        hp: Math.round(base.hp * hpScale),
        bounty: Math.round(base.bounty * bountyScale),
      });
    }
  }

  // Groups may overlap in time, and jitter can reorder neighbours. The spawner
  // walks this list in order, so sorting is what makes it correct rather than
  // merely tidy.
  plan.sort((a, b) => a.at - b.at);
  return plan;
}
