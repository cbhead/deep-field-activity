import { Graphics, type Renderer, type Texture } from 'pixi.js';
import { TILE_PX } from './constants.ts';
import { BAKE_NEUTRAL, THEME } from './theme.ts';

/**
 * Every repeated visual is baked into a GPU texture once, then instanced as
 * cheap batched Sprites.
 *
 * A live Graphics object re-tessellates its geometry and breaks the sprite
 * batch; 390 of them for the board — let alone hundreds of creeps later — is
 * the difference between one draw call and hundreds. This is also why "colored
 * shapes, no art" costs nothing architecturally: swapping in real sprites later
 * only changes what this file returns.
 */
export interface Textures {
  ground: Texture;
  groundAlt: Texture;
  path: Texture;
  blocked: Texture;
  /**
   * Baked white so it can be `tint`ed per enemy type — tinting is free on the
   * GPU and keeps every creep on one texture, hence one draw call.
   */
  creep: Texture;
  /** Also baked white and tinted per tower type. Doubles as the build ghost. */
  tower: Texture;
  /** Tinted by the firing tower, so you can read which tower landed a shot. */
  projectile: Texture;
}

/** Radius the projectile texture is baked at, in tiles. */
export const PROJECTILE_RADIUS = 0.11;

/** Radius the creep texture is baked at, in tiles. Sprites scale from this. */
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
 */
const flatTile =
  (fill: number, edge: number | null) =>
  (g: Graphics): void => {
    g.rect(0, 0, TILE_PX, TILE_PX).fill(fill);
    if (edge !== null) {
      // Inset by half a pixel so the 1px stroke lands on the pixel, not across two.
      g.rect(0.5, 0.5, TILE_PX - 1, TILE_PX - 1).stroke({ width: 1, color: edge, alpha: 0.6 });
    }
  };

export function createTextures(renderer: Renderer): Textures {
  const r = CREEP_BAKE_RADIUS * TILE_PX;
  const { board, shape } = THEME;

  return {
    creep: bake(renderer, (g) => {
      g.circle(r, r, r - 1)
        .fill(BAKE_NEUTRAL)
        .stroke({ width: shape.strokeWidth, color: shape.outline, alpha: shape.outlineAlpha });
    }),

    // A plinth with a barrel hub, so a tower reads as built rather than as a
    // coloured tile. Drawn neutral; the tint carries the type.
    tower: bake(renderer, (g) => {
      const size = TILE_PX - shape.towerPad * 2;
      g.roundRect(shape.towerPad, shape.towerPad, size, size, shape.towerCorner)
        .fill({ color: BAKE_NEUTRAL, alpha: shape.towerFillAlpha })
        .stroke({ width: shape.strokeWidth, color: BAKE_NEUTRAL });
      g.circle(TILE_PX / 2, TILE_PX / 2, TILE_PX * shape.hubRatio).fill(BAKE_NEUTRAL);
    }),

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
    ground: bake(renderer, flatTile(board.ground, board.gridLine)),
    groundAlt: bake(renderer, flatTile(board.groundAlt, board.gridLine)),
    path: bake(renderer, flatTile(board.path, board.pathEdge)),
    blocked: bake(
      renderer,
      (g) => {
        g.rect(0, 0, TILE_PX, TILE_PX).fill(board.ground);
        g.roundRect(3, 3, TILE_PX - 6, TILE_PX - 6, 5)
          .fill(board.blocked)
          .stroke({ width: 1, color: board.blockedEdge });
      },
    ),
  };
}
