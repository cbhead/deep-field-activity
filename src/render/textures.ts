import { Graphics, type Renderer, type Texture } from 'pixi.js';
import { TILE_PX, COLORS } from './constants.ts';

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
}

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
  (fill: number, edge?: number) =>
  (g: Graphics): void => {
    g.rect(0, 0, TILE_PX, TILE_PX).fill(fill);
    if (edge !== undefined) {
      // Inset by half a pixel so the 1px stroke lands on the pixel, not across two.
      g.rect(0.5, 0.5, TILE_PX - 1, TILE_PX - 1).stroke({ width: 1, color: edge, alpha: 0.6 });
    }
  };

export function createTextures(renderer: Renderer): Textures {
  const r = CREEP_BAKE_RADIUS * TILE_PX;
  return {
    creep: bake(renderer, (g) => {
      g.circle(r, r, r - 1)
        .fill(0xffffff)
        .stroke({ width: 2, color: 0x000000, alpha: 0.35 });
    }),
    ground: bake(renderer, flatTile(COLORS.ground, COLORS.gridLine)),
    groundAlt: bake(renderer, flatTile(COLORS.groundAlt, COLORS.gridLine)),
    path: bake(renderer, flatTile(COLORS.path)),
    blocked: bake(
      renderer,
      (g) => {
        g.rect(0, 0, TILE_PX, TILE_PX).fill(COLORS.ground);
        g.roundRect(3, 3, TILE_PX - 6, TILE_PX - 6, 5)
          .fill(COLORS.blocked)
          .stroke({ width: 1, color: COLORS.blockedEdge });
      },
    ),
  };
}
