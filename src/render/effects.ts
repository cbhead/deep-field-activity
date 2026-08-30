import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import type { UiPrefs } from '../app/uiState.ts';
import { formatDamage } from '../sim/analysis.ts';
import type { SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { TILE_PX } from './constants.ts';
import type { Layers } from './pixiApp.ts';
import { BAKE_NEUTRAL, THEME } from './theme.ts';

/**
 * Transient combat feedback: health bars, floating damage, death bursts,
 * tracers, and the leak flare.
 *
 * Everything here is anchored to something short-lived — a contact's health bar
 * dies with the contact, a tracer with the shot — and the three rules below all
 * follow from that. A station outlives the whole run, so its chrome is not here;
 * see `towerChrome.ts`, which states the boundary.
 *
 * Three rules shape this file.
 *
 * **One Graphics for each *class* of thing, not one per entity.** Health bars
 * and tracers are redrawn from scratch every frame into a single Graphics
 * apiece. That is two draw calls total no matter how many creeps are alive,
 * where a Graphics per creep would be hundreds and would break the sprite batch
 * that `textures.ts` exists to protect.
 *
 * **Everything is droppable.** Effects are driven from discrete events, and a
 * burst of them — returning from a backgrounded tab, or a wipe at 4× — must
 * degrade rather than pile up. Pools are fixed size and the oldest entry is
 * recycled when they fill.
 *
 * **`Math.random` is correct here and nowhere else.** Scatter on a death burst
 * must NOT come from the seeded stream: presentation randomness that touched
 * the sim's RNG would desync two Race clients the moment one of them dropped a
 * frame. The eslint boundary enforces the split; this comment records why.
 */

/** Live floating numbers. Past this the oldest is recycled. */
const MAX_NUMBERS = 40;
/** Live death-burst particles. */
const MAX_PARTICLES = 160;
/**
 * Live detonation rings. Far smaller than the particle cap on purpose — a Nova
 * fires every 1.4s, so more than a handful on screen means something has gone
 * wrong rather than that the player needs to see all of them.
 */
const MAX_BLASTS = 12;

/**
 * A single frame may drain far more events than are worth drawing — a wipe at
 * 4×, or the backlog after an unpause. Past this many in one frame we stop
 * spawning effects for the rest of it; the sim is unaffected.
 */
const EVENTS_PER_FRAME_BUDGET = 24;

/**
 * `fill` is not optional here, and the reason is worth stating.
 *
 * Pixi defaults text to BLACK, and these numbers are recoloured per firing
 * station with `.tint` — which *multiplies*. Black times any tint is still
 * black, so leaving the fill out did not produce "default-coloured" text, it
 * produced permanently invisible text on a near-black board. Baking the fill
 * neutral is what makes the tint mean anything, exactly as it does for every
 * texture in `textures.ts`.
 */
const NUMBER_STYLE: TextStyleOptions = {
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  fontSize: 13,
  fontWeight: '700',
  fill: BAKE_NEUTRAL,
  // Damage numbers spawn on top of the contact that was hit, which is the
  // brightest thing on the board. Without an outline they wash out against it.
  stroke: { color: THEME.fx.textOutline, width: 3, join: 'round' },
};

interface FloatingNumber {
  text: Text;
  life: number;
  ttl: number;
  vx: number;
  vy: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  tint: number;
}

/** An expanding detonation ring, drawn at the blast's true radius. */
interface Blast {
  x: number;
  y: number;
  /** Board px, converted from the tile radius the event carried. */
  radius: number;
  life: number;
  ttl: number;
  tint: number;
}

export class Effects {
  private readonly bars = new Graphics();
  private readonly burst = new Graphics();
  private readonly rim = new Graphics();
  private readonly numberLayer = new Container();

  private readonly numbers: FloatingNumber[] = [];
  private readonly particles: Particle[] = [];
  private readonly blasts: Blast[] = [];

  /** Seconds of red rim left to show after a leak. */
  private leakRim = 0;

  private spawnedThisFrame = 0;

  constructor(
    layers: Layers,
    private readonly boardW: number,
    private readonly boardH: number,
  ) {
    layers.effects.addChild(this.bars, this.burst, this.numberLayer);
    // The rim belongs on top of everything world-anchored, but under the DOM
    // HUD — the overlay layer is exactly that slot.
    layers.overlay.addChild(this.rim);
  }

  beginFrame(): void {
    this.spawnedThisFrame = 0;
  }

  onEvent(ev: SimEvent, prefs: UiPrefs): void {
    if (this.spawnedThisFrame >= EVENTS_PER_FRAME_BUDGET) return;

    switch (ev.type) {
      case 'creepDamaged': {
        if (!prefs.damageNumbers) break;
        this.spawnedThisFrame++;
        // A hit the overshield ate whole is coloured as the shield rather than
        // as the station that fired it. That trades away attribution, on
        // purpose: while a Warden is soaking fire, *which* station is hitting it
        // matters far less than the fact that none of it is reaching the hull.
        // A volley into a shield now reads as a wall of blue at a glance, which
        // is the difference between "my stations are broken" and "close the gap
        // and it cannot regenerate".
        const allShield = ev.toShield > 0 && ev.toShield >= ev.amount - 1e-6;
        const tint = allShield
          ? THEME.fx.shield
          : ev.defId === null
            ? THEME.fx.damageText
            : THEME.towers[ev.defId];
        // Bracketed as well as recoloured, and the brackets are the part that
        // actually works. `fx.shield` (#9fbcff) and Lance's tint (#8fc4fa) are
        // two nearly identical blues, so a Lance emptying itself into an
        // overshield would have looked exactly like a Lance hurting the hull —
        // the tint alone silently fails for one station in three. Parentheses
        // carry the meaning on their own: this one did not reach the hull.
        const label = `−${formatDamage(ev.amount)}`;
        this.addNumber(allShield ? `(${label})` : label, ev.x, ev.y, tint);
        break;
      }
      case 'blast':
        this.spawnedThisFrame++;
        this.addBlast(ev.x, ev.y, ev.radius, THEME.towers[ev.defId]);
        break;
      case 'creepKilled':
        this.spawnedThisFrame++;
        // The contact's own colour, not a fixed one. This was hardcoded to
        // drifter back when drifter was the only type, which would have made
        // every Monolith and Mote burst in the wrong colour.
        this.addBurst(ev.x, ev.y, THEME.enemies[ev.defId]);
        break;
      case 'creepSplit':
        this.spawnedThisFrame++;
        // Tinted as the *children*, so the burst reads as "these are what you
        // now have to deal with" rather than as an ordinary kill.
        this.addBurst(ev.x, ev.y, THEME.enemies[ev.into]);
        break;
      case 'shieldBroke':
        this.spawnedThisFrame++;
        this.addBurst(ev.x, ev.y, THEME.fx.shield);
        break;
      case 'creepLeaked':
        this.spawnedThisFrame++;
        this.leakRim = 0.6;
        this.addBurst(ev.x, ev.y, THEME.fx.leak);
        break;
      default:
        break;
    }
  }

  private addNumber(label: string, tileX: number, tileY: number, tint: number): void {
    let slot = this.numbers.find((n) => n.life >= n.ttl);
    if (slot === undefined) {
      if (this.numbers.length >= MAX_NUMBERS) {
        // Recycle the oldest rather than growing without bound.
        slot = this.numbers.reduce((a, b) => (a.life > b.life ? a : b));
      } else {
        const text = new Text({ text: label, style: NUMBER_STYLE });
        text.anchor.set(0.5, 1);
        this.numberLayer.addChild(text);
        slot = { text, life: 0, ttl: 0.7, vx: 0, vy: -26 };
        this.numbers.push(slot);
      }
    }

    slot.text.text = label;
    slot.text.tint = tint;
    slot.text.alpha = 1;
    slot.text.visible = true;
    // Scattered, not stacked. Rapid fire on one contact used to drop every
    // number on the same pixel column, which armour turned from untidy into
    // wrong: the reading the player now has to make is "−3 here, −8 there", and
    // a pile of overlapping glyphs is exactly the reading it prevents. An
    // initial offset separates numbers that spawn on the same frame; the
    // divergent drift keeps them apart as they rise.
    //
    // `Math.random` is correct here — see the file note. This is presentation
    // scatter and must never touch the seeded stream.
    slot.vx = (Math.random() - 0.5) * 34;
    slot.text.position.set(
      tileX * TILE_PX + (Math.random() - 0.5) * 14,
      tileY * TILE_PX - 8 - Math.random() * 6,
    );
    slot.life = 0;
    slot.ttl = 0.7;
  }

  private addBurst(tileX: number, tileY: number, tint: number): void {
    const x = tileX * TILE_PX;
    const y = tileY * TILE_PX;
    for (let i = 0; i < 7; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      // Presentation randomness — deliberately Math.random, see the file note.
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 70;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        ttl: 0.35 + Math.random() * 0.25,
        tint,
      });
    }
  }

  /**
   * A detonation ring that expands to the blast's *actual* radius.
   *
   * Splash was the mechanic you paid a premium for and could never see. Drawing
   * it at the radius carried on the event — rather than at some fixed
   * decorative size — makes the ring a usable readout: the player can see
   * whether the contacts that survived were inside the blast or outside it,
   * which is the whole placement question for a Nova.
   */
  private addBlast(tileX: number, tileY: number, tileRadius: number, tint: number): void {
    if (this.blasts.length >= MAX_BLASTS) this.blasts.shift();
    this.blasts.push({
      x: tileX * TILE_PX,
      y: tileY * TILE_PX,
      radius: tileRadius * TILE_PX,
      life: 0,
      ttl: 0.3,
      tint,
    });
  }

  /**
   * `dt` is wall-clock seconds, not sim time: these are presentation and should
   * decay at the same rate whether the game is running at 1× or 4×, or paused.
   */
  update(w: World, dt: number): void {
    this.drawBars(w);
    this.stepNumbers(dt);
    this.stepParticles(dt);
    this.stepBlasts(dt);
    this.stepRim(dt);
  }

  /**
   * Health bars, slow clocks and projectile tracers — one Graphics between them.
   *
   * `prefs` is gone from here: the only thing that read it was the always-on
   * reach circle, which belongs to the station rather than to any transient
   * entity and moved to `towerChrome.ts` with the rest of the station's chrome.
   */
  private drawBars(w: World): void {
    const g = this.bars;
    g.clear();

    for (const p of w.projectiles) {
      if (p.dead) continue;

      // A piercing shot draws the *whole* track it has crossed, not a stub.
      //
      // Pierce is the thing Lance's price is paid for and it was invisible: a
      // dot with a short tail looks identical whether it passed through three
      // contacts or missed everything. The full line is the mechanic — it lies
      // across the contacts it hit, so "line them up" stops being folklore and
      // becomes something the board shows you.
      // The shot's own snapshot, matching the flight branch in the sim.
      if (p.stats.pierce > 0) {
        g.moveTo(p.ox * TILE_PX, p.oy * TILE_PX)
          .lineTo(p.x * TILE_PX, p.y * TILE_PX)
          .stroke({ width: 2, color: THEME.towers[p.defId], alpha: 0.42 });
        continue;
      }

      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      // A short tail pointing back the way it came, so fire reads as a tracer
      // rather than a floating dot.
      const k = Math.min(0.55, len) / len;
      g.moveTo(p.x * TILE_PX - dx * k * TILE_PX, p.y * TILE_PX - dy * k * TILE_PX)
        .lineTo(p.x * TILE_PX, p.y * TILE_PX)
        .stroke({ width: 2, color: THEME.towers[p.defId], alpha: 0.4 });
    }

    for (const c of w.creeps) {
      if (c.dead) continue;

      // Ahead of the health-bar early-out below: a contact held in a well reads
      // as slowed whether or not it has been scratched yet, and it shares the
      // bars Graphics rather than taking one of its own.
      //
      // A flat ring said "slowed" and nothing else — not how much, and not how
      // long is left, which are the two things a player actually decides on.
      // The ring is now a clock: a faint full track with a bright arc burning
      // down as the slow expires, thickening with how hard the slow bites. A
      // well wearing off is visible *before* the contact speeds up.
      if (c.slowTimer > 0 && c.slowMax > 0) {
        const cx = c.x * TILE_PX;
        const cy = c.y * TILE_PX;
        const r = TILE_PX * 0.36;
        // 0 at no slow, 1 at a full stop. Singularity's 0.8 factor is a fifth
        // of the way up that scale, so the width range is deliberately narrow —
        // this has to read as emphasis, not as a different effect.
        const bite = Math.min(1, Math.max(0, 1 - c.slowFactor));
        const width = 1.5 + bite * 5;

        g.circle(cx, cy, r).stroke({ width, color: THEME.fx.slowRing, alpha: 0.16 });

        // Clockwise from twelve, so a nearly-expired slow is a short stub at
        // the top rather than a gap that has to be measured against nothing.
        //
        // The `moveTo` is load-bearing, not tidiness. `arc` behaves like the
        // canvas primitive it wraps: with a path already open it draws a
        // connecting line from the current point to where the arc begins. Every
        // slowed contact was therefore trailing a stray line back to whatever
        // shape happened to be drawn before it — long diagonals across the
        // board that looked like a projectile bug. Seeding the path at the arc's
        // own start point is what makes the sub-path independent.
        const start = -Math.PI / 2;
        g.moveTo(cx, cy - r)
          .arc(cx, cy, r, start, start + Math.PI * 2 * (c.slowTimer / c.slowMax))
          .stroke({ width, color: THEME.fx.slowRing, alpha: 0.85 });
      }

      const frac = c.hp / c.maxHp;
      const shieldFrac = c.maxShield > 0 ? c.shield / c.maxShield : 0;
      // Undamaged creeps get no bar: a board of full bars is noise, and the
      // bar appearing is itself the signal that something is being worked on.
      // A shielded contact is exempt — its shield regenerating back to full is
      // exactly the thing the player needs to see, and hiding the bar the
      // moment it recovered would hide the whole mechanic.
      if (frac >= 0.999 && shieldFrac >= 0.999) continue;

      const wpx = 32;
      const x = c.x * TILE_PX - wpx / 2;
      const y = c.y * TILE_PX - TILE_PX * 0.42;
      g.rect(x, y, wpx, 4).fill({ color: THEME.fx.hpTrack, alpha: 0.8 });
      g.rect(x, y, wpx * frac, 4).fill(frac < 0.3 ? THEME.fx.hpLow : THEME.fx.hpFull);

      // The shield sits as its own band *above* the hull bar rather than as a
      // segment within it, so a full shield over a hurt hull reads as two
      // separate quantities instead of one confusingly long bar.
      if (c.maxShield > 0) {
        g.rect(x, y - 3.5, wpx, 2.5).fill({ color: THEME.fx.hpTrack, alpha: 0.8 });
        if (shieldFrac > 0) {
          g.rect(x, y - 3.5, wpx * shieldFrac, 2.5).fill(THEME.fx.shield);
        }
      }
    }

  }

  private stepNumbers(dt: number): void {
    for (const n of this.numbers) {
      if (n.life >= n.ttl) continue;
      n.life += dt;
      const k = n.life / n.ttl;
      n.text.x += n.vx * dt;
      n.text.y += n.vy * dt;
      n.text.alpha = 1 - k * k;
      if (n.life >= n.ttl) n.text.visible = false;
    }
  }

  private stepParticles(dt: number): void {
    const g = this.burst;
    g.clear();

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life += dt;
      if (p.life >= p.ttl) {
        this.particles[i] = this.particles[this.particles.length - 1]!;
        this.particles.pop();
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // A little drag, so a burst settles instead of flying off the board.
      p.vx *= 0.92;
      p.vy *= 0.92;
      const k = 1 - p.life / p.ttl;
      g.circle(p.x, p.y, 1 + k * 2).fill({ color: p.tint, alpha: k });
    }
  }

  /**
   * Drawn into the burst Graphics, which `stepParticles` has just cleared — so
   * this must run after it. One more shape in an existing draw call rather than
   * a Graphics of its own, for the reason at the top of this file.
   */
  private stepBlasts(dt: number): void {
    const g = this.burst;

    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i]!;
      b.life += dt;
      if (b.life >= b.ttl) {
        this.blasts[i] = this.blasts[this.blasts.length - 1]!;
        this.blasts.pop();
        continue;
      }
      const k = b.life / b.ttl;
      // Snaps out to full radius and holds there while fading, rather than
      // easing linearly: the useful frame is the one showing where the edge
      // fell, so the ring should spend its life at the size that answers that.
      const r = b.radius * Math.min(1, k * 2.2);
      g.circle(b.x, b.y, r).stroke({ width: 2, color: b.tint, alpha: 0.75 * (1 - k) });
    }
  }

  /** The screen-edge pulse on a leak — the signal you catch while looking away. */
  private stepRim(dt: number): void {
    const g = this.rim;
    g.clear();
    if (this.leakRim <= 0) return;

    this.leakRim = Math.max(0, this.leakRim - dt);
    const k = this.leakRim / 0.6;
    const band = 46;

    // Four inward-fading bands rather than a filter: a real inset glow would
    // need a blur pass, which is exactly the per-object filter cost this
    // renderer is built to avoid.
    for (let i = 0; i < 4; i++) {
      const inset = (band / 4) * i;
      const alpha = k * 0.16 * (1 - i / 4);
      g.rect(inset, inset, this.boardW - inset * 2, this.boardH - inset * 2).stroke({
        width: band / 4,
        color: THEME.fx.leak,
        alpha,
      });
    }
  }
}
