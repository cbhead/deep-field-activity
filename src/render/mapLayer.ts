import { Container, Graphics, Sprite } from 'pixi.js';
import type { MapDef } from '../sim/types.ts';
import { mulberry32 } from '../sim/util/rng.ts';
import { TILE_PX } from './constants.ts';
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

  const tileField = new Container();
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const kind = map.tiles[row * map.cols + col]!;
      const texture =
        kind === 'path'
          ? tex.path
          : kind === 'blocked'
            ? tex.blocked
            : // Checker the buildable ground so the grid is readable without a
              // hard line grid over the whole board.
              (col + row) % 2 === 0
              ? tex.ground
              : tex.groundAlt;

      const sprite = new Sprite(texture);
      sprite.position.set(col * TILE_PX, row * TILE_PX);
      tileField.addChild(sprite);
    }
  }
  layer.addChild(tileField);
  layer.addChild(buildEndMarkers(map, field));

  return layer;
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
 * The pulsar at the goal: radius as a fraction of the tile, stroke width, alpha.
 *
 * Several rings at falling alpha rather than one at a constant one. That
 * falloff is the whole difference — a single even ring reads as a targeting
 * reticle borrowed from the HUD, while a stack that fades outward reads as
 * something emitting, which is what the thing the creeps are walking towards
 * ought to look like.
 */
const PULSAR_RINGS: readonly (readonly [number, number, number])[] = [
  [0.46, 1, 0.12],
  [0.36, 1.4, 0.22],
  [0.26, 2, 0.4],
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

  // The halo is a flat low-alpha disc, not a blur. A filter would buy a render
  // target and a second pass for a marker that is drawn once and never changes,
  // and at this radius the difference is not visible anyway.
  g.circle(gx, gy, TILE_PX * 0.46).fill({ color: goal, alpha: 0.05 });
  for (const [radius, width, alpha] of PULSAR_RINGS) {
    g.circle(gx, gy, TILE_PX * radius).stroke({ width, color: goal, alpha });
  }
  // Core: a soft shoulder under a hard centre, so the middle blooms instead of
  // sitting there as a flat dot the rings happen to be centred on.
  g.circle(gx, gy, TILE_PX * 0.15).fill({ color: goal, alpha: 0.28 });
  g.circle(gx, gy, TILE_PX * 0.08).fill({ color: goal, alpha: 0.95 });

  return g;
}
