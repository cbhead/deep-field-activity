/**
 * Pixel-space constants. These live in the renderer on purpose — the simulation
 * works entirely in tile units (floats), so `speed: 1.8` reads as "1.8 tiles per
 * second" and changing the tile size never touches gameplay code.
 */
export const TILE_PX = 40;

/** Board dimensions come from the parsed map, not from here. */
export const tilesToPx = (tiles: number): number => tiles * TILE_PX;

/** Colours live in `theme.ts`, so that a reskin is one file rather than five. */
