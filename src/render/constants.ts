/**
 * Pixel-space constants. These live in the renderer on purpose — the simulation
 * works entirely in tile units (floats), so `speed: 1.8` reads as "1.8 tiles per
 * second" and changing the tile size never touches gameplay code.
 */
export const TILE_PX = 40;

/** Board dimensions come from the parsed map, not from here. */
export const tilesToPx = (tiles: number): number => tiles * TILE_PX;

export const COLORS = {
  bg: 0x0f172a,

  ground: 0x1a2e2a,
  groundAlt: 0x182a26,
  gridLine: 0x24413a,

  blocked: 0x334155,
  blockedEdge: 0x475569,

  path: 0x3f3a2f,
  pathEdge: 0x4a4436,

  spawn: 0xf87171,
  goal: 0x38bdf8,

  /** Rejected placement. Red reads as "no" without needing a label. */
  invalid: 0xef4444,
} as const;
