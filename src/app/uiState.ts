import type { TowerId } from '../content/towers.ts';
import { isCompactViewport } from '../render/constants.ts';
import type { EntityId } from '../sim/types.ts';

/**
 * Presentation state that the simulation must never see.
 *
 * What is armed in the build bar, which station the inspector is showing, and
 * whether the deck is open are not facts about the game world — two players
 * watching the same replay would have different values here. Keeping them out
 * of `World` is what stops the sim acquiring a notion of "the local player",
 * and it is the same boundary Race mode will need.
 */
export interface UiPrefs {
  /** Show reach circles only under the pointer, or on every placed station. */
  reachCircles: 'hover' | 'always';
  damageNumbers: boolean;
  /**
   * The route's current. The one moving thing on the board layer.
   *
   * On by default, and off by default for anyone who has asked their system for
   * reduced motion — which has to be checked in JS, because the stylesheet's
   * `prefers-reduced-motion` block cannot reach a Pixi sprite.
   */
  stream: boolean;
}

/**
 * Read once at startup rather than watched.
 *
 * A player who changes the system setting mid-run can flip the toggle, and
 * live-watching it would mean the board could start moving underneath someone
 * who had asked it not to.
 */
const wantsMotion = (): boolean =>
  typeof matchMedia !== 'function' || !matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * On a landscape phone the deck starts closed.
 *
 * 150px of a ~331px viewport is the difference between seeing the final
 * approach and not, and it is one tap to open. Asked of `matchMedia` and the
 * viewport directly rather than of the `td-compact` class, because
 * `createUiState()` runs before `createRenderer()` — the class does not exist
 * yet at this point, and reading it would silently always say "not compact".
 */
const startsCompact = (): boolean =>
  typeof matchMedia === 'function' &&
  isCompactViewport(
    matchMedia('(pointer: coarse)').matches,
    document.documentElement.clientWidth,
    document.documentElement.clientHeight,
  );

export interface UiState {
  /** Tower type armed for placement, or null when not building. */
  selected: TowerId | null;
  /** Tile under the pointer; null when the pointer is off the board. */
  hover: readonly [number, number] | null;
  /** Station the inspector is showing. Cleared when it is sold or the run ends. */
  inspecting: EntityId | null;
  /**
   * The placement preview is being driven, or parked, by a finger.
   *
   * Drives the magnified callout above the contact point: at touch scale a
   * fingertip covers the target tile outright, and the overlay's inline verdict
   * label renders at ~5 CSS px, so both the ghost and the price have to be
   * repeated somewhere the finger is not. Never set on the mouse path.
   */
  touchPreview: boolean;
  /** The build deck slides away so the board is uninterrupted during a wave. */
  deckOpen: boolean;
  /** Explicit player pause. Mirrors `GameLoop.paused`; the HUD reads it here. */
  paused: boolean;
  prefs: UiPrefs;
}

export const createUiState = (): UiState => ({
  selected: null,
  hover: null,
  inspecting: null,
  touchPreview: false,
  deckOpen: !startsCompact(),
  paused: false,
  prefs: { reachCircles: 'hover', damageNumbers: true, stream: wantsMotion() },
});
