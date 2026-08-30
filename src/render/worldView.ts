import { Sprite, type Container, type Texture } from 'pixi.js';
import { ENEMIES } from '../content/enemies.ts';
import type { EntityId, SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import type { Layers } from './pixiApp.ts';
import { TILE_PX } from './constants.ts';
import { THEME } from './theme.ts';
import { CREEP_BAKE_RADIUS, type Textures } from './textures.ts';

/**
 * How long a hit flash takes to fall back to the contact's own colour, in
 * wall-clock seconds. Short enough that a contact under sustained fire reads as
 * bright rather than as a strobe.
 */
const FLASH_SECONDS = 0.1;

interface EntityView {
  sprite: Sprite;
  /** Frame this view was last matched to a live entity. See the sweep below. */
  seen: number;
  /**
   * Hit flash remaining, 1 → 0. It lives on the view rather than in a table of
   * its own so the sweep below disposes of it along with the sprite; a side
   * table would have to be swept in step, and would leak the first time it
   * wasn't. Only contacts ever raise it.
   */
  flash: number;
}

interface TowerView {
  sprite: Sprite;
  seen: number;
  /** Last tier drawn, so an upgrade swaps the texture and nothing else does. */
  tier: number;
}

/** The minimum a thing needs to be drawable by `syncEntities`. */
interface Drawable {
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
}

/**
 * Maintains a sprite per live entity by reading the world each frame.
 *
 * Not immutable snapshots plus diffing — that is a React reflex, and here it
 * would allocate tens of thousands of objects per second to describe things
 * that barely changed. The renderer reads the sim's mutable objects directly
 * and never writes to them.
 */
export class WorldView {
  private readonly creeps = new Map<EntityId, EntityView>();
  private readonly projectiles = new Map<EntityId, EntityView>();
  /**
   * Towers go through the same mark-and-sweep as everything else.
   *
   * They used to be a plain Set on the reasoning that a tower never moves and
   * never dies — but selling shipped, and a Set that is only ever added to left
   * the sprite of a sold tower on the board forever. The sweep disposes of it
   * for free, and the cached tier is what lets an upgrade re-texture in place.
   */
  private readonly towers = new Map<EntityId, TowerView>();
  private frame = 0;

  constructor(
    private readonly layers: Layers,
    private readonly textures: Textures,
  ) {}

  /**
   * `dt` is wall-clock seconds, not sim time: the hit flash is presentation and
   * must look identical at 1× and 4×. It is defaulted rather than required so a
   * call site that has not been updated decays at an assumed 60Hz instead of
   * leaving struck contacts stuck white.
   */
  sync(w: World, dt = 1 / 60): void {
    this.frame++;

    for (const t of w.towers) {
      let view = this.towers.get(t.id);
      if (view === undefined) {
        const sprite = new Sprite(this.tierTexture(t.tier));
        sprite.tint = THEME.towers[t.defId];
        sprite.position.set(t.col * TILE_PX, t.row * TILE_PX);
        this.layers.towers.addChild(sprite);
        view = { sprite, seen: 0, tier: t.tier };
        this.towers.set(t.id, view);
      } else if (view.tier !== t.tier) {
        // Swap the texture rather than rebuild the sprite: position, tint and
        // parent are all still correct, and every tier bakes to the same 40x40
        // frame so the silhouette does not move.
        view.sprite.texture = this.tierTexture(t.tier);
        view.tier = t.tier;
      }
      view.seen = this.frame;
    }

    for (const [id, view] of this.towers) {
      if (view.seen !== this.frame) {
        view.sprite.destroy();
        this.towers.delete(id);
      }
    }

    // --- Channel 1: pull continuous state. Idempotent, so a dropped frame
    // costs nothing.
    this.syncEntities(w.creeps, this.creeps, this.layers.creeps, (c) => {
      const def = ENEMIES[c.defId];
      // Armour is a property of the type and never changes, so the silhouette
      // is chosen once at creation — unlike a tower's tier, which has to be
      // watched every frame for upgrades.
      const sprite = new Sprite(def.armor > 0 ? this.textures.creepPlated : this.textures.creep);
      sprite.anchor.set(0.5);
      sprite.tint = THEME.enemies[c.defId];
      sprite.scale.set(def.radius / CREEP_BAKE_RADIUS);
      return sprite;
    });

    this.stepFlashes(w, dt);

    this.syncEntities(w.projectiles, this.projectiles, this.layers.projectiles, (p) => {
      const sprite = new Sprite(this.textures.projectile);
      sprite.anchor.set(0.5);
      sprite.tint = THEME.towers[p.defId];
      return sprite;
    });

    // --- Channel 2: discrete events, which arrive through `onEvent`. They are
    // drained once, in main.ts, and fanned out to this view, the effects layer
    // and the HUD. Draining them here would mean whichever consumer ran first
    // silently starved the others.
  }

  /** Clamped, so a tier beyond the baked set degrades to the top art rather than throwing. */
  private tierTexture(tier: number): Texture {
    const i = Math.min(Math.max(tier, 1), this.textures.towers.length) - 1;
    return this.textures.towers[i]!;
  }

  /**
   * A contact that just took damage flashes toward `THEME.fx.hitFlash`.
   *
   * `creepDamaged` carries the contact's id, so this is an O(1) lookup and the
   * flash is exact. Resolving it by proximity instead would light the wrong
   * contact whenever two overlap, and drop the effect entirely when a hitch
   * moved them further than the match radius in one frame — and would need a
   * per-frame scan budget to stay cheap. One field on the event removed all
   * three problems.
   *
   * A hit on something already gone (killed earlier in the same drain) finds
   * nothing and does nothing, which is correct.
   */
  onEvent(ev: SimEvent): void {
    if (ev.type !== 'creepDamaged') return;
    // A second hit restarts the flash rather than stacking on it, so a burst of
    // events costs one number per contact however many of them land.
    const view = this.creeps.get(ev.id);
    if (view !== undefined) view.flash = 1;
  }

  /**
   * Decay the live flashes and write the tint they imply.
   *
   * The step that takes a flash to zero writes `THEME.enemies[...]` exactly, so
   * a contact always lands back on its own colour rather than a rounding error
   * away from it, and every later frame skips it for nothing.
   */
  private stepFlashes(w: World, dt: number): void {
    const decay = dt / FLASH_SECONDS;
    for (const c of w.creeps) {
      const view = this.creeps.get(c.id);
      if (view === undefined || view.flash <= 0) continue;
      view.flash = Math.max(0, view.flash - decay);
      view.sprite.tint = mix(THEME.enemies[c.defId], THEME.fx.hitFlash, view.flash);
    }
  }

  /**
   * Mark-and-sweep rather than building a Set of live ids every frame: same
   * result, no per-frame allocation. Deleting while iterating a Map is safe.
   */
  private syncEntities<T extends Drawable>(
    list: readonly T[],
    views: Map<EntityId, EntityView>,
    layer: Container,
    create: (entity: T) => Sprite,
  ): void {
    for (const entity of list) {
      let view = views.get(entity.id);
      if (view === undefined) {
        const sprite = create(entity);
        layer.addChild(sprite);
        view = { sprite, seen: 0, flash: 0 };
        views.set(entity.id, view);
      }
      view.seen = this.frame;
      view.sprite.position.set(entity.x * TILE_PX, entity.y * TILE_PX);
    }

    for (const [id, view] of views) {
      if (view.seen !== this.frame) {
        view.sprite.destroy();
        views.delete(id);
      }
    }
  }
}

/**
 * Lerp between two packed 0xRRGGBB colours, channel by channel.
 *
 * Naive sRGB rather than anything perceptual: over a tenth of a second, between
 * two colours this saturated, the difference does not survive being looked at,
 * and a gamma-correct mix would cost two pows per channel per struck contact
 * per frame.
 */
function mix(from: number, to: number, k: number): number {
  const r = Math.round(((from >> 16) & 255) * (1 - k) + ((to >> 16) & 255) * k);
  const g = Math.round(((from >> 8) & 255) * (1 - k) + ((to >> 8) & 255) * k);
  const b = Math.round((from & 255) * (1 - k) + (to & 255) * k);
  return (r << 16) | (g << 8) | b;
}
