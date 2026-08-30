import { Sprite, type Container } from 'pixi.js';
import { ENEMIES } from '../content/enemies.ts';
import type { EntityId } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import type { Layers } from './pixiApp.ts';
import { TILE_PX } from './constants.ts';
import { THEME } from './theme.ts';
import { CREEP_BAKE_RADIUS, type Textures } from './textures.ts';

interface EntityView {
  sprite: Sprite;
  /** Frame this view was last matched to a live entity. See the sweep below. */
  seen: number;
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
  /** Towers never move and never die (until M7's sell), so a plain set suffices. */
  private readonly towers = new Set<EntityId>();
  private frame = 0;

  constructor(
    private readonly layers: Layers,
    private readonly textures: Textures,
  ) {}

  sync(w: World): void {
    this.frame++;

    for (const t of w.towers) {
      if (this.towers.has(t.id)) continue;
      const sprite = new Sprite(this.textures.tower);
      sprite.tint = THEME.towers[t.defId];
      sprite.position.set(t.col * TILE_PX, t.row * TILE_PX);
      this.layers.towers.addChild(sprite);
      this.towers.add(t.id);
    }

    // --- Channel 1: pull continuous state. Idempotent, so a dropped frame
    // costs nothing.
    this.syncEntities(w.creeps, this.creeps, this.layers.creeps, (c) => {
      const def = ENEMIES[c.defId];
      const sprite = new Sprite(this.textures.creep);
      sprite.anchor.set(0.5);
      sprite.tint = THEME.enemies[c.defId];
      sprite.scale.set(def.radius / CREEP_BAKE_RADIUS);
      return sprite;
    });

    this.syncEntities(w.projectiles, this.projectiles, this.layers.projectiles, (p) => {
      const sprite = new Sprite(this.textures.projectile);
      sprite.anchor.set(0.5);
      sprite.tint = THEME.towers[p.defId];
      return sprite;
    });

    // --- Channel 2: drain discrete events. These are instants; if we miss one
    // the effect simply never plays, which is why they are pushed rather than
    // polled. M6 turns these into HUD updates; M8 gives them impact. Until then
    // the console is the HUD.
    for (const ev of w.events) {
      switch (ev.type) {
        case 'creepLeaked':
          console.info(`[td] leak at (${ev.x.toFixed(1)}, ${ev.y.toFixed(1)}) — ${w.lives} lives left`);
          break;
        case 'creepKilled':
          // Far too chatty to log per kill; M8 turns this into a particle burst
          // and a floating damage number.
          break;
        case 'waveStarted':
          console.info(`[td] wave ${ev.wave + 1} — ${ev.count} incoming`);
          break;
        case 'waveCleared':
          console.info(`[td] wave ${ev.wave + 1} cleared — $${w.money}`);
          break;
        case 'waveRushed':
          console.info(`[td] rushed wave ${ev.wave + 1} — +$${ev.bonus} for ${ev.secondsSaved.toFixed(1)}s saved`);
          break;
        case 'waveRejected':
          console.info(
            ev.reason === 'spawning'
              ? '[td] wave already spawning — wait for it to finish'
              : '[td] no waves left to send',
          );
          break;
        case 'towerPlaced':
          console.info(`[td] built at ${ev.col},${ev.row} — $${w.money} left`);
          break;
        case 'buildRejected':
          console.info(`[td] build rejected: ${ev.reason}`);
          break;
        case 'gameOver':
          console.info(`[td] ${ev.won ? 'VICTORY' : 'DEFEAT'} at ${w.time.toFixed(1)}s`);
          break;
      }
    }
    w.events.length = 0;
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
        view = { sprite, seen: 0 };
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
