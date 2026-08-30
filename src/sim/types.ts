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

  speed: number;
  hp: number;
  maxHp: number;
  /** Money paid on kill. Baked in at spawn, since it scales per wave. */
  bounty: number;

  /** Set during the tick; the cleanup phase removes it from the array. */
  dead: boolean;
}

export interface Tower {
  readonly id: EntityId;
  readonly defId: TowerId;

  /** Towers are tile-aligned, so the tile is the identity and x/y is derived. */
  readonly col: number;
  readonly row: number;
  /** Tile centre, cached because targeting reads it every tick. */
  readonly x: number;
  readonly y: number;

  range: number;
  damage: number;
  fireInterval: number;
  projectileSpeed: number;

  /** Seconds until this tower may fire again. */
  cooldown: number;

  /** Total money sunk in, for the M7 sell refund. */
  spent: number;
}

export interface Projectile {
  readonly id: EntityId;
  readonly defId: TowerId;

  x: number;
  y: number;

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
  /** Debug scaffolding: drop a single creep on the path. */
  | { type: 'spawnDebugCreep' };

/**
 * Why a tower may not go on a tile. `null` means it may.
 *
 * A reason rather than a boolean, because the placement ghost is the highest
 * value UI in the game and "you can't" is much worse feedback than "not on the
 * road" or "you can't afford that".
 */
export type PlacementError = 'offBoard' | 'notBuildable' | 'occupied' | 'tooPoor';

/**
 * Discrete instants, pushed by the sim and drained by the renderer once per
 * frame. Continuous state (positions, hp fractions) is *pulled* instead — it is
 * idempotent, so a dropped frame costs nothing. An event is a thing that
 * happened at a moment, and if the renderer misses it the effect never plays.
 */
export type SimEvent =
  | { type: 'creepLeaked'; x: number; y: number }
  | { type: 'waveStarted'; wave: number; count: number }
  | { type: 'creepKilled'; x: number; y: number; bounty: number }
  | { type: 'waveCleared'; wave: number }
  | { type: 'towerPlaced'; id: EntityId; col: number; row: number }
  | { type: 'buildRejected'; reason: PlacementError }
  | { type: 'gameOver'; won: boolean };

/** Whole-match state. The sim stops stepping once this leaves 'playing'. */
export type MatchPhase = 'playing' | 'lost' | 'won';

export type WavePhase =
  /** Build time. Counting down to the next wave. */
  | 'intermission'
  /** Working through the spawn plan. */
  | 'spawning'
  /** Everything is spawned; waiting for the board to empty. */
  | 'clearing'
  /** No waves left. */
  | 'done';
