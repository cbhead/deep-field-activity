/**
 * Authoring formats for content.
 *
 * `src/content/` is data, never logic — it imports nothing and computes nothing
 * beyond arithmetic on its own constants. That's what lets a balance change be a
 * one-line diff in a file with no behaviour in it.
 */

/** A tile address. Integers, unlike the sim's float positions. */
export type TileCoord = readonly [col: number, row: number];

export interface EnemyDef {
  readonly id: string;
  readonly name: string;
  readonly hp: number;
  /** Tiles per second. Reads as a design value because the sim works in tiles. */
  readonly speed: number;
  /** Money awarded on kill. */
  readonly bounty: number;
  /** Draw and hit radius, in tiles. */
  readonly radius: number;

  /**
   * Flat damage subtracted from every individual hit. 0 for everything unarmoured.
   *
   * Flat, not a percentage, and that is the entire design. A percentage cut
   * scales every station equally and therefore counters none of them; a flat
   * cut discriminates by damage *per hit*, so a station landing one heavy shot
   * barely notices while one that chips is nearly stopped.
   *
   * It exists because pierce and slow turned out to multiply: a slow bunches
   * contacts into a file, and pierce is worth more the longer the file, so
   * Singularity manufactures exactly the condition that maximises Lance. The
   * sweep's marginal block showed that pair winning every seed without losing a
   * life while Nova's marginal contribution was *negative*. Armour is the axis
   * on which that pair is weak and Nova is strong, so it makes Nova the answer
   * to something rather than a more expensive way to do what Lance already did.
   *
   * Never total immunity — see `BALANCE.armorFloor`.
   */
  readonly armor: number;

  /**
   * Overshield absorbed before hull. 0 for everything that has none.
   *
   * Shields punish *thin* coverage rather than low damage: they regenerate
   * after a lull, so a contact that slips past a gap arrives whole. Scales with
   * the wave exactly as hp does.
   */
  readonly shield: number;
  /** Seconds without taking damage before the shield starts coming back. */
  readonly shieldRegenDelay: number;
  /** Shield points per second once regen has started. */
  readonly shieldRegenRate: number;

  /**
   * What this breaks into when killed, or null.
   *
   * The named type must itself have `splitInto: null`. That is what makes
   * runaway splitting structurally impossible rather than merely avoided by
   * choosing sensible content — a gate asserts it.
   */
  readonly splitInto: { readonly enemy: string; readonly count: number } | null;
}

export interface TowerDef {
  readonly id: string;
  readonly name: string;
  /** One-line pitch, shown in the build bar. */
  readonly blurb: string;
  readonly cost: number;
  /** Firing radius in tiles, measured from the tower's tile centre. */
  readonly range: number;
  readonly damage: number;
  /** Seconds between shots. */
  readonly fireInterval: number;
  /** Tiles per second. A high value simulates hitscan without a second system. */
  readonly projectileSpeed: number;

  /**
   * Behaviour, one field per mechanic. All five are required rather than
   * optional so that every station's full behaviour is readable in one place —
   * a `0` is a statement ("this one does not splash"), where an absent optional
   * field is a question.
   */

  /** Extra contacts a shot passes through. `0` expires on the first hit. */
  readonly pierce: number;
  /** Splash radius in tiles at the point of impact. `0` is single-target. */
  readonly splashRadius: number;
  /** Damage factor at the very edge of the splash. `1` is no falloff. */
  readonly splashFalloff: number;
  /** Speed multiplier applied to a contact on hit. `1` is no slow. */
  readonly slowFactor: number;
  /** Seconds the slow lasts. Refreshed on re-hit, never stacked. */
  readonly slowSeconds: number;

  /**
   * Extra contacts the hit jumps to, and how far a jump may reach.
   *
   * Distinct from `pierce`, which is the same idea constrained to a straight
   * line. Pierce wants contacts *lined up* and splash wants them *clumped*; a
   * loose scatter satisfies neither, and that was the hole in the roster. A
   * chain needs only proximity, so it is the answer to a spread-out swarm
   * without being an answer to anything tough.
   */
  readonly chainJumps: number;
  readonly chainRange: number;
  /** Damage multiplier applied per jump, compounding. `1` would not fall off. */
  readonly chainFalloff: number;

  /**
   * How fast damage ramps while the station holds one target, and the ceiling.
   *
   * `rampPerSecond: 0` is a station that does not ramp, which is most of them.
   * The ramp resets the instant the target changes — that is the whole design:
   * it makes a ramping station excellent against one wall of hull and useless
   * against a crowd, which is the inverse of the chain above, and it is why a
   * slow that holds something in place is worth pairing with.
   */
  readonly rampPerSecond: number;
  /** Ceiling as a multiple of base damage. `1` means no ramp is possible. */
  readonly rampMax: number;

  /**
   * The effect upgrade path: what this station's third upgrade track improves,
   * on top of the damage and range tracks every station shares.
   *
   * `perTier` is a set of additive deltas applied once per tier above Mk I, so
   * the effect a station is *for* is the thing its effect path deepens — a
   * Lance pierces further, a Singularity slows harder. Additive rather than
   * multiplicative because most of these stats are counts and factors where
   * "+1 jump" and "−6 points of slow factor" are the natural authoring units.
   *
   * The first key is the headline: the inspector's effect button previews it,
   * so put the stat a player is buying first and any supporting tweak after.
   */
  readonly effectUpgrade: {
    /** Short label on the effect-path button, e.g. 'Pierce'. */
    readonly name: string;
    readonly perTier: Readonly<Partial<TowerStats>>;
  };

  /** Number key that selects this tower. */
  readonly hotkey: string;
  /**
   * First wave index (0-based) at which this type may be built. 0 means
   * available from the start. The deck renders anything still locked as a
   * disabled slot naming the wave it opens on.
   */
  readonly unlockWave: number;
}

/**
 * The combat numbers a station actually fights with — every stat an upgrade
 * can move, plus the ones that ride along unchanged.
 *
 * A `Pick` of the def rather than a new shape so the two can never disagree
 * field-by-field. The sim stores one of these per tower (recomputed from the
 * def and the tower's tiers on every upgrade) and snapshots it onto each
 * projectile at fire time, so a shot in flight lands with the stats it was
 * fired with even if the station is upgraded or sold before impact.
 */
export type TowerStats = Pick<
  TowerDef,
  | 'range'
  | 'damage'
  | 'fireInterval'
  | 'projectileSpeed'
  | 'pierce'
  | 'splashRadius'
  | 'splashFalloff'
  | 'slowFactor'
  | 'slowSeconds'
  | 'chainJumps'
  | 'chainRange'
  | 'chainFalloff'
  | 'rampPerSecond'
  | 'rampMax'
>;

/** One burst of identical enemies inside a wave. */
export interface WaveGroup {
  readonly enemy: string;
  readonly count: number;
  /** Seconds between spawns within the group. */
  readonly every: number;
  /** Seconds into the wave before this group starts. */
  readonly after: number;

  /**
   * Which lane this group walks. A `RouteSource.id` pins it to one; `'split'`
   * deals it round-robin across every route in index order.
   *
   * Optional, and absent means route 0 — which is what makes a one-route board
   * read exactly as it did before this field existed, and why the three shipped
   * wave tables needed no edit.
   *
   * Round-robin rather than random, and that is load-bearing rather than
   * merely simple: a race replays the same wave plan on two clients, so lane
   * assignment has to be reproducible from the seed alone. Dealing in index
   * order needs no RNG stream at all, which is one fewer thing that can drift
   * — and it means `'split'` on a count of 12 across two lanes is always 6 and
   * 6, which a designer can reason about.
   */
  readonly route?: string | 'split';
}

export interface WaveDef {
  readonly groups: readonly WaveGroup[];
}

/**
 * One lane. An id and a waypoint chain, and deliberately nothing else.
 *
 * No per-route speed, no weighting, no priority. Those would all be reasonable
 * and all be premature: on a multi-lane board the *geometry* is doing the work,
 * and a second knob on top of it would only hide which one mattered.
 */
export interface RouteSource {
  /** Unique within the map. The authoring handle, and what a wave group names. */
  readonly id: string;

  /**
   * The lane as corner tile coords, first = a spawn, last = the goal.
   *
   * Authored explicitly rather than traced out of the ASCII: a trace is ambiguous
   * wherever the path touches itself, and the order of travel isn't recoverable
   * from painted tiles at all. The cost of a second representation is drift, so
   * `parseMap()` cross-checks the two — every route tile must be painted path,
   * and every painted path tile must be on *some* route.
   */
  readonly waypoints: readonly TileCoord[];
}

export interface MapSource {
  readonly id: string;
  readonly name: string;

  /**
   * The board, one string per row. All rows must be the same length.
   *
   *   `.` buildable ground    `#` path
   *   `x` blocked scenery     `S` spawn (path)    `E` goal (path)
   *
   * More than one `S` is legal — a board may have several spawns. More than one
   * `E` is not: one goal keeps a board about coverage, where two goals with
   * different life costs would be a different game, about triage.
   */
  readonly rows: readonly string[];

  /**
   * The lanes contacts walk. At least one.
   *
   * A single-route map is the old shape and reads identically — which is the
   * whole reason this is a list rather than a `waypoints` field beside an
   * optional `extraLanes`. Lanes that share tiles are legal and expected: a
   * merge *is* two routes covering the same road.
   */
  readonly routes: readonly RouteSource[];
}
