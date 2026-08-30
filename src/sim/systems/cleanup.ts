import type { World } from '../world.ts';

/**
 * Remove dead entities, once, at the end of the tick.
 *
 * Deferring removal to a single phase means no system ever iterates an array
 * that another system is splicing underneath it — the classic source of skipped
 * entities. Swap-remove iterating backwards is O(1) per removal and does not
 * care that it reorders the array, because nothing depends on creep order.
 */
export function cleanup(w: World): void {
  const creeps = w.creeps;
  for (let i = creeps.length - 1; i >= 0; i--) {
    if (creeps[i]!.dead) {
      creeps[i] = creeps[creeps.length - 1]!;
      creeps.pop();
    }
  }
}
