import type { Application } from 'pixi.js';
import { TOWERS, TOWER_IDS } from '../content/towers.ts';
import { TILE_PX } from '../render/constants.ts';
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
export function attachInput(app: Application, world: World, ui: UiState): void {
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

    if (ui.selected === null) return;
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
      ui.selected = null;
      return;
    }
    if (ev.code === 'Space') {
      // M6 gives this a button. Until then it is the only way to skip an
      // intermission.
      ev.preventDefault();
      world.commands.push({ type: 'startWave' });
      return;
    }
    const hit = TOWER_IDS.find((id) => TOWERS[id].hotkey === ev.key);
    if (hit !== undefined) ui.selected = ui.selected === hit ? null : hit;
  });
}
