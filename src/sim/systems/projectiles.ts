import { damageCreep } from '../damage.ts';
import type { World } from '../world.ts';

/** Safety net: no projectile may outlive this, whatever the numbers say. */
const MAX_FLIGHT_SECONDS = 5;

/**
 * One projectile system, not two.
 *
 * Every tower fires a travelling homing shot; "hitscan" is simulated by giving
 * frost a projectile speed of 40 tiles/sec, which lands within a tick or two at
 * any real range. A separate instant-damage path would mean two damage code
 * paths, two sets of edge cases, and two places to fix the same bug.
 */
export function stepProjectiles(w: World, dt: number): void {
  const step = dt;

  for (const p of w.projectiles) {
    if (p.dead) continue;

    p.age += dt;
    if (p.age > MAX_FLIGHT_SECONDS) {
      p.dead = true;
      continue;
    }

    // Home while the target lives; once it dies, carry on to where it last was
    // and expire there. A shot that vanishes mid-air reads as a rendering bug,
    // even though the damage outcome is identical.
    if (!p.target.dead) {
      p.tx = p.target.x;
      p.ty = p.target.y;
    }

    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const travel = p.speed * step;

    if (dist <= travel) {
      p.x = p.tx;
      p.y = p.ty;
      p.dead = true;
      // damageCreep no-ops on an already-dead creep, so a wasted shot is free.
      damageCreep(w, p.target, p.damage);
      continue;
    }

    const k = travel / dist;
    p.x += dx * k;
    p.y += dy * k;
  }
}
