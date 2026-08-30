import { applyCommands } from './systems/commands.ts';
import { moveCreeps } from './systems/movement.ts';
import { cleanup } from './systems/cleanup.ts';
import type { World } from './world.ts';

/**
 * Advance the world by exactly one tick.
 *
 * `dt` is always the same value — the loop never passes it a wall-clock delta.
 * That single constraint is what makes the simulation replayable, testable
 * headlessly, and fair between two machines of different speeds in Race mode.
 *
 * Phase order is deliberate and is the closest thing this codebase has to a
 * spec. Commands first so player actions land before anything moves; cleanup
 * last so every system sees a stable array.
 */
export function stepWorld(w: World, dt: number): void {
  applyCommands(w);
  // M3: updateWaves(w, dt)
  moveCreeps(w, dt);
  // M5: fireTowers(w, dt); stepProjectiles(w, dt)
  cleanup(w);

  w.time += dt;
  w.tick++;
}
