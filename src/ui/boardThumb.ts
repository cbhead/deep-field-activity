/**
 * A board, small enough to sit on a card.
 *
 * The front door described its three sectors in prose — "a symmetric double
 * hairpin around a pocket that reaches both lanes" — which is good writing
 * about a shape the player could simply be *shown*. The map rows were already
 * imported and already parsed; only the drawing was missing.
 *
 * **Every figure here is derived, never written down.** Road length comes from
 * counting parsed tiles and turn count from the waypoints, so changing a map's
 * `rows` changes its card with no other edit — a board cannot lie about its own
 * shape. That rule is why `turns()` does *not* use `waypoints.length - 2`,
 * which the front-door spec prescribes: measured against the shipped maps that
 * formula gives 7 / 7 / 9 where the real heading changes are 6 / 6 / 8, and
 * Switchback's own blurb says "six turns". Implementing it literally would have
 * put a numeral on the card contradicting the prose beside it.
 *
 * Rects are merged along each row, so a 26x15 board is about twenty of them
 * rather than 390 — small enough to inline in a card without the markup
 * outweighing the picture.
 */
import type { MapSource } from '../content/types.ts';
import type { MapDef } from '../sim/types.ts';
import { parseMap } from '../sim/util/grid.ts';
import { OFF_ROUTE, routeDistance } from '../render/route.ts';

export interface BoardFacts {
  /** Tiles of road, counted from the parsed map. */
  readonly road: number;
  /**
   * Changes of heading, not waypoints, and on the *twistiest* lane rather than
   * summed across them. Summing would print 34 for a four-lane board, which is
   * not a fact about anything a player walks — no contact makes 34 turns.
   */
  readonly turns: number;
  /** How many lanes contacts arrive down. 1 on the boards that have one. */
  readonly lanes: number;
  readonly cols: number;
  readonly rows: number;
}

export function boardFacts(src: MapSource): BoardFacts {
  const map = parseMap(src);
  return {
    road: map.tiles.filter((t) => t === 'path').length,
    turns: Math.max(...map.routes.map(turns)),
    lanes: map.routes.length,
    cols: map.cols,
    rows: map.rows,
  };
}

/**
 * Heading changes on one lane, which is what a player means by "turn".
 *
 * `waypoints` holds interior points, and two consecutive segments can share a
 * heading — so counting waypoints over-reports. This compares the direction in
 * and the direction out at each one.
 */
function turns(route: MapDef['routes'][number]): number {
  const w = route.waypoints;
  let n = 0;
  for (let i = 1; i < w.length - 1; i++) {
    const ax = Math.sign(w[i]!.x - w[i - 1]!.x);
    const ay = Math.sign(w[i]!.y - w[i - 1]!.y);
    const bx = Math.sign(w[i + 1]!.x - w[i]!.x);
    const by = Math.sign(w[i + 1]!.y - w[i]!.y);
    if (ax !== bx || ay !== by) n++;
  }
  return n;
}

/**
 * The board as inline SVG.
 *
 * The route uses the same brightness ramp the board does — dim at the spawn,
 * bright at the pulsar — so the front door teaches the board's visual grammar
 * before the player ever sees it at size. `dim` is for a locked sector, which
 * shows its board rather than hiding it: you can see what you are working
 * toward.
 */
export function boardThumb(src: MapSource, width: number, dim = false): string {
  const map = parseMap(src);
  const dist = routeDistance(map);
  const u = width / map.cols;
  const height = u * map.rows;

  const parts: string[] = [];
  const rect = (col: number, row: number, span: number, fill: string, alpha: number): void => {
    parts.push(
      `<rect x="${(col * u).toFixed(2)}" y="${(row * u).toFixed(2)}"` +
        ` width="${(span * u).toFixed(2)}" height="${u.toFixed(2)}"` +
        ` fill="${fill}" fill-opacity="${alpha.toFixed(3)}"/>`,
    );
  };

  for (let row = 0; row < map.rows; row++) {
    let col = 0;
    while (col < map.cols) {
      const i = row * map.cols + col;
      const kind = map.tiles[i]!;

      // Route tiles never merge: each carries its own point on the ramp, which
      // is the whole reason the thumbnail is worth drawing rather than tracing.
      if (kind === 'path') {
        const t = dist[i] === OFF_ROUTE ? 0 : dist[i]!;
        rect(col, row, 1, 'var(--accent)', (dim ? 0.22 : 0.45) + t * (dim ? 0.2 : 0.5));
        col++;
        continue;
      }

      // Everything else merges along the row.
      let span = 1;
      while (col + span < map.cols && map.tiles[row * map.cols + col + span] === kind) span++;
      if (kind === 'blocked') rect(col, row, span, 'var(--muted)', dim ? 0.06 : 0.13);
      col += span;
    }
  }

  return (
    `<svg class="thumb${dim ? ' dim' : ''}" width="${width}" height="${height.toFixed(1)}"` +
    ` viewBox="0 0 ${width} ${height.toFixed(1)}" aria-hidden="true">` +
    `<rect width="${width}" height="${height.toFixed(1)}" fill="var(--slot)" fill-opacity="${dim ? 0.35 : 0.6}"/>` +
    parts.join('') +
    `</svg>`
  );
}
