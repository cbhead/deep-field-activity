/**
 * What each station draws inside its hull, in unit space.
 *
 * **Shared between two renderers on purpose**, which reverses the call
 * `icons.ts` made for the hexagon. That call was right: the hull is decoration,
 * and coupling a Pixi `poly()` to an SVG `d` to save nine numbers was not worth
 * it. These are not decoration. A pierce line, a blast ring, a chain path — each
 * is *a claim about what the board is doing*, and the deck makes that claim in a
 * button while the board has to honour it in a sprite. A legend that drifts from
 * the thing it explains is worse than no legend, which is the same reasoning
 * that already made `COLLAR_SECTORS` shared. This is that precedent, applied to
 * the case the design's "deck and board teach each other" creates.
 *
 * Pure geometry: no colour, no Pixi, no DOM. `textures.ts` scales it to
 * `TILE_PX` and fills in `BAKE_NEUTRAL`; `icons.ts` scales it to a 40-unit
 * viewBox and strokes it in `currentColor`. Neither imports the other.
 *
 * **The annulus is the constraint.** The hub sits at `shape.hubRatio` (~0.14)
 * and grows with tier; the tier pips own the row at `shape.pipRowY` (~0.80);
 * the hull's vertices reach ~0.42. So a mark lives between roughly r=0.16 and
 * r=0.32 of the tile, and above y≈0.72. Anything outside that collides with
 * something that is already saying a different thing.
 *
 * Every mark is chosen to be *the shot the station already fires*, so the board
 * is teaching what the deck claims rather than inventing a second vocabulary:
 * Nova's ring is the detonation `effects.ts` draws, Singularity's arcs are the
 * clock `creepChrome.ts` draws, Filament's bars are `towerChrome`'s spin-up arc
 * unrolled.
 */
import type { TowerId } from '../content/towers.ts';

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface Disc {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** Angles in degrees, clockwise from three o'clock, as the collar uses. */
export interface MarkArc {
  readonly r: number;
  readonly from: number;
  readonly span: number;
}

export interface StationMark {
  /** Open polylines, stroked. */
  readonly lines: readonly (readonly Pt[])[];
  /** Filled dots. */
  readonly discs: readonly Disc[];
  /** Stroked arcs centred on the station. */
  readonly arcs: readonly MarkArc[];
}

const NONE: StationMark = { lines: [], discs: [], arcs: [] };

export const STATION_MARKS: Readonly<Record<TowerId, StationMark>> = {
  /** A shot passing through, with what it has already hit trailing behind it. */
  lance: {
    ...NONE,
    lines: [[{ x: 0.18, y: 0.5 }, { x: 0.8, y: 0.5 }]],
    discs: [
      { cx: 0.68, cy: 0.5, r: 0.042 },
      { cx: 0.79, cy: 0.5, r: 0.028 },
    ],
  },

  /** The detonation ring, at the radius the blast actually draws. */
  nova: {
    ...NONE,
    arcs: [{ r: 0.31, from: 0, span: 360 }],
  },

  /** Two arcs drawing inward — the slow clock, standing still. */
  singularity: {
    ...NONE,
    arcs: [
      { r: 0.32, from: -140, span: 100 },
      { r: 0.32, from: 40, span: 100 },
      { r: 0.22, from: -60, span: 120 },
    ],
  },

  /** A jump between contacts, which is what the chain is. */
  arc: {
    ...NONE,
    lines: [
      [
        { x: 0.25, y: 0.6 },
        { x: 0.42, y: 0.39 },
        { x: 0.58, y: 0.6 },
        { x: 0.75, y: 0.39 },
      ],
    ],
    discs: [
      { cx: 0.25, cy: 0.6, r: 0.036 },
      { cx: 0.58, cy: 0.6, r: 0.036 },
      { cx: 0.75, cy: 0.39, r: 0.036 },
    ],
  },

  /** Time on target, unrolled from the spin-up arc into rising bars. */
  filament: {
    ...NONE,
    lines: [
      [{ x: 0.3, y: 0.66 }, { x: 0.3, y: 0.58 }],
      [{ x: 0.43, y: 0.66 }, { x: 0.43, y: 0.48 }],
      [{ x: 0.57, y: 0.66 }, { x: 0.57, y: 0.38 }],
      [{ x: 0.7, y: 0.66 }, { x: 0.7, y: 0.3 }],
    ],
  },
};

/** Stroke weight for a mark, as a fraction of the tile. Thin: it is a legend. */
export const MARK_STROKE = 0.042;
