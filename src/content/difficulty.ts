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

    /**
     * 1.05, down from 1.1, and **bounty is baseline** — the same argument as
     * the starting-money note above, applied to the two dials that were left.
     *
     * A bounty cut is an opening-budget cut paid in instalments. It compounds
     * in exactly the way that one did, and it does it worst on the boards that
     * can least afford it: a multi-lane board needs a third and fourth station
     * before it covers its second road at all, and 5% off every kill is 5% off
     * the rate at which those arrive.
     *
     * The hp multiplier compounds too, and less obviously. It is not a linear
     * tax — it decides whether a contact dies inside the reach of a defence
     * that is already marginal, so a few percent flips a wave from "held" to
     * "leaked entirely". On the eight-board sweep that showed up as a cliff
     * rather than a slope: Braid cleared Standard with 13 of 20 lives and died
     * on wave 4 of Blackout, on the same table.
     *
     * What is left is the thin reserve, which the note above already calls the
     * tier's identity, plus enough of an hp bump to keep the blurb honest.
     * Seven of the eight boards clear it; Sluice, whose lanes run 2.5 : 1 and
     * whose whole subject is punishing incomplete coverage, is a coin flip —
     * which for the hardest board at the hardest tier is the intent.
     */
    hpFactor: 1.05,
    bountyFactor: 1,
  },
} as const satisfies Record<string, DifficultyDef>;

/**
 * Floor under a carried bank, as a fraction of the tier's own starting money.
 *
 * Cash carries between sectors and *replaces* the tier's starting money, which
 * is what makes banking a real decision. Without a floor that rule has a
 * degenerate end: `tools/campaign.ts` showed a normal spend-everything run
 * finishing Switchback on $44–$101, and the cheapest station costs $75. Below
 * that the player owns nothing, can buy nothing, and therefore earns no bounty
 * — a sector that cannot be played rather than one that is hard. Every
 * continuous run in the probe died there, on every difficulty, one of them with
 * thirty lives still in hand.
 *
 * **0.9, raised from 0.6, because the floor was itself an opening-budget cut.**
 * That is the dial the Blackout note above already records rejecting, and it
 * was being applied here to every sector after the first. A spend-everything
 * run always lands *on* the floor, so 0.6 meant arriving at sector 2 onwards
 * with $150 against boards tuned at $250 — and the compounding is the same
 * compounding: a thin opening leaks, a leak costs bounty, the sector is gone.
 *
 * It read as a content problem and was not one. Cascade clears Blackout 5/5 on
 * a fresh start and died on *wave 2* of the continuous run; Standard could not
 * finish the campaign at all, breaking at sector 4 on every seed. At 0.9 both
 * of those go away — Standard completes 5/5, and Blackout is limited by Sluice
 * being a coin flip rather than by the wallet.
 *
 * The mechanic is unchanged in the direction that matters. Banking is still
 * entirely the player's doing and still uncapped, so a careful run arrives at
 * the finale on three hundred dollars and a profligate one does not. What is
 * gone is the *punishment* for arriving empty, and that is the right thing to
 * lose: a floor exists to keep a sector playable, not to be the penalty. The
 * penalty for never banking is simply never getting the upside.
 *
 * Still below every tier's normal start, so arriving poor is not free.
 *
 * ---
 *
 * **How the floor came to be doing this job at all.** What follows was written
 * by a parallel session that reached this dial from the other end — the parse
 * bug — and is preserved because its measurements are the reason the value
 * above could be chosen on evidence rather than feel.
 *
 * The claim that the floor sits below every tier's normal start was the
 * load-bearing one, and it was silently false for a while. `main.ts` parsed an
 * absent `?bank` with `Number(params.get('bank'))`,
 * which is `0` — finite and non-negative, so it read as a real carried bank of
 * nothing and every *fresh* run opened on the floor instead of the tier's own
 * money. The floor became the opening budget for the home screen's Play button,
 * the sector picker, and any `?seed=` boot. Race mode and the headless probes
 * pass no bank and so were never affected, which is why nothing caught it: for
 * the whole of that period `tools/campaign.ts` was scoring a game no player
 * could reach.
 *
 * Same probe, same five seeds, `bank` undefined vs `0`:
 *
 *                          full start        on the floor
 *   Standard  Switchback   5/5, 17.4 lives   1/5,  1.2 lives
 *   Standard  Cascade      5/5, 12.0 waves   3/5,  8.8 waves
 *   Standard  Pincer       5/5, 12.0 waves   5/5, 12.0 waves
 *   Blackout  Cascade      5/5, 12.0 waves   0/5,  2.0 waves
 *   Blackout  Pincer       5/5, 12.0 waves   0/5,  6.0 waves
 *   Standard  continuous   2 of 3 seeds finish the arc   all 3 break on leg one
 *
 * The greedy builder only spreads — it never upgrades and never holds cash back
 * — so read the absolute numbers as a floor rather than a forecast. The *gap*
 * is the point, and it is the same gap the Blackout note above already rejects
 * on its own evidence: cutting the opening budget compounds, and it took that
 * tier to 0/5 on every sector, dying on Cascade in the first two waves. The bug
 * was re-applying, to all three tiers at once, the one dial this file documents
 * as the wrong one. Fixing the parse restores the intent this comment always
 * claimed: the floor catches a poor arrival, it does not set the opening.
 *
 * ---
 *
 * **Re-swept once it was only a floor** — `npm run bankfloor`, 16 seeds. 0.6
 * was chosen while it was also the opening budget of every fresh run, so it was
 * picked for being a playable *start*. That is not the question it answers now,
 * and on the question it does answer it is not a good number.
 *
 * A floor fails in two directions. Too low strands: below the cheapest station
 * the sector cannot be played. Too high is a subsidy: if arriving broke hands
 * you a normal opening anyway, spending to zero costs nothing and the carry
 * stops being a decision. Each tier's usable band sits between them:
 *
 *                 Recon ($320)          Standard ($250)
 *   0.45          alive, -3.5 lives     strands
 *   0.55          alive, -2.7 lives     strands
 *   0.60  <--     DEAD, -0.1 lives      STRANDS, 38/48 sectors
 *   0.70          dead,  -0.0 lives     alive, -5.9 lives
 *   0.75          dead,  -0.0 lives     alive, -4.0 lives
 *
 * Recon's band is 0.40–0.55 and Standard's is 0.65–0.80. They do not overlap,
 * and 0.6 is in neither — it is simultaneously too high for Recon, where
 * arriving broke costs a tenth of a life and banking is therefore decorative,
 * and too low for Standard, where a spend-everything run still loses a fifth of
 * its sectors outright.
 *
 * The bands are disjoint because a *fraction* ties the safety net to the tier's
 * generosity, and generosity runs opposite to need: Recon starts richest at
 * $320 and needs the least help, because its contacts are softer and its bounty
 * richer. So the fraction hands the most to the tier that wants the least. In
 * absolute dollars the bands do overlap — Recon $128–$176, Standard $163–$200 —
 * and a flat $170 sits inside both (Recon 0.53, -2.7 lives; Standard 0.68, -6.4
 * lives; full 48/48 arc on each). If this is revisited, that is the candidate,
 * and the shape is the finding rather than the number.
 *
 * Two caveats on the table. The arc column is chaotic — an opening change moves
 * every placement after it — so it carries a noise band of about ±4 sectors in
 * 48; only clear drops like Standard's 38 mean anything. And Blackout is absent
 * because it cannot clear sector one under the probe's builder at any money, so
 * a continuous run never reaches a hand-off and never exercises the floor at
 * all. That is a gap in the evidence, not a verdict that Blackout is fine.
 *
 * ---
 *
 * **The two investigations do not fully agree, and the value above is the
 * unreconciled part.** The re-sweep puts Standard's usable band at 0.65–0.80
 * and calls anything above it a subsidy; the campaign evidence that set 0.9
 * says Standard cannot finish the arc below it. Both ran against the *fixed*
 * parse, so this is not the bug reasserting itself — they weight different
 * failures, stranding versus completion, and the probe's builder never banks,
 * which is exactly the behaviour a subsidy would be invisible to.
 *
 * 0.9 is kept because it is the one of the two that has been played. The
 * re-sweep's real finding is structural and survives either number: a
 * *fraction* hands the most help to the tier that needs it least, and a flat
 * $170 sits inside both bands. Re-open with `npm run bankfloor` if the carry
 * stops feeling like a decision.
 */
export const BANK_FLOOR = 0.9;

export type DifficultyId = keyof typeof DIFFICULTIES;

/** Menu order, easiest first. Explicit because object key order is a trap. */
export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['recon', 'standard', 'blackout'];

export const DEFAULT_DIFFICULTY: DifficultyId = 'standard';
