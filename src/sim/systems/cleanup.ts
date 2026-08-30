import type { World } from '../world.ts';

/**
 * Remove dead entities, once, at the end of the tick.
 *
 * Deferring removal to a single phase means no system ever iterates an array
 * that another system is splicing underneath it — the classic source of skipped
 * entities. Swap-remove iterating backwards is O(1) per removal and does not
 * care that it reorders the array, because nothing depends on entity order.
 */
export function cleanup(w: World): void {
  sweep(w.creeps);
  sweep(w.projectiles);
}

function sweep(list: { dead: boolean }[]): void {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.dead) {
      list[i] = list[list.length - 1]!;
      list.pop();
    }
  }
}
