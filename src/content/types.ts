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

  /** Number key that selects this tower. */
  readonly hotkey: string;
  /**
   * First wave index (0-based) at which this type may be built. 0 means
   * available from the start. The deck renders anything still locked as a
   * disabled slot naming the wave it opens on.
   */
  readonly unlockWave: number;
}

/** One burst of identical enemies inside a wave. */
export interface WaveGroup {
  readonly enemy: string;
  readonly count: number;
  /** Seconds between spawns within the group. */
  readonly every: number;
  /** Seconds into the wave before this group starts. */
  readonly after: number;
}

export interface WaveDef {
  readonly groups: readonly WaveGroup[];
}

export interface MapSource {
  readonly id: string;
  readonly name: string;

  /**
   * The board, one string per row. All rows must be the same length.
   *
   *   `.` buildable ground    `#` path
   *   `x` blocked scenery     `S` spawn (path)    `E` goal (path)
   */
  readonly rows: readonly string[];

  /**
   * The creep route as corner tile coords, first = spawn, last = goal.
   *
   * Authored explicitly rather than traced out of the ASCII: a trace is ambiguous
   * wherever the path touches itself, and the order of travel isn't recoverable
   * from painted tiles at all. The cost of a second representation is drift, so
   * `parseMap()` cross-checks the two — every route tile must be painted path,
   * and every painted path tile must be on the route.
   */
  readonly waypoints: readonly TileCoord[];
}
