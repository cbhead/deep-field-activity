import { Graphics } from 'pixi.js';
import { BALANCE } from '../content/balance.ts';
import type { UiPrefs } from '../app/uiState.ts';
import type { Tower } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { COLLAR_SECTORS, COLLAR_SPAN, TILE_PX } from './constants.ts';
import { strokeArc } from './draw.ts';
import type { Layers } from './pixiApp.ts';
import { THEME } from './theme.ts';

/**
 * Everything drawn *on a station* to report its state: what it has been
 * upgraded into, what it is doing right now, how far it reaches.
 *
 * **Why this is not in `effects.ts`.** That file's contents all belong to
 * something short-lived — a contact's health bar dies with the contact, a
 * tracer with the shot — and its three rules follow from that: effects are
 * event-driven, pooled, and *droppable*, because a burst of them must degrade
 * rather than pile up. None of that is true here. A station lives for the whole
 * run, its chrome is pulled from state every frame rather than pushed by
 * events, and dropping a frame of it would mean an upgrade silently vanishing.
 * Towers are the only long-lived entity on the board, so this is the only
 * persistent chrome; that is the line between the two files, and it is the rule
 * for where a new indicator goes.
 *
 * **The scarce resource is radius, not code.** Every indicator here competes for
 * the same forty pixels around one hexagon, and they collide silently — two
 * rings a few pixels apart read as one fat smudge rather than as two readings.
 * So the budget is allocated here, in one place, rather than discovered:
 *
 * | radius (tiles) | what                  | drawn when                     |
 * |----------------|-----------------------|--------------------------------|
 * | 0.00 – 0.28    | the baked sprite      | always (owned by `worldView`)  |
 * | 0.32           | spin-up arc           | a ramping station holding focus|
 * | 0.48           | upgrade collar        | any path above tier 1          |
 * | `stats.range`  | reach circle          | only when the player asks      |
 *
 * 0.28–0.32 and 0.36–0.48 are free. Anything new should claim a band here
 * before it is written, and say what it collides with if it does not fit —
 * the collar itself started at 0.44, sat on the hex's ~0.42 vertices, and lost
 * the contrast fight with the station's own glow.
 *
 * Its sibling is `creepChrome.ts`, which does the same job for contacts and
 * documents the one way the two differ: contacts vary in size, so its budget is
 * measured out from each contact's own radius rather than from fixed constants.
 *
 * One Graphics for all of it, as in `effects.ts`: one draw call regardless of
 * how many stations are on the board, where a Graphics per tower would be
 * dozens and would break the sprite batch `textures.ts` exists to protect.
 */

/** A ramping station's charge, inside the hex so it reads as the core spinning. */
const SPIN_UP_RADIUS = 0.32;

/**
 * The upgrade collar, ringing the hex.
 *
 * The station's vertices reach ~0.42 of a tile, so 0.44 drew *on* the
 * silhouette — legible zoomed in, mush at 1x, which is the size the game is
 * played at. 0.48 clears it with ~1.5px still between the collars of two
 * adjacent towers.
 */
const COLLAR_RADIUS = 0.48;

/**
 * Which paths this station has been taken down, and how far.
 *
 * The baked sprite carries *overall* power — the pip row, the growing core, the
 * halo — but it is keyed on `visualTier`, the sum of the three paths, so a Lance
 * at damage 3, one at range 3 and one at effect 3 all bake to the identical
 * texture while being 18 damage, 3.7 tiles of reach and pierce 4. The board
 * could show how much had been spent on a station and never what on.
 *
 * Position is the encoding rather than colour — see `COLLAR_SECTORS` for why the
 * palette had nothing to spare — and the inspector's dial is where that
 * positional code is taught. Nothing is drawn at tier 1, so an untouched board
 * stays as clean as it was and every arc is something the player chose.
 */
function drawUpgradeCollar(g: Graphics, t: Tower): void {
  const max = BALANCE.upgrade.maxTier;
  if (max <= 1) return;

  const cx = t.x * TILE_PX;
  const cy = t.y * TILE_PX;
  const r = TILE_PX * COLLAR_RADIUS;

  for (const { path, from } of COLLAR_SECTORS) {
    const tier = t.tiers[path];
    if (tier <= 1) continue;

    // Tier 2 fills half the sector, tier 3 all of it — "how far along this
    // path", not "how many tiers", which is what the player is choosing.
    const fill = (tier - 1) / (max - 1);
    const a0 = (from * Math.PI) / 180;
    const a1 = a0 + (COLLAR_SPAN * fill * Math.PI) / 180;

    // Laid down twice: a dark backing, then the arc. The collar crosses both the
    // starfield and the station's own halo, and a single stroke that reads on
    // one washes out on the other.
    strokeArc(g, cx, cy, r, a0, a1, { width: 5, color: THEME.board.bg, alpha: 0.75 });
    strokeArc(g, cx, cy, r, a0, a1, { width: 3, color: THEME.towers[t.defId], alpha: 1 });
  }
}

/**
 * How far a ramping station has spun up, on the station rather than its shots.
 *
 * A ramp nobody can see is a ramp nobody can play around, and the useful
 * question is about the station — "is this one up to speed, or did it just
 * switch targets and lose everything" — not about any single shot. Keeping it
 * here also keeps the ramp off the projectile, so the sim carries no field that
 * exists only to be drawn.
 */
function drawSpinUp(g: Graphics, t: Tower): void {
  // Live stats, not the def: the effect path moves both ramp dials, so the arc
  // has to fill against the ceiling this station actually has.
  const { rampPerSecond, rampMax } = t.stats;
  if (rampPerSecond <= 0 || t.focusTime <= 0) return;

  const charge = Math.min(1, t.focusTime / ((rampMax - 1) / rampPerSecond));
  const r = TILE_PX * SPIN_UP_RADIUS;
  const start = -Math.PI / 2;

  strokeArc(g, t.x * TILE_PX, t.y * TILE_PX, r, start, start + Math.PI * 2 * charge, {
    width: 1 + charge * 2.5,
    color: THEME.towers[t.defId],
    alpha: 0.4 + charge * 0.5,
  });
}

/** Every station's reach at once, when the player has asked to see it. */
function drawReach(g: Graphics, t: Tower, prefs: UiPrefs): void {
  if (prefs.reachCircles !== 'always') return;
  g.circle(t.x * TILE_PX, t.y * TILE_PX, t.stats.range * TILE_PX).stroke({
    width: 1,
    color: THEME.towers[t.defId],
    alpha: 0.16,
  });
}

export class TowerChrome {
  private readonly gfx = new Graphics();

  constructor(layers: Layers) {
    layers.effects.addChild(this.gfx);
  }

  /**
   * Redrawn wholesale each frame, like the bars in `effects.ts`: a station's
   * chrome is a pure function of its state, so there is nothing to reconcile
   * and no invalidation to get wrong when an upgrade lands.
   *
   * Indicators are called explicitly rather than iterated from a registry. The
   * list is short, the draw order is the stacking order, and an array of
   * function pointers would hide both to save one line per addition.
   */
  sync(w: World, prefs: UiPrefs): void {
    const g = this.gfx;
    g.clear();

    for (const t of w.towers) {
      drawSpinUp(g, t);
      drawUpgradeCollar(g, t);
      drawReach(g, t, prefs);
    }
  }
}
