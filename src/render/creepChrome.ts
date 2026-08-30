import { Graphics } from 'pixi.js';
import { ENEMIES } from '../content/enemies.ts';
import type { Creep } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { TILE_PX } from './constants.ts';
import { strokeArc } from './draw.ts';
import type { Layers } from './pixiApp.ts';
import { THEME } from './theme.ts';

/**
 * Everything drawn *on a contact* to report its state: what is keeping it alive,
 * and what is being done to it.
 *
 * The sibling of `towerChrome.ts`, and the split between them is the same one:
 * `effects.ts` owns feedback that is event-driven, pooled and droppable, while a
 * chrome layer is pulled from state every frame and must never miss one. A
 * dropped health bar is a contact that looks healthy.
 *
 * **Two constraints make this different from the station's chrome, and both
 * shape the layout budget below.**
 *
 * *Contacts are not one size.* A station is always the same hexagon, so its
 * indicators could be placed at fixed radii. Contacts run from a Mote at 0.17
 * tiles to a Monolith at 0.46 — a factor of 2.7 — and every offset here was
 * originally a constant. The slow clock sat at a flat 0.36 tiles, which put it
 * *inside the body* of the Monolith, the Cluster and the Bulwark: half the
 * roster wore its most important status indicator hidden under itself, and the
 * health bar overlapped the same three. Every offset is now measured out from
 * the contact's own radius, which is the only way a shared layout can hold
 * across that range.
 *
 * *There can be 250 of them.* Ten times the station count, bunched rather than
 * tile-spaced, so anything drawn unconditionally becomes a wall of noise. The
 * governing rule is **draw nothing for a contact that has nothing to report** —
 * an untouched contact gets no bar, a contact under no status gets no ring. That
 * suppression is what keeps a full board readable, and a new indicator must
 * bring its own version of it.
 *
 * **The layout budget**, measured outward from the contact's centre, where `R`
 * is that contact's own body radius in px:
 *
 * | band              | what                | drawn when                  |
 * |-------------------|---------------------|-----------------------------|
 * | 0 – R             | the baked sprite    | always (owned by `worldView`)|
 * | R + 3             | status clock ring   | a status is active          |
 * | above R + 6       | hull bar            | damaged, or shielded        |
 * | above the hull bar| shield band         | the contact has a shield    |
 *
 * Outward past the clock ring is free, as is anything above the bars. A second
 * status ring would collide with the first and should share the band by arc
 * position — the way the station's collar shares one ring between three paths —
 * rather than stacking another circle a few pixels out, which reads as a smudge
 * rather than as two readings.
 */

/** Clear of the body, close enough to still read as belonging to it. */
const RING_GAP = 3;
/** Gap between the top of the body and the underside of the hull bar. */
const BAR_GAP = 6;
const BAR_H = 4;
const SHIELD_H = 2.5;
/** Gap between the hull bar and the shield band above it. */
const SHIELD_GAP = 3.5;

/**
 * Bar width does *not* scale with the contact, deliberately.
 *
 * Everything else here is measured from the body because occlusion demanded it,
 * but a bar is read as a *fraction*, and fractions are only comparable when the
 * tracks are. A Mote's bar being wider than the Mote is a small ugliness; a
 * player unable to tell at a glance which of two contacts is closer to dying is
 * the thing bars exist to prevent.
 */
const BAR_W = 32;

/** The px radius of a contact's body, which every offset here is measured from. */
const bodyRadius = (c: Creep): number => ENEMIES[c.defId].radius * TILE_PX;

/**
 * A status as a clock: how hard it bites, and how much of it is left.
 *
 * A flat ring said "slowed" and nothing else — not how much, and not how long,
 * which are the two things a player actually decides on. The track is the full
 * circle at low alpha and the bright arc burns down as the status expires, so a
 * well wearing off is visible *before* the contact speeds up.
 */
function drawSlowClock(g: Graphics, c: Creep, r: number): void {
  if (c.slowTimer <= 0 || c.slowMax <= 0) return;

  const cx = c.x * TILE_PX;
  const cy = c.y * TILE_PX;

  // 0 at no slow, 1 at a full stop. Singularity's 0.8 factor is a fifth of the
  // way up that scale, so the width range is deliberately narrow — this has to
  // read as emphasis, not as a different effect.
  const bite = Math.min(1, Math.max(0, 1 - c.slowFactor));
  const width = 1.5 + bite * 5;

  g.circle(cx, cy, r).stroke({ width, color: THEME.fx.slowRing, alpha: 0.16 });

  // Clockwise from twelve, so a nearly-expired status is a short stub at the top
  // rather than a gap that has to be measured against nothing.
  const start = -Math.PI / 2;
  strokeArc(g, cx, cy, r, start, start + Math.PI * 2 * (c.slowTimer / c.slowMax), {
    width,
    color: THEME.fx.slowRing,
    alpha: 0.85,
  });
}

/**
 * Hull, and the overshield above it.
 *
 * Undamaged contacts get no bar: a board of full bars is noise, and the bar
 * *appearing* is itself the signal that something is being worked on. A shielded
 * contact is exempt from that — its shield regenerating back to full is exactly
 * the thing the player needs to see, and hiding the bar the moment it recovered
 * would hide the whole mechanic.
 */
function drawHealth(g: Graphics, c: Creep, r: number): void {
  const frac = c.hp / c.maxHp;
  const shieldFrac = c.maxShield > 0 ? c.shield / c.maxShield : 0;
  if (frac >= 0.999 && shieldFrac >= 0.999) return;

  const x = c.x * TILE_PX - BAR_W / 2;
  const y = c.y * TILE_PX - r - BAR_GAP - BAR_H;

  g.rect(x, y, BAR_W, BAR_H).fill({ color: THEME.fx.hpTrack, alpha: 0.8 });
  g.rect(x, y, BAR_W * frac, BAR_H).fill(frac < 0.3 ? THEME.fx.hpLow : THEME.fx.hpFull);

  // The shield sits as its own band *above* the hull bar rather than as a
  // segment within it, so a full shield over a hurt hull reads as two separate
  // quantities instead of one confusingly long bar.
  if (c.maxShield > 0) {
    g.rect(x, y - SHIELD_GAP, BAR_W, SHIELD_H).fill({ color: THEME.fx.hpTrack, alpha: 0.8 });
    if (shieldFrac > 0) {
      g.rect(x, y - SHIELD_GAP, BAR_W * shieldFrac, SHIELD_H).fill(THEME.fx.shield);
    }
  }
}

export class CreepChrome {
  private readonly gfx = new Graphics();

  constructor(layers: Layers) {
    layers.effects.addChild(this.gfx);
  }

  /**
   * Redrawn wholesale each frame: a contact's chrome is a pure function of its
   * state, so there is nothing to reconcile and no invalidation to get wrong
   * when it takes a hit.
   *
   * Indicators are called explicitly rather than iterated from a registry — the
   * list is short, the call order is the stacking order, and this loop runs a
   * couple of hundred times a frame, which is the one place in the renderer
   * where an indirection per entity would actually be felt.
   */
  sync(w: World): void {
    const g = this.gfx;
    g.clear();

    for (const c of w.creeps) {
      if (c.dead) continue;
      const r = bodyRadius(c);
      drawSlowClock(g, c, r + RING_GAP);
      drawHealth(g, c, r);
    }
  }
}
