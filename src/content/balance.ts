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
} as const;
