import { Container, Graphics, Sprite } from 'pixi.js';
import { ENEMIES } from '../content/enemies.ts';
import type { Creep, EntityId, SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { contactShape } from './contactShape.ts';
import { TILE_PX } from './constants.ts';
import { strokeArc } from './draw.ts';
import type { Layers } from './pixiApp.ts';
import { THEME } from './theme.ts';
import { CREEP_BAKE_RADIUS, type Textures } from './textures.ts';
import { routeHeading } from './worldView.ts';

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
 * | 0 – R             | additive hit flash  | struck in the last 0.12s    |
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

/** How close two held contacts must be to count as one mass, in tiles. */
const FIELD_REACH = 1.15;

/** Below this a ring per contact is still the clearest thing to draw. */
const FIELD_MIN = 3;

/** How far the field puffs out past each member, in tiles. */
const FIELD_PAD = 0.62;

/**
 * One soft field per bunch of held contacts, drawn behind their clocks.
 *
 * A slow's whole job is to bunch contacts into a file, so the effect
 * manufactures the exact density at which its own indicator stops working: six
 * outlines at 40px spacing stop being six readings and become a texture, and
 * the player loses both *which are slowed* and *how many there are* at once.
 *
 * **The design's fix was to replace the rings at three or more. That would have
 * been right against the indicator it described — a plain outline — but the
 * shipped one is a clock**, whose arc burns down with the status and whose width
 * carries how hard the slow bites. Merging would have discarded both, in the
 * one situation where knowing which contact is about to speed up matters most.
 *
 * So the field goes *behind* instead: the group reads as one held mass at a
 * glance, and every contact keeps its own timer on top. It costs a little more
 * ink than the spec asked for and keeps two readings the spec would have spent.
 *
 * The union of overlapping soft discs has no outline, which is what makes this
 * read as a field rather than as a fat ring — the same trick the nebula uses.
 */
function drawSlowFields(g: Graphics, w: World): void {
  const held = w.creeps.filter((c) => !c.dead && c.slowTimer > 0);
  if (held.length < FIELD_MIN) return;

  const seen = new Set<number>();
  for (const start of held) {
    if (seen.has(start.id)) continue;

    // Flood outward from one held contact to everything transitively near it,
    // so a file of six is one field rather than four overlapping pairs.
    const group = [start];
    seen.add(start.id);
    for (let i = 0; i < group.length; i++) {
      const a = group[i]!;
      for (const b of held) {
        if (seen.has(b.id)) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) > FIELD_REACH) continue;
        seen.add(b.id);
        group.push(b);
      }
    }

    if (group.length < FIELD_MIN) continue;
    for (const c of group) {
      g.circle(c.x * TILE_PX, c.y * TILE_PX, (ENEMIES[c.defId].radius + FIELD_PAD) * TILE_PX).fill({
        color: THEME.fx.slowRing,
        alpha: 0.07,
      });
    }
  }
}

/**
 * A contact whose shield has started coming back.
 *
 * The band already shows the shield filling, but nothing marked the *moment*
 * regen began — so a Warden that healed in a coverage gap arrived whole with no
 * prior warning, and the player learned about the gap from the leak rather than
 * from the board.
 *
 * Blue, from `fx.shield`, which is already a separate token from the slow's
 * cyan `fx.slowRing`. "Must not read as the slow field" is therefore satisfied
 * by construction rather than by eye — and this is a filled halo where the slow
 * is a ring, so the two differ in shape as well as hue.
 */
function drawRegenHalo(g: Graphics, c: Creep, r: number): void {
  if (c.maxShield <= 0 || c.shieldTimer > 0 || c.shield >= c.maxShield) return;

  g.circle(c.x * TILE_PX, c.y * TILE_PX, r + HALO_PAD).fill({
    color: THEME.fx.shield,
    alpha: 0.14,
  });
}

/** Just outside the hull, inside the slow ring's band. */
const HALO_PAD = 3;

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
  // **1, not 0, when there is no shield.** At 0 the suppression below could
  // never fire for the four contacts that carry no overshield, so every
  // untouched Drifter, Mote, Cluster and Bulwark wore a full bar for its whole
  // life — the exact wall of noise the rule above exists to prevent, and
  // invisible in review because a full bar over a full-health contact looks
  // like a correctly working health bar.
  const shieldFrac = c.maxShield > 0 ? c.shield / c.maxShield : 1;
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

/**
 * How long a struck contact stays lit. Short enough that overlapping hits read
 * as a rate rather than as a steady glow, long enough to survive a dropped
 * frame — the same window the tint lerp used before the mechanism changed.
 */
const FLASH_SECONDS = 0.12;

/**
 * How bright a fresh hit is, as the additive sprite's alpha at t=0.
 *
 * Under 1 on purpose. Additive compositing already pushes a body toward its own
 * clipped white, and at full alpha the two brightest contacts — the Mote's core
 * and the Cluster's nuclei, which are the only baked values above their token —
 * would blow out to a shapeless blob, losing the silhouette in the one moment
 * the player is most likely to be looking at it.
 */
const FLASH_ALPHA = 0.7;

/** One contact's flash: how much is left, and which way its body is facing. */
interface Flash {
  t: number;
  rotation: number;
}

export class CreepChrome {
  private readonly gfx = new Graphics();
  /**
   * Its own container, added *before* the Graphics so every flash sits under
   * the bars and clocks. A hit must never white out the health bar that says
   * whether the hit mattered.
   */
  private readonly flashLayer = new Container();
  private readonly flashes = new Map<EntityId, Flash>();
  /** Grown on demand, never shrunk — a board's peak hit count is its steady state. */
  private readonly pool: Sprite[] = [];

  constructor(
    layers: Layers,
    private readonly textures: Textures,
  ) {
    layers.effects.addChild(this.flashLayer);
    layers.effects.addChild(this.gfx);
  }

  /**
   * The hit flash, which used to live in `worldView` as a tint lerped toward
   * white.
   *
   * That mechanism died with the neutral bake: `tint` multiplies, so against a
   * contact baked in its own final colours it can only ever darken. Brightening
   * now needs a second draw in `blendMode: 'add'` — the contact's own texture,
   * over itself, fading out.
   */
  onEvent(ev: SimEvent): void {
    if (ev.type !== 'creepDamaged') return;
    // Re-arm rather than accumulate: a contact under fire from four stations
    // should read as *lit*, not as four times as bright as one under fire from
    // one. Rate is already carried by the health bar draining.
    const flash = this.flashes.get(ev.id);
    if (flash === undefined) this.flashes.set(ev.id, { t: FLASH_SECONDS, rotation: 0 });
    else flash.t = FLASH_SECONDS;
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
  sync(w: World, dt: number): void {
    const g = this.gfx;
    g.clear();

    // A pass of its own, before the loop, because call order is stacking order:
    // the field has to sit *behind* the clocks rather than replace them.
    drawSlowFields(g, w);

    this.syncFlashes(w, dt);

    for (const c of w.creeps) {
      if (c.dead) continue;
      const r = bodyRadius(c);
      drawRegenHalo(g, c, r);
      drawSlowClock(g, c, r + RING_GAP);
      drawHealth(g, c, r);
    }
  }

  /**
   * Age every flash, then draw the ones still burning.
   *
   * Driven off the live creep list rather than off the flash map, so a contact
   * that died mid-flash simply stops being drawn — no separate cleanup, and no
   * frame where a bright ghost hangs over empty road. Stale entries are swept
   * by the timer regardless, which is what stops the map growing without bound
   * across a long run.
   *
   * `dt` is wall-clock, so the fade lasts the same tenth of a second at 1x and
   * at 4x. It is not a sim quantity and must not be scaled by one.
   */
  private syncFlashes(w: World, dt: number): void {
    for (const [id, flash] of this.flashes) {
      flash.t -= dt;
      if (flash.t <= 0) this.flashes.delete(id);
    }

    let used = 0;
    for (const c of w.creeps) {
      if (c.dead) continue;
      const flash = this.flashes.get(c.id);
      if (flash === undefined) continue;

      const def = ENEMIES[c.defId];
      const sprite = this.take(used++);
      sprite.texture = this.textures.contacts[c.defId];
      sprite.scale.set(def.radius / CREEP_BAKE_RADIUS);
      sprite.position.set(c.x * TILE_PX, c.y * TILE_PX);

      // Share the body's heading, or the Mote's flash would be a bright comet
      // pointing east over a comet pointing north. Held through the corner
      // frame where there is no heading to read.
      if (contactShape(c.defId).rotates) {
        flash.rotation = routeHeading(w, c) ?? flash.rotation;
        sprite.rotation = flash.rotation;
      } else {
        sprite.rotation = 0;
      }

      // Linear rather than eased: the fall-off is over a tenth of a second, so
      // a curve would cost a pow per struck contact per frame to describe
      // something nobody can see.
      sprite.alpha = FLASH_ALPHA * (flash.t / FLASH_SECONDS);
      sprite.visible = true;
    }

    // Suppression, the rule this whole layer is built on: a contact that is not
    // being struck draws nothing.
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.visible = false;
  }

  /** Pooled, because at full board this is called ~50 times a second. */
  private take(i: number): Sprite {
    const existing = this.pool[i];
    if (existing !== undefined) return existing;

    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    // The whole point of the layer. `add` against a coloured bake is the only
    // way to get *brighter* than the token — which is what a hit has to be.
    sprite.blendMode = 'add';
    this.pool.push(sprite);
    this.flashLayer.addChild(sprite);
    return sprite;
  }
}
