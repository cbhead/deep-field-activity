import { Graphics, Sprite } from 'pixi.js';
import { TOWERS, type TowerId } from '../content/towers.ts';
import { placementError } from '../sim/build.ts';
import type { World } from '../sim/world.ts';
import { TILE_PX } from './constants.ts';
import { THEME } from './theme.ts';
import type { Layers } from './pixiApp.ts';
import type { Textures } from './textures.ts';

/**
 * The placement ghost and range circle.
 *
 * The plan calls this the highest-value UI work in the game, and it is: it is
 * the difference between placement feeling responsive and feeling broken. You
 * must be able to see, before committing, both *whether* a tile is legal and
 * *what the tower would cover*.
 *
 * It asks `placementError` — the same function `applyCommands` uses — so what
 * is shown and what will be accepted cannot drift apart.
 */
export class Overlay {
  private readonly ghost: Sprite;
  private readonly gfx = new Graphics();

  /** Last drawn state, so a stationary pointer costs nothing. */
  private lastKey = '';

  constructor(layers: Layers, textures: Textures) {
    this.ghost = new Sprite(textures.tower);
    this.ghost.visible = false;
    this.ghost.alpha = 0.55;
    layers.overlay.addChild(this.gfx, this.ghost);
  }

  sync(w: World, selected: TowerId | null, hover: readonly [number, number] | null): void {
    const reason =
      selected === null || hover === null
        ? 'offBoard'
        : placementError(w, selected, hover[0], hover[1]);

    // Re-tessellating the range circle every frame is wasteful when nothing
    // visible has changed, and a stationary pointer is the common case. Keyed
    // on the placement *verdict* rather than on money: once kills pay bounty
    // every few ticks, a money-keyed cache would never hit.
    const key = hover === null ? '' : `${selected}:${hover[0]},${hover[1]}:${reason}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.gfx.clear();

    if (selected === null || hover === null) {
      this.ghost.visible = false;
      return;
    }

    const [col, row] = hover;
    if (reason === 'offBoard') {
      this.ghost.visible = false;
      return;
    }

    const ok = reason === null;
    // A legal ghost wears the tower's own colour, which answers "which tower"
    // as well as "yes"; only rejection needs a dedicated red.
    const tint = ok ? THEME.towers[selected] : THEME.feedback.invalid;
    const cx = (col + 0.5) * TILE_PX;
    const cy = (row + 0.5) * TILE_PX;

    this.ghost.visible = true;
    this.ghost.tint = tint;
    this.ghost.position.set(col * TILE_PX, row * TILE_PX);

    // Range first, so the ghost sits on top of it.
    const { rangeFillAlpha, rangeStrokeAlpha, tileOutlineAlpha } = THEME.feedback;
    this.gfx
      .circle(cx, cy, TOWERS[selected].range * TILE_PX)
      .fill({ color: tint, alpha: rangeFillAlpha })
      .stroke({ width: THEME.shape.strokeWidth, color: tint, alpha: rangeStrokeAlpha });

    // A tile outline reads as "this exact square", which the soft range circle
    // alone does not communicate.
    this.gfx
      .rect(col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX)
      .stroke({ width: THEME.shape.strokeWidth, color: tint, alpha: tileOutlineAlpha });
  }
}
