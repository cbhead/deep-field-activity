import { Container, Graphics, Sprite } from 'pixi.js';
import type { MapDef } from '../sim/types.ts';
import { TILE_PX } from './constants.ts';
import { THEME } from './theme.ts';
import type { Textures } from './textures.ts';

/**
 * The board. Built once and never touched again — nothing on this layer moves,
 * so it costs one batched draw call per frame and no per-frame work at all.
 */
export function buildMapLayer(map: MapDef, tex: Textures): Container {
  const layer = new Container();

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
  layer.addChild(buildEndMarkers(map));

  return layer;
}

/** Spawn arrow and goal ring. Two nodes, so plain Graphics is fine here. */
function buildEndMarkers(map: MapDef): Graphics {
  const g = new Graphics();

  // The spawn point sits one tile off-board; draw the arrow on the first
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
    .fill({ color: THEME.board.spawn, alpha: 0.85 });

  const gx = map.goal.x * TILE_PX;
  const gy = map.goal.y * TILE_PX;
  g.circle(gx, gy, TILE_PX * 0.34).stroke({ width: 3, color: THEME.board.goal, alpha: 0.9 });
  g.circle(gx, gy, TILE_PX * 0.14).fill({ color: THEME.board.goal, alpha: 0.6 });

  return g;
}
