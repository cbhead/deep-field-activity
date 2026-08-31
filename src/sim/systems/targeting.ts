import type { TowerStats } from '../../content/types.ts';
import type { Creep, TargetMode, Tower } from '../types.ts';
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

    const best = pickTarget(w, t);

    if (best === undefined) {
      // Nothing in range. Clamp rather than letting cooldown run negative, or
      // a tower that idled through an intermission would fire a burst the
      // instant the next wave walked in.
      t.cooldown = 0;
      // Losing the target loses the spin-up with it. Without this a station
      // would hold its charge across a whole intermission and open the next
      // wave at full power, which is the one reward a ramp must not give.
      t.focusId = null;
      t.focusTime = 0;
      continue;
    }

    const s = t.stats;

    // Focus advances here rather than every tick, and that is deliberate.
    // Re-targeting every tick is affordable; doing it for every station
    // *regardless of cooldown* is a different bill and buys nothing, because
    // between two shots the ramp cannot be observed — only its effect on the
    // next one. Adding the interval that just elapsed gives the same answer
    // sampling continuously would, for a fraction of the work.
    if (t.focusId === best.id) {
      t.focusTime = Math.min(t.focusTime + s.fireInterval, rampSeconds(s));
    } else {
      t.focusId = best.id;
      t.focusTime = 0;
    }

    const aim = aimPoint(t, best, s.pierce > 0);

    w.projectiles.push({
      id: w.nextId++,
      defId: t.defId,
      towerId: t.id,
      // The station's current stats, carried whole: impact behaviour reads the
      // shot's snapshot, not the def, which is what lets the effect path change
      // what a station *does* rather than only how hard it hits.
      stats: s,
      x: t.x,
      y: t.y,
      ox: t.x,
      oy: t.y,
      target: best,
      tx: aim.x,
      ty: aim.y,
      speed: s.projectileSpeed,
      // The ramp multiplies the tier's damage rather than replacing it, so an
      // upgraded Filament ramps from a higher floor to a higher ceiling and the
      // two systems stay independent.
      damage: s.damage * rampFactor(t),
      pierce: s.pierce,
      hits: [],
      age: 0,
      dead: false,
    });

    // Presentation only — nothing in the sim reads it, and it draws no random
    // numbers, so the seed still fixes the match completely.
    w.events.push({ type: 'towerFired', defId: t.defId, x: t.x, y: t.y });

    // `+=`, not `=`. Assigning would round every tower's fire rate up to a
    // multiple of the tick, so a 0.5s interval would silently become 0.5167s
    // and every balance number would be quietly wrong.
    t.cooldown += s.fireInterval;
  }
}

/**
 * Seconds of held focus needed to reach the ceiling. `0` for a station that
 * does not ramp, which is what keeps `focusTime` from drifting upward forever
 * on the four stations that never read it. Takes stats, not the def, because
 * the effect path moves both ramp dials.
 */
export const rampSeconds = (s: TowerStats): number =>
  s.rampPerSecond > 0 ? (s.rampMax - 1) / s.rampPerSecond : 0;

/**
 * Damage multiplier from held focus, `1` for everything that does not ramp.
 *
 * Exported because the inspector prints it: a player deciding whether a
 * Filament is worth its price needs to see what it is *currently* doing, and a
 * HUD computing its own copy of this would drift from the simulation at exactly
 * the moment money is being spent. Same discipline as `effectiveDamage`.
 */
export const rampFactor = (t: Tower): number =>
  t.stats.rampPerSecond > 0
    ? Math.min(t.stats.rampMax, 1 + t.focusTime * t.stats.rampPerSecond)
    : 1;

/**
 * Where the shot is headed.
 *
 * A homing shot aims at the contact and re-aims every tick. A piercing one aims
 * at the edge of the station's reach *along the same bearing*, so it crosses the
 * whole covered stretch instead of stopping wherever the first contact happened
 * to be standing — which is what makes lining contacts up worth doing.
 *
 * Reusing `tx`/`ty` as "aim point" rather than adding a velocity vector keeps
 * `Projectile` one field lighter and means both flight modes share the same
 * move-toward-a-point maths.
 */
function aimPoint(t: Tower, target: Creep, piercing: boolean): { x: number; y: number } {
  if (!piercing) return { x: target.x, y: target.y };

  const dx = target.x - t.x;
  const dy = target.y - t.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  // A contact standing exactly on the station has no bearing to extend along.
  if (d === 0) return { x: target.x, y: target.y };

  return { x: t.x + (dx / d) * t.stats.range, y: t.y + (dy / d) * t.stats.range };
}

/**
 * The score a candidate is ranked by, highest wins. One scan whatever the mode,
 * so switching targeting costs nothing at runtime.
 *
 * `close` negates the squared distance rather than taking a root — ordering is
 * all that matters and the root would be pure cost in the hot loop.
 */
function score(mode: TargetMode, c: Creep, d2: number): number {
  switch (mode) {
    case 'first':
      return c.progress;
    case 'last':
      return -c.progress;
    case 'strong':
      return c.hp;
    case 'close':
      return -d2;
  }
}

function pickTarget(w: World, t: Tower): Creep | undefined {
  const r2 = t.stats.range * t.stats.range;

  /**
   * A ramping station holds its target while that target is alive and in reach.
   *
   * This is the one deliberate exception to the no-caching rule above, and it
   * exists because without it the mechanic cannot function. `first` re-picks the
   * contact furthest along every single tick, and in a moving stream that is a
   * different contact constantly — so a Filament reset its ramp perpetually and
   * measured *weaker* than pure Singularity, a station with no damage at all.
   *
   * The rule's usual objection — a tower fixated on something about to die
   * elsewhere — is precisely the trade a beam is supposed to make. It is also
   * scoped: only stations that actually ramp are sticky, so the default
   * behaviour of the other four is untouched.
   */
  if (t.stats.rampPerSecond > 0 && t.focusId !== null) {
    for (const c of w.creeps) {
      if (c.dead || c.id !== t.focusId) continue;
      const dx = c.x - t.x;
      const dy = c.y - t.y;
      if (dx * dx + dy * dy <= r2) return c;
      break;
    }
  }

  let best: Creep | undefined;
  let bestScore = -Infinity;

  for (const c of w.creeps) {
    if (c.dead) continue;
    const dx = c.x - t.x;
    const dy = c.y - t.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;

    const s = score(t.targeting, c, d2);
    // Strictly greater, so ties go to the creep found first. That keeps the
    // choice deterministic given a deterministic creep array, which is what
    // Race-mode fairness rests on.
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }

  return best;
}
