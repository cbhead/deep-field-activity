import { Sprite, type Container, type Texture } from 'pixi.js';
import { ENEMIES } from '../content/enemies.ts';
import { visualTier } from '../sim/build.ts';
import { contactShape } from './contactShape.ts';
import type { TowerId } from '../content/towers.ts';
import type { Creep, EntityId, Tower } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import type { Layers } from './pixiApp.ts';
import { TILE_PX } from './constants.ts';
import { THEME } from './theme.ts';
import { CREEP_BAKE_RADIUS, type Textures } from './textures.ts';

interface EntityView {
  sprite: Sprite;
  /** Frame this view was last matched to a live entity. See the sweep below. */
  seen: number;
}

interface TowerView {
  sprite: Sprite;
  seen: number;
  /** Last tier drawn, so an upgrade swaps the texture and nothing else does. */
  tier: number;
}

/** The minimum a thing needs to be drawable by `syncEntities`. */
interface Drawable {
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
}

/**
 * Maintains a sprite per live entity by reading the world each frame.
 *
 * Not immutable snapshots plus diffing — that is a React reflex, and here it
 * would allocate tens of thousands of objects per second to describe things
 * that barely changed. The renderer reads the sim's mutable objects directly
 * and never writes to them.
 */
export class WorldView {
  private readonly creeps = new Map<EntityId, EntityView>();
  private readonly projectiles = new Map<EntityId, EntityView>();
  /**
   * Towers go through the same mark-and-sweep as everything else.
   *
   * They used to be a plain Set on the reasoning that a tower never moves and
   * never dies — but selling shipped, and a Set that is only ever added to left
   * the sprite of a sold tower on the board forever. The sweep disposes of it
   * for free, and the cached tier is what lets an upgrade re-texture in place.
   */
  private readonly towers = new Map<EntityId, TowerView>();
  private frame = 0;

  constructor(
    private readonly layers: Layers,
    private readonly textures: Textures,
  ) {}

  /**
   * No `dt` any more: the hit flash was the only thing here that needed
   * wall-clock time, and it has moved to `creepChrome` — a coloured bake cannot
   * be brightened by lerping a tint, so the mechanism had to change with it.
   */
  sync(w: World): void {
    this.frame++;

    for (const t of w.towers) {
      // Three independent upgrade paths collapse to one number for the art —
      // `visualTier` is the mapping, shared with the Race-mode pins.
      const tier = visualTier(t);
      let view = this.towers.get(t.id);
      if (view === undefined) {
        const sprite = new Sprite(this.tierTexture(t.defId, tier));
        sprite.tint = THEME.towers[t.defId];
        sprite.position.set(t.col * TILE_PX, t.row * TILE_PX);
        this.layers.towers.addChild(sprite);
        view = { sprite, seen: 0, tier };
        this.towers.set(t.id, view);
      } else if (view.tier !== tier) {
        // Swap the texture rather than rebuild the sprite: position, tint and
        // parent are all still correct, and every tier bakes to the same 40x40
        // frame so the silhouette does not move.
        view.sprite.texture = this.tierTexture(t.defId, tier);
        view.tier = tier;
      }

      // A ramping station brightens as it spins up. The arc in `towerChrome`
      // already carries the figure; this carries the fact at a glance, so a
      // charged Filament is distinguishable from a cold one without reading a
      // dial. Both derive from `focusTime`, so both snap back on the same frame
      // a retarget costs the multiplier — which is the frame that matters.
      view.sprite.tint = mix(THEME.towers[t.defId], THEME.fx.hitFlash, charge(t) * RAMP_LIFT);

      view.seen = this.frame;
    }

    for (const [id, view] of this.towers) {
      if (view.seen !== this.frame) {
        view.sprite.destroy();
        this.towers.delete(id);
      }
    }

    // --- Channel 1: pull continuous state. Idempotent, so a dropped frame
    // costs nothing.
    this.syncEntities(w.creeps, this.creeps, this.layers.creeps, (c) => {
      const def = ENEMIES[c.defId];
      // One bake per type, chosen once at creation — a contact's type never
      // changes, unlike a tower's tier, which has to be watched every frame.
      //
      // **No tint.** Each contact is baked in its own final colours, because a
      // `tint` multiplies and so can never produce a highlight brighter than
      // the token — which is exactly what the Mote's core and the Cluster's
      // nuclei are.
      const sprite = new Sprite(this.textures.contacts[c.defId]);
      sprite.anchor.set(0.5);
      sprite.scale.set(def.radius / CREEP_BAKE_RADIUS);
      return sprite;
    });

    this.aimRotated(w);

    this.syncEntities(w.projectiles, this.projectiles, this.layers.projectiles, (p) => {
      const sprite = new Sprite(this.textures.projectile);
      sprite.anchor.set(0.5);
      sprite.tint = THEME.towers[p.defId];
      return sprite;
    });

    // --- Channel 2: discrete events, which arrive through `onEvent`. They are
    // drained once, in main.ts, and fanned out to this view, the effects layer
    // and the HUD. Draining them here would mean whichever consumer ran first
    // silently starved the others.
  }

  /** Clamped, so a tier beyond the baked set degrades to the top art rather than throwing. */
  private tierTexture(defId: TowerId, tier: number): Texture {
    const set = this.textures.towers[defId];
    const i = Math.min(Math.max(tier, 1), set.length) - 1;
    return set[i]!;
  }

  /**
   * Point the comet along the road.
   *
   * The Mote is the only rotated contact, and the only one that should be: a
   * comet that does not point along travel is meaningless, while a tumbling
   * trefoil would read as debris. Everything else keeps `rotation = 0`.
   *
   * Nothing new is stored on the sim: the heading is derived from the route
   * every frame by `routeHeading`, below.
   */
  private aimRotated(w: World): void {
    for (const c of w.creeps) {
      if (!contactShape(c.defId).rotates) continue;

      const view = this.creeps.get(c.id);
      const heading = routeHeading(w, c);
      // On the frame movement snaps to a corner there is no heading. Hold the
      // last one through it rather than snapping the comet to east.
      if (view === undefined || heading === undefined) continue;
      view.sprite.rotation = heading;
    }
  }

  /**
   * Mark-and-sweep rather than building a Set of live ids every frame: same
   * result, no per-frame allocation. Deleting while iterating a Map is safe.
   */
  private syncEntities<T extends Drawable>(
    list: readonly T[],
    views: Map<EntityId, EntityView>,
    layer: Container,
    create: (entity: T) => Sprite,
  ): void {
    for (const entity of list) {
      let view = views.get(entity.id);
      if (view === undefined) {
        const sprite = create(entity);
        layer.addChild(sprite);
        view = { sprite, seen: 0 };
        views.set(entity.id, view);
      }
      view.seen = this.frame;
      view.sprite.position.set(entity.x * TILE_PX, entity.y * TILE_PX);
    }

    for (const [id, view] of views) {
      if (view.seen !== this.frame) {
        view.sprite.destroy();
        views.delete(id);
      }
    }
  }
}

/**
 * Which way a contact is travelling, in radians, or `undefined` if it cannot be
 * told this frame.
 *
 * Exported because the hit flash draws the contact's own texture a second time
 * in `creepChrome`, and a flash that did not share the body's rotation would
 * paint a bright comet pointing east over a comet pointing north. One function,
 * so the two can never disagree about which way the Mote is facing.
 *
 * **`Creep.leg` is the waypoint being walked *toward*** — `movement.ts` does
 * `const target = route[c.leg]`. Taking the heading from the contact's own
 * position to that target rather than from a waypoint pair is both simpler and
 * safer: it needs no special case at the spawn, and it cannot be off by one,
 * which here would ship a comet flying tail-first.
 */
export function routeHeading(w: World, c: Creep): number | undefined {
  const target = w.map.routes[c.route]?.waypoints[c.leg];
  if (target === undefined) return undefined;

  const dx = target.x - c.x;
  const dy = target.y - c.y;
  // On the frame movement snaps to a corner the delta is ~0 and atan2 would
  // answer "east" — which is a heading, just not this contact's.
  if (Math.abs(dx) + Math.abs(dy) < 1e-4) return undefined;
  return Math.atan2(dy, dx);
}

/**
 * How far a fully-charged station's tint travels toward white.
 *
 * Small on purpose. A station sits below a contact in the contrast hierarchy,
 * and a ramp that lit up like a hit flash would spend attention the creeps have
 * already been promised. It only has to be enough to tell a charged Filament
 * from a cold one, which is the whole ask.
 */
const RAMP_LIFT = 0.3;

/**
 * 0 cold, 1 at the ceiling. Non-ramping stations are always 0, so this costs
 * one comparison for the four that do not ramp.
 *
 * The same expression `towerChrome.drawSpinUp` uses, deliberately — the arc and
 * the brightness are two readings of one number, and if they could disagree
 * they eventually would.
 */
function charge(t: Tower): number {
  if (t.stats.rampPerSecond <= 0 || t.focusTime <= 0) return 0;
  const toCeiling = (t.stats.rampMax - 1) / t.stats.rampPerSecond;
  return toCeiling <= 0 ? 1 : Math.min(1, t.focusTime / toCeiling);
}

/**
 * Lerp between two packed 0xRRGGBB colours, channel by channel.
 *
 * Naive sRGB rather than anything perceptual: over a tenth of a second, between
 * two colours this saturated, the difference does not survive being looked at,
 * and a gamma-correct mix would cost two pows per channel per struck contact
 * per frame.
 */
function mix(from: number, to: number, k: number): number {
  const r = Math.round(((from >> 16) & 255) * (1 - k) + ((to >> 16) & 255) * k);
  const g = Math.round(((from >> 8) & 255) * (1 - k) + ((to >> 8) & 255) * k);
  const b = Math.round((from & 255) * (1 - k) + (to & 255) * k);
  return (r << 16) | (g << 8) | b;
}
