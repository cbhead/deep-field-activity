import type { TowerDef } from './types.ts';

/**
 * The three v1 stations.
 *
 * **Ids match the names on purpose.** They were once `arrow`/`cannon`/`frost`
 * and the display names moved on without them; that mismatch is the kind that
 * compounds with every station added, so the key, the `id` and the `name` are
 * now one word. Renaming later costs a typed find/replace the compiler polices
 * completely, plus the `.t-<id>` classes in styles.css that it does not.
 *
 * Costs are set against range, not against raw damage. Range buys time on
 * target, so a short-reach station needs more damage per dollar just to break
 * even: Lance yields 0.16 dps/$ at 2.8 tiles, Nova 0.21 at 2.5. Tuned by sweep
 * (see the balance probe in tools/check.ts), not by feel — the first guess had
 * Lance at 0.20 dps/$ *and* the longest reach, which made it strictly correct
 * and the other two decorative.
 *
 * **These numbers are pre-M7 and will all move.** Each station is about to gain
 * the behaviour its name asserts — Lance pierces, Nova detonates, Singularity
 * slows — and everything here was tuned when all three behaved identically. The
 * blurbs below describe what they do *today*, not what the names promise; they
 * get rewritten when the mechanics land.
 *
 * Known gap: Singularity cannot yet carry a game on its own, and the probe says
 * so — `won 0/5`. With one contact type and no status effects there is nothing
 * for a low-damage, high-rate, long-reach station to be good *at*. Its whole
 * point is the gravitational slow that arrives in M7; it is priced as cheap
 * early coverage until then.
 */
export const TOWERS = {
  lance: {
    id: 'lance',
    name: 'Lance',
    blurb: 'Steady all-rounder. Good reach, no surprises.',
    cost: 75,
    range: 2.8,
    damage: 6,
    fireInterval: 0.5,
    projectileSpeed: 14,
    pierce: 2,
    splashRadius: 0,
    splashFalloff: 1,
    slowFactor: 1,
    slowSeconds: 0,
    hotkey: '1',
    unlockWave: 0,
  },
  nova: {
    id: 'nova',
    name: 'Nova',
    blurb: 'Heavy hits, slow reload, short reach. Wants a corner.',
    cost: 105,
    range: 2.5,
    damage: 22,
    fireInterval: 1.4,
    projectileSpeed: 9,
    pierce: 0,
    splashRadius: 1.1,
    splashFalloff: 0.35,
    slowFactor: 1,
    slowSeconds: 0,
    hotkey: '2',
    unlockWave: 0,
  },
  singularity: {
    id: 'singularity',
    name: 'Singularity',
    blurb: 'Longest reach, rapid fire, tiny hits.',
    cost: 65,
    range: 3.3,
    damage: 2,
    fireInterval: 0.28,
    // Fast enough to land the same tick it is fired, in practice. Hitscan
    // without a second damage path and a second set of bugs.
    projectileSpeed: 40,
    pierce: 0,
    splashRadius: 0,
    splashFalloff: 1,
    slowFactor: 0.55,
    slowSeconds: 1.2,
    hotkey: '3',
    unlockWave: 0,
  },
} as const satisfies Record<string, TowerDef>;

export type TowerId = keyof typeof TOWERS;

export const TOWER_IDS = Object.keys(TOWERS) as TowerId[];
