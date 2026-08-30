import { BALANCE } from '../../content/balance.ts';
import { planWave, waveCount } from '../wavePlan.ts';
import { spawnCreep, type World } from '../world.ts';

/** Begin the current wave immediately, whatever the intermission timer says. */
export function beginWave(w: World): void {
  const s = w.wave;
  if (s.phase !== 'intermission') return;

  s.plan = planWave(w.seed, s.index);
  s.spawned = 0;
  s.timer = 0;
  s.phase = 'spawning';
  w.events.push({ type: 'waveStarted', wave: s.index, count: s.plan.length });
}

export function updateWaves(w: World, dt: number): void {
  const s = w.wave;

  switch (s.phase) {
    case 'intermission':
      s.timer -= dt;
      if (s.timer <= 0) beginWave(w);
      break;

    case 'spawning': {
      s.timer += dt;
      // A `while`, not an `if`: at 4x speed, or with a tight rush wave, more
      // than one spawn can come due in a single 16ms tick.
      while (s.spawned < s.plan.length && s.plan[s.spawned]!.at <= s.timer) {
        const next = s.plan[s.spawned]!;
        spawnCreep(w, next.enemy, next.hp, next.bounty);
        s.spawned++;
      }
      if (s.spawned >= s.plan.length) s.phase = 'clearing';
      break;
    }

    case 'clearing':
      // Leaks count as cleared: the life is already gone, and stalling the
      // wave because the player let one through would punish twice.
      if (w.creeps.length === 0) {
        w.money += BALANCE.waveClearReward;
        w.events.push({ type: 'waveCleared', wave: s.index });

        if (s.index + 1 >= waveCount()) {
          s.phase = 'done';
          w.phase = 'won';
          w.events.push({ type: 'gameOver', won: true });
        } else {
          s.index++;
          s.phase = 'intermission';
          s.timer = BALANCE.intermission;
        }
      }
      break;

    case 'done':
      break;
  }
}
