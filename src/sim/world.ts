import { BALANCE } from '../content/balance.ts';
import { ENEMIES, type EnemyId } from '../content/enemies.ts';
import type { PlannedSpawn } from './wavePlan.ts';
import type {
  Command,
  Creep,
  EntityId,
  MapDef,
  MatchPhase,
  Projectile,
  SimEvent,
  Tower,
  WavePhase,
} from './types.ts';

export interface WaveState {
  /** 0-based index into WAVES: the wave spawning now, or the next one due. */
  index: number;
  phase: WavePhase;
  /**
   * Counts *down* during intermission and *up* during spawning. One field
   * rather than two because the phases are mutually exclusive.
   */
  timer: number;
  plan: PlannedSpawn[];
  /** How far through `plan` the spawner has got. */
  spawned: number;

  /** Highest wave index fully spawned. -1 before the first wave. */
  dispatchedThrough: number;
  /**
   * Highest wave index with no creeps left alive. -1 before the first clear.
   *
   * Separate from `dispatchedThrough` because waves overlap — wave 4 can be
   * walking while wave 3's last straggler is still alive, so an empty board is
   * not what "cleared" means any more.
   */
  clearedThrough: number;
}

/**
 * The entire game state. Plain mutable objects in flat arrays — deliberately
 * not an ECS. Three fixed archetypes and a few hundred entities do not justify
 * a component registry, query machinery, and entities that are unreadable in a
 * console.log.
 *
 * Note what is absent: no wall-clock time, no DOM handles, no render objects,
 * no notion of frame rate. `time` and `tick` advance by fixed DT only. That is
 * what lets this run headlessly in Node and produce identical results twice.
 */
export interface World {
  readonly seed: number;
  readonly map: MapDef;

  /** Ticks elapsed. Integer, and the sim's only clock alongside `time`. */
  tick: number;
  /** Seconds of *simulated* time — `tick * DT`, never `performance.now()`. */
  time: number;

  phase: MatchPhase;
  lives: number;
  money: number;
  wave: WaveState;

  creeps: Creep[];
  towers: Tower[];
  projectiles: Projectile[];

  /** Drained at the start of each tick. See the Command doc comment. */
  commands: Command[];
  /** Drained by the renderer once per frame. Unbounded if nobody drains it. */
  events: SimEvent[];

  nextId: EntityId;
}

export function createWorld(map: MapDef, seed: number): World {
  return {
    seed,
    map,
    tick: 0,
    time: 0,
    phase: 'playing',
    lives: BALANCE.startingLives,
    money: BALANCE.startingMoney,
    wave: {
      index: 0,
      phase: 'intermission',
      timer: BALANCE.firstWaveDelay,
      plan: [],
      spawned: 0,
      dispatchedThrough: -1,
      clearedThrough: -1,
    },
    creeps: [],
    towers: [],
    projectiles: [],
    commands: [],
    events: [],
    nextId: 1,
  };
}

export function spawnCreep(
  w: World,
  defId: EnemyId,
  hp?: number,
  bounty?: number,
  wave = w.wave.index,
): Creep {
  const def = ENEMIES[defId];
  const start = w.map.spawn;
  const health = hp ?? def.hp;

  const creep: Creep = {
    id: w.nextId++,
    defId,
    x: start.x,
    y: start.y,
    // waypoints[0] is the off-board entry the creep is standing on, so the
    // first leg is walking toward waypoints[1].
    leg: 1,
    progress: 0,
    speed: def.speed,
    hp: health,
    maxHp: health,
    bounty: bounty ?? def.bounty,
    wave,
    dead: false,
  };
  w.creeps.push(creep);
  return creep;
}
