import type { EnemyDef } from './types.ts';

/**
 * `as const satisfies` rather than a plain annotation: `satisfies` type-checks
 * each entry against EnemyDef while `as const` keeps the literal types, so
 * `EnemyId` is the union `'grunt'` rather than `string`. Typos in a wave table
 * then fail to compile.
 */
export const ENEMIES = {
  grunt: {
    id: 'grunt',
    name: 'Grunt',
    hp: 20,
    speed: 1.8,
    bounty: 4,
    radius: 0.3,
  },
} as const satisfies Record<string, EnemyDef>;

export type EnemyId = keyof typeof ENEMIES;
