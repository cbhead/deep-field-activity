import { waveStats, type World } from '../world.ts';

/**
 * Walk every creep along the waypoint route.
 *
 * The loop spends a per-tick distance *budget* rather than lerping by a time
 * fraction, so a creep can cross several short legs in one tick without
 * overshooting or losing the remainder at a corner. At 4x speed with a fast
 * enemy that is not hypothetical.
 *
 * A gravitational slow scales that budget and never `creep.speed` itself, which
 * stays the base it was spawned with — see `Creep.slowTimer`.
 */
export function moveCreeps(w: World, dt: number): void {
  const route = w.map.waypoints;

  for (const c of w.creeps) {
    if (c.dead) continue;

    // Sampled once per creep, not once per leg: the budget below can cross
    // several legs in a tick, and charging the timer inside that loop would
    // make a slow burn off faster on a corner-heavy stretch than on a straight.
    const speed = c.slowTimer > 0 ? c.speed * c.slowFactor : c.speed;
    if (c.slowTimer > 0) {
      c.slowTimer = Math.max(0, c.slowTimer - dt);
      // Retire the factor with the timer so the two can never disagree; a stale
      // 0.55 sitting behind an expired timer is the kind of thing that only
      // shows up as a desync.
      if (c.slowTimer === 0) c.slowFactor = 1;
    }

    let budget = speed * dt;
    while (budget > 0) {
      const target = route[c.leg];

      // Ran off the end of the route: the creep reached the goal.
      if (target === undefined) {
        c.dead = true;
        w.lives = Math.max(0, w.lives - 1);
        w.stats.leaks++;
        waveStats(w, c.wave).leaked++;
        w.events.push({ type: 'creepLeaked', x: c.x, y: c.y });
        break;
      }

      const dx = target.x - c.x;
      const dy = target.y - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= budget) {
        // Snap to the corner so float error cannot accumulate across legs, then
        // carry the leftover distance into the next one.
        c.x = target.x;
        c.y = target.y;
        c.progress += dist;
        budget -= dist;
        c.leg++;
      } else {
        const k = budget / dist;
        c.x += dx * k;
        c.y += dy * k;
        c.progress += budget;
        budget = 0;
      }
    }
  }
}
