import type { Application } from 'pixi.js';
import { TOWERS, TOWER_IDS } from '../content/towers.ts';
import { TILE_PX } from '../render/constants.ts';
import { isUnlocked, towerAt } from '../sim/build.ts';
import type { World } from '../sim/world.ts';
import type { UiState } from './uiState.ts';

/**
 * Screen pixels → tile coordinate, or null if the pointer is off the board.
 *
 * Goes through the canvas bounding rect rather than assuming a 1:1 mapping,
 * because `fitCanvas` letterboxes the board by CSS size — the element is
 * routinely smaller than the stage it draws.
 */
export function pointerToTile(
  app: Application,
  ev: PointerEvent,
  cols: number,
  rows: number,
): readonly [number, number] | null {
  const rect = app.canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * app.screen.width;
  const y = ((ev.clientY - rect.top) / rect.height) * app.screen.height;
  const col = Math.floor(x / TILE_PX);
  const row = Math.floor(y / TILE_PX);
  return col >= 0 && col < cols && row >= 0 && row < rows ? [col, row] : null;
}

/**
 * Input never mutates the world. It translates a gesture into a Command and
 * queues it; the sim applies it at the top of the next tick. Hover, by
 * contrast, is pure presentation and goes straight into UiState.
 */
export function attachInput(
  app: Application,
  world: World,
  ui: UiState,
  togglePause: () => void,
): void {
  const { cols, rows } = world.map;
  const canvas = app.canvas;

  canvas.addEventListener('pointermove', (raw) => {
    ui.hover = pointerToTile(app, raw as PointerEvent, cols, rows);
  });

  canvas.addEventListener('pointerleave', () => {
    ui.hover = null;
  });

  canvas.addEventListener('pointerdown', (raw) => {
    const ev = raw as PointerEvent;
    const tile = pointerToTile(app, ev, cols, rows);
    if (tile === null) return;
    ui.hover = tile;

    // Nothing armed: a click is an inspect gesture. Clicking empty ground
    // dismisses the inspector, which is the expected way out of it.
    if (ui.selected === null) {
      const hit = towerAt(world, tile[0], tile[1]);
      ui.inspecting = hit?.id ?? null;
      return;
    }
    world.commands.push({ type: 'placeTower', defId: ui.selected, col: tile[0], row: tile[1] });
  });

  // Right-click to disarm is the genre convention, and cheaper than moving the
  // pointer back to the build bar to click the same button again.
  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    ui.selected = null;
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      // Escape unwinds one layer at a time: disarm, then close the inspector,
      // then pause. Jumping straight to the pause menu from an armed state
      // would make cancelling a placement feel like it opened a modal.
      if (ui.selected !== null) ui.selected = null;
      else if (ui.inspecting !== null) ui.inspecting = null;
      else togglePause();
      return;
    }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      ui.deckOpen = !ui.deckOpen;
      return;
    }
    if (ev.code === 'Space') {
      ev.preventDefault();
      world.commands.push({ type: 'startWave' });
      return;
    }

    const hit = TOWER_IDS.find((id) => TOWERS[id].hotkey === ev.key);
    if (hit !== undefined && isUnlocked(world, hit)) {
      ui.selected = ui.selected === hit ? null : hit;
      // Arming and inspecting are mutually exclusive: both want the detail
      // column, and both draw a reach circle.
      if (ui.selected !== null) ui.inspecting = null;
    }
  });
}
