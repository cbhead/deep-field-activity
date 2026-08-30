/**
 * Pixel-space constants. These live in the renderer on purpose — the simulation
 * works entirely in tile units (floats), so `speed: 1.8` reads as "1.8 tiles per
 * second" and changing the tile size never touches gameplay code.
 */
export const TILE_PX = 40;

/** Board dimensions come from the parsed map, not from here. */
export const tilesToPx = (tiles: number): number => tiles * TILE_PX;

/**
 * Height the open deck reserves beneath the board, in board-space px.
 *
 * The deck used to overlay the board and hid the goal plus seven of the route's
 * forty-three tiles — including the final approach, which is exactly where
 * leaks happen. Reserving the space instead costs board size but means the
 * player can always see what they are defending.
 *
 * Lives here rather than only in CSS because `fitCanvas` has to letterbox the
 * board and the deck as one unit; the stylesheet reads it back as `--deck-h`.
 */
export const DECK_PX = 150;

/** Colours live in `theme.ts`, so that a reskin is one file rather than five. */
