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

  /** Fraction of spend returned when a tower is sold. Includes upgrade spend. */
  sellRefund: 0.7,

  upgrade: {
    /** Mk I → Mk III. The inspector draws one pip per tier. */
    maxTier: 3,
    /**
     * Cost to reach the next tier is `baseCost * costFactor * currentTier`, so
     * the second upgrade costs twice the first. Escalating rather than flat
     * because otherwise stacking tiers on one good tile always beats spreading
     * coverage, and coverage is the more interesting decision.
     */
    costFactor: 1.5,
    /**
     * Damage only. Range and fire rate stay put deliberately: an upgrade that
     * grew reach would silently redraw the coverage map, and the whole appeal
     * of upgrading a *specific* tower is that you already chose its position.
     */
    damageFactor: 1.5,
  },

  /**
   * Grade thresholds, best first. The first entry whose predicate holds wins.
   * Leaks are weighted above speed — holding the line is the game.
   */
  grade: {
    perfectSeconds: 240,
  },

  /** Seconds of build time before wave 1. */
  firstWaveDelay: 12,
  /**
   * Seconds between one wave finishing *spawning* and the next starting — not
   * between one wave clearing and the next. Waves overlap: stragglers from the
   * previous wave are still walking when the next arrives, which is both the
   * genre norm and what makes sending early a real decision.
   */
  intermission: 8,
  /** Paid when every creep of a wave is off the board, on top of per-kill bounty. */
  waveClearReward: 20,

  /**
   * Cash per second of intermission forfeited by sending a wave early.
   *
   * This is the risk/reward lever: rushing buys tempo and money but stacks the
   * next wave on top of one you have not finished killing. In Race mode it is
   * the main way to pull ahead, since ranking is waves cleared first.
   */
  rushBonusPerSecond: 4,

  /**
   * Per-wave multipliers, compounding: wave N enemies have
   * `base * growth ** N`. Computed rather than tabulated is the whole reason
   * content is TypeScript and not JSON — this is the dial difficulty is
   * actually tuned with, and it isn't expressible in a data file.
   */
  hpGrowth: 1.28,
  bountyGrowth: 1.14,

  /**
   * Spawn timing is jittered by ±this fraction of the group interval, drawn
   * from the seeded WAVE stream. Metronomic spawns look mechanical; jitter that
   * is *seeded* keeps both players in a Race facing the same arrival pattern.
   */
  spawnJitter: 0.18,
} as const;
