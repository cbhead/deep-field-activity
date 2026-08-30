import type { EnemyDef } from './types.ts';

/**
 * The things that come down the route. The HUD calls them *contacts*
 * collectively; each type has its own name.
 *
 * `as const satisfies` rather than a plain annotation: `satisfies` type-checks
 * each entry against EnemyDef while `as const` keeps the literal types, so
 * `EnemyId` is the union of these keys rather than `string`. Typos in a wave
 * table then fail to compile — which is also what polices the id/name match here.
 *
 * The five types exist to ask different questions of a defence, not to be five
 * flavours of the same one:
 *
 * - **Drifter** — the baseline everything else is read against.
 * - **Mote** — too fast and too numerous for single-target fire. Wants splash.
 * - **Monolith** — a wall of hull. Punishes chip damage, which is the first
 *   thing in this game a Singularity is genuinely bad at.
 * - **Warden** — regenerates its shield in any gap, so it punishes thin
 *   coverage rather than low damage. A defence with a hole arrives whole.
 * - **Cluster** — dies into three Motes, converting one kill into an overwhelm
 *   problem somewhere further back down the route.
 */
export const ENEMIES = {
  drifter: {
    id: 'drifter',
    name: 'Drifter',
    hp: 20,
    speed: 1.8,
    bounty: 6,
    radius: 0.3,
    shield: 0,
    shieldRegenDelay: 0,
    shieldRegenRate: 0,
    splitInto: null,
  },

  mote: {
    id: 'mote',
    name: 'Mote',
    hp: 7,
    speed: 2.9,
    bounty: 2,
    radius: 0.17,
    shield: 0,
    shieldRegenDelay: 0,
    shieldRegenRate: 0,
    // Must stay null: Cluster splits into Motes, and a Mote that split in turn
    // would never terminate.
    splitInto: null,
  },

  monolith: {
    id: 'monolith',
    name: 'Monolith',
    hp: 140,
    speed: 0.85,
    bounty: 34,
    radius: 0.46,
    shield: 0,
    shieldRegenDelay: 0,
    shieldRegenRate: 0,
    splitInto: null,
  },

  warden: {
    id: 'warden',
    name: 'Warden',
    hp: 26,
    speed: 1.5,
    bounty: 14,
    radius: 0.33,
    shield: 30,
    shieldRegenDelay: 2.2,
    shieldRegenRate: 14,
    splitInto: null,
  },

  cluster: {
    id: 'cluster',
    name: 'Cluster',
    hp: 44,
    speed: 1.3,
    bounty: 12,
    radius: 0.4,
    shield: 0,
    shieldRegenDelay: 0,
    shieldRegenRate: 0,
    splitInto: { enemy: 'mote', count: 3 },
  },
} as const satisfies Record<string, EnemyDef>;

export type EnemyId = keyof typeof ENEMIES;

export const ENEMY_IDS = Object.keys(ENEMIES) as EnemyId[];
