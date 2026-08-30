import { BALANCE } from '../content/balance.ts';
import { ENEMIES, type EnemyId } from '../content/enemies.ts';
import { DEFAULT_RULES, type Rules } from './rules.ts';
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
 * Counters, not rules.
 *
 * Nothing in the simulation reads these — they exist so the wave-clear, defeat
 * and victory screens can report what actually happened rather than shrugging.
 * Kept on the World rather than derived at the end because most of it is not
 * recoverable after the fact: a killed creep leaves no trace to count.
 */
export interface RunStats {
  kills: number;
  leaks: number;
  /** Cash from bounties only, excluding clear rewards and rush bonuses. */
  bounty: number;
  /** Cash spent on building and upgrading, before any sell refunds. */
  spent: number;
}

/** The same three figures, per wave, so a clear can be itemised. */
export interface WaveStats {
  kills: number;
  bounty: number;
  leaked: number;
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
  /**
   * Which arc this run is playing and how hard. Read by the spawner, the
   * splitter and every screen that reports progress — carried on the World so
   * none of them has to be told separately and then disagree.
   */
  readonly rules: Rules;

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

  /**
   * Deaths that owe children, drained by `resolveSplits` once the systems that
   * iterate `w.creeps` have finished for the tick. See `damageCreep`.
   */
  pendingSplits: PendingSplit[];

  stats: RunStats;
  /** Indexed by wave. Grown lazily by `waveStats()`. */
  perWave: WaveStats[];

  /** Drained at the start of each tick. See the Command doc comment. */
  commands: Command[];
  /** Drained by the renderer once per frame. Unbounded if nobody drains it. */
  events: SimEvent[];

  nextId: EntityId;
}

export function createWorld(map: MapDef, seed: number, rules: Rules = DEFAULT_RULES): World {
  return {
    seed,
    map,
    rules,
    tick: 0,
    time: 0,
    phase: 'playing',
    lives: rules.startingLives,
    money: rules.startingMoney,
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
    pendingSplits: [],
    stats: { kills: 0, leaks: 0, bounty: 0, spent: 0 },
    perWave: [],
    commands: [],
    events: [],
    nextId: 1,
  };
}

/** The stats bucket for a wave, created on first touch. */
export function waveStats(w: World, wave: number): WaveStats {
  let s = w.perWave[wave];
  if (s === undefined) {
    s = { kills: 0, bounty: 0, leaked: 0 };
    w.perWave[wave] = s;
  }
  return s;
}

export function towerById(w: World, id: EntityId): Tower | undefined {
  for (const t of w.towers) if (t.id === id) return t;
  return undefined;
}

export interface PendingSplit {
  readonly parent: Creep;
  readonly into: EnemyId;
  readonly count: number;
}

/**
 * Everything a spawn may override. An options bag rather than five positional
 * arguments, because `spawnCreep(w, 'mote', 7, 2, 3, 0, at)` is unreadable and
 * one transposed pair would be a silent balance bug.
 */
export interface SpawnOptions {
  hp?: number;
  bounty?: number;
  shield?: number;
  wave?: number;
  /**
   * Start partway along the route instead of at the entry.
   *
   * Used by splits: children appear where the parent died, not back at the
   * spawn. Without this a Cluster killed at the goal would hand the player
   * three fresh Motes with the whole route to walk, which is a reward.
   */
  at?: { x: number; y: number; leg: number; progress: number };
}

export function spawnCreep(w: World, defId: EnemyId, opts: SpawnOptions = {}): Creep {
  const def = ENEMIES[defId];
  const start = opts.at ?? { ...w.map.spawn, leg: 1, progress: 0 };
  const health = opts.hp ?? def.hp;
  const shield = opts.shield ?? def.shield;

  const creep: Creep = {
    id: w.nextId++,
    defId,
    x: start.x,
    y: start.y,
    // waypoints[0] is the off-board entry the creep is standing on, so the
    // first leg is walking toward waypoints[1].
    leg: start.leg,
    progress: start.progress,
    speed: def.speed,
    slowTimer: 0,
    slowFactor: 1,
    hp: health,
    maxHp: health,
    shield,
    maxShield: shield,
    shieldTimer: 0,
    bounty: opts.bounty ?? def.bounty,
    wave: opts.wave ?? w.wave.index,
    dead: false,
  };
  w.creeps.push(creep);
  return creep;
}
