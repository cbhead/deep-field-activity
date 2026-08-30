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

/**
 * Height the top bar reserves above the board, in board-space px.
 *
 * Same reasoning as `DECK_PX`, arrived at later. The bar overlaid the top two
 * rows and — worse than hiding them — it takes pointer events, so tiles up
 * there could be looked at but not built on. A control strip that silently
 * eats part of the play area is the same bug whichever edge it sits on.
 */
export const TOP_PX = 46;

/** Colours live in `theme.ts`, so that a reskin is one file rather than five. */

/**
 * Where each upgrade path sits on the collar drawn around an upgraded station.
 *
 * **Position is the encoding, not colour.** Three paths need three channels and
 * the palette has none to spare — every hue is already claimed by a station
 * (Arc green, Filament violet) or a status (shield blue, slow cyan), so a colour
 * code here would collide with something the player has already learned. Fixed
 * sectors never clash, and the collar is drawn in the station's own tint so it
 * reads as part of that station rather than as a fourth thing on the board.
 *
 * Clockwise from twelve in `UPGRADE_PATHS` order — damage, range, effect —
 * which is also left-to-right order in the inspector's path buttons.
 *
 * Lives here rather than in either consumer because BOTH have to agree: the
 * board draws these as Pixi arcs and the inspector's dial draws them as SVG
 * paths, and the dial is the only place the positional code is ever taught. If
 * the two drifted, the legend would quietly start lying about the board. This
 * file is pixi-free, so the DOM side can import it without pulling in a renderer.
 */
export const COLLAR_SECTORS = [
  { path: 'damage', from: -137 },
  { path: 'range', from: -17 },
  { path: 'effect', from: 103 },
] as const;

/** Degrees each sector spans. 94 of every 120, so the three read as separate. */
export const COLLAR_SPAN = 94;
