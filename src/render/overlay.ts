import { Graphics, Sprite, Text } from 'pixi.js';
import { TOWERS, type TowerId } from '../content/towers.ts';
import { placementError } from '../sim/build.ts';
import type { EntityId, PlacementError } from '../sim/types.ts';
import { towerById, type World } from '../sim/world.ts';
import { TILE_PX } from './constants.ts';
import { BAKE_NEUTRAL, THEME } from './theme.ts';
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
/**
 * What the ghost says at the cursor when a tile is refused.
 *
 * Naming the reason is the difference between feedback and a shrug: "you can't"
 * makes the player hunt for the rule, "on the route" tells them the rule. Keyed
 * off the same PlacementError the command path enforces, so a message can never
 * describe a verdict the sim won't reach.
 */
const REJECTION: Record<Exclude<PlacementError, 'offBoard'>, string> = {
  onRoute: 'On the route',
  blocked: 'Nebula · no build',
  occupied: 'Occupied',
  tooPoor: 'Not enough cash',
  locked: 'Locked',
};

export class Overlay {
  private readonly ghost: Sprite;
  private readonly gfx = new Graphics();
  private readonly label: Text;

  /** Last drawn state, so a stationary pointer costs nothing. */
  private lastKey = '';

  constructor(layers: Layers, textures: Textures) {
    this.ghost = new Sprite(textures.towers[0]!);
    this.ghost.visible = false;
    this.ghost.alpha = 0.55;

    // `fill` is load-bearing: Pixi defaults text to black and this label is
    // recoloured with `.tint`, which multiplies — so without a neutral fill the
    // label was black on a near-black board no matter what tint was set.
    this.label = new Text({
      text: '',
      style: {
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 12,
        fontWeight: '700',
        fill: BAKE_NEUTRAL,
        stroke: { color: THEME.fx.textOutline, width: 3, join: 'round' },
      },
    });
    this.label.visible = false;
    layers.overlay.addChild(this.gfx, this.ghost, this.label);
  }

  sync(
    w: World,
    selected: TowerId | null,
    hover: readonly [number, number] | null,
    inspecting: EntityId | null = null,
  ): void {
    const reason =
      selected === null || hover === null
        ? 'offBoard'
        : placementError(w, selected, hover[0], hover[1]);

    // Re-tessellating the range circle every frame is wasteful when nothing
    // visible has changed, and a stationary pointer is the common case. Keyed
    // on the placement *verdict* rather than on money: once kills pay bounty
    // every few ticks, a money-keyed cache would never hit.
    const inspected = inspecting === null ? undefined : towerById(w, inspecting);
    const key =
      `${selected}:${hover === null ? '' : `${hover[0]},${hover[1]}`}:${reason}` +
      `:${inspected ? `${inspected.id}.${inspected.range}` : ''}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.gfx.clear();

    // The inspected station shows its reach whether or not anything is armed —
    // that is the whole reason for clicking it.
    if (inspected !== undefined) {
      const ix = inspected.x * TILE_PX;
      const iy = inspected.y * TILE_PX;
      this.gfx
        .circle(ix, iy, inspected.range * TILE_PX)
        .fill({ color: THEME.feedback.selected, alpha: THEME.feedback.rangeFillAlpha })
        .stroke({
          width: THEME.shape.strokeWidth,
          color: THEME.feedback.selected,
          alpha: THEME.feedback.rangeStrokeAlpha,
        });
      this.gfx
        .rect(inspected.col * TILE_PX, inspected.row * TILE_PX, TILE_PX, TILE_PX)
        .stroke({ width: 2, color: THEME.feedback.selected, alpha: 0.95 });
    }

    if (selected === null || hover === null) {
      this.ghost.visible = false;
      this.label.visible = false;
      return;
    }

    const [col, row] = hover;
    if (reason === 'offBoard') {
      this.ghost.visible = false;
      this.label.visible = false;
      return;
    }

    const ok = reason === null;

    // The verdict, in words, beside the cursor. A legal tile shows the price
    // rather than a bare "yes" — the number is the part worth confirming when
    // cash is tight.
    this.label.visible = true;
    this.label.text = ok ? `Deploy · −$${TOWERS[selected].cost}` : REJECTION[reason];
    this.label.tint = ok ? THEME.towers[selected] : THEME.feedback.invalid;

    // Sit to the right of the tile normally, but flip to the left rather than
    // run off the board. Hovering the last few columns used to push the label
    // past the canvas edge, where it was clipped away entirely — so the tiles
    // whose verdict is least obvious were the ones that explained themselves
    // least. `width` is only valid once `text` is set, hence the ordering.
    const boardW = w.map.cols * TILE_PX;
    const right = (col + 1) * TILE_PX + 8;
    const flip = right + this.label.width > boardW;
    this.label.x = flip ? Math.max(2, col * TILE_PX - 8 - this.label.width) : right;
    this.label.y = Math.min(row * TILE_PX + 8, w.map.rows * TILE_PX - this.label.height - 2);
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
