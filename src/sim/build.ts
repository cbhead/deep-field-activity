import { BALANCE } from '../content/balance.ts';
import { TOWERS, type TowerId } from '../content/towers.ts';
import type { TowerStats } from '../content/types.ts';
import type {
  PlacementError,
  TargetMode,
  Tower,
  TowerActionError,
  TowerTiers,
  UpgradePath,
} from './types.ts';
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

/** Damage a tower of this type has at a given damage-path tier. */
export const damageAtTier = (defId: TowerId, tier: number): number =>
  Math.round(TOWERS[defId].damage * BALANCE.upgrade.damageFactor ** (tier - 1));

/** Range a tower of this type has at a given range-path tier. */
export const rangeAtTier = (defId: TowerId, tier: number): number =>
  TOWERS[defId].range * BALANCE.upgrade.rangeFactor ** (tier - 1);

/**
 * The effective combat numbers at a given set of path tiers.
 *
 * The single place tiers become stats — `buildTower`, `upgradeTower` and the
 * inspector's previews all come through here, so what a purchase is shown to
 * buy and what it actually buys cannot drift apart.
 */
export function computeStats(defId: TowerId, tiers: TowerTiers): TowerStats {
  const def = TOWERS[defId];
  // Annotated mutable: inferred, the fields would be unions of the five defs'
  // literal values, and the += below could not write to them.
  const stats: { -readonly [K in keyof TowerStats]: number } = {
    range: rangeAtTier(defId, tiers.range),
    damage: damageAtTier(defId, tiers.damage),
    fireInterval: def.fireInterval,
    projectileSpeed: def.projectileSpeed,
    pierce: def.pierce,
    splashRadius: def.splashRadius,
    splashFalloff: def.splashFalloff,
    slowFactor: def.slowFactor,
    slowSeconds: def.slowSeconds,
    chainJumps: def.chainJumps,
    chainRange: def.chainRange,
    chainFalloff: def.chainFalloff,
    rampPerSecond: def.rampPerSecond,
    rampMax: def.rampMax,
  };

  // Widened from the def's literal type: each station's `perTier` is a narrow
  // `as const` shape, and the loop needs the general one.
  const perTier: Readonly<Partial<TowerStats>> = def.effectUpgrade.perTier;
  const steps = tiers.effect - 1;
  if (steps > 0) {
    for (const key of Object.keys(perTier) as (keyof TowerStats)[]) {
      stats[key] += perTier[key]! * steps;
    }
  }
  return stats;
}

/**
 * What the stats would be after buying the next tier of `path`, or null at the
 * ceiling. The inspector prices its three buttons off this, so the preview is
 * computed by the same function the purchase will run.
 */
export function nextStats(t: Tower, path: UpgradePath): TowerStats | null {
  if (t.tiers[path] >= BALANCE.upgrade.maxTier) return null;
  return computeStats(t.defId, { ...t.tiers, [path]: t.tiers[path] + 1 });
}

/**
 * The tier the *art* shows, 1..maxTier. There is one baked texture per tier,
 * not one per combination of paths, so the sprite tracks total investment:
 * the first purchases each visibly harden the station, then the art tops out
 * while the per-path pips in the inspector carry the detail.
 */
export const visualTier = (t: Tower): number =>
  Math.min(BALANCE.upgrade.maxTier, t.tiers.damage + t.tiers.range + t.tiers.effect - 2);

/**
 * Price of the next tier *in this path*, or null when the path is maxed.
 * Escalates with the path's current tier so deepening one track never strictly
 * dominates broadening — see `BALANCE.upgrade.costFactor`.
 */
export function upgradeCost(t: Tower, path: UpgradePath): number | null {
  const tier = t.tiers[path];
  if (tier >= BALANCE.upgrade.maxTier) return null;
  return Math.round(TOWERS[t.defId].cost * BALANCE.upgrade.costFactor * tier);
}

/** What selling returns right now — a cut of everything sunk in, upgrades included. */
export const sellValue = (t: Tower): number => Math.floor(t.spent * BALANCE.sellRefund);

export function upgradeError(
  w: World,
  t: Tower | undefined,
  path: UpgradePath,
): TowerActionError | null {
  if (t === undefined) return 'noSuchTower';
  const cost = upgradeCost(t, path);
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

  const tiers: TowerTiers = { damage: 1, range: 1, effect: 1 };
  const tower: Tower = {
    id: w.nextId++,
    defId,
    col,
    row,
    x: centre.x,
    y: centre.y,
    tiers,
    stats: computeStats(defId, tiers),
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
export function upgradeTower(w: World, t: Tower, path: UpgradePath): number {
  const cost = upgradeCost(t, path)!;
  t.tiers[path]++;
  // A fresh object, never a mutation — in-flight projectiles hold the old one
  // as their snapshot. See the field's comment in `types.ts`.
  t.stats = computeStats(t.defId, t.tiers);
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
