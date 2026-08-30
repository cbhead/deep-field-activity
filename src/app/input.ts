import type { Application } from 'pixi.js';
import type { TileCoord } from '../content/types.ts';
import { TILE_PX } from '../render/constants.ts';
import type { World } from '../sim/world.ts';

/**
 * Screen pixels → tile coordinate.
 *
 * Goes through the canvas bounding rect rather than assuming a 1:1 mapping,
 * because `fitCanvas` letterboxes the board by CSS size — the element is
 * routinely smaller than the stage it draws. M4's placement ghost reuses this.
 */
export function pointerToTile(app: Application, ev: PointerEvent): TileCoord {
  const rect = app.canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * app.screen.width;
  const y = ((ev.clientY - rect.top) / rect.height) * app.screen.height;
  return [Math.floor(x / TILE_PX), Math.floor(y / TILE_PX)];
}

/**
 * Input never mutates the world. It translates a gesture into a Command and
 * queues it; the sim applies it at the top of the next tick.
 */
export function attachInput(app: Application, world: World): void {
  app.canvas.addEventListener('pointerdown', (rawEvent) => {
    const ev = rawEvent as PointerEvent;
    const [col, row] = pointerToTile(app, ev);
    console.info(`[td] click → tile ${col},${row}`);

    // M2 scaffolding: any click spawns a creep so the path can be watched.
    // M4 replaces this with the build commands.
    world.commands.push({ type: 'spawnDebugCreep' });
  });
}
