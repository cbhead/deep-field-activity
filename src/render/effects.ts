import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import type { UiPrefs } from '../app/uiState.ts';
import type { SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { TILE_PX } from './constants.ts';
import type { Layers } from './pixiApp.ts';
import { BAKE_NEUTRAL, THEME } from './theme.ts';

/**
 * Transient combat feedback: health bars, floating damage, death bursts,
 * tracers, and the leak flare.
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

export class Effects {
  private readonly bars = new Graphics();
  private readonly burst = new Graphics();
  private readonly rim = new Graphics();
  private readonly numberLayer = new Container();

  private readonly numbers: FloatingNumber[] = [];
  private readonly particles: Particle[] = [];

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
        const tint = ev.defId === null ? THEME.fx.damageText : THEME.towers[ev.defId];
        this.addNumber(`−${Math.round(ev.amount)}`, ev.x, ev.y, tint);
        break;
      }
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
        slot = { text, life: 0, ttl: 0.7, vy: -26 };
        this.numbers.push(slot);
      }
    }

    slot.text.text = label;
    slot.text.tint = tint;
    slot.text.alpha = 1;
    slot.text.visible = true;
    slot.text.position.set(tileX * TILE_PX, tileY * TILE_PX - 8);
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
   * `dt` is wall-clock seconds, not sim time: these are presentation and should
   * decay at the same rate whether the game is running at 1× or 4×, or paused.
   */
  update(w: World, dt: number, prefs: UiPrefs): void {
    this.drawBars(w, prefs);
    this.stepNumbers(dt);
    this.stepParticles(dt);
    this.stepRim(dt);
  }

  /** Health bars and projectile tracers — one Graphics between them. */
  private drawBars(w: World, prefs: UiPrefs): void {
    const g = this.bars;
    g.clear();

    for (const p of w.projectiles) {
      if (p.dead) continue;
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
      if (c.slowTimer > 0) {
        g.circle(c.x * TILE_PX, c.y * TILE_PX, TILE_PX * 0.36).stroke({
          width: 2,
          color: THEME.fx.slowRing,
          alpha: 0.5,
        });
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

    // Reach circles for every placed station, when the player asked for them.
    if (prefs.reachCircles === 'always') {
      for (const t of w.towers) {
        g.circle(t.x * TILE_PX, t.y * TILE_PX, t.range * TILE_PX).stroke({
          width: 1,
          color: THEME.towers[t.defId],
          alpha: 0.16,
        });
      }
    }
  }

  private stepNumbers(dt: number): void {
    for (const n of this.numbers) {
      if (n.life >= n.ttl) continue;
      n.life += dt;
      const k = n.life / n.ttl;
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
