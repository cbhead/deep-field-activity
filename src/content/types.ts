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
  /** Sprite tint. Presentational, but it belongs with the rest of the def. */
  readonly color: number;
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
