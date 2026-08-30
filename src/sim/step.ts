import { applyCommands } from './systems/commands.ts';
import { updateWaves } from './systems/waves.ts';
import { updateStatuses } from './systems/status.ts';
import { moveCreeps } from './systems/movement.ts';
import { fireTowers } from './systems/targeting.ts';
import { stepProjectiles } from './systems/projectiles.ts';
import { resolveSplits } from './systems/splits.ts';
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
  // A finished match freezes rather than continuing to tick. M6 puts a result
  // screen over the top of it.
  if (w.phase !== 'playing') return;

  applyCommands(w);
  updateWaves(w, dt);
  // Shields recover before anything can shoot at them.
  updateStatuses(w, dt);
  moveCreeps(w, dt);
  // Fire before stepping: a projectile spawned this tick waits a tick before
  // moving, which is one frame of muzzle position rather than a shot that
  // teleports partway to its target the instant it appears.
  fireTowers(w, dt);
  stepProjectiles(w, dt);
  // After every system that iterates `w.creeps`, before the sweep that would
  // otherwise drop the parents the children are positioned from.
  resolveSplits(w);
  cleanup(w);

  // Checked after cleanup so the leak that emptied the life bar has already
  // been counted, and once only — the phase change stops the next tick.
  if (w.lives <= 0) {
    w.phase = 'lost';
    w.events.push({ type: 'gameOver', won: false });
  }

  w.time += dt;
  w.tick++;
}
