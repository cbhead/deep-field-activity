import { Container, Graphics, Sprite } from 'pixi.js';
import type { MapDef } from '../sim/types.ts';
import { mulberry32 } from '../sim/util/rng.ts';
import { TILE_PX, gridMaskAt } from './constants.ts';
import type { SectorField } from './theme.ts';
import type { Textures } from './textures.ts';

/**
 * The board. Built once and never touched again — nothing on this layer moves,
 * so it costs a few static batched draw calls per frame and no per-frame work
 * at all.
 *
 * That last property is why the starfield does not twinkle. Animating it was
 * considered and dropped: it would convert the one layer in the renderer with
 * zero running cost into a per-frame one, and it would put motion in the
 * background of a game where motion is how you spot a contact.
 */
export function buildMapLayer(map: MapDef, tex: Textures, field: SectorField): Container {
  const layer = new Container();

  // Beneath the tiles, which are baked translucent so it shows through.
  layer.addChild(buildStarfield(map.cols * TILE_PX, map.rows * TILE_PX, field));

  // Below the tiles, so a bloom can never dim ground the player has to build on.
  layer.addChild(halo(tex, map.goal.x, map.goal.y, PULSAR_REACH, field.goal, field.bloomAlpha));
  layer.addChild(
    halo(tex, map.spawn.x, map.spawn.y, PULSAR_REACH, field.spawn, field.bloomAlpha * SPAWN_SHARE),
  );

  layer.addChild(buildTileField(map, tex, field));

  // Above the tiles, because ground is translucent: a wash underneath would
  // arrive at `1 - groundAlpha` and be most of a layer you paid for and cannot
  // see. Above, it lands at the value it was authored at.
  layer.addChild(wash(tex, map, map.goal, WASH_REACH, field.lit, field.litAlpha));
  layer.addChild(wash(tex, map, map.spawn, HAZE_REACH, field.haze, field.hazeAlpha));

  layer.addChild(buildLattice(map, field));
  layer.addChild(buildEndMarkers(map, field));

  return layer;
}

/**
 * How far the pulsar's bloom reaches, in tiles.
 *
 * The objective used to be drawn inside one 40px tile — smaller than a station,
 * for the thing whose loss ends the run. When a leak happens the eye has to
 * already have been somewhere, and a detail in the corner is not somewhere.
 */
const PULSAR_REACH = 2.5;

/** Arrival is quiet, the core is loud. The spawn gets the same shape, dimmer. */
const SPAWN_SHARE = 0.25;

/** Wash extents as a fraction of the board, from the design's gradient stops. */
const WASH_REACH = { x: 0.64, y: 0.52 };
const HAZE_REACH = { x: 0.51, y: 0.45 };

/**
 * The shared falloff, stretched and tinted.
 *
 * A `Sprite` rather than a `Graphics` on purpose: these sit next to the tile
 * field in z, so they join its batch. Four Graphics here would cost four extra
 * draw calls *and* split the tile batch in two.
 */
function falloffSprite(
  tex: Textures,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tint: number,
  alpha: number,
): Sprite {
  const s = new Sprite(tex.falloff);
  s.anchor.set(0.5);
  s.setSize(rx * 2, ry * 2);
  s.position.set(cx, cy);
  s.tint = tint;
  s.alpha = alpha;
  return s;
}

/** A bloom centred on a tile, measured in tiles. */
const halo = (
  tex: Textures,
  tileX: number,
  tileY: number,
  reach: number,
  tint: number,
  alpha: number,
): Sprite =>
  falloffSprite(
    tex,
    tileX * TILE_PX,
    tileY * TILE_PX,
    reach * TILE_PX,
    reach * TILE_PX,
    tint,
    alpha,
  );

/**
 * A board-wide wash, centred on something that matters.
 *
 * Anchored to the real `goal` and `spawn` rather than to the fixed 84%/72% the
 * design's mock used, because the mock was drawn over Switchback and the other
 * two boards put their ends elsewhere. "Lit from the pulsar" is the intent; the
 * percentage was only ever one board's arithmetic for it.
 */
const wash = (
  tex: Textures,
  map: MapDef,
  at: { readonly x: number; readonly y: number },
  reach: { readonly x: number; readonly y: number },
  tint: number,
  alpha: number,
): Sprite =>
  falloffSprite(
    tex,
    at.x * TILE_PX,
    at.y * TILE_PX,
    map.cols * TILE_PX * reach.x,
    map.rows * TILE_PX * reach.y,
    tint,
    alpha,
  );

/**
 * Every tile, from one texture.
 *
 * The colour is `tint` and the translucency is `alpha`, both of which Pixi 8
 * packs into the vertex stream — so 390 tiles in four different colours are
 * still a single batched draw call, exactly as 390 identical ones were.
 *
 * The alpha is what lets the starfield through. Open ground sits short of
 * opaque so the sky reads as being *behind* the board rather than as one more
 * shade of tile; the route stays at 1 and occludes it, which is what makes the
 * road read as a structure laid over the void. That is a legibility win as much
 * as a visual one — a route you can trace without the field competing under it
 * is a route you can plan against.
 */
function buildTileField(map: MapDef, tex: Textures, field: SectorField): Container {
  const tileField = new Container();

  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const kind = map.tiles[row * map.cols + col]!;

      // Blocked keeps its own texture until the nebula moves into board space;
      // everything else is the shared square wearing a colour.
      const sprite = new Sprite(kind === 'blocked' ? tex.blocked : tex.tile);

      if (kind === 'path') {
        sprite.tint = field.path;
      } else if (kind !== 'blocked') {
        // Checker the buildable ground, so a tile is countable without a hard
        // grid line having to do the whole job.
        sprite.tint = (col + row) % 2 === 0 ? field.ground : field.groundAlt;
        sprite.alpha = field.groundAlpha;
      }

      sprite.position.set(col * TILE_PX, row * TILE_PX);
      tileField.addChild(sprite);
    }
  }

  return tileField;
}

/**
 * The grid, as one board-space object above the tiles.
 *
 * It used to be baked into each tile's own texture, which cost no extra nodes
 * but made the fade in `gridMaskAt` impossible: you cannot mask a texture that
 * is repeated across 390 sprites. Lifting it out buys the fade, and it also
 * collapsed three tile textures into one, because the stroke was the only thing
 * that distinguished them.
 *
 * Two consequences worth knowing:
 *
 *  - **It draws above the tiles, not below.** Open ground is translucent, so a
 *    lattice underneath would come through at `1 - groundAlpha` and lose most
 *    of its weight. Above, it lands at full strength, which is where placement
 *    legibility lives.
 *  - **One line per edge, where there used to be two.** Neighbouring tiles each
 *    stroked their own inset border, so a shared edge carried two adjacent 1px
 *    lines. `field.gridAlpha` is raised to compensate.
 */
function buildLattice(map: MapDef, field: SectorField): Graphics {
  const g = new Graphics();
  const boardW = map.cols * TILE_PX;
  const boardH = map.rows * TILE_PX;

  // Off-board reads as ground, so the board keeps its outer border.
  const kindAt = (col: number, row: number): string =>
    col < 0 || row < 0 || col >= map.cols || row >= map.rows
      ? 'ground'
      : map.tiles[row * map.cols + col]!;

  /**
   * An edge is drawn unless both sides are the same thing you would not want
   * subdivided: the route reads as one continuous road, and a nebula is gas
   * rather than a set of squares. Everything else — including the boundary
   * *between* road and ground — is a line the player uses.
   */
  const skip = (a: string, b: string): boolean =>
    (a === 'path' && b === 'path') || (a === 'blocked' && b === 'blocked');

  const stroke = (x0: number, y0: number, x1: number, y1: number): void => {
    const alpha = field.gridAlpha * gridMaskAt((x0 + x1) / 2, (y0 + y1) / 2, boardW, boardH);
    if (alpha <= 0) return;
    g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1, color: field.gridLine, alpha });
  };

  // Half-pixel offsets so a 1px stroke lands *on* a pixel rather than across
  // two — the same convention the baked tile border used.
  for (let col = 0; col <= map.cols; col++) {
    for (let row = 0; row < map.rows; row++) {
      if (skip(kindAt(col - 1, row), kindAt(col, row))) continue;
      const x = col * TILE_PX + 0.5;
      stroke(x, row * TILE_PX, x, (row + 1) * TILE_PX);
    }
  }

  for (let row = 0; row <= map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      if (skip(kindAt(col, row - 1), kindAt(col, row))) continue;
      const y = row * TILE_PX + 0.5;
      stroke(col * TILE_PX, y, (col + 1) * TILE_PX, y);
    }
  }

  return g;
}

/**
 * Across the whole 26x15 board, so roughly one star every two tiles. Dense
 * enough that no tile is conspicuously empty, sparse enough that the field never
 * resolves into texture the eye has to look past.
 */
const STAR_COUNT = 300;

/** Rarity is what makes the bright ones read as depth rather than as noise. */
const BRIGHT_STAR_CHANCE = 0.12;

/**
 * A literal, and deliberately not the match seed. The sky is set dressing, not
 * content: a board that reshuffled its stars on every reload would read as a
 * rendering fault rather than as space, and the board is the fixed thing a
 * player learns. Unseeded randomness is legal in the renderer — see the
 * boundary rules in eslint.config.js — but it is the wrong tool for anything
 * that outlives a frame.
 */
const SKY_SEED = 0x5c1f;

/**
 * The whole sky in one Graphics.
 *
 * Board-wide rather than baked into a tile: at any density that reads as a sky,
 * a 40px tile repeated 390 times shows its period immediately, and the eye finds
 * a lattice faster than it finds a star. One node rather than 300 for the same
 * reason the tiles are Sprites — 300 renderables walked every frame to draw a
 * thing that never changes is the cost this layer exists to avoid.
 */
function buildStarfield(width: number, height: number, field: SectorField): Graphics {
  const g = new Graphics();
  const rand = mulberry32(SKY_SEED);

  for (let i = 0; i < STAR_COUNT; i++) {
    const x = rand() * width;
    const y = rand() * height;
    const bright = rand() < BRIGHT_STAR_CHANCE;

    // The ceilings matter more than the exact numbers. Even the brightest star
    // has to sit below a station stroke, which sits below a contact: the sky is
    // the bottom of the contrast hierarchy, and anything up here that pulls the
    // eye is spending attention the pink creeps have already been promised.
    const radius = bright ? 1 + rand() * 0.6 : 0.45 + rand() * 0.65;
    const alpha = bright ? 0.55 + rand() * 0.25 : 0.16 + rand() * 0.34;

    g.circle(x, y, radius).fill({
      color: bright ? field.starBright : field.star,
      alpha,
    });
  }

  return g;
}

/**
 * The pulsar at the goal: radius **in tiles**, stroke width, alpha.
 *
 * Several rings at falling alpha rather than one at a constant one. That
 * falloff is the whole difference — a single even ring reads as a targeting
 * reticle borrowed from the HUD, while a stack that fades outward reads as
 * something emitting, which is what the thing the creeps are walking towards
 * ought to look like.
 *
 * These used to be fractions of a single tile, which made the game's entire
 * loss condition a 40px detail at the board's edge — smaller than any station,
 * and nowhere the eye would already be when a leak happened. Now they reach
 * `PULSAR_REACH`, and the outermost two are faint enough to read as bloom
 * rather than as more rings.
 */
const PULSAR_RINGS: readonly (readonly [number, number, number])[] = [
  [2.5, 1, 0.05],
  [1.85, 1, 0.08],
  [1.3, 1.2, 0.13],
  [0.85, 1.5, 0.2],
  [0.46, 2, 0.34],
];

/** Spawn chevron and goal pulsar. Two markers, so plain Graphics is fine here. */
function buildEndMarkers(map: MapDef, field: SectorField): Graphics {
  const g = new Graphics();

  // The spawn point sits one tile off-board; draw the chevron on the first
  // on-board tile instead, pointing the way creeps will travel.
  const entry = map.waypoints[0]!;
  const first = map.waypoints[1]!;
  const dx = Math.sign(first.x - entry.x);
  const dy = Math.sign(first.y - entry.y);
  const ax = first.x * TILE_PX;
  const ay = first.y * TILE_PX;
  const r = TILE_PX * 0.3;

  // Tip points along travel; the base is the perpendicular through the centre.
  g.moveTo(ax + dx * r, ay + dy * r)
    .lineTo(ax - dx * r + dy * r, ay - dy * r + dx * r)
    .lineTo(ax - dx * r - dy * r, ay - dy * r - dx * r)
    .fill({ color: field.spawn, alpha: 0.85 });

  const gx = map.goal.x * TILE_PX;
  const gy = map.goal.y * TILE_PX;
  const goal = field.goal;

  // The bloom is the `falloff` sprite under the tile field, not a disc here —
  // see the halos added in `buildMapLayer`. What is left in this Graphics is
  // only what has to sit *above* the board: the rings and the core.
  for (const [radius, width, alpha] of PULSAR_RINGS) {
    g.circle(gx, gy, TILE_PX * radius).stroke({ width, color: goal, alpha });
  }
  // Core: a soft shoulder under a hard centre, so the middle blooms instead of
  // sitting there as a flat dot the rings happen to be centred on. It grew with
  // the rings — a 0.08-tile dot inside a 2.5-tile ring stack would read as a
  // target the rings were aimed at rather than as the thing emitting them.
  g.circle(gx, gy, TILE_PX * 0.34).fill({ color: goal, alpha: 0.16 });
  g.circle(gx, gy, TILE_PX * 0.2).fill({ color: goal, alpha: 0.34 });
  g.circle(gx, gy, TILE_PX * 0.11).fill({ color: goal, alpha: 0.95 });

  return g;
}
