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

/**
 * A whole build strategy: how tiles are ranked, and whether the best ones are
 * held back for stations that have not unlocked yet.
 *
 * **Reservation is a strategy, not a rule**, and that is a measured conclusion
 * rather than a stylistic one. Holding tiles back is plainly right on some
 * boards and plainly wrong on others: at Blackout it moves Sluice from 0/5 to
 * 5/5 and Braid from 5/5 to 1/5. Applying it globally would have traded one
 * board's bad reading for another's, which is not a fix.
 *
 * So it joins `cluster` and `spread` on the same terms as the header describes
 * them — crude strategies that bracket what a player might do, reported
 * together, with which one wins being itself a fact about the board. A player
 * on Sluice saves a tile for the Filament; a player on Braid, where the early
 * waves already bite through a fourteen-life reserve, cannot afford to.
 */
export interface Strategy {
  readonly how: Ranking;
  /** Hold the best still-free tiles for stations yet to unlock. */
  readonly hold: boolean;
}

/** The four crude strategies, in a stable order so reports are comparable. */
export const STRATEGIES: readonly Strategy[] = [
  { how: 'cluster', hold: false },
  { how: 'spread', hold: false },
  { how: 'cluster', hold: true },
  { how: 'spread', hold: true },
];

export const strategyName = (s: Strategy): string => `${s.how}${s.hold ? '+hold' : ''}`;

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

/**
 * Which tile the next station takes, as an index into `spots`, or `-1` when
 * every tile is spoken for.
 *
 * **An attacking station takes the next unused tile in rank order.** That is
 * what both harnesses have always done and still do for five of the six.
 *
 * **A support station cannot be placed that way.** Overclock's entire effect is
 * on the stations inside its reach, so handing it whatever tile the build cycle
 * happened to reach measures where the cursor landed rather than what the
 * station is worth — and it would usually measure zero. A zero produced that way
 * is a fact about this harness, not about the station, and it is exactly the
 * kind of number this module exists to stop the two tools disagreeing about.
 * Support takes the highest-ranked unused tile with the most already-built
 * stations in reach instead.
 *
 * Ties break by rank: `spots` is already ordered and the scan uses a strict `>`,
 * so the first and best-ranked candidate wins. Deterministic, which both tools
 * depend on.
 *
 * Still crude, like the two rankings above, and in one way worth naming: it
 * counts a fed Lance and a fed Nova the same when the buff is worth roughly
 * three times more to the Nova. So it is a *floor* on what support measures, not
 * an estimate of it — a real player choosing which stations to feed does better
 * than this, and the sweep's numbers should be read as the pessimistic end.
 *
 * **`reserve` holds the best still-free tiles back for stations that have not
 * unlocked yet**, and it exists because its absence was measured. The builder
 * fills tiles in rank order with whatever is available *now*, so Arc (wave 2),
 * Filament (4) and Overclock (6) could only ever have what was left over. That
 * is not what a player does — a player knows what is coming and saves a good
 * tile for it.
 *
 * This was invisible until the locked-station stall was fixed, because the stall
 * had been reserving tiles by accident: it bought three towers, idled, and
 * handed the 4th and 5th ranked tiles to the two late unlocks. Removing the
 * stall removed the reservation with it, and on Sluice — two lanes at 21t and
 * 51t, where placement is most of the game — that alone moved Standard from
 * 5/5 to 4/5 and Blackout from 5/5 to 0/5. Neither reading was about the
 * content; both were about which tiles the late stations got.
 *
 * Support is excluded from the count on purpose. `spotFor` does not place
 * support by rank at all, so holding a *rank-premium* tile for an Overclock
 * would reserve something it has no use for.
 *
 * Reservation never stalls a build: if every unreserved tile is taken, the held
 * ones are released rather than the builder buying nothing.
 */
export function spotFor(
  spots: readonly (readonly [number, number])[],
  taken: ReadonlySet<number>,
  support: {
    readonly range: number;
    readonly towers: readonly { readonly x: number; readonly y: number }[];
  } | null,
  reserve = 0,
): number {
  // The top `reserve` still-free tiles, held for stations yet to unlock.
  const held = new Set<number>();
  for (let i = 0; i < spots.length && held.size < reserve; i++) {
    if (!taken.has(i)) held.add(i);
  }

  if (support === null) {
    for (let i = 0; i < spots.length; i++) if (!taken.has(i) && !held.has(i)) return i;
    // Nothing unreserved left. Release the held tiles rather than stalling —
    // a reservation that stops the build entirely measures far worse than one
    // that is simply given up on.
    for (let i = 0; i < spots.length; i++) if (!taken.has(i)) return i;
    return -1;
  }

  const r2 = support.range * support.range;
  let best = -1;
  let bestFed = -1;

  for (let i = 0; i < spots.length; i++) {
    if (taken.has(i) || held.has(i)) continue;
    // Tile centres, matching `tileCentre` — a station's `x`/`y` is the centre,
    // and comparing a corner against a centre would be off by half a tile in
    // both axes, which at this range is most of a tile of error.
    const cx = spots[i]![0] + 0.5;
    const cy = spots[i]![1] + 0.5;

    let fed = 0;
    for (const t of support.towers) {
      const dx = t.x - cx;
      const dy = t.y - cy;
      if (dx * dx + dy * dy <= r2) fed++;
    }

    if (fed > bestFed) {
      bestFed = fed;
      best = i;
    }
  }

  // Same release as the gun path: a reservation must never be the reason a
  // station goes unbuilt.
  if (best < 0) {
    for (let i = 0; i < spots.length; i++) if (!taken.has(i)) return i;
  }
  return best;
}
