/**
 * What a run is playing: which arc, and how hard.
 *
 * The sim used to reach straight for the `WAVES` table and `BALANCE`'s starting
 * figures, which is fine while there is exactly one of each. A campaign makes
 * both a per-run choice, and this is the object that carries that choice from
 * the menu down to the spawner without any system in between needing to know a
 * campaign exists.
 *
 * Every function that takes a `Rules` defaults it to `DEFAULT_RULES`, and
 * `DEFAULT_RULES` is byte-for-byte the game as it was before the campaign: the
 * Switchback arc at the swept baseline. That default is why `tools/check.ts`
 * and `tools/sweep.ts` did not have to change, and why Race mode is still the
 * same game — Race passes nothing, so it gets the baseline, so the N2 fairness
 * gate keeps meaning what it meant.
 */

import { BALANCE } from '../content/balance.ts';
import { WAVES } from '../content/waves.ts';
import { BANK_FLOOR, DIFFICULTIES, DEFAULT_DIFFICULTY, type DifficultyId } from '../content/difficulty.ts';
import type { LevelDef } from '../content/levels.ts';
import type { WaveDef } from '../content/types.ts';

export interface Rules {
  readonly levelId: string;
  readonly difficultyId: DifficultyId;
  readonly waves: readonly WaveDef[];
  readonly startingLives: number;
  readonly startingMoney: number;
  /**
   * Applied to *scaled* hp and shield, after the seeded roll. Difficulty must
   * never touch composition or spawn timing — if it did, two players on the
   * same seed at different tiers would face different arrival patterns, and the
   * one property this game's determinism story rests on would be gone.
   */
  readonly hpFactor: number;
  readonly bountyFactor: number;
}

/**
 * The baseline. Lives and money are **getters**, not captured values.
 *
 * `tools/sweep.ts` patches `BALANCE` in place between runs and relies on every
 * consumer reading it at call time — that is the documented trick that lets it
 * drive the real simulation rather than a copy. Snapshotting these two numbers
 * at module load would silently opt the default ruleset out of that, so a sweep
 * over starting money would report no effect. One stable object, values read
 * late: the sweep keeps working and nothing allocates per call.
 */
export const DEFAULT_RULES: Rules = {
  levelId: 'level01',
  difficultyId: DEFAULT_DIFFICULTY,
  waves: WAVES,
  get startingLives() {
    return BALANCE.startingLives;
  },
  get startingMoney() {
    return BALANCE.startingMoney;
  },
  hpFactor: 1,
  bountyFactor: 1,
};

/**
 * Bind a campaign level and a difficulty tier into one run's rules.
 *
 * `bank` is money carried out of the previous sector, and it **replaces** the
 * tier's starting money rather than adding to it. That is the whole point: if
 * carried cash were a bonus on top, banking would be free and the decision it
 * is meant to create — spend now or keep it for the next sector — would not
 * exist. Replacing makes leftover cash genuinely yours and genuinely at risk.
 *
 * A sector entered poor is therefore possible and is meant to be, but it is
 * floored at `BANK_FLOOR` of the tier's own starting money. Unfloored, the rule
 * had a dead end rather than a hard mode: a normal run finished Switchback on
 * $44–$101 against a cheapest station of $75, so the next sector opened with no
 * towers, no way to buy one, and therefore no bounty ever. The floor sits below
 * every tier's normal start, so arriving poor still costs you — it just cannot
 * cost you the ability to play.
 *
 * Beyond that the bank is uncapped, so hoarding really does compound. That is a
 * deliberate choice rather than an oversight: the run is the player's to make
 * lopsided if they want to.
 */
export function resolveRules(level: LevelDef, difficulty: DifficultyId, bank?: number): Rules {
  const d = DIFFICULTIES[difficulty];
  return {
    levelId: level.id,
    difficultyId: d.id as DifficultyId,
    waves: level.waves,
    startingLives: d.startingLives,
    startingMoney:
      bank === undefined ? d.startingMoney : Math.max(bank, Math.round(d.startingMoney * BANK_FLOOR)),
    hpFactor: d.hpFactor,
    bountyFactor: d.bountyFactor,
  };
}
