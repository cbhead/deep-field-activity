import {
  buildTower,
  placementError,
  sellTower,
  setTargeting,
  upgradeError,
  upgradeTower,
} from '../build.ts';
import { spawnCreep, towerById, type World } from '../world.ts';
import { beginWave } from './waves.ts';

/**
 * Drain the command queue. Runs as the first phase of every tick so that player
 * actions apply at a well-defined instant, before anything moves.
 *
 * Every branch re-validates rather than trusting the click that produced it:
 * money may have been spent, a wave may have started, or the tower may have
 * been sold between the pointer event and this tick.
 */
export function applyCommands(w: World): void {
  for (const cmd of w.commands) {
    switch (cmd.type) {
      case 'startWave':
        beginWave(w);
        break;

      case 'placeTower': {
        const reason = placementError(w, cmd.defId, cmd.col, cmd.row);
        if (reason !== null) {
          w.events.push({ type: 'buildRejected', reason });
          break;
        }
        const tower = buildTower(w, cmd.defId, cmd.col, cmd.row);
        w.events.push({ type: 'towerPlaced', id: tower.id, col: tower.col, row: tower.row });
        break;
      }

      case 'upgradeTower': {
        const t = towerById(w, cmd.id);
        const reason = upgradeError(w, t);
        if (reason !== null || t === undefined) {
          w.events.push({ type: 'towerActionRejected', reason: reason ?? 'noSuchTower' });
          break;
        }
        const cost = upgradeTower(w, t);
        w.events.push({ type: 'towerUpgraded', id: t.id, tier: t.tier, cost });
        break;
      }

      case 'sellTower': {
        const t = towerById(w, cmd.id);
        if (t === undefined) {
          w.events.push({ type: 'towerActionRejected', reason: 'noSuchTower' });
          break;
        }
        const { col, row } = t;
        const refund = sellTower(w, t);
        w.events.push({ type: 'towerSold', id: t.id, col, row, refund });
        break;
      }

      case 'setTargeting': {
        const t = towerById(w, cmd.id);
        if (t === undefined) {
          w.events.push({ type: 'towerActionRejected', reason: 'noSuchTower' });
          break;
        }
        setTargeting(t, cmd.mode);
        break;
      }

      case 'spawnDebugCreep':
        spawnCreep(w, 'drifter');
        break;
    }
  }
  w.commands.length = 0;
}
