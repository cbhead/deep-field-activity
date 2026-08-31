import { BALANCE } from '../content/balance.ts';
import { ENEMIES, type EnemyId } from '../content/enemies.ts';
import type { MapDef } from './types.ts';
import { tileCentre } from './util/grid.ts';
import { planWave } from './wavePlan.ts';
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

/** One lane's coverage, named, so a board with four of them can be read. */
export interface LaneCoverage extends Coverage {
  readonly id: string;
}

/** Every path tile on one lane, in walking order, so gap positions mean something. */
function routeTiles(map: MapDef, route: number): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  const seen = new Set<number>();
  const waypoints = map.routes[route]!.waypoints;

  // Walked from the waypoint list rather than scanned row-major: the lane's
  // own order is what makes "the last approach" expressible at all.
  for (let leg = 1; leg < waypoints.length; leg++) {
    const a = waypoints[leg - 1]!;
    const b = waypoints[leg]!;
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

function coverLane(w: World, route: number): LaneCoverage {
  const tiles = routeTiles(w.map, route);
  const gaps: { col: number; row: number }[] = [];
  let positionSum = 0;

  tiles.forEach((tile, i) => {
    const c = tileCentre(tile.col, tile.row);
    for (const t of w.towers) {
      const dx = c.x - t.x;
      const dy = c.y - t.y;
      if (dx * dx + dy * dy <= t.stats.range * t.stats.range) return;
    }
    gaps.push(tile);
    positionSum += tiles.length > 1 ? i / (tiles.length - 1) : 0;
  });

  return {
    id: w.map.routes[route]!.id,
    covered: tiles.length - gaps.length,
    total: tiles.length,
    gaps,
    meanPosition: gaps.length > 0 ? positionSum / gaps.length : null,
  };
}

/**
 * Coverage per lane.
 *
 * Per lane rather than averaged, because a single figure across four lanes is
 * worse than useless: three lanes sealed and one wide open averages to
 * "mostly covered", which is the exact opposite of what happened.
 */
export const laneCoverage = (w: World): LaneCoverage[] =>
  w.map.routes.map((_, i) => coverLane(w, i));

/**
 * Whole-board coverage, counting each tile once however many lanes cross it.
 *
 * The union, not the sum. A merge tile guarded by one station is one tile
 * guarded, and adding it up per lane would let a board with a long shared
 * trunk report more road than it has.
 */
export function coverage(w: World): Coverage {
  const seen = new Set<number>();
  const gapKeys = new Set<number>();
  const gaps: { col: number; row: number }[] = [];
  let total = 0;
  let positionSum = 0;

  for (let route = 0; route < w.map.routes.length; route++) {
    const tiles = routeTiles(w.map, route);
    tiles.forEach((tile, i) => {
      const key = tile.row * w.map.cols + tile.col;
      const fresh = !seen.has(key);
      if (fresh) {
        seen.add(key);
        total++;
      }

      const c = tileCentre(tile.col, tile.row);
      for (const t of w.towers) {
        const dx = c.x - t.x;
        const dy = c.y - t.y;
        if (dx * dx + dy * dy <= t.stats.range * t.stats.range) return;
      }
      if (gapKeys.has(key)) return;
      gapKeys.add(key);
      gaps.push(tile);
      // Position is taken from the first lane that walks the tile, which is the
      // only reading available for a tile two lanes reach at different points.
      positionSum += tiles.length > 1 ? i / (tiles.length - 1) : 0;
    });
  }

  return {
    covered: total - gaps.length,
    total,
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

/**
 * The per-lane breakdown, for boards that have more than one lane.
 *
 * Empty string on a single-lane board: `describeGaps` has already said
 * everything there is to say, and "main: 4 of 44" beneath it would be the same
 * sentence twice.
 */
export function describeLanes(lanes: readonly LaneCoverage[]): string {
  if (lanes.length < 2) return '';
  return lanes.map((l) => `${l.id} ${l.covered}/${l.total}`).join(' · ');
}

export interface ArmourReference {
  defId: EnemyId;
  armor: number;
  /** True when nothing armoured is alive and this came from the inbound wave. */
  inbound: boolean;
}

/**
 * The toughest-armoured contact the player is currently up against.
 *
 * Exists so the inspector can price a station against something real rather
 * than against a fixed reference that is meaningless for the first six waves.
 *
 * The inbound fallback is the deliberate part. "Alive right now" alone goes
 * blank for the whole intermission — which is precisely when stations get
 * upgraded, so the readout would vanish exactly when it is needed. Falling back
 * to the next wave's plan keeps the answer to "what am I about to face"
 * available at the moment the money is spent.
 */
export function toughestArmour(w: World): ArmourReference | null {
  let best: ArmourReference | null = null;

  for (const c of w.creeps) {
    if (c.dead) continue;
    const armor = ENEMIES[c.defId].armor;
    if (armor > 0 && (best === null || armor > best.armor)) {
      best = { defId: c.defId, armor, inbound: false };
    }
  }
  if (best !== null) return best;

  for (const spawn of planWave(w.seed, w.wave.index, w.rules, w.map.routes)) {
    const armor = ENEMIES[spawn.enemy].armor;
    if (armor > 0 && (best === null || armor > best.armor)) {
      best = { defId: spawn.enemy, armor, inbound: true };
    }
  }
  return best;
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
  const kept = w.lives / w.rules.startingLives;
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
      ? `Hold all ${w.rules.startingLives} lives and finish under ${clock}.`
      : `Let nothing through — you leaked ${w.stats.leaks} this run — and finish under ${clock}.`;
  return `${gap} Sending waves early does both at once.`;
}

/**
 * A damage figure, for anywhere a player reads one.
 *
 * Rounding to whole numbers was fine until armour: a hit floored to 0.45 renders
 * as `0`, which tells the player their station did *nothing* when in fact it did
 * the least the floor allows. That is the same lie the inspector used to tell,
 * and it must not be told twice — so the floating combat numbers and the
 * inspector share this rather than each rounding their own way.
 */
export const formatDamage = (n: number): string =>
  n < 10 ? n.toFixed(n < 1 ? 2 : 1) : String(Math.round(n));

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
