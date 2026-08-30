/**
 * Runtime simulation types.
 *
 * Everything positional here is in TILES as floats — `creep.x = 12.37` means
 * "just past the middle of column 12". The renderer is the only thing that
 * knows about pixels, so `speed: 1.8` reads as 1.8 tiles/sec and changing the
 * tile size never touches gameplay or balance.
 */

import type { EnemyId } from '../content/enemies.ts';
import type { TowerId } from '../content/towers.ts';

export interface Vec2 {
  x: number;
  y: number;
}

export type TileKind =
  /** Buildable. The only kind a tower may occupy. */
  | 'ground'
  /** Creeps walk here. Not buildable. */
  | 'path'
  /** Scenery. Not buildable, not walkable. */
  | 'blocked';

/** A parsed, validated map. Produced by `parseMap()`; never authored by hand. */
export interface MapDef {
  readonly id: string;
  readonly name: string;
  readonly cols: number;
  readonly rows: number;

  /** Row-major, length `cols * rows`. Index with `tileIndex()`. */
  readonly tiles: readonly TileKind[];

  /**
   * The route in sim space — tile *centres*, so tile (0,2) is (0.5, 2.5).
   * Creeps interpolate between consecutive entries.
   */
  readonly waypoints: readonly Vec2[];

  /**
   * Where creeps enter, one tile outside the board, so they walk on-screen
   * rather than popping into existence on the edge tile.
   */
  readonly spawn: Vec2;

  /** Centre of the goal tile. A creep reaching it costs a life. */
  readonly goal: Vec2;

  /** Total route length in tiles. Used for progress and for pacing waves. */
  readonly pathLength: number;
}

export type EntityId = number;

export interface Creep {
  readonly id: EntityId;
  readonly defId: EnemyId;

  /** Position in tiles. */
  x: number;
  y: number;

  /** Index of the waypoint currently being walked *toward*. */
  leg: number;

  /**
   * Tiles travelled along the route. Targeting defaults to "furthest along"
   * later, and comparing this is exact where comparing positions is not.
   */
  progress: number;

  /** Base speed in tiles/sec. Never mutated — see `slowTimer`. */
  speed: number;
  /**
   * Seconds of gravitational slow remaining, and the multiplier while it lasts.
   *
   * Kept separate from `speed` rather than scaling it in place: a slow that
   * mutated the base could never expire cleanly, and two overlapping wells
   * would compound into a permanent crawl. Movement reads an *effective* speed
   * from these; the strongest active slow wins and a re-hit refreshes the timer
   * rather than stacking.
   */
  slowTimer: number;
  slowFactor: number;
  /**
   * What `slowTimer` started at, so the renderer can show how much of the slow
   * is *left* rather than merely that there is one.
   *
   * Carried on the contact rather than looked up from the station that applied
   * it, because that station can be sold, upgraded or outranged before the slow
   * expires — and the ring has to keep counting down truthfully regardless.
   */
  slowMax: number;
  hp: number;
  maxHp: number;

  /**
   * Overshield, absorbed before hull, and the countdown until it regenerates.
   *
   * `shieldTimer` counts *down* from the def's delay and is reset by any hit,
   * so sustained fire holds a shield at zero while a lull hands it back. That
   * is what makes a Warden a test of coverage rather than of raw damage.
   */
  shield: number;
  maxShield: number;
  shieldTimer: number;
  /** Money paid on kill. Baked in at spawn, since it scales per wave. */
  bounty: number;

  /**
   * Which wave this creep belongs to. Because waves overlap, "wave 3 is
   * cleared" cannot be inferred from an empty board — creeps from wave 4 may
   * already be walking. This tag is what keeps clear-rewards and victory exact.
   */
  readonly wave: number;

  /** Set during the tick; the cleanup phase removes it from the array. */
  dead: boolean;
}

/**
 * Which creep a tower shoots when several are in reach.
 *
 * `first` is the default and the only one that is right by default: the creep
 * furthest along the route is the one closest to costing a life. The others
 * exist because the right answer changes with what a tower is *for* — a Nova
 * covering a corner wants `strong`, a Singularity trimming stragglers wants
 * `last`.
 */
export type TargetMode = 'first' | 'last' | 'strong' | 'close';

export const TARGET_MODES: readonly TargetMode[] = ['first', 'last', 'strong', 'close'];

export interface Tower {
  readonly id: EntityId;
  readonly defId: TowerId;

  /** Towers are tile-aligned, so the tile is the identity and x/y is derived. */
  readonly col: number;
  readonly row: number;
  /** Tile centre, cached because targeting reads it every tick. */
  readonly x: number;
  readonly y: number;

  /** 1-based. Mk I is tier 1; `BALANCE.upgrade.maxTier` is the ceiling. */
  tier: number;

  range: number;
  damage: number;
  fireInterval: number;
  projectileSpeed: number;

  targeting: TargetMode;

  /** Seconds until this tower may fire again. */
  cooldown: number;

  /** Total money sunk in, including upgrades. The sell refund is a cut of this. */
  spent: number;

  /** Lifetime attribution, for the inspector. Presentation only — no rule reads them. */
  kills: number;
  damageDealt: number;
}

export interface Projectile {
  readonly id: EntityId;
  readonly defId: TowerId;
  /**
   * Who fired it. An id rather than a reference because the tower can be sold
   * mid-flight, and attribution to a tower that no longer exists should simply
   * find nothing rather than resurrect it.
   */
  readonly towerId: EntityId;

  x: number;
  y: number;

  /**
   * Contacts this shot may still pass through, and the ids it has already
   * damaged so it cannot hit the same one twice.
   *
   * A piercing shot flies *straight* — see `stepProjectiles`. One that homed
   * would curve back into a contact it had just passed, which is why the
   * branch is on flight behaviour rather than on damage.
   */
  pierce: number;
  readonly hits: EntityId[];

  /**
   * Where this shot was fired from. Only meaningful for a piercing shot, which
   * is drawn as the whole line it has crossed rather than as a dot with a stub
   * of tail — pierce is a mechanic you pay a premium for and could not
   * previously see working.
   */
  readonly ox: number;
  readonly oy: number;

  /**
   * A direct reference, not an id.
   *
   * An id would mean an O(creeps) lookup per projectile per tick, which is
   * worse than the targeting scan it was meant to avoid. Holding the object is
   * safe: `cleanup` removes it from the array but the reference keeps it alive,
   * and `dead` is what we actually check.
   */
  readonly target: Creep;

  /** Last known target position, so a shot at a creep that dies still lands. */
  tx: number;
  ty: number;

  speed: number;
  damage: number;
  /** Seconds in flight, for the runaway guard. */
  age: number;
  dead: boolean;
}

/**
 * Player intent. Nothing outside the sim mutates the world directly — a click
 * pushes a Command, and `applyCommands` drains the queue as the first phase of
 * the tick. Actions therefore land on exact tick boundaries, validation lives in
 * one place, and this is precisely the seam a replay or a netcode layer needs.
 */
export type Command =
  /** Send the next wave now, forfeiting the rest of the intermission. */
  | { type: 'startWave' }
  | { type: 'placeTower'; defId: TowerId; col: number; row: number }
  | { type: 'upgradeTower'; id: EntityId }
  | { type: 'sellTower'; id: EntityId }
  | { type: 'setTargeting'; id: EntityId; mode: TargetMode }
  /** Debug scaffolding: drop a single creep on the path. */
  | { type: 'spawnDebugCreep' };

/**
 * Why a tower may not go on a tile. `null` means it may.
 *
 * A reason rather than a boolean, because the placement ghost is the highest
 * value UI in the game and "you can't" is much worse feedback than "not on the
 * road" or "you can't afford that".
 */
export type PlacementError =
  | 'offBoard'
  /**
   * Split from a single `notBuildable` because the ghost names the reason at
   * the cursor, and "on the route" and "that's scenery" are different pieces of
   * advice — one says move off the road, the other says this tile never works.
   */
  | 'onRoute'
  | 'blocked'
  | 'occupied'
  | 'tooPoor'
  /** The type exists but has not been unlocked at this wave yet. */
  | 'locked';

/** Why an upgrade or sell was refused. `null` means it went through. */
export type TowerActionError = 'noSuchTower' | 'maxTier' | 'tooPoor';

/**
 * Discrete instants, pushed by the sim and drained by the renderer once per
 * frame. Continuous state (positions, hp fractions) is *pulled* instead — it is
 * idempotent, so a dropped frame costs nothing. An event is a thing that
 * happened at a moment, and if the renderer misses it the effect never plays.
 */
export type SimEvent =
  | { type: 'creepLeaked'; x: number; y: number }
  | { type: 'waveStarted'; wave: number; count: number }
  /**
   * Every landed hit, not just fatal ones — this is what floating damage
   * numbers and hit flashes are drawn from. It is the highest-frequency event
   * in the game (~50/sec at full board), so the renderer caps how many it will
   * turn into effects rather than the sim deciding for it.
   */
  | {
      type: 'creepDamaged';
      /**
       * Which contact was hit. Carried so the renderer can flash exactly the
       * right sprite — without it the only option is matching by proximity,
       * which lights the wrong contact when two overlap and drops the effect
       * entirely after a hitch moves them further than the match radius.
       */
      id: EntityId;
      x: number;
      y: number;
      amount: number;
      /**
       * How much of `amount` the overshield ate.
       *
       * Split out because "my stations are firing and it will not die" has two
       * completely different causes — no damage, or all of it landing on a
       * shield that regenerates — and the floating numbers could not tell them
       * apart. A Warden soaking a volley now reads as a wall of shield-coloured
       * numbers instead of looking like stations doing nothing.
       */
      toShield: number;
      defId: TowerId | null;
    }
  /**
   * A detonation, emitted whether or not it caught anything.
   *
   * Carries the radius so the ring drawn is the blast that actually happened —
   * the alternative is the renderer looking the station's splash up itself,
   * which would quietly start lying the moment splash varies by tier.
   */
  | { type: 'blast'; x: number; y: number; radius: number; defId: TowerId }
  | { type: 'creepKilled'; x: number; y: number; bounty: number; defId: EnemyId }
  /** A contact broke apart. Carries the children's type so the burst matches. */
  | { type: 'creepSplit'; x: number; y: number; into: EnemyId; count: number }
  | { type: 'shieldBroke'; x: number; y: number }
  | { type: 'waveRushed'; wave: number; bonus: number; secondsSaved: number }
  /** A startWave that could not be honoured. Silence would read as a bug. */
  | { type: 'waveRejected'; reason: 'spawning' | 'done' }
  /**
   * Itemised rather than a single number, because "where did my money come
   * from" is the question a player asks while deciding what to build next.
   */
  | { type: 'waveCleared'; wave: number; kills: number; bounty: number; leaked: number; reward: number }
  | { type: 'towerPlaced'; id: EntityId; col: number; row: number }
  | { type: 'buildRejected'; reason: PlacementError }
  | { type: 'towerUpgraded'; id: EntityId; tier: number; cost: number }
  | { type: 'towerSold'; id: EntityId; col: number; row: number; refund: number }
  | { type: 'towerActionRejected'; reason: TowerActionError }
  | { type: 'gameOver'; won: boolean };

/** Whole-match state. The sim stops stepping once this leaves 'playing'. */
export type MatchPhase = 'playing' | 'lost' | 'won';

/**
 * Wave *dispatch* state — where the spawner is, not what is on the board.
 *
 * There is deliberately no 'clearing' phase. Dispatch and board-clearing are
 * separate concerns now that waves overlap: the next intermission begins the
 * moment a wave finishes spawning, while its creeps are still walking. Whether
 * a given wave has been cleared is answered by `clearedThrough`, computed from
 * the creeps actually alive.
 */
export type WavePhase =
  /** Counting down to the next wave. Sending early skips the remainder. */
  | 'intermission'
  /** Working through the spawn plan. */
  | 'spawning'
  /** Every wave has been dispatched. */
  | 'done';
