import { Sprite } from 'pixi.js';
import { ENEMIES } from '../content/enemies.ts';
import type { EntityId } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import type { Layers } from './pixiApp.ts';
import { TILE_PX } from './constants.ts';
import { CREEP_BAKE_RADIUS, type Textures } from './textures.ts';

interface CreepView {
  sprite: Sprite;
  /** Frame this view was last matched to a live creep. See the sweep below. */
  seen: number;
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
  private readonly creeps = new Map<EntityId, CreepView>();
  private frame = 0;

  constructor(
    private readonly layers: Layers,
    private readonly textures: Textures,
  ) {}

  sync(w: World): void {
    this.frame++;

    // --- Channel 1: pull continuous state. Idempotent, so a dropped frame
    // costs nothing.
    for (const c of w.creeps) {
      let view = this.creeps.get(c.id);
      if (view === undefined) {
        const def = ENEMIES[c.defId];
        const sprite = new Sprite(this.textures.creep);
        sprite.anchor.set(0.5);
        sprite.tint = def.color;
        sprite.scale.set(def.radius / CREEP_BAKE_RADIUS);
        this.layers.creeps.addChild(sprite);
        view = { sprite, seen: 0 };
        this.creeps.set(c.id, view);
      }
      view.seen = this.frame;
      view.sprite.position.set(c.x * TILE_PX, c.y * TILE_PX);
    }

    // Mark-and-sweep rather than building a Set of live ids every frame: same
    // result, no per-frame allocation. Deleting while iterating a Map is safe.
    for (const [id, view] of this.creeps) {
      if (view.seen !== this.frame) {
        view.sprite.destroy();
        this.creeps.delete(id);
      }
    }

    // --- Channel 2: drain discrete events. These are instants; if we miss one
    // the effect simply never plays, which is why they are pushed rather than
    // polled.
    // M6 turns these into HUD updates; M8 gives them sound and screen shake.
    // Until then the console is the HUD.
    for (const ev of w.events) {
      switch (ev.type) {
        case 'creepLeaked':
          console.info(`[td] leak at (${ev.x.toFixed(1)}, ${ev.y.toFixed(1)}) — ${w.lives} lives left`);
          break;
        case 'waveStarted':
          console.info(`[td] wave ${ev.wave + 1} — ${ev.count} incoming`);
          break;
        case 'waveCleared':
          console.info(`[td] wave ${ev.wave + 1} cleared — $${w.money}`);
          break;
        case 'gameOver':
          console.info(`[td] ${ev.won ? 'VICTORY' : 'DEFEAT'} at ${w.time.toFixed(1)}s`);
          break;
      }
    }
    w.events.length = 0;
  }
}
