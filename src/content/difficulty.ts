/**
 * Difficulty tiers.
 *
 * Deliberately a separate file from `balance.ts`, and deliberately expressed as
 * *factors* rather than absolute numbers. `balance.ts` holds the swept baseline
 * — `hpGrowth` in particular is a measured value with a table of evidence
 * behind it — and a difficulty tier must not be able to quietly relitigate it.
 * Multiplying the result keeps one source of truth for the arc and makes each
 * tier a single readable statement about how far it moves.
 *
 * `standard` is exactly the swept baseline: every factor is 1 and the lives and
 * money come straight from BALANCE. That identity is load-bearing — it is what
 * makes `tools/sweep.ts` still describe the game people actually play, and it
 * is what Race mode runs, so the two modes stay the same game.
 *
 * The factors apply to *scaled* stats, after the seeded roll. Spawn timing and
 * composition are untouched, so difficulty never perturbs the RNG stream and a
 * given seed produces the same arrival pattern at every tier.
 */

import { BALANCE } from './balance.ts';

export interface DifficultyDef {
  readonly id: string;
  readonly name: string;
  /** One line, shown under the name on the difficulty picker. */
  readonly blurb: string;

  readonly startingLives: number;
  readonly startingMoney: number;
  /** Multiplies contact hp and shield. Bounty is separate so easy isn't rich. */
  readonly hpFactor: number;
  readonly bountyFactor: number;
}

export const DIFFICULTIES = {
  recon: {
    id: 'recon',
    name: 'Recon',
    blurb: 'Softer contacts and a deeper reserve. The arc is the same shape — you just get to make more mistakes inside it.',
    startingLives: 30,
    startingMoney: 320,
    hpFactor: 0.8,
    // Slightly richer than standard, but less than the hp cut gives back, so
    // Recon is forgiving without turning into a different economy.
    bountyFactor: 1.1,
  },

  standard: {
    id: 'standard',
    name: 'Standard',
    blurb: 'The tuned arc, exactly as swept. Mixing stations beats building one, and nothing is unwinnable.',
    startingLives: BALANCE.startingLives,
    startingMoney: BALANCE.startingMoney,
    hpFactor: 1,
    bountyFactor: 1,
  },

  blackout: {
    id: 'blackout',
    name: 'Blackout',
    blurb: 'A thin reserve and tougher contacts. Assumes you already know which station answers what.',
    startingLives: 14,
    /**
     * Baseline money, deliberately. Cutting the *opening* budget was the first
     * thing tried and it is the wrong dial by a wide margin: it compounds. A
     * short first tower means an early leak, an early leak means less bounty,
     * and the run is unrecoverable by wave three — `tools/campaign.ts` had this
     * tier at 0/5 on every level, dying on Cascade's *first* wave.
     *
     * The thin reserve is the tier's identity and it is enough. Blackout should
     * punish mistakes, not remove the means of avoiding them.
     */
    startingMoney: BALANCE.startingMoney,
    hpFactor: 1.1,
    bountyFactor: 0.95,
  },
} as const satisfies Record<string, DifficultyDef>;

export type DifficultyId = keyof typeof DIFFICULTIES;

/** Menu order, easiest first. Explicit because object key order is a trap. */
export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['recon', 'standard', 'blackout'];

export const DEFAULT_DIFFICULTY: DifficultyId = 'standard';
