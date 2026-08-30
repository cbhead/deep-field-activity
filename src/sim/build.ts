import { TOWERS, type TowerId } from '../content/towers.ts';
import type { PlacementError, Tower } from './types.ts';
import { isBuildableTile, tileCentre } from './util/grid.ts';
import type { World } from './world.ts';

/**
 * Placement rules, in one place.
 *
 * Deliberately NOT under `sim/systems/` — the renderer needs this to colour the
 * placement ghost, and the eslint boundary (rightly) stops presentation code
 * importing simulation systems. This is a pure query over world state, which is
 * exactly the kind of thing both sides may share.
 *
 * The ghost and the command handler call the same function, so what the player
 * is shown and what the sim will accept cannot drift apart.
 */
export function placementError(
  w: World,
  defId: TowerId,
  col: number,
  row: number,
): PlacementError | null {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return 'offBoard';
  if (col < 0 || col >= w.map.cols || row < 0 || row >= w.map.rows) return 'offBoard';
  if (!isBuildableTile(w.map, col, row)) return 'notBuildable';
  if (towerAt(w, col, row) !== undefined) return 'occupied';
  if (w.money < TOWERS[defId].cost) return 'tooPoor';
  return null;
}

export const canPlace = (w: World, defId: TowerId, col: number, row: number): boolean =>
  placementError(w, defId, col, row) === null;

/**
 * Linear scan. With a couple of dozen towers this is faster than maintaining a
 * parallel occupancy index, and it cannot fall out of sync with the array.
 */
export function towerAt(w: World, col: number, row: number): Tower | undefined {
  for (const t of w.towers) if (t.col === col && t.row === row) return t;
  return undefined;
}

/**
 * Build a tower. Assumes placement has already been validated — the caller is
 * `applyCommands`, which re-checks rather than trusting the click that produced
 * the command.
 */
export function buildTower(w: World, defId: TowerId, col: number, row: number): Tower {
  const def = TOWERS[defId];
  const centre = tileCentre(col, row);

  const tower: Tower = {
    id: w.nextId++,
    defId,
    col,
    row,
    x: centre.x,
    y: centre.y,
    range: def.range,
    damage: def.damage,
    fireInterval: def.fireInterval,
    projectileSpeed: def.projectileSpeed,
    // Ready to fire the moment it lands, so a last-second build still helps.
    cooldown: 0,
    spent: def.cost,
  };

  w.money -= def.cost;
  w.towers.push(tower);
  return tower;
}
