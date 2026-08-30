import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import type { UiPrefs } from '../app/uiState.ts';
import { formatDamage } from '../sim/analysis.ts';
import type { SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { TILE_PX } from './constants.ts';
import type { Layers } from './pixiApp.ts';
import { BAKE_NEUTRAL, THEME } from './theme.ts';

/**
 * Transient combat feedback: floating damage, death bursts, detonation rings,
 * shot tracers, and the leak flare.
 *
 * Everything here is **event-driven and droppable**. It is pushed by discrete
 * `SimEvent`s, pooled, and capped — a burst must degrade rather than pile up,
 * and a dropped particle costs nothing.
 *
 * State *readouts* are the opposite: pulled from the world every frame, and a
 * dropped frame would be a lie. Those live in the chrome layers, split by the
 * entity they hang off — `towerChrome.ts` and `creepChrome.ts`. That is the line
 * between these files and the rule for where a new indicator goes: if it answers
 * "what is true right now", it is chrome; if it answers "what just happened", it
 * is an effect.
 *
 * Tracers stay here because a shot *is* the transient thing — the tracer is the
 * event, not a readout of it.
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
  private readonly tracers = new Graphics();
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
    layers.effects.addChild(this.tracers, this.burst, this.numberLayer);
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
        this.addSplitPips(ev.x, ev.y, ev.count, THEME.enemies[ev.into]);
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
   * A Cluster's death, told apart from every other death.
   *
   * The kill that makes things *worse* looked exactly like the kill that makes
   * things better: both fired the same seven-particle scatter. So a Cluster
   * killed at the front of the route was a mistake the player only found out
   * about three Motes later, which is far too late to have placed anything
   * differently.
   *
   * `count` pips rather than a fixed scatter, evenly spaced and tinted as the
   * *children* — so the effect says how many are coming and what they are,
   * before any of them has walked. Evenly spaced rather than random because
   * three deliberate marks read as a count and seven random ones read as an
   * explosion, and this event is a count.
   */
  private addSplitPips(tileX: number, tileY: number, count: number, tint: number): void {
    const x = tileX * TILE_PX;
    const y = tileY * TILE_PX;
    // One random offset for the whole set, so the pips stay evenly spaced
    // relative to each other but successive splits do not stamp identically.
    const turn = Math.random() * Math.PI * 2;

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const angle = turn + (i / count) * Math.PI * 2;
      const speed = 95 + Math.random() * 25;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        // Short and uniform: this is an announcement, not debris.
        ttl: 0.25,
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
    this.drawTracers(w);
    this.stepNumbers(dt);
    this.stepParticles(dt);
    this.stepBlasts(dt);
    this.stepRim(dt);
  }

/** Shots in flight. A piercing one draws its whole track; the rest a short tail. */
  private drawTracers(w: World): void {
    const g = this.tracers;
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
