import type { TowerDef } from './types.ts';

/**
 * The three v1 towers.
 *
 * Costs are set against range, not against raw damage. Range buys time on
 * target, so a short-reach tower needs more damage per dollar just to break
 * even: arrow yields 0.16 dps/$ at 2.8 tiles, cannon 0.21 at 2.5. Tuned by
 * sweep (see the balance probe in tools/check.ts), not by feel — the first
 * guess had arrow at 0.20 dps/$ *and* the longest reach, which made it
 * strictly correct and the other two decorative.
 *
 * Known gap: frost cannot yet carry a game on its own. With one enemy type and
 * no status effects there is nothing for a low-damage, high-rate, long-reach
 * tower to be good *at* — its whole point is the slow that arrives in M7. It is
 * priced as cheap early coverage until then.
 */
export const TOWERS = {
  arrow: {
    id: 'arrow',
    name: 'Arrow',
    blurb: 'Steady all-rounder. Good reach, no surprises.',
    cost: 75,
    range: 2.8,
    damage: 6,
    fireInterval: 0.5,
    projectileSpeed: 14,
    hotkey: '1',
  },
  cannon: {
    id: 'cannon',
    name: 'Cannon',
    blurb: 'Heavy hits, slow reload, short reach. Wants a corner.',
    cost: 105,
    range: 2.5,
    damage: 22,
    fireInterval: 1.4,
    projectileSpeed: 9,
    hotkey: '2',
  },
  frost: {
    id: 'frost',
    name: 'Frost',
    blurb: 'Longest reach, rapid fire, tiny hits.',
    cost: 65,
    range: 3.3,
    damage: 2,
    fireInterval: 0.28,
    // Fast enough to land the same tick it is fired, in practice. Hitscan
    // without a second damage path and a second set of bugs.
    projectileSpeed: 40,
    hotkey: '3',
  },
} as const satisfies Record<string, TowerDef>;

export type TowerId = keyof typeof TOWERS;

export const TOWER_IDS = Object.keys(TOWERS) as TowerId[];
