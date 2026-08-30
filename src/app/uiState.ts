import type { TowerId } from '../content/towers.ts';

/**
 * Presentation state that the simulation must never see.
 *
 * What is armed in the build bar and what tile the pointer is over are not
 * facts about the game world — two players watching the same replay would have
 * different values here. Keeping them out of `World` is what stops the sim
 * acquiring a notion of "the local player".
 */
export interface UiState {
  /** Tower type armed for placement, or null when not building. */
  selected: TowerId | null;
  /** Tile under the pointer; null when the pointer is off the board. */
  hover: readonly [number, number] | null;
}

export const createUiState = (): UiState => ({ selected: null, hover: null });
