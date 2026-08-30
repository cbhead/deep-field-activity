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
 * The six types exist to ask different questions of a defence, not to be six
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
 * - **Bulwark** — flat armour on every hit. Punishes *many small hits*, which
 *   is the one thing the rest of the roster never asked about, and the reason
 *   Lance-plus-Singularity could clear every seed without losing a life.
 */
export const ENEMIES = {
  drifter: {
    id: 'drifter',
    name: 'Drifter',
    hp: 20,
    speed: 1.8,
    bounty: 6,
    radius: 0.3,
    armor: 0,
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
    armor: 0,
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
    hp: 150,
    speed: 0.85,
    bounty: 34,
    radius: 0.46,
    armor: 0,
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
    armor: 0,
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
    armor: 0,
    shield: 0,
    shieldRegenDelay: 0,
    shieldRegenRate: 0,
    splitInto: { enemy: 'mote', count: 3 },
  },

  bulwark: {
    id: 'bulwark',
    name: 'Bulwark',
    // Deliberately not a second Monolith. Monolith is a wall of hull that any
    // sustained damage eventually grinds down; a Bulwark's hull is ordinary and
    // the plating is the whole problem, so the answer is a bigger hit rather
    // than more time on target. Moderate hp is what keeps those two distinct.
    // Low on purpose, and lower than it first shipped. Hull scales with the
    // wave and armour does not, so a beefy armoured contact compounds two
    // difficulties and by wave 9 is unkillable by anything but Nova — which is
    // just the old dominance with a different station on top. Keeping hull near
    // Drifter's leaves armour as the only question it asks.
    hp: 26,
    speed: 1.4,
    bounty: 18,
    radius: 0.38,
    // Nova's 22 keeps 77% of its hit, Lance's 8 keeps 38%, and Singularity's 3
    // floors out. "Bad, not useless" is the target for Lance — it should be the
    // wrong tool here, not a wasted purchase.
    //
    // Note what this does to upgrades. A Mk III Lance hits for 18 and keeps
    // 72%, so armour roughly doubles what upgrading is worth and makes it beat
    // adding another tower — the reverse of this game's usual pull toward
    // coverage. The sweep cannot see that: its builder only ever spreads.
    armor: 5,
    shield: 0,
    shieldRegenDelay: 0,
    shieldRegenRate: 0,
    splitInto: null,
  },
} as const satisfies Record<string, EnemyDef>;

export type EnemyId = keyof typeof ENEMIES;

export const ENEMY_IDS = Object.keys(ENEMIES) as EnemyId[];
