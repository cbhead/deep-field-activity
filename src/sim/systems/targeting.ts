import type { Creep } from '../types.ts';
import type { World } from '../world.ts';

/**
 * Pick a target for every ready tower and fire.
 *
 * Naive O(towers × creeps). At the ceiling this game will ever reach — 25
 * towers, 250 creeps, 60Hz — that is 375k squared-distance checks a second,
 * around 0.3% of a frame. Spatial partitioning would be pure cost.
 *
 * Two details that are easy to get wrong:
 *
 * - **Squared distances, never `Math.sqrt`.** This is the one loop in the game
 *   that runs often enough for it to matter.
 * - **Re-target every tick, no caching.** Caching produces the classic bad
 *   behaviour where a tower keeps tracking a creep that something else is about
 *   to kill, while a fresh one walks past it.
 */
export function fireTowers(w: World, dt: number): void {
  for (const t of w.towers) {
    t.cooldown -= dt;
    if (t.cooldown > 0) continue;

    const r2 = t.range * t.range;
    let best: Creep | undefined;
    let bestProgress = -1;

    for (const c of w.creeps) {
      if (c.dead) continue;
      const dx = c.x - t.x;
      const dy = c.y - t.y;
      if (dx * dx + dy * dy > r2) continue;
      // Furthest along the path wins: the creep closest to costing a life is
      // the one worth shooting.
      if (c.progress > bestProgress) {
        bestProgress = c.progress;
        best = c;
      }
    }

    if (best === undefined) {
      // Nothing in range. Clamp rather than letting cooldown run negative, or
      // a tower that idled through an intermission would fire a burst the
      // instant the next wave walked in.
      t.cooldown = 0;
      continue;
    }

    w.projectiles.push({
      id: w.nextId++,
      defId: t.defId,
      x: t.x,
      y: t.y,
      target: best,
      tx: best.x,
      ty: best.y,
      speed: t.projectileSpeed,
      damage: t.damage,
      age: 0,
      dead: false,
    });

    // `+=`, not `=`. Assigning would round every tower's fire rate up to a
    // multiple of the tick, so a 0.5s interval would silently become 0.5167s
    // and every balance number would be quietly wrong.
    t.cooldown += t.fireInterval;
  }
}
