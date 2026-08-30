import { buildTower, placementError } from '../build.ts';
import { spawnCreep, type World } from '../world.ts';
import { beginWave } from './waves.ts';

/**
 * Drain the command queue. Runs as the first phase of every tick so that player
 * actions apply at a well-defined instant, before anything moves.
 */
export function applyCommands(w: World): void {
  for (const cmd of w.commands) {
    switch (cmd.type) {
      case 'startWave':
        beginWave(w);
        break;

      case 'placeTower': {
        // Re-validated here rather than trusted from the click that produced
        // it: money may have been spent, or a wave may have started, between
        // the pointer event and this tick.
        const reason = placementError(w, cmd.defId, cmd.col, cmd.row);
        if (reason !== null) {
          w.events.push({ type: 'buildRejected', reason });
          break;
        }
        const tower = buildTower(w, cmd.defId, cmd.col, cmd.row);
        w.events.push({ type: 'towerPlaced', id: tower.id, col: tower.col, row: tower.row });
        break;
      }
      case 'spawnDebugCreep':
        spawnCreep(w, 'grunt');
        break;
    }
  }
  w.commands.length = 0;
}
