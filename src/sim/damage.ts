import type { Creep } from './types.ts';
import type { World } from './world.ts';

/**
 * The single place a creep can lose health.
 *
 * The guard is the whole point. Two projectiles landing on the same tick will
 * both find a creep whose hp is about to go negative, and without this the
 * bounty is paid twice and the death event fires twice. Funnelling every damage
 * source through one function is what makes that impossible rather than merely
 * unlikely — M7's splash will land here too.
 */
export function damageCreep(w: World, c: Creep, amount: number): void {
  if (c.dead || c.hp <= 0) return;

  c.hp -= amount;
  if (c.hp > 0) return;

  c.dead = true;
  w.money += c.bounty;
  w.events.push({ type: 'creepKilled', x: c.x, y: c.y, bounty: c.bounty });
}
