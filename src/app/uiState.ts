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
  /**
   * Master volume, 0–1.
   *
   * The one pref that **persists**, and the only one that needs to. The others
   * are cheap to re-set and their wrong value is merely untidy; arriving at a
   * game that is loud when you had told it not to be is a different class of
   * mistake, and it happens in a shared room exactly once before someone stops
   * playing. Read back by `loadAudioPrefs`.
   */
  volume: number;
  muted: boolean;
}

const AUDIO_KEY = 'deep-field-audio';

/**
 * Volume and mute, read back from a previous session.
 *
 * Tolerant of every kind of garbage in the slot — a bad parse, a missing field,
 * a number out of range — because a corrupt preference must never be the reason
 * the game does not boot. Same posture as `progress.ts`.
 */
function loadAudioPrefs(): { volume: number; muted: boolean } {
  const fallback = { volume: 0.6, muted: false };
  try {
    const raw = localStorage.getItem(AUDIO_KEY);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const rec = parsed as Record<string, unknown>;
    const volume = typeof rec['volume'] === 'number' ? rec['volume'] : fallback.volume;
    return {
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : fallback.volume,
      muted: rec['muted'] === true,
    };
  } catch {
    return fallback;
  }
}

/** Called on every change from the pause menu. Failure here is not worth a crash. */
export function saveAudioPrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify({ volume: prefs.volume, muted: prefs.muted }));
  } catch {
    // Private browsing, or a full quota. The session still works.
  }
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

  /**
   * Which lane the next sortie goes down — an index into `map.routes`.
   *
   * Here rather than on the World for exactly the reason this file exists: two
   * players watching the same replay would have different values for it, and
   * the sim only ever learns a lane from the command that carries one.
   *
   * A *mode* rather than a per-send argument. Sustained pressure down one lane
   * is the strategy the versus board was shaped to reward, and re-picking on
   * every send would tax the thing it is meant to encourage. Ignored entirely
   * outside versus, where nothing renders the picker.
   */
  sortieLane: number;
  prefs: UiPrefs;
}

export const createUiState = (): UiState => ({
  selected: null,
  sortieLane: 0,
  hover: null,
  inspecting: null,
  touchPreview: false,
  deckOpen: !startsCompact(),
  paused: false,
  prefs: {
    reachCircles: 'hover',
    damageNumbers: true,
    stream: wantsMotion(),
    ...loadAudioPrefs(),
  },
});
