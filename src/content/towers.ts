import type { TowerDef } from './types.ts';

/**
 * The three v1 towers.
 *
 * They differ on the axes that make a placement decision interesting — reach,
 * damage per shot, and rate — before any special behaviour exists. Cannon's
 * splash and frost's slow arrive in M7; until then these are already three
 * genuinely different answers to "what do I put on this tile", which is what
 * M5 needs in order to tell us whether the loop is fun.
 *
 * Numbers are a first guess. M9's headless harness is what tunes them.
 */
export const TOWERS = {
  arrow: {
    id: 'arrow',
    name: 'Arrow',
    blurb: 'Cheap, fast, long reach. The backbone.',
    cost: 60,
    range: 3.0,
    damage: 6,
    fireInterval: 0.5,
    projectileSpeed: 14,
    hotkey: '1',
  },
  cannon: {
    id: 'cannon',
    name: 'Cannon',
    blurb: 'Slow, heavy, short reach. Wants a corner.',
    cost: 110,
    range: 2.4,
    damage: 20,
    fireInterval: 1.4,
    projectileSpeed: 9,
    hotkey: '2',
  },
  frost: {
    id: 'frost',
    name: 'Frost',
    blurb: 'Low damage, near-instant shots.',
    cost: 85,
    range: 2.8,
    damage: 3,
    fireInterval: 0.75,
    // Fast enough to land the same tick it is fired, in practice. Hitscan
    // without a second damage path and a second set of bugs.
    projectileSpeed: 40,
    hotkey: '3',
  },
} as const satisfies Record<string, TowerDef>;

export type TowerId = keyof typeof TOWERS;

export const TOWER_IDS = Object.keys(TOWERS) as TowerId[];
