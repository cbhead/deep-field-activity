import { BALANCE } from '../content/balance.ts';
import { ENEMIES, type EnemyId } from '../content/enemies.ts';
import type { Command, Creep, EntityId, MapDef, SimEvent } from './types.ts';

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

  lives: number;
  money: number;

  creeps: Creep[];

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
    lives: BALANCE.startingLives,
    money: BALANCE.startingMoney,
    creeps: [],
    commands: [],
    events: [],
    nextId: 1,
  };
}

export function spawnCreep(w: World, defId: EnemyId): Creep {
  const def = ENEMIES[defId];
  const start = w.map.spawn;

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
    hp: def.hp,
    maxHp: def.hp,
    dead: false,
  };
  w.creeps.push(creep);
  return creep;
}
