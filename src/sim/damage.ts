import { ENEMIES, type EnemyId } from '../content/enemies.ts';
import type { Creep, Tower } from './types.ts';
import { waveStats, type World } from './world.ts';

/**
 * The single place a creep can lose health.
 *
 * The guard is the whole point. Two projectiles landing on the same tick will
 * both find a creep whose hp is about to go negative, and without this the
 * bounty is paid twice and the death event fires twice. Funnelling every damage
 * source through one function is what makes that impossible rather than merely
 * unlikely — M7's splash will land here too.
 *
 * `source` is the firing tower when there is one, for the inspector's per-tower
 * attribution. It is optional because splash and any future hazard damage have
 * no single owner, and because attribution must never be load-bearing: nothing
 * about the outcome changes when it is absent.
 */
export function damageCreep(w: World, c: Creep, amount: number, source?: Tower): void {
  if (c.dead || c.hp <= 0) return;

  // Any hit restarts the regen countdown, whether or not a shield is up. That
  // is what makes sustained fire hold a Warden's shield at zero while a gap in
  // coverage hands it back.
  c.shieldTimer = ENEMIES[c.defId].shieldRegenDelay;

  // Shield absorbs first, and the overflow carries into the hull — so a single
  // heavy shot is not wasted on a thin shield the way it would be if the shield
  // simply ate the whole hit.
  let toHull = amount;
  if (c.shield > 0) {
    const absorbed = Math.min(c.shield, toHull);
    c.shield -= absorbed;
    toHull -= absorbed;
    if (c.shield === 0) w.events.push({ type: 'shieldBroke', x: c.x, y: c.y });
  }

  // Credit shield and hull alike, but never more than was actually there, so
  // overkill on a 2hp creep doesn't inflate a tower's damage figure.
  const landed = Math.min(amount, amount - toHull + c.hp);
  c.hp -= toHull;

  if (source !== undefined) source.damageDealt += landed;
  w.events.push({
    type: 'creepDamaged',
    id: c.id,
    x: c.x,
    y: c.y,
    amount: landed,
    defId: source?.defId ?? null,
  });

  if (c.hp > 0) return;

  c.dead = true;
  w.money += c.bounty;
  w.stats.kills++;
  w.stats.bounty += c.bounty;

  const wave = waveStats(w, c.wave);
  wave.kills++;
  wave.bounty += c.bounty;

  if (source !== undefined) source.kills++;
  w.events.push({ type: 'creepKilled', x: c.x, y: c.y, bounty: c.bounty, defId: c.defId });

  // Queued, never spawned here. `stepProjectiles` is iterating `w.creeps` when
  // this runs, and a push mid-iteration would let the very shot that made the
  // kill also strike a child that did not exist when it was fired.
  const split = ENEMIES[c.defId].splitInto;
  if (split !== null) {
    w.pendingSplits.push({ parent: c, into: split.enemy as EnemyId, count: split.count });
  }
}
