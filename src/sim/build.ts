import { BALANCE } from '../content/balance.ts';
import { TOWERS, type TowerId } from '../content/towers.ts';
import type { PlacementError, TargetMode, Tower, TowerActionError } from './types.ts';
import { isBuildableTile, tileAt, tileCentre } from './util/grid.ts';
import type { World } from './world.ts';

/**
 * Placement and tower-lifecycle rules, in one place.
 *
 * Deliberately NOT under `sim/systems/` — the renderer needs these to colour the
 * placement ghost and to price the inspector's buttons, and the eslint boundary
 * (rightly) stops presentation code importing simulation systems. These are pure
 * queries over world state, which is exactly the kind of thing both sides may
 * share.
 *
 * The ghost and the command handler call the same functions, so what the player
 * is shown and what the sim will accept cannot drift apart.
 */
export function placementError(
  w: World,
  defId: TowerId,
  col: number,
  row: number,
): PlacementError | null {
  // Bounds first: `offBoard` is what tells the renderer to hide the ghost
  // entirely, so it has to win over reasons that would draw a red one.
  if (!Number.isInteger(col) || !Number.isInteger(row)) return 'offBoard';
  if (col < 0 || col >= w.map.cols || row < 0 || row >= w.map.rows) return 'offBoard';
  if (!isUnlocked(w, defId)) return 'locked';
  if (!isBuildableTile(w.map, col, row)) {
    return tileAt(w.map, col, row) === 'path' ? 'onRoute' : 'blocked';
  }
  if (towerAt(w, col, row) !== undefined) return 'occupied';
  if (w.money < TOWERS[defId].cost) return 'tooPoor';
  return null;
}

export const canPlace = (w: World, defId: TowerId, col: number, row: number): boolean =>
  placementError(w, defId, col, row) === null;

/**
 * Unlocks are keyed to the wave *reached*, not the wave cleared, so a type
 * announced as "wave 5" is buildable during the build phase before wave 5 —
 * which is the only moment the unlock is useful.
 */
export const isUnlocked = (w: World, defId: TowerId): boolean =>
  w.wave.index >= TOWERS[defId].unlockWave;

/**
 * Linear scan. With a couple of dozen towers this is faster than maintaining a
 * parallel occupancy index, and it cannot fall out of sync with the array.
 */
export function towerAt(w: World, col: number, row: number): Tower | undefined {
  for (const t of w.towers) if (t.col === col && t.row === row) return t;
  return undefined;
}

/** Damage a tower of this type has at a given tier. */
export const damageAtTier = (defId: TowerId, tier: number): number =>
  Math.round(TOWERS[defId].damage * BALANCE.upgrade.damageFactor ** (tier - 1));

/**
 * Price of the *next* tier, or null when there isn't one. Escalates with the
 * current tier so stacking one tile never dominates spreading coverage.
 */
export function upgradeCost(t: Tower): number | null {
  if (t.tier >= BALANCE.upgrade.maxTier) return null;
  return Math.round(TOWERS[t.defId].cost * BALANCE.upgrade.costFactor * t.tier);
}

/** What selling returns right now — a cut of everything sunk in, upgrades included. */
export const sellValue = (t: Tower): number => Math.floor(t.spent * BALANCE.sellRefund);

export function upgradeError(w: World, t: Tower | undefined): TowerActionError | null {
  if (t === undefined) return 'noSuchTower';
  const cost = upgradeCost(t);
  if (cost === null) return 'maxTier';
  if (w.money < cost) return 'tooPoor';
  return null;
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
    tier: 1,
    range: def.range,
    damage: def.damage,
    fireInterval: def.fireInterval,
    projectileSpeed: def.projectileSpeed,
    targeting: 'first',
    // Ready to fire the moment it lands, so a last-second build still helps.
    cooldown: 0,
    focusId: null,
    focusTime: 0,
    spent: def.cost,
    kills: 0,
    damageDealt: 0,
  };

  w.money -= def.cost;
  w.stats.spent += def.cost;
  w.towers.push(tower);
  return tower;
}

/** Assumes `upgradeError` already returned null. */
export function upgradeTower(w: World, t: Tower): number {
  const cost = upgradeCost(t)!;
  t.tier++;
  t.damage = damageAtTier(t.defId, t.tier);
  t.spent += cost;
  w.money -= cost;
  w.stats.spent += cost;
  return cost;
}

/**
 * Sell a tower. Removes it immediately rather than flagging it dead: towers are
 * not swept by `cleanup` (nothing else needs them to survive the tick), and a
 * tower that keeps firing after you sold it reads as a bug.
 *
 * Projectiles already in flight hold a `towerId`, not a reference, so their
 * attribution simply finds nothing — the damage still lands, which is right.
 */
export function sellTower(w: World, t: Tower): number {
  const refund = sellValue(t);
  const i = w.towers.indexOf(t);
  if (i >= 0) {
    w.towers[i] = w.towers[w.towers.length - 1]!;
    w.towers.pop();
  }
  w.money += refund;
  return refund;
}

export function setTargeting(t: Tower, mode: TargetMode): void {
  t.targeting = mode;
}
