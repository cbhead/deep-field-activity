import { ENEMIES } from '../../content/enemies.ts';
import type { TowerStats } from '../../content/types.ts';
import { damageCreep } from '../damage.ts';
import type { Creep, EntityId, Projectile, Tower } from '../types.ts';
import { towerById, type World } from '../world.ts';

/** Safety net: no projectile may outlive this, whatever the numbers say. */
const MAX_FLIGHT_SECONDS = 5;

/**
 * One projectile system, not two.
 *
 * Every station fires a travelling shot; "hitscan" is simulated by giving
 * Singularity a projectile speed of 40 tiles/sec, which lands within a tick or
 * two at any real range. A separate instant-damage path would mean two damage
 * code paths, two sets of edge cases, and two places to fix the same bug.
 *
 * **Pierce keeps that promise where it counts** — still one projectile array
 * and one `damageCreep` funnel — but adds a branch on *flight*. A piercing shot
 * flies straight and sweeps the segment it crossed; one that homed would curve
 * back into a contact it had just passed. That is the whole reason the branch
 * exists, and it is a branch on movement, not on damage.
 *
 * Splash, the chain and the gravitational slow add no branch at all: they are
 * extra ways to *reach* `damageCreep`, applied at the moment of impact. If a
 * change ever needs a second way to actually apply damage, that is the moment
 * to stop and re-plan rather than grow a third path here.
 *
 * Filament's ramp was the change that nearly did. A sustained beam is naturally
 * a per-tick channel, which would have been exactly that second path — so it is
 * built as an ordinary near-hitscan shot whose *damage* depends on how long the
 * station has held its target. The ramp lives in `fireTowers`, this file never
 * learns about it, and there is still one funnel.
 */
export function stepProjectiles(w: World, dt: number): void {
  for (const p of w.projectiles) {
    if (p.dead) continue;

    p.age += dt;
    if (p.age > MAX_FLIGHT_SECONDS) {
      p.dead = true;
      continue;
    }

    // The snapshot taken at fire time, not the def and not the live station:
    // effects are upgradeable now, and a shot already in the air lands with
    // the behaviour it was fired with.
    const s = p.stats;
    if (s.pierce > 0) stepPiercing(w, p, s, dt);
    else stepHoming(w, p, s, dt);
  }
}

/**
 * The original behaviour, unchanged: track the target, expire on arrival.
 *
 * Homing while the target lives and then carrying on to where it last was
 * means a shot never vanishes mid-air — which reads as a rendering bug even
 * though the damage outcome is identical.
 */
function stepHoming(w: World, p: Projectile, s: TowerStats, dt: number): void {
  if (!p.target.dead) {
    p.tx = p.target.x;
    p.ty = p.target.y;
  }

  const dx = p.tx - p.x;
  const dy = p.ty - p.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const travel = p.speed * dt;

  if (dist > travel) {
    const k = travel / dist;
    p.x += dx * k;
    p.y += dy * k;
    return;
  }

  p.x = p.tx;
  p.y = p.ty;
  p.dead = true;

  // The firing station may have been sold mid-flight; attribution then finds
  // nothing and the damage still lands, which is the right outcome.
  const source = towerById(w, p.towerId);
  // damageCreep no-ops on an already-dead contact, so a wasted shot is free.
  hit(w, p.target, p.damage, s, source);
  if (s.splashRadius > 0) detonate(w, p, s, source);
  if (s.chainJumps > 0) chain(w, p, s, source);
}

/**
 * Fly straight and damage everything crossed, up to the pierce budget.
 *
 * The aim point was pushed past the target at spawn (see `fireTowers`), so the
 * shot crosses the station's whole reach rather than stopping where the first
 * contact happened to be standing.
 */
function stepPiercing(w: World, p: Projectile, s: TowerStats, dt: number): void {
  const fromX = p.x;
  const fromY = p.y;

  const dx = p.tx - p.x;
  const dy = p.ty - p.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const travel = p.speed * dt;

  if (dist > travel) {
    const k = travel / dist;
    p.x += dx * k;
    p.y += dy * k;
  } else {
    p.x = p.tx;
    p.y = p.ty;
    p.dead = true;
  }

  const source = towerById(w, p.towerId);

  // Swept, not point-sampled: at 14 tiles/sec a shot covers ~0.23 tiles per
  // tick against a 0.3-tile hitbox, so a point test would already be marginal
  // and any faster station would tunnel straight through a contact.
  //
  // Contacts are taken in array order rather than sorted along the segment.
  // Two in a single sweep is rare at these speeds, and array order is
  // deterministic — which is the property Race fairness actually needs.
  for (const c of w.creeps) {
    if (c.dead || p.hits.includes(c.id)) continue;

    const r = ENEMIES[c.defId].radius;
    if (segmentDistanceSq(c.x, c.y, fromX, fromY, p.x, p.y) > r * r) continue;

    p.hits.push(c.id);
    hit(w, c, p.damage, s, source);

    if (p.pierce <= 0) {
      p.dead = true;
      break;
    }
    p.pierce--;
  }
}

/** Damage plus any on-hit status. The one place both are applied together. */
function hit(w: World, c: Creep, amount: number, s: TowerStats, source: Tower | undefined): void {
  damageCreep(w, c, amount, source);
  applySlow(c, s);
}

/**
 * Splash, with linear falloff to `splashFalloff` at the rim.
 *
 * `Math.sqrt` is fine here where it would not be in targeting: this runs once
 * per contact inside the blast at the instant of impact, not every tick.
 */
function detonate(w: World, p: Projectile, s: TowerStats, source: Tower | undefined): void {
  const r = s.splashRadius;
  const r2 = r * r;

  // Announced before the damage loop, and unconditionally: a detonation that
  // caught nothing is exactly the one the player most needs to see, because it
  // is the one telling them the station is mistimed or misplaced.
  w.events.push({ type: 'blast', x: p.x, y: p.y, radius: r, defId: p.defId });

  for (const c of w.creeps) {
    // The direct hit was already paid in full by the caller.
    if (c.dead || c === p.target) continue;

    const dx = c.x - p.x;
    const dy = c.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;

    const falloff = 1 - (Math.sqrt(d2) / r) * (1 - s.splashFalloff);
    hit(w, c, p.damage * falloff, s, source);
  }
}

/**
 * Hop from the struck contact to its nearest neighbours, falling off per jump.
 *
 * Note what this is *not*: a second way to apply damage. Like `detonate` it is
 * another way to **reach** `damageCreep` at the instant of impact, which is the
 * rule this file is built around — one funnel, one set of edge cases. It adds
 * no branch on flight and none on damage.
 *
 * The walk is nearest-first from the *previous* link rather than all-from-the-
 * origin, because that is what makes a chain read as a chain: it follows a line
 * of contacts away from the impact instead of picking the same tight cluster
 * the blast would have caught anyway. Without it, Arc is a worse Nova.
 *
 * O(jumps × creeps) at the moment of impact only — three jumps over a couple of
 * hundred contacts, a few times a second. `Math.sqrt` is avoided for the same
 * reason as everywhere else, by comparing squared distances.
 */
function chain(w: World, p: Projectile, s: TowerStats, source: Tower | undefined): void {
  const struck: EntityId[] = [p.target.id];
  let fromX = p.x;
  let fromY = p.y;
  let damage = p.damage;
  const reach2 = s.chainRange * s.chainRange;

  for (let jump = 0; jump < s.chainJumps; jump++) {
    let best: Creep | undefined;
    let bestD2 = reach2;

    for (const c of w.creeps) {
      if (c.dead || struck.includes(c.id)) continue;
      const dx = c.x - fromX;
      const dy = c.y - fromY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = c;
      }
    }

    // Nothing within reach ends the chain. A jump that found no one must not be
    // spent and then resumed from the same place on the next iteration, or the
    // loop would just re-scan and re-fail `chainJumps` times.
    if (best === undefined) return;

    damage *= s.chainFalloff;
    hit(w, best, damage, s, source);
    struck.push(best.id);
    fromX = best.x;
    fromY = best.y;
  }
}

/**
 * Refresh, never stack.
 *
 * A lower factor is a stronger slow. Letting two wells compound would turn a
 * pair of cheap stations into a permanent stop, which is the classic way a
 * tower defense accidentally solves itself.
 */
function applySlow(c: Creep, s: TowerStats): void {
  if (s.slowSeconds <= 0 || s.slowFactor >= 1) return;

  if (c.slowTimer <= 0 || s.slowFactor < c.slowFactor) c.slowFactor = s.slowFactor;
  c.slowTimer = Math.max(c.slowTimer, s.slowSeconds);
  // The ring reads `slowTimer / slowMax`, so the denominator has to grow with a
  // refresh that extended the slow — otherwise a re-hit would show an arc
  // stuck at full and the countdown would stop meaning anything.
  c.slowMax = Math.max(c.slowMax, c.slowTimer);
}

/** Squared distance from a point to a segment. No `sqrt` — ordering is all we need. */
function segmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const ab2 = abx * abx + aby * aby;

  // A zero-length sweep (a shot that did not move this tick) degenerates to a
  // point test against `a`, which is correct rather than a special case.
  let t = 0;
  if (ab2 > 0) {
    t = ((px - ax) * abx + (py - ay) * aby) / ab2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }

  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return dx * dx + dy * dy;
}
