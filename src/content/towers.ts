import type { TowerDef } from './types.ts';

/**
 * The five stations.
 *
 * **Ids match the names on purpose.** They were once `arrow`/`cannon`/`frost`
 * and the display names moved on without them; that mismatch is the kind that
 * compounds with every station added, so the key, the `id` and the `name` are
 * now one word. Renaming later costs a typed find/replace the compiler polices
 * completely, plus the `.t-<id>` classes in styles.css that it does not.
 *
 * **Every station is the answer to something, and to only one thing.** That is
 * the property the roster is tuned for, and `tools/check.ts`'s matchup matrix
 * is what checks it — a row of zeros is a station that beats everything, a
 * column nothing clears is a contact with no counter, and both are failures.
 *
 * The five, and the question each answers:
 *
 * - **Lance** pierces — contacts *lined up* along a straight.
 * - **Nova** detonates — contacts *clumped* together.
 * - **Arc** chains — contacts merely *near* each other, which is the case
 *   neither of the other two covers and was the hole in the roster.
 * - **Filament** ramps on a held target — one wall of hull, and nothing else.
 * - **Singularity** slows — support. It wins 0/5 alone in the mono-build rows
 *   and that number means nothing: a station with no damage cannot answer a
 *   "can it clear the arc by itself" question. Read its marginal contribution
 *   instead, where it is worth more than either of the ones that do damage.
 *
 * Costs are set against range, not against raw damage, because range buys time
 * on target: a short-reach station needs more damage per dollar just to break
 * even. Tuned by sweep, never by feel — the first guess had Lance at the best
 * damage per dollar *and* the longest reach, which made it strictly correct and
 * the other two decorative.
 */
export const TOWERS = {
  lance: {
    id: 'lance',
    name: 'Lance',
    blurb: 'Shots pass through. Wants contacts lined up.',
    cost: 75,
    range: 2.8,
    damage: 8,
    fireInterval: 0.5,
    projectileSpeed: 14,
    pierce: 2,
    splashRadius: 0,
    splashFalloff: 1,
    slowFactor: 1,
    slowSeconds: 0,
    chainJumps: 0,
    chainRange: 0,
    chainFalloff: 1,
    rampPerSecond: 0,
    rampMax: 1,
    // 2 → 3 → 4 contacts passed through. Pierce is the identity, so the effect
    // path buys more of it — each tier makes a well-placed straight pay more.
    effectUpgrade: { name: 'Pierce', perTier: { pierce: 1 } },
    hotkey: '1',
    unlockWave: 0,
  },
  nova: {
    id: 'nova',
    name: 'Nova',
    blurb: 'Blast damage. The answer to a swarm.',
    cost: 115,
    range: 2.5,
    damage: 22,
    fireInterval: 1.4,
    projectileSpeed: 9,
    pierce: 0,
    splashRadius: 0.8,
    splashFalloff: 0.35,
    slowFactor: 1,
    slowSeconds: 0,
    chainJumps: 0,
    chainRange: 0,
    chainFalloff: 1,
    rampPerSecond: 0,
    rampMax: 1,
    // 0.8 → 1.05 → 1.3 tile blast. Radius rather than falloff because a wider
    // ring is legible on the board — the blast event carries the real radius,
    // so the drawn circle grows with the purchase.
    effectUpgrade: { name: 'Blast', perTier: { splashRadius: 0.25 } },
    hotkey: '2',
    unlockWave: 0,
  },
  singularity: {
    id: 'singularity',
    name: 'Singularity',
    blurb: 'Slows everything it touches. Support, not damage.',
    cost: 80,
    range: 3.3,
    damage: 3,
    fireInterval: 0.28,
    // Fast enough to land the same tick it is fired, in practice. Hitscan
    // without a second damage path and a second set of bugs.
    projectileSpeed: 40,
    pierce: 0,
    splashRadius: 0,
    splashFalloff: 1,
    slowFactor: 0.8,
    slowSeconds: 0.9,
    chainJumps: 0,
    chainRange: 0,
    chainFalloff: 1,
    rampPerSecond: 0,
    rampMax: 1,
    // 80% → 74% → 68% speed, held 0.9s → 1.2s → 1.5s. Both dials move a little
    // rather than one a lot: a much lower factor alone approaches a stop (the
    // classic way a slow breaks a tower defense), and duration alone is
    // invisible under constant re-hits. slowFactor leads because it is the
    // number the inspector previews.
    effectUpgrade: { name: 'Slow', perTier: { slowFactor: -0.06, slowSeconds: 0.3 } },
    hotkey: '3',
    unlockWave: 0,
  },

  arc: {
    id: 'arc',
    name: 'Arc',
    blurb: 'Jumps between contacts. Wants them near each other, not lined up.',
    cost: 105,
    range: 2.6,
    damage: 10,
    fireInterval: 0.75,
    // Near-hitscan, like Singularity: an arc that visibly travelled would read
    // as a slow projectile rather than as electricity finding a path.
    projectileSpeed: 30,
    pierce: 0,
    splashRadius: 0,
    splashFalloff: 1,
    slowFactor: 1,
    slowSeconds: 0,
    // 10 into the first, then 5.5, 3.0, 1.7 — about 20 spread over four
    // contacts. Deliberately worse than Lance into a single target and better
    // than either into a scatter, which is the only thing it should win at.
    // The falloff started at 0.65 and the probe had Arc winning 5/5 at 17.4
    // lives alone, ahead of every other single station — proximity is a far
    // easier condition to satisfy than Lance's alignment, so equal falloff made
    // it the strictly easier buy rather than a different one.
    chainJumps: 3,
    chainRange: 1.6,
    chainFalloff: 0.55,
    rampPerSecond: 0,
    rampMax: 1,
    // 3 → 4 → 5 jumps. Jumps, not falloff: extra hops keep the "worse than
    // Lance into a line, better into a scatter" identity, where softer falloff
    // would creep toward beating Lance at its own condition.
    effectUpgrade: { name: 'Chain', perTier: { chainJumps: 1 } },
    hotkey: '4',
    // Opens on the wave Motes first arrive. Every station unlocks alongside the
    // problem it answers, so the deck teaches the roster instead of the player
    // having to infer it.
    unlockWave: 2,
  },

  filament: {
    id: 'filament',
    name: 'Filament',
    blurb: 'Burns hotter the longer it holds one target. Cools if it switches.',
    cost: 105,
    range: 2.4,
    // Low per-hit damage on purpose: armour is subtracted per hit, so a
    // Filament is deliberately terrible into a Bulwark however long it burns.
    // It answers hull, not plating — that is what keeps it from being a
    // strictly better Nova.
    damage: 4,
    fireInterval: 0.25,
    projectileSpeed: 40,
    pierce: 0,
    splashRadius: 0,
    splashFalloff: 1,
    slowFactor: 1,
    slowSeconds: 0,
    chainJumps: 0,
    chainRange: 0,
    chainFalloff: 1,
    // 16 dps cold, 48 dps at the ceiling, reached after 2.5s on one target.
    // Swept between two failures rather than guessed: 12/42 over 4s could not
    // carry a run even with its unlock removed (wave 8 of 10, level with pure
    // Singularity, which has no damage at all), while 20/70 over 2.5s won alone
    // at 19.8 lives and made nova+filament a flawless 20/20 — dominant, which
    // is the one outcome the roster must not have.
    rampPerSecond: 0.8,
    rampMax: 3,
    // Ceiling ×3 → ×3.75 → ×4.5, spin-up 0.8 → 1.0 → 1.2/s. Both rise so time
    // to the ceiling stays near 2.5s — a higher ceiling alone would mean a burn
    // that never finishes charging against anything that dies. rampMax leads
    // because the ceiling is the number the inspector previews.
    effectUpgrade: { name: 'Ramp', perTier: { rampMax: 0.75, rampPerSecond: 0.2 } },
    hotkey: '5',
    /** Opens on the wave the first Monolith walks in. */
    unlockWave: 4,
  },
} as const satisfies Record<string, TowerDef>;

export type TowerId = keyof typeof TOWERS;

export const TOWER_IDS = Object.keys(TOWERS) as TowerId[];
