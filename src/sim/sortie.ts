import { BALANCE } from '../content/balance.ts';
import { SORTIES, type SortieId } from '../content/sorties.ts';
import { scaledStats } from './wavePlan.ts';
import { spawnCreep, type World } from './world.ts';
import type { Creep, SortieError } from './types.ts';

/**
 * Sending contacts at the other player.
 *
 * Its own file rather than a corner of `build.ts` because the two are opposite
 * halves of the same economy and share nothing but the money: build spends to
 * *keep* contacts off a board, this spends to put them on one. Sitting apart
 * also keeps the boundary obvious — `build.ts` never reads a sortie and this
 * never reads a tower.
 *
 * **Nothing here knows the network exists.** `launchSortie` charges the sender
 * and returns what to send; `receiveSortie` puts a contact on a board. Which
 * world each of those runs against is the caller's problem, and in a local
 * loopback both are the same world. That is the same boundary `uiState.ts`
 * documents for presentation, applied to the wire: the sim must never acquire
 * a notion of "the other player".
 */

/**
 * What a sortie costs right now, on the board it would be sent *to*.
 *
 * Derived from the scaled bounty rather than authored, so the price tracks
 * `bountyGrowth` with no second curve to sweep — see `BALANCE.sortie`.
 *
 * `waveIndex` is the receiver's, not the sender's. Both players run the same
 * seeded metronome so the two are within a wave of each other in practice, and
 * using the receiver's means the contact that arrives is always sized for the
 * board it lands on. It also means there is no wave number on the wire that a
 * client could put an absurd value in.
 */
export function sortieCost(id: SortieId, waveIndex: number, w: World): number {
  const { bounty } = scaledStats(SORTIES[id].enemy, waveIndex, w.rules);
  return Math.max(1, Math.round(bounty * BALANCE.sortie.markup));
}

/** Paid back to the sender when a sortie reaches the far core. */
export const sortieKickback = (cost: number): number =>
  Math.round(cost * BALANCE.sortie.kickback);

/** Whether this rung of the sortie table is open to this world's era. */
export const sortieUnlocked = (w: World, id: SortieId): boolean =>
  w.rules.sorties && w.era >= SORTIES[id].era;

export function sortieError(w: World, id: SortieId, lane: number): SortieError | null {
  if (!w.rules.sorties) return 'noSorties';
  if (!sortieUnlocked(w, id)) return 'locked';
  if (!Number.isInteger(lane) || lane < 0 || lane >= w.map.routes.length) return 'noSuchLane';
  if (w.money < sortieCost(id, w.wave.index, w)) return 'tooPoor';
  return null;
}

/**
 * Charge the sender. Assumes `sortieError` already returned null.
 *
 * Returns the price, because the kickback is a fraction of what *this* player
 * paid and re-deriving it when the contact lands would read the wave index at
 * the wrong moment — a Monolith walks for the better part of a minute, and the
 * board can be two waves further on by the time it arrives.
 */
export function launchSortie(w: World, id: SortieId): number {
  const cost = sortieCost(id, w.wave.index, w);
  w.money -= cost;
  w.stats.sortiesSent++;
  w.stats.sortieSpend += cost;
  return cost;
}

/**
 * Put an opponent's sortie on this board, at midfield, on the lane they chose.
 *
 * Scaled to *this* board's current wave, so it arrives as a real contact rather
 * than as whatever was current when it was bought. `origin: 'sortie'` is what
 * keeps it out of wave settlement — see `Creep.origin`, and the V1 gate that
 * exists because a slow one would otherwise hold a wave open for a minute.
 */
export function receiveSortie(w: World, id: SortieId, lane: number, kickback: number): Creep {
  const def = SORTIES[id];
  const stats = scaledStats(def.enemy, w.wave.index, w.rules);
  return spawnCreep(w, def.enemy, {
    ...stats,
    origin: 'sortie',
    leakDamage: def.weight,
    route: lane,
    kickback,
  });
}
