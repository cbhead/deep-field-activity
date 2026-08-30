import { scaledStats } from '../wavePlan.ts';
import { spawnCreep, type World } from '../world.ts';

/**
 * How far apart children are placed along the route, in tiles.
 *
 * Fixed, not random. Splitting draws no random numbers at all, so it stays a
 * pure function of what died and Race fairness needs no new RNG stream. A
 * scatter would look marginally better and would cost a shared stream and a
 * whole class of desync question.
 */
const SPREAD_TILES = 0.22;

/**
 * Turn queued deaths into children.
 *
 * Runs after every system that iterates `w.creeps` and before `cleanup`, which
 * is the only window where appending is safe: `damageCreep` is called from deep
 * inside the projectile sweep, and pushing there would let the shot that made
 * the kill also hit what the kill produced.
 */
export function resolveSplits(w: World): void {
  for (const split of w.pendingSplits) {
    const parent = split.parent;
    const stats = scaledStats(split.into, parent.wave);

    for (let i = 0; i < split.count; i++) {
      // Spread along the route rather than across it, so children stay on the
      // road. Centred on the parent: the first is pushed back, the last ahead.
      const offset = (i - (split.count - 1) / 2) * SPREAD_TILES;

      spawnCreep(w, split.into, {
        ...stats,
        // The parent's tag, not the current wave. `clearedThrough` is computed
        // from the lowest wave still alive, so a child tagged with a later wave
        // would let its parent's wave settle while the child was still walking
        // — paying the clear reward early and, at the end of a run, declaring
        // victory with contacts on the board.
        wave: parent.wave,
        at: {
          x: parent.x,
          y: parent.y,
          leg: parent.leg,
          // Never negative: a child pushed behind the start would walk the
          // route's first leg twice.
          progress: Math.max(0, parent.progress + offset),
        },
      });
    }

    w.events.push({
      type: 'creepSplit',
      x: parent.x,
      y: parent.y,
      into: split.into,
      count: split.count,
    });
  }

  w.pendingSplits.length = 0;
}
