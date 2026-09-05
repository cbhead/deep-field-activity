import { waveStats, type World } from '../world.ts';

/**
 * Walk every creep along its own lane.
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
  for (const c of w.creeps) {
    if (c.dead) continue;

    // Per creep, not once for the whole loop: contacts on a multi-lane board
    // are walking different chains.
    const route = w.map.routes[c.route]!.waypoints;

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
        // Floored at zero rather than allowed negative, so a heavy contact
        // landing on a one-life reserve reads as a loss and not as a debt. The
        // phase change on the next tick is what ends the run either way.
        w.lives = Math.max(0, w.lives - c.leakDamage);
        w.stats.leaks++;
        // Only wave contacts are itemised per wave — a sortie belongs to no
        // wave, and tallying it against whichever one happened to be spawning
        // would print leaks in a clear summary the wave never caused.
        if (c.origin === 'wave') waveStats(w, c.wave).leaked++;
        w.events.push({
          type: 'creepLeaked',
          x: c.x,
          y: c.y,
          cost: c.leakDamage,
          bought: c.origin === 'sortie',
        });
        // A sortie that lands pays *its sender*, who is not this world. The
        // event is the only way that money can travel; crediting it here would
        // pay the person who just took the hit.
        if (c.origin === 'sortie' && c.kickback > 0) {
          w.stats.sortiesTaken++;
          w.events.push({ type: 'sortieLanded', kickback: c.kickback, cost: c.leakDamage });
        }
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
