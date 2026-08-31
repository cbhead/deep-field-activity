/**
 * The touch placement gesture, as a pure state machine.
 *
 * Touch has no hover, and hover is what makes placement legible: the ghost, the
 * reach circle and the "Deploy · −$40" verdict are all driven from `ui.hover`.
 * A tap that goes straight to a `placeTower` command spends money on a tile the
 * player never saw previewed. So on touch, the gesture's job is to keep a
 * preview alive for long enough to be read, and only then commit.
 *
 * Three gestures, one machine:
 *
 *   press & hold on the board  → ghost follows the finger, release commits
 *   quick tap on the board     → pins the preview; a second tap commits
 *   drag out of a deck slot    → arms that station, then as above
 *
 * The quick-tap case is the fat-finger guard. A board tile is 32–34 CSS px on a
 * tablet and ~19 on a phone — smaller than a fingertip — so a gesture too brief
 * to have read the verdict deliberately does not buy anything.
 *
 * No DOM, no Pixi, no `window`, no sim: this file is a function from (state,
 * event) to (state, effects), which is what lets `tools/check.ts` exercise the
 * whole thing headlessly. The adapter in `input.ts` turns real PointerEvents
 * into these events and performs the effects.
 */
import type { TowerId } from '../content/towers.ts';

/**
 * How long a press must last before releasing it commits a placement.
 *
 * The one feel-sensitive number here, and the one worth tuning on a real
 * device: too low and a sloppy tap buys a station on a tile the finger was
 * covering; too high and press-and-hold feels like it is ignoring you. Exposed
 * on the dev `td` handle so it can be dialled in without a rebuild.
 */
export const TAP_MS = 260;

/** Slot rect in client coordinates — only ever tested for "is the finger still inside". */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type Tile = readonly [number, number];

export type GestureState =
  | { readonly k: 'idle' }
  /** Finger down on the board with a station armed. */
  | { readonly k: 'boardPress'; readonly id: number; readonly startTile: Tile | null;
      readonly moved: boolean; readonly downAt: number }
  /** Finger down on the board with nothing armed — an inspect, resolved on lift. */
  | { readonly k: 'inspectPress'; readonly id: number; readonly startTile: Tile | null }
  /** Finger down on a deck slot, still inside it. */
  | { readonly k: 'deckPress'; readonly id: number; readonly towerId: TowerId; readonly rect: Rect }
  /** Dragged clear of the slot: armed, and now aiming. */
  | { readonly k: 'deckDrag'; readonly id: number; readonly towerId: TowerId };

/**
 * `pinned` is the tile a quick tap parked the preview on. It lives beside the
 * state rather than inside it because it deliberately outlives the gesture —
 * that is the whole point of the two-tap model.
 *
 * It is NOT presentation state and must not reach `UiState`: the preview a pin
 * produces is already expressed as `ui.hover`, and a field on `UiState` would
 * be pulled into the HUD's deck key and rebuild the deck between a press and
 * its release, which hud.ts documents as what makes a button feel dead.
 */
export interface Gesture {
  readonly state: GestureState;
  readonly pinned: Tile | null;
}

export const idleGesture = (): Gesture => ({ state: { k: 'idle' }, pinned: null });

export type GestureInput =
  | { readonly k: 'boardDown'; readonly id: number; readonly tile: Tile | null;
      readonly armed: TowerId | null; readonly at: number }
  | { readonly k: 'deckDown'; readonly id: number; readonly towerId: TowerId; readonly rect: Rect }
  | { readonly k: 'move'; readonly id: number; readonly tile: Tile | null;
      readonly x: number; readonly y: number }
  | { readonly k: 'up'; readonly id: number; readonly tile: Tile | null; readonly at: number }
  | { readonly k: 'cancel'; readonly id: number };

export type Effect =
  /** Drive `ui.hover`, which is what the overlay renders the preview from. */
  | { readonly k: 'hover'; readonly tile: Tile | null }
  /** Turn the magnified finger callout on or off. */
  | { readonly k: 'preview'; readonly on: boolean }
  | { readonly k: 'place'; readonly tile: Tile }
  | { readonly k: 'arm'; readonly towerId: TowerId }
  /** The adapter resolves the tile to a tower id; the machine stays sim-free. */
  | { readonly k: 'inspect'; readonly tile: Tile }
  /** Suppress the synthesised click that follows a touch, so a drag out of a
   *  slot and back does not toggle the station straight off again. */
  | { readonly k: 'swallowClick' };

const sameTile = (a: Tile | null, b: Tile | null): boolean =>
  a === null || b === null ? a === b : a[0] === b[0] && a[1] === b[1];

const inside = (r: Rect, x: number, y: number): boolean =>
  // A small margin, so a press that trembles by a pixel is not read as a drag.
  x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4;

/** Give up on the current gesture without buying anything, restoring any pin. */
const abort = (g: Gesture): { next: Gesture; effects: Effect[] } => ({
  next: { state: { k: 'idle' }, pinned: g.pinned },
  effects: [
    { k: 'hover', tile: g.pinned },
    { k: 'preview', on: g.pinned !== null },
  ],
});

/** The gesture is over and something was bought — drop the preview entirely. */
const settled: Effect[] = [
  { k: 'hover', tile: null },
  { k: 'preview', on: false },
];

/**
 * @param tapMs Overridable so the feel can be dialled in on a real device
 *   through the dev handle, and so the headless gate can pin it rather than
 *   inherit whatever the current default happens to be.
 */
export function reduce(
  g: Gesture,
  ev: GestureInput,
  tapMs: number = TAP_MS,
): { next: Gesture; effects: Effect[] } {
  const s = g.state;

  // A second finger while a gesture is live is ignored outright rather than
  // cancelling: the overwhelmingly common cause is a palm or a resting thumb,
  // and losing an in-flight placement to that is punishing. It also means a
  // second finger on Send or a speed button runs the ordinary click path, so
  // holding a ghost with one thumb and sending the wave with the other works
  // with no code for it.
  if ((ev.k === 'boardDown' || ev.k === 'deckDown') && s.k !== 'idle') {
    return { next: g, effects: [] };
  }
  if (ev.k !== 'boardDown' && ev.k !== 'deckDown' && s.k !== 'idle' && ev.id !== s.id) {
    return { next: g, effects: [] };
  }

  switch (ev.k) {
    case 'boardDown':
      // Nothing armed: this is an inspect, and it resolves on lift rather than
      // on contact. Inspecting on contact means a mis-touch while scrubbing
      // opens the inspector, which steals the detail column mid-wave.
      if (ev.armed === null) {
        return {
          next: { state: { k: 'inspectPress', id: ev.id, startTile: ev.tile }, pinned: g.pinned },
          effects: [],
        };
      }
      return {
        next: {
          state: { k: 'boardPress', id: ev.id, startTile: ev.tile, moved: false, downAt: ev.at },
          pinned: g.pinned,
        },
        // The verdict has to be on screen from the moment of contact: a
        // press-and-hold commits on release with no movement, so this preview
        // is the only thing the player gets to read before paying.
        effects: [{ k: 'hover', tile: ev.tile }, { k: 'preview', on: true }],
      };

    case 'deckDown':
      return {
        next: {
          state: { k: 'deckPress', id: ev.id, towerId: ev.towerId, rect: ev.rect },
          pinned: g.pinned,
        },
        effects: [],
      };

    case 'move':
      if (s.k === 'boardPress') {
        // Movement is measured in TILES, not pixels. A pixel threshold is
        // scale-dependent — 10px is a quarter of a tile on a tablet and well
        // over half on a phone — whereas "the tile under my finger changed" is
        // the same fact at every scale.
        const moved = s.moved || !sameTile(ev.tile, s.startTile);
        return {
          next: { state: { ...s, moved }, pinned: g.pinned },
          effects: [{ k: 'hover', tile: ev.tile }],
        };
      }
      if (s.k === 'deckDrag') {
        return { next: g, effects: [{ k: 'hover', tile: ev.tile }] };
      }
      if (s.k === 'deckPress') {
        // Leaving the slot's own rect is the threshold, for the same reason
        // tile-change is: it self-scales and it means what the gesture means.
        if (inside(s.rect, ev.x, ev.y)) return { next: g, effects: [] };
        return {
          next: { state: { k: 'deckDrag', id: s.id, towerId: s.towerId }, pinned: g.pinned },
          effects: [
            { k: 'arm', towerId: s.towerId },
            { k: 'hover', tile: ev.tile },
            { k: 'preview', on: true },
          ],
        };
      }
      return { next: g, effects: [] };

    case 'up':
      if (s.k === 'boardPress') {
        // Slid off the board and let go: an abort, and it must not cost money.
        if (ev.tile === null) return abort(g);

        const deliberate = s.moved || ev.at - s.downAt >= tapMs;
        // Either a considered press, or the confirming second tap on a tile
        // already pinned and previewed.
        if (deliberate || sameTile(ev.tile, g.pinned)) {
          return {
            next: { state: { k: 'idle' }, pinned: null },
            effects: [{ k: 'place', tile: ev.tile }, ...settled],
          };
        }
        // Too quick to have read the verdict: park the preview instead of
        // buying. The next tap on this same tile is the confirmation.
        return {
          next: { state: { k: 'idle' }, pinned: ev.tile },
          effects: [{ k: 'hover', tile: ev.tile }, { k: 'preview', on: true }],
        };
      }

      if (s.k === 'inspectPress') {
        const hit = ev.tile !== null && sameTile(ev.tile, s.startTile);
        return {
          next: { state: { k: 'idle' }, pinned: g.pinned },
          effects: hit ? [{ k: 'inspect', tile: ev.tile as Tile }] : [],
        };
      }

      if (s.k === 'deckDrag') {
        if (ev.tile === null) {
          // Dragged out of the slot and released off the board. The station
          // stays armed — this is the "arm it, then aim" path — and nothing is
          // bought.
          return {
            next: { state: { k: 'idle' }, pinned: null },
            effects: [...settled, { k: 'swallowClick' }],
          };
        }
        return {
          next: { state: { k: 'idle' }, pinned: null },
          effects: [{ k: 'place', tile: ev.tile }, ...settled, { k: 'swallowClick' }],
        };
      }

      // deckPress that never left the slot: fall through to the DOM's own
      // click, which already toggles the station. Handling it here as well
      // would arm and immediately disarm.
      return { next: { state: { k: 'idle' }, pinned: g.pinned }, effects: [] };

    case 'cancel':
      // The system took the pointer — a notification, a call, an edge swipe, a
      // tab going hidden. Stay armed, keep any pin, buy nothing.
      return s.k === 'deckPress'
        ? { next: { state: { k: 'idle' }, pinned: g.pinned }, effects: [] }
        : abort(g);
  }
}
