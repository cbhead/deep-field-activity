import type { MapSource, TileCoord } from '../../content/types.ts';
import type { MapDef, MapRoute, TileKind, Vec2 } from '../types.ts';

const LEGEND: Readonly<Record<string, TileKind>> = {
  '.': 'ground',
  '#': 'path',
  x: 'blocked',
  S: 'path',
  E: 'path',
};

export const tileIndex = (map: MapDef, col: number, row: number): number => row * map.cols + col;

export const inBounds = (map: MapDef, col: number, row: number): boolean =>
  col >= 0 && col < map.cols && row >= 0 && row < map.rows;

export function tileAt(map: MapDef, col: number, row: number): TileKind | undefined {
  return inBounds(map, col, row) ? map.tiles[tileIndex(map, col, row)] : undefined;
}

/** Terrain check only — occupancy by an existing tower is the build system's job. */
export const isBuildableTile = (map: MapDef, col: number, row: number): boolean =>
  tileAt(map, col, row) === 'ground';

/** Sim positions address tile centres, so column 0 spans x ∈ [0, 1) and centres at 0.5. */
export const tileCentre = (col: number, row: number): Vec2 => ({ x: col + 0.5, y: row + 0.5 });

export const tileOf = (p: Vec2): TileCoord => [Math.floor(p.x), Math.floor(p.y)];

class MapError extends Error {
  constructor(id: string, detail: string) {
    super(`map "${id}": ${detail}`);
    this.name = 'MapError';
  }
}

/**
 * ASCII + routes → a validated MapDef.
 *
 * The validation is the point. Two representations of the same road will drift
 * apart the first time the map is edited, and the failure mode is quiet: creeps
 * gliding over grass, or a stretch of road nothing ever walks on. Every check
 * below turns one of those into a startup crash with a tile coordinate in it.
 *
 * Per lane the rules are exactly what they always were — right angles, no
 * duplicate waypoints, never off-board, never off-path. Multi-lane boards add
 * three rules *across* lanes:
 *
 * 1. **Several `S` are legal, one `E` is the rule.** Every lane starts on a
 *    painted `S` and ends on the painted `E`; a painted `S` with no lane
 *    leaving it is an error, because it would draw a spawn marker nothing ever
 *    comes out of.
 * 2. **Coverage is checked against the union** of every lane, not one chain.
 * 3. **Shared tiles are legal and expected.** A merge *is* two lanes on the
 *    same road, so the old "each tile once" instinct has to be explicitly
 *    not-a-rule — otherwise every board with a merge fails to load.
 */
export function parseMap(src: MapSource): MapDef {
  const rows = src.rows.length;
  if (rows === 0) throw new MapError(src.id, 'has no rows');
  const cols = src.rows[0]!.length;
  if (cols === 0) throw new MapError(src.id, 'row 0 is empty');

  const tiles: TileKind[] = [];
  const spawnTiles: TileCoord[] = [];
  let goalTile: TileCoord | undefined;

  for (let row = 0; row < rows; row++) {
    const line = src.rows[row]!;
    if (line.length !== cols) {
      throw new MapError(src.id, `row ${row} is ${line.length} tiles wide, expected ${cols}`);
    }
    for (let col = 0; col < cols; col++) {
      const ch = line[col]!;
      const kind = LEGEND[ch];
      if (kind === undefined) {
        throw new MapError(src.id, `unknown tile '${ch}' at ${col},${row}`);
      }
      tiles.push(kind);

      if (ch === 'S') {
        spawnTiles.push([col, row]);
      } else if (ch === 'E') {
        // One goal, deliberately. Two goals with different life costs is a
        // different game — about triage rather than about coverage.
        if (goalTile) throw new MapError(src.id, 'has more than one goal (E)');
        goalTile = [col, row];
      }
    }
  }

  if (spawnTiles.length === 0) throw new MapError(src.id, 'has no spawn (S)');
  if (!goalTile) throw new MapError(src.id, 'has no goal (E)');

  if (src.routes.length === 0) throw new MapError(src.id, 'has no routes');

  const sameTile = (a: TileCoord, b: TileCoord): boolean => a[0] === b[0] && a[1] === b[1];

  // Union coverage across every lane, so orphaned road is caught against the
  // whole road rather than against whichever lane happened to be checked last.
  const covered = new Set<number>();
  const spawnsUsed = new Set<string>();
  const seenIds = new Set<string>();
  const routes: MapRoute[] = [];

  for (const route of src.routes) {
    const where = (detail: string): MapError => new MapError(src.id, `route "${route.id}": ${detail}`);

    if (seenIds.has(route.id)) throw where('id is used twice');
    seenIds.add(route.id);

    const corners = route.waypoints;
    if (corners.length < 2) throw where('needs at least two waypoints');

    const head = corners[0]!;
    if (!spawnTiles.some((s) => sameTile(s, head))) {
      throw where(`starts at ${head.join(',')}, which is not a painted spawn (S)`);
    }
    spawnsUsed.add(head.join(','));

    const tail = corners[corners.length - 1]!;
    if (!sameTile(tail, goalTile)) {
      throw where(`ends at ${tail.join(',')}, not the goal tile ${goalTile.join(',')}`);
    }

    covered.add(head[1] * cols + head[0]);

    for (let i = 1; i < corners.length; i++) {
      const [c0, r0] = corners[i - 1]!;
      const [c1, r1] = corners[i]!;

      if (c0 !== c1 && r0 !== r1) {
        throw where(`segment ${i - 1}→${i} is diagonal; a route must turn at right angles`);
      }
      const steps = Math.abs(c1 - c0) + Math.abs(r1 - r0);
      if (steps === 0) throw where(`waypoints ${i - 1} and ${i} are the same tile`);

      const dc = Math.sign(c1 - c0);
      const dr = Math.sign(r1 - r0);
      for (let s = 1; s <= steps; s++) {
        const col = c0 + dc * s;
        const row = r0 + dr * s;
        if (col < 0 || col >= cols || row < 0 || row >= rows) {
          throw where(`leaves the board at ${col},${row}`);
        }
        const idx = row * cols + col;
        if (tiles[idx] !== 'path') {
          throw where(`crosses ${tiles[idx]} tile at ${col},${row} — paint it '#'`);
        }
        // Deliberately no "already covered" check. Shared tiles are what a
        // merge is made of.
        covered.add(idx);
      }
    }

    // Creeps enter one tile outside the board so they walk on rather than
    // popping into existence. The lead-in continues the first segment
    // backwards, per lane, because lanes may enter from different spawns.
    const [e0, f0] = head;
    const [e1, f1] = corners[1]!;
    const entry = tileCentre(e0 - Math.sign(e1 - e0), f0 - Math.sign(f1 - f0));

    const waypoints: Vec2[] = [entry, ...corners.map(([col, row]) => tileCentre(col, row))];

    let length = 0;
    for (let i = 1; i < waypoints.length; i++) {
      const a = waypoints[i - 1]!;
      const b = waypoints[i]!;
      length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    }

    routes.push({ id: route.id, waypoints, length });
  }

  for (const s of spawnTiles) {
    if (!spawnsUsed.has(s.join(','))) {
      throw new MapError(src.id, `spawn (S) at ${s.join(',')} has no route leaving it`);
    }
  }

  for (let idx = 0; idx < tiles.length; idx++) {
    if (tiles[idx] === 'path' && !covered.has(idx)) {
      const col = idx % cols;
      const row = (idx - col) / cols;
      throw new MapError(src.id, `path tile at ${col},${row} is on no route — orphaned road`);
    }
  }

  return {
    id: src.id,
    name: src.name,
    cols,
    rows,
    tiles,
    routes,
    goal: tileCentre(goalTile[0], goalTile[1]),
  };
}

/**
 * Tiles shared by every lane at the very end, and that as a fraction of the
 * shortest lane.
 *
 * The single number that decides whether a board can be solved by one cluster:
 * guarding the merge has to be *legal but insufficient*. Reported rather than
 * enforced — a board is allowed to be deliberately generous here, and two of
 * them are, so a threshold in code would be a threshold arguing with the
 * design instead of describing it.
 */
export function mergeRunway(map: MapDef): { tiles: number; fraction: number } {
  // Compared tile by tile, not corner by corner. Two lanes can merge in the
  // middle of a straight — Sluice's chute runs through the point where the coil
  // joins it without turning — so neither lane has a waypoint there and a
  // corner-wise comparison reports the whole trunk instead of the shared part.
  const lanes = map.routes.map(tileRun);

  let shared = 0;
  outer: for (;;) {
    const probe = lanes[0]![lanes[0]!.length - 1 - shared];
    if (probe === undefined) break;
    for (const lane of lanes) {
      const t = lane[lane.length - 1 - shared];
      if (t === undefined || t !== probe) break outer;
    }
    shared++;
  }

  // A suffix of k tiles is k-1 tiles of road walked, and lane length counts the
  // off-board lead-in the same way — so both sides drop one.
  const tiles = Math.max(0, shared - 1);
  const shortest = Math.min(...map.routes.map((r) => r.length - 1));
  return { tiles, fraction: shortest > 0 ? tiles / shortest : 0 };
}

/** One lane expanded to the tile indices it walks, in order. */
function tileRun(route: MapRoute): number[] {
  const out: number[] = [];
  const wp = route.waypoints;
  if (wp.length === 0) return out;

  let x = Math.floor(wp[0]!.x);
  let y = Math.floor(wp[0]!.y);
  const push = (): void => {
    out.push(y * 100000 + x);
  };

  push();
  for (let i = 1; i < wp.length; i++) {
    const tx = Math.floor(wp[i]!.x);
    const ty = Math.floor(wp[i]!.y);
    const dx = Math.sign(tx - x);
    const dy = Math.sign(ty - y);
    const steps = Math.abs(tx - x) + Math.abs(ty - y);
    for (let s = 0; s < steps; s++) {
      x += dx;
      y += dy;
      push();
    }
  }
  return out;
}
