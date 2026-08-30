/**
 * Where each tile sits along the route, and how close it is to one.
 *
 * Pure arithmetic over `MapDef` — no Pixi, no DOM, no colour. It lives in
 * `render/` because only the renderer needs it, but it is kept free of the
 * renderer so `tools/check.ts` can import it and assert the things below that
 * are easy to get subtly wrong: that the route is fully covered, that distance
 * increases monotonically toward the goal, and that it reaches exactly 1.
 *
 * The point of all of it is one sentence from the design: *a flat corridor says
 * where contacts walk and nothing else — not which way they travel, not how
 * close to the core they are. The most information-dense object on the board
 * carries one bit.*
 */
import type { MapDef } from '../sim/types.ts';

/** Not on the route. Distinguishable from "at the very start", which is 0. */
export const OFF_ROUTE = -1;

/**
 * Normalised distance along the route for every tile, `OFF_ROUTE` elsewhere.
 *
 * Walks the waypoint list a tile at a time, exactly as `parseMap` built it, so
 * the two cannot disagree about what the road is. `map.pathLength` counts the
 * same steps, so the value at the goal lands on 1 with no fudge factor.
 *
 * **First visit wins.** None of the three shipped boards crosses itself, but a
 * future one might, and keeping the minimum stops a crossing tile from being
 * brighter than both of its neighbours — which would read as a landmark that
 * is not there.
 */
export function routeDistance(map: MapDef): Float32Array {
  const out = new Float32Array(map.cols * map.rows).fill(OFF_ROUTE);
  const wp = map.waypoints;
  if (wp.length === 0) return out;

  let travelled = 0;
  let x = Math.floor(wp[0]!.x);
  let y = Math.floor(wp[0]!.y);

  const mark = (): void => {
    if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return;
    const i = y * map.cols + x;
    if (out[i] === OFF_ROUTE) out[i] = travelled / map.pathLength;
  };

  mark();
  for (let i = 1; i < wp.length; i++) {
    const tx = Math.floor(wp[i]!.x);
    const ty = Math.floor(wp[i]!.y);
    const dx = Math.sign(tx - x);
    const dy = Math.sign(ty - y);
    const steps = Math.abs(tx - x) + Math.abs(ty - y);

    for (let s = 0; s < steps; s++) {
      x += dx;
      y += dy;
      travelled++;
      mark();
    }
  }

  return out;
}

/**
 * How many tiles away from the road each tile is, capped at `rings`.
 *
 * A breadth-first sweep seeded from every route tile at once, which is what
 * makes it a *distance to the road* rather than a distance to one point on it.
 * Route tiles are ring 0; anything past `rings` is `rings + 1` and gets no
 * spill.
 *
 * The spill exists so the road lights what it passes rather than sitting on the
 * board like a decal — but it is folded into the neighbouring tile's own tint
 * rather than drawn as extra sprites, so it costs nothing at all. See
 * `buildTileField`.
 */
export function routeSpill(map: MapDef, dist: Float32Array, rings: number): Uint8Array {
  const out = new Uint8Array(map.cols * map.rows).fill(rings + 1);
  let frontier: number[] = [];

  for (let i = 0; i < dist.length; i++) {
    if (dist[i] !== OFF_ROUTE) {
      out[i] = 0;
      frontier.push(i);
    }
  }

  for (let ring = 1; ring <= rings && frontier.length > 0; ring++) {
    const next: number[] = [];
    for (const i of frontier) {
      const col = i % map.cols;
      const row = (i / map.cols) | 0;

      for (const [dc, dr] of NEIGHBOURS) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) continue;

        const j = r * map.cols + c;
        if (out[j]! <= ring) continue;
        out[j] = ring;
        next.push(j);
      }
    }
    frontier = next;
  }

  return out;
}

/** Four-connected, so the spill turns corners the way the road does. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** How far the road lights the ground beside it, and by how much at each step. */
export const SPILL_RINGS = 2;
export const SPILL_FALLOFF: readonly number[] = [1, 0.4, 0.14];
