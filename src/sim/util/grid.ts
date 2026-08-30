import type { MapSource, TileCoord } from '../../content/types.ts';
import type { MapDef, TileKind, Vec2 } from '../types.ts';

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
 * ASCII + waypoints → a validated MapDef.
 *
 * The validation is the point. Two representations of the same route will drift
 * apart the first time the map is edited, and the failure mode is quiet: creeps
 * gliding over grass, or a stretch of road nothing ever walks on. Every check
 * below turns one of those into a startup crash with a tile coordinate in it.
 */
export function parseMap(src: MapSource): MapDef {
  const rows = src.rows.length;
  if (rows === 0) throw new MapError(src.id, 'has no rows');
  const cols = src.rows[0]!.length;
  if (cols === 0) throw new MapError(src.id, 'row 0 is empty');

  const tiles: TileKind[] = [];
  let spawnTile: TileCoord | undefined;
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
        if (spawnTile) throw new MapError(src.id, 'has more than one spawn (S)');
        spawnTile = [col, row];
      } else if (ch === 'E') {
        if (goalTile) throw new MapError(src.id, 'has more than one goal (E)');
        goalTile = [col, row];
      }
    }
  }

  if (!spawnTile) throw new MapError(src.id, 'has no spawn (S)');
  if (!goalTile) throw new MapError(src.id, 'has no goal (E)');

  const corners = src.waypoints;
  if (corners.length < 2) throw new MapError(src.id, 'needs at least two waypoints');

  const sameTile = (a: TileCoord, b: TileCoord): boolean => a[0] === b[0] && a[1] === b[1];
  if (!sameTile(corners[0]!, spawnTile)) {
    throw new MapError(src.id, `first waypoint ${corners[0]!.join(',')} is not the spawn tile ${spawnTile.join(',')}`);
  }
  if (!sameTile(corners[corners.length - 1]!, goalTile)) {
    throw new MapError(src.id, `last waypoint is not the goal tile ${goalTile.join(',')}`);
  }

  // Walk the route tile by tile, checking it against the painted board and
  // recording coverage so orphaned path art can be caught afterwards.
  const covered = new Set<number>();
  covered.add(spawnTile[1] * cols + spawnTile[0]);

  for (let i = 1; i < corners.length; i++) {
    const [c0, r0] = corners[i - 1]!;
    const [c1, r1] = corners[i]!;

    if (c0 !== c1 && r0 !== r1) {
      throw new MapError(src.id, `segment ${i - 1}→${i} is diagonal; the route must turn at right angles`);
    }
    const steps = Math.abs(c1 - c0) + Math.abs(r1 - r0);
    if (steps === 0) throw new MapError(src.id, `waypoints ${i - 1} and ${i} are the same tile`);

    const dc = Math.sign(c1 - c0);
    const dr = Math.sign(r1 - r0);
    for (let s = 1; s <= steps; s++) {
      const col = c0 + dc * s;
      const row = r0 + dr * s;
      if (col < 0 || col >= cols || row < 0 || row >= rows) {
        throw new MapError(src.id, `route leaves the board at ${col},${row}`);
      }
      const idx = row * cols + col;
      if (tiles[idx] !== 'path') {
        throw new MapError(src.id, `route crosses ${tiles[idx]} tile at ${col},${row} — paint it '#'`);
      }
      covered.add(idx);
    }
  }

  for (let idx = 0; idx < tiles.length; idx++) {
    if (tiles[idx] === 'path' && !covered.has(idx)) {
      const col = idx % cols;
      const row = (idx - col) / cols;
      throw new MapError(src.id, `path tile at ${col},${row} is not on the route — orphaned road`);
    }
  }

  // Creeps enter one tile outside the board so they walk on rather than popping
  // into existence. The lead-in continues the first segment backwards.
  const [c0, r0] = corners[0]!;
  const [c1, r1] = corners[1]!;
  const entry = tileCentre(c0 - Math.sign(c1 - c0), r0 - Math.sign(r1 - r0));

  const waypoints: Vec2[] = [entry, ...corners.map(([col, row]) => tileCentre(col, row))];

  let pathLength = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]!;
    const b = waypoints[i]!;
    pathLength += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  }

  return {
    id: src.id,
    name: src.name,
    cols,
    rows,
    tiles,
    waypoints,
    spawn: entry,
    goal: waypoints[waypoints.length - 1]!,
    pathLength,
  };
}
