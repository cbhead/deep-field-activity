import { BALANCE } from '../content/balance.ts';
import type { MapDef } from './types.ts';
import { tileCentre } from './util/grid.ts';
import type { World } from './world.ts';

/**
 * Post-hoc reporting. Pure queries over world state, in `sim/` rather than
 * `render/` because they are answers *about the game*, not about the screen —
 * the headless harness wants them too.
 *
 * Nothing here is called during a tick. Coverage is an O(routeTiles × towers)
 * scan run once when a screen needs it, not per frame.
 */

export interface Coverage {
  /** Route tiles with at least one tower able to reach their centre. */
  covered: number;
  total: number;
  /** The uncovered tiles, in route order. */
  gaps: { col: number; row: number }[];
  /**
   * Where the gaps sit along the route, 0 (spawn) to 1 (goal), averaged.
   * `null` when there are none. This is what lets the defeat screen say
   * "most of them on the last approach" instead of just counting.
   */
  meanPosition: number | null;
}

/** Every path tile, in route order, so gap positions mean something. */
function routeTiles(map: MapDef): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  const seen = new Set<number>();

  // Walked from the waypoint list rather than scanned row-major: the route's
  // own order is what makes "the last approach" expressible at all.
  for (let leg = 1; leg < map.waypoints.length; leg++) {
    const a = map.waypoints[leg - 1]!;
    const b = map.waypoints[leg]!;
    const steps = Math.round(Math.abs(b.x - a.x) + Math.abs(b.y - a.y));
    const sx = Math.sign(b.x - a.x);
    const sy = Math.sign(b.y - a.y);

    for (let i = 0; i <= steps; i++) {
      const col = Math.floor(a.x + sx * i);
      const row = Math.floor(a.y + sy * i);
      if (col < 0 || col >= map.cols || row < 0 || row >= map.rows) continue;
      const key = row * map.cols + col;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ col, row });
    }
  }
  return out;
}

export function coverage(w: World): Coverage {
  const tiles = routeTiles(w.map);
  const gaps: { col: number; row: number }[] = [];
  let positionSum = 0;

  tiles.forEach((tile, i) => {
    const c = tileCentre(tile.col, tile.row);
    for (const t of w.towers) {
      const dx = c.x - t.x;
      const dy = c.y - t.y;
      if (dx * dx + dy * dy <= t.range * t.range) return;
    }
    gaps.push(tile);
    positionSum += tiles.length > 1 ? i / (tiles.length - 1) : 0;
  });

  return {
    covered: tiles.length - gaps.length,
    total: tiles.length,
    gaps,
    meanPosition: gaps.length > 0 ? positionSum / gaps.length : null,
  };
}

/** Plain-English placement of the gaps, for the defeat screen. */
export function describeGaps(c: Coverage): string {
  if (c.gaps.length === 0) return 'The whole route was covered.';
  const where =
    c.meanPosition === null
      ? ''
      : c.meanPosition > 0.66
        ? ' — most of them on the last approach'
        : c.meanPosition < 0.33
          ? ' — most of them near the entry'
          : ' — most of them through the middle';
  return `${c.gaps.length} of ${c.total} route tiles had no station in reach${where}.`;
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

/**
 * Leaks dominate, time only breaks the tie at the top.
 *
 * Deliberately computed from things the sim already tracks rather than a new
 * score accumulator: a grade that can be recomputed from a finished world is
 * one that can never disagree with the numbers shown beside it.
 */
export function grade(w: World): Grade {
  if (w.phase !== 'won') return 'D';
  if (w.stats.leaks === 0 && w.time <= BALANCE.grade.perfectSeconds) return 'S';
  const kept = w.lives / BALANCE.startingLives;
  // 0.85 rather than 0.9 so that losing three of twenty still reads as an A —
  // a clean run with one bad wave should not drop two grades.
  if (kept >= 0.85) return 'A';
  if (kept >= 0.65) return 'B';
  if (kept >= 0.4) return 'C';
  return 'D';
}

/**
 * What the next grade up would take. `null` at S.
 *
 * Always names the strategy, not just the target: rushing is the one action
 * that moves both terms at once, and a player who has just finished a run is
 * exactly the person who will act on knowing that.
 */
export function nextGradeHint(w: World): string | null {
  if (grade(w) === 'S') return null;
  const clock = formatClock(BALANCE.grade.perfectSeconds);
  const gap =
    w.stats.leaks === 0
      ? `Hold all ${BALANCE.startingLives} lives and finish under ${clock}.`
      : `Let nothing through — you leaked ${w.stats.leaks} this run — and finish under ${clock}.`;
  return `${gap} Sending waves early does both at once.`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
