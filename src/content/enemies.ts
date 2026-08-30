import type { EnemyDef } from './types.ts';

/**
 * The things that come down the route. The HUD calls them *contacts*
 * collectively; each type has its own name.
 *
 * `as const satisfies` rather than a plain annotation: `satisfies` type-checks
 * each entry against EnemyDef while `as const` keeps the literal types, so
 * `EnemyId` is the union `'drifter'` rather than `string`. Typos in a wave table
 * then fail to compile — which is also what polices the id/name match here.
 */
export const ENEMIES = {
  drifter: {
    id: 'drifter',
    name: 'Drifter',
    hp: 20,
    speed: 1.8,
    bounty: 6,
    radius: 0.3,
  },
} as const satisfies Record<string, EnemyDef>;

export type EnemyId = keyof typeof ENEMIES;
