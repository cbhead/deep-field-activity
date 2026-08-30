import { BALANCE } from '../content/balance.ts';
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
/**
 * What one hit of `amount` actually lands against `armor`.
 *
 * Extracted rather than left inline because the inspector prints this figure,
 * and a HUD computing its own copy would drift from what the simulation does —
 * lying at exactly the moment the player is trusting it to spend money. Same
 * discipline as `placementError` being shared by the placement ghost and the
 * command handler, and gated the same way.
 *
 * Flat subtraction, floored so armour is never immunity. Applied per hit rather
 * than to a total is the whole mechanic: it is what makes one heavy shot worth
 * more than the same damage delivered as chip.
 */
export const effectiveDamage = (amount: number, armor: number): number =>
  armor > 0 ? Math.max(amount * BALANCE.armorFloor, amount - armor) : amount;

export function damageCreep(w: World, c: Creep, amount: number, source?: Tower): void {
  if (c.dead || c.hp <= 0) return;

  const def = ENEMIES[c.defId];

  // Any hit restarts the regen countdown, whether or not a shield is up. That
  // is what makes sustained fire hold a Warden's shield at zero while a gap in
  // coverage hands it back.
  c.shieldTimer = def.shieldRegenDelay;

  // Armour comes off the individual hit, before anything else can absorb it.
  // Splash arrives here too, which is deliberate — the falloff edge of a
  // detonation is a small hit and armour treats it like one.
  const effective = effectiveDamage(amount, def.armor);

  // Shield absorbs next, and the overflow carries into the hull — so a single
  // heavy shot is not wasted on a thin shield the way it would be if the shield
  // simply ate the whole hit.
  let toHull = effective;
  let toShield = 0;
  if (c.shield > 0) {
    toShield = Math.min(c.shield, toHull);
    c.shield -= toShield;
    toHull -= toShield;
    if (c.shield === 0) w.events.push({ type: 'shieldBroke', x: c.x, y: c.y });
  }

  // Credit shield and hull alike, but never more than was actually there, so
  // overkill on a 2hp creep doesn't inflate a tower's damage figure.
  const landed = Math.min(effective, effective - toHull + c.hp);
  c.hp -= toHull;

  if (source !== undefined) source.damageDealt += landed;
  w.events.push({
    type: 'creepDamaged',
    id: c.id,
    x: c.x,
    y: c.y,
    amount: landed,
    toShield,
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
