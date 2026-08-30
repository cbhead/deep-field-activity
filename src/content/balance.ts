/**
 * Every balance-affecting number in the game.
 *
 * Hard rule: no balance-affecting numeric literal appears anywhere in `src/sim/`.
 * The sim is mechanism; this file is the design. That split is what makes the
 * headless balance harness (M9) able to sweep values without touching logic.
 */
export const BALANCE = {
  startingLives: 20,
  startingMoney: 250,

  /** Fraction of spend returned when a tower is sold. */
  sellRefund: 0.7,

  /** Seconds of build time before wave 1. */
  firstWaveDelay: 12,
  /** Seconds between a wave clearing and the next one starting. */
  intermission: 8,
  /** Paid on clearing a wave, on top of per-kill bounty. */
  waveClearReward: 20,

  /**
   * Per-wave multipliers, compounding: wave N enemies have
   * `base * growth ** N`. Computed rather than tabulated is the whole reason
   * content is TypeScript and not JSON — this is the dial difficulty is
   * actually tuned with, and it isn't expressible in a data file.
   */
  hpGrowth: 1.22,
  bountyGrowth: 1.08,

  /**
   * Spawn timing is jittered by ±this fraction of the group interval, drawn
   * from the seeded WAVE stream. Metronomic spawns look mechanical; jitter that
   * is *seeded* keeps both players in a Race facing the same arrival pattern.
   */
  spawnJitter: 0.18,
} as const;
