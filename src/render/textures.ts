import { Graphics, type Renderer, type Texture } from 'pixi.js';
import { BALANCE } from '../content/balance.ts';
import { TILE_PX } from './constants.ts';
import { BAKE_NEUTRAL, THEME } from './theme.ts';

/**
 * Every repeated visual is baked into a GPU texture once, then instanced as
 * cheap batched Sprites.
 *
 * A live Graphics object re-tessellates its geometry and breaks the sprite
 * batch; 390 of them for the board — let alone hundreds of creeps — is the
 * difference between one draw call and hundreds. This is also why "colored
 * shapes, no art" costs nothing architecturally: swapping in real sprites later
 * only changes what this file returns.
 */
export interface Textures {
  ground: Texture;
  groundAlt: Texture;
  path: Texture;
  blocked: Texture;
  /**
   * Baked neutral so it can be `tint`ed per enemy type — tinting is free on the
   * GPU and keeps every creep on one texture, hence one draw call.
   */
  creep: Texture;
  /**
   * One bake per tier, indexed `tier - 1`. Baked neutral and tinted per tower
   * type; `towers[0]` doubles as the build ghost, since placement is always Mk I.
   */
  towers: readonly Texture[];
  /** Tinted by the firing tower, so you can read which tower landed a shot. */
  projectile: Texture;
}

/** Radius the projectile texture is baked at, in tiles. */
export const PROJECTILE_RADIUS = 0.11;

/** Radius the creep *core* is baked at, in tiles. Sprites scale from this. */
export const CREEP_BAKE_RADIUS = 0.5;

function bake(renderer: Renderer, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const texture = renderer.generateTexture({
    target: g,
    // Match the canvas so tiles stay crisp on retina.
    resolution: renderer.resolution,
    antialias: true,
  });
  g.destroy();
  return texture;
}

/**
 * The grid line is baked into the tile itself rather than drawn as an overlay
 * mesh — the border is what makes tower placement legible, and this way it
 * costs zero extra nodes. Path tiles deliberately get no grid so the route
 * reads as one continuous road.
 *
 * `alpha` is what lets the starfield through. Open ground is baked short of
 * opaque so the sky reads as being *behind* the board rather than as one more
 * tile colour; the route is the exception and stays at 1. Occluding the stars
 * is what makes the road read as a structure laid over the void, and it is a
 * legibility win as much as a visual one — a route you can trace without the
 * field competing under it is a route you can plan against. The edge stroke
 * keeps its own alpha: dimming the grid along with the fill would trade away
 * placement legibility to buy nothing.
 */
const flatTile =
  (fill: number, edge: number | null, alpha = 1) =>
  (g: Graphics): void => {
    g.rect(0, 0, TILE_PX, TILE_PX).fill({ color: fill, alpha });
    if (edge !== null) {
      // Inset by half a pixel so the 1px stroke lands on the pixel, not across two.
      g.rect(0.5, 0.5, TILE_PX - 1, TILE_PX - 1).stroke({ width: 1, color: edge, alpha: 0.6 });
    }
  };

/**
 * The nebula — what an unbuildable tile is in Deep Field.
 *
 * Discs, as fractions of the tile: centre x, centre y, radius. Overlapping them
 * at low alpha rather than drawing one shape is the entire trick, because the
 * union of soft discs has no outline, and an outline is the difference between
 * gas and a rock. Deliberately not concentric — a shared centre stacks into
 * visible rings, which is this shape's obvious failure mode.
 *
 * Every disc is contained within the tile deliberately: `generateTexture` sizes
 * from geometry bounds, so a single pixel of overhang would quietly produce a
 * larger-than-40px texture and skew every tile after it.
 */
const NEBULA_PUFFS: readonly (readonly [number, number, number])[] = [
  [0.5, 0.5, 0.5],
  [0.34, 0.38, 0.3],
  [0.68, 0.4, 0.28],
  [0.36, 0.66, 0.28],
  [0.65, 0.64, 0.31],
  [0.52, 0.5, 0.22],
];

/** Denser knots in the gas, in `blockedEdge`. Two is enough to kill the flatness. */
const NEBULA_KNOTS: readonly (readonly [number, number, number])[] = [
  [0.45, 0.47, 0.24],
  [0.57, 0.56, 0.16],
];

/**
 * Low enough that no single disc has a boundary you can pick out, so the cloud
 * comes from accumulation rather than from any one shape. It also caps how
 * bright the nebula can get: the puffs stack to roughly the density of the old
 * flat plate at the middle, which is where scenery belongs — below a station,
 * far below a contact.
 */
const NEBULA_ALPHA = 0.15;
const NEBULA_KNOT_ALPHA = 0.15;

/**
 * A flat coat under the puffs, covering the tile corner to corner.
 *
 * Without it a clump of nebula reads as four coins rather than one mass, and
 * this is a tiling artefact rather than a taste call: a disc inscribed in the
 * tile meets each edge at exactly one point, so adjacent tiles leave a dark
 * cross along their shared borders that traces the grid perfectly. The coat buys
 * that back for a straight boundary where the clump ends — at this alpha a
 * smaller step than the grid line already drawn on every tile around it.
 */
const NEBULA_COAT_ALPHA = 0.18;

/**
 * A pointy-top hexagon inscribed in the tile — the Deep Field station.
 *
 * Drawn as an outline over a translucent body rather than a solid fill, so the
 * starfield shows through the emplacement. That is also why the body is baked
 * as neutral-at-low-alpha instead of a dark colour: `tint` multiplies, so a
 * baked dark interior would go muddy under a light tint, whereas alpha lets the
 * board itself supply the interior.
 */
function hexGeometry(pad: number) {
  return {
    cx: TILE_PX / 2,
    top: pad,
    bottom: TILE_PX - pad,
    left: TILE_PX * 0.15,
    right: TILE_PX * 0.85,
    yUpper: TILE_PX * 0.275,
    yLower: TILE_PX * 0.725,
  };
}

/**
 * Pin the bake to exactly one tile.
 *
 * `generateTexture` sizes from geometry bounds, and the station is inset on
 * every side — so without this the hex bakes to 30x36 and, drawn at the tile's
 * top-left, sits 5px left and 2px high of centre. Worse for tiers: pips extend
 * the bounds downward, so each tier would crop differently and a station would
 * visibly *jump* when upgraded.
 *
 * A zero-alpha full-tile rect fixes the frame at 40x40 for every tier, which
 * makes the sprite's origin the tile's origin and keeps the silhouette put.
 */
function pinToTile(g: Graphics): void {
  g.rect(0, 0, TILE_PX, TILE_PX).fill({ color: BAKE_NEUTRAL, alpha: 0 });
}

/**
 * The station at a given tier.
 *
 * Tier reads two ways at once, because one alone is not enough at 40px: a row
 * of pips gives the exact count, and a core that grows and gains a halo gives
 * the at-a-glance impression. Both are drawn in `BAKE_NEUTRAL` so the station's
 * tint carries them — brightness comes from *radius and alpha*, never from
 * colour, because `tint` multiplies and would erase a baked colour shift.
 */
function drawTower(g: Graphics, tier: number): void {
  const s = THEME.shape;
  pinToTile(g);

  const cx = TILE_PX / 2;
  const cy = TILE_PX / 2;
  const hub = TILE_PX * s.hubRatio * (1 + s.tierHubGrowth * (tier - 1));

  if (s.tower === 'roundRect') {
    const size = TILE_PX - s.towerPad * 2;
    g.roundRect(s.towerPad, s.towerPad, size, size, s.towerCorner)
      .fill({ color: BAKE_NEUTRAL, alpha: s.towerFillAlpha })
      .stroke({ width: s.strokeWidth, color: BAKE_NEUTRAL });
  } else {
    const { top, bottom, left, right, yUpper, yLower } = hexGeometry(s.towerPad);
    g.poly([cx, top, right, yUpper, right, yLower, cx, bottom, left, yLower, left, yUpper])
      .fill({ color: BAKE_NEUTRAL, alpha: s.towerFillAlpha })
      .stroke({ width: s.strokeWidth, color: BAKE_NEUTRAL });

    // Internal bracing — three chords through the centre. Cheap, and it is what
    // stops the hex reading as a flat plate at 40px.
    if (s.towerStrutAlpha > 0) {
      g.moveTo(cx, top)
        .lineTo(cx, bottom)
        .moveTo(left, yUpper)
        .lineTo(right, yLower)
        .moveTo(right, yUpper)
        .lineTo(left, yLower)
        .stroke({ width: 1, color: BAKE_NEUTRAL, alpha: s.towerStrutAlpha });
    }
  }

  // Halo under the core, so the core sits on top of its own glow.
  if (tier > 1 && s.tierGlowAlpha > 0) {
    g.circle(cx, cy, hub * s.tierGlowRatio).fill({
      color: BAKE_NEUTRAL,
      alpha: s.tierGlowAlpha * (tier - 1),
    });
  }
  g.circle(cx, cy, hub).fill(BAKE_NEUTRAL);

  drawTierPips(g, tier);
}

/**
 * A centred row of pips low on the station, one per tier.
 *
 * Placed at 0.795 of the tile so they sit inside the hex's lower taper — the
 * hex is ~17px wide there, which fits three pips at this spacing with margin.
 */
function drawTierPips(g: Graphics, tier: number): void {
  const s = THEME.shape;
  const r = TILE_PX * s.pipRadius;
  const gap = TILE_PX * s.pipSpacing;
  const y = TILE_PX * s.pipRowY;
  const x0 = TILE_PX / 2 - (gap * (tier - 1)) / 2;

  for (let i = 0; i < tier; i++) {
    g.circle(x0 + i * gap, y, r).fill(BAKE_NEUTRAL);
  }
}

export function createTextures(renderer: Renderer): Textures {
  const { board, shape } = THEME;

  // The creep texture is baked larger than the creep so the halo has somewhere
  // to live. The *core* stays at CREEP_BAKE_RADIUS, which is what worldView
  // scales against, so the glow spills outside the hitbox without enlarging it.
  const core = CREEP_BAKE_RADIUS * TILE_PX;
  const outer = core * Math.max(1, shape.glowRatio);

  return {
    creep: bake(renderer, (g) => {
      if (shape.glowAlpha > 0 && shape.glowRatio > 1) {
        g.circle(outer, outer, outer).fill({ color: BAKE_NEUTRAL, alpha: shape.glowAlpha });
      }
      g.circle(outer, outer, core - 1)
        .fill(BAKE_NEUTRAL)
        .stroke({ width: 2, color: shape.outline, alpha: shape.outlineAlpha });
    }),

    towers: Array.from({ length: BALANCE.upgrade.maxTier }, (_, i) =>
      bake(renderer, (g) => {
        drawTower(g, i + 1);
      }),
    ),

    projectile: bake(renderer, (g) => {
      const pr = PROJECTILE_RADIUS * TILE_PX;
      // A soft halo under a hard core: at this size a plain dot disappears
      // against the board, and the halo is what makes fire legible.
      g.circle(pr * 2, pr * 2, pr * shape.haloRatio).fill({
        color: BAKE_NEUTRAL,
        alpha: shape.haloAlpha,
      });
      g.circle(pr * 2, pr * 2, pr).fill(BAKE_NEUTRAL);
    }),

    ground: bake(renderer, flatTile(board.ground, board.gridLine, board.groundAlpha)),
    groundAlt: bake(renderer, flatTile(board.groundAlt, board.gridLine, board.groundAlpha)),
    path: bake(renderer, flatTile(board.path, board.pathEdge)),

    // The base sits at `groundAlpha` like open ground rather than staying
    // opaque. An opaque base would punch a starless rectangle out of the sky,
    // and a rectangular hole in a starfield is a far louder tile artefact than
    // the two-values-of-255 seam it would fix. The cloud is what occludes the
    // stars here, and it does it gradually, which is what a cloud should do.
    blocked: bake(renderer, (g) => {
      g.rect(0, 0, TILE_PX, TILE_PX).fill({ color: board.ground, alpha: board.groundAlpha });
      g.rect(0, 0, TILE_PX, TILE_PX).fill({ color: board.blocked, alpha: NEBULA_COAT_ALPHA });
      for (const [cx, cy, r] of NEBULA_PUFFS) {
        g.circle(cx * TILE_PX, cy * TILE_PX, r * TILE_PX).fill({
          color: board.blocked,
          alpha: NEBULA_ALPHA,
        });
      }
      for (const [cx, cy, r] of NEBULA_KNOTS) {
        g.circle(cx * TILE_PX, cy * TILE_PX, r * TILE_PX).fill({
          color: board.blockedEdge,
          alpha: NEBULA_KNOT_ALPHA,
        });
      }
    }),
  };
}
