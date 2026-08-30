import { spawnCreep, type World } from '../world.ts';

/**
 * Drain the command queue. Runs as the first phase of every tick so that player
 * actions apply at a well-defined instant, before anything moves.
 */
export function applyCommands(w: World): void {
  for (const cmd of w.commands) {
    switch (cmd.type) {
      case 'spawnDebugCreep':
        spawnCreep(w, 'grunt');
        break;
    }
  }
  w.commands.length = 0;
}
