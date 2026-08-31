/**
 * Where a headless build puts its stations, and in what order.
 *
 * One module because there was briefly more than one copy. `campaign.ts` and
 * `sweep.ts` each grew their own, the greedy tie-breaks drifted apart, and the
 * two tools then disagreed about whether a board was winnable — Sluice cleared
 * 5/5 under one and 0/5 under the other, on identical content. A balance figure
 * that depends on which harness printed it is not a balance figure, so the
 * orderings live here and both tools import them.
 *
 * Neither is a player. They are two crude strategies that bracket what a player
 * might do, and reporting both is the point: which one wins is itself a fact
 * about a board.
 */
import type { MapDef } from '../src/sim/types.ts';

export type Ranking = 'cluster' | 'spread';

/** Ground tiles and the road each can reach, computed once per (board, range). */
function reachable(map: MapDef, range: number): { col: number; row: number; reach: number[] }[] {
  const road: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === 'path') road.push(i);

  const out: { col: number; row: number; reach: number[] }[] = [];
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      if (map.tiles[row * map.cols + col] !== 'ground') continue;
      const reach = road.filter((i) => {
        const dx = (i % map.cols) - col;
        const dy = ((i / map.cols) | 0) - row;
        return dx * dx + dy * dy <= range * range;
      });
      out.push({ col, row, reach });
    }
  }
  return out;
}

const cache = new Map<string, [number, number][]>();

/**
 * **cluster** — every tile scored against the whole road, sorted once.
 *
 * Packs the busiest stretch, which on a single-lane board is close to right:
 * concentration buys the density that kills a Monolith, and a thin film kills
 * nothing. The three original boards were tuned against this.
 *
 * **spread** — a greedy set cover; each pick reaches the most road *nothing has
 * covered yet*.
 *
 * On lanes of unequal length `cluster` is not merely crude but backwards, since
 * a tile beside a 50-tile coil always outscores one beside a 20-tile chute — it
 * put nineteen stations on Sluice at 73% coverage of one lane and 38% of the
 * other. `spread` shuts the widest gap instead, and wins on the boards where
 * covering everything matters more than covering anything deeply.
 *
 * Ties break by total reach, then by position, so the order is deterministic
 * and a tie prefers the tile that will still be useful once the gap is shut.
 */
export function buildOrder(map: MapDef, range: number, how: Ranking): [number, number][] {
  const key = `${map.id}:${Math.round(range * 10)}:${how}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const ground = reachable(map, range);
  let out: [number, number][];

  if (how === 'cluster') {
    out = ground
      .slice()
      .sort((a, b) => b.reach.length - a.reach.length || a.col - b.col || a.row - b.row)
      .map((s) => [s.col, s.row] as [number, number]);
  } else {
    out = [];
    const covered = new Set<number>();
    const taken = new Set<number>();

    for (;;) {
      let best = -1;
      let bestGain = -1;
      for (let i = 0; i < ground.length; i++) {
        if (taken.has(i)) continue;
        let gain = 0;
        for (const t of ground[i]!.reach) if (!covered.has(t)) gain++;
        if (gain > bestGain || (gain === bestGain && best >= 0 && ground[i]!.reach.length > ground[best]!.reach.length)) {
          best = i;
          bestGain = gain;
        }
      }
      if (best < 0 || bestGain <= 0) break;
      taken.add(best);
      out.push([ground[best]!.col, ground[best]!.row]);
      for (const t of ground[best]!.reach) covered.add(t);
    }

    // Once the road is covered, doubling up on the busiest stretch is what a
    // player with money left over would do.
    for (const { s } of ground
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => !taken.has(i))
      .sort((a, b) => b.s.reach.length - a.s.reach.length || a.s.col - b.s.col || a.s.row - b.s.row)) {
      out.push([s.col, s.row]);
    }
  }

  cache.set(key, out);
  return out;
}
