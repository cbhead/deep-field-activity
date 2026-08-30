import { BALANCE } from '../../content/balance.ts';
import { planWave, waveCount } from '../wavePlan.ts';
import { spawnCreep, waveStats, type World } from '../world.ts';

/**
 * Send the next wave now, forfeiting the rest of the intermission.
 *
 * Refused only while a wave is mid-spawn — sending two waves through the same
 * spawn plan at once has no sensible meaning. Every other moment is fair game,
 * including while the previous wave is still walking the board. That overlap is
 * the point: rushing buys tempo and cash at the cost of fighting two waves at
 * once, and in Race mode it is how a player pulls ahead.
 *
 * A refusal emits an event rather than returning silently. A control that does
 * nothing and says nothing reads as broken, which is exactly how this behaved
 * before.
 */
export function beginWave(w: World): void {
  const s = w.wave;

  if (s.phase === 'spawning') {
    w.events.push({ type: 'waveRejected', reason: 'spawning' });
    return;
  }
  if (s.phase === 'done') {
    w.events.push({ type: 'waveRejected', reason: 'done' });
    return;
  }

  // Captured before the timer is reset. The auto-start path arrives here with
  // the timer already at or below zero, so it earns nothing — the bonus is
  // strictly payment for time the player chose to give up.
  const secondsSaved = Math.max(0, s.timer);

  s.plan = planWave(w.seed, s.index);
  s.spawned = 0;
  s.timer = 0;
  s.phase = 'spawning';
  w.events.push({ type: 'waveStarted', wave: s.index, count: s.plan.length });

  if (secondsSaved > 0) {
    const bonus = Math.round(secondsSaved * BALANCE.rushBonusPerSecond);
    w.money += bonus;
    w.events.push({ type: 'waveRushed', wave: s.index, bonus, secondsSaved });
  }
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
        spawnCreep(w, next.enemy, next.hp, next.bounty, s.index);
        s.spawned++;
      }

      if (s.spawned >= s.plan.length) {
        s.dispatchedThrough = s.index;
        // The intermission starts now, not when the board empties. This is what
        // makes waves overlap.
        if (s.index + 1 >= waveCount()) {
          s.phase = 'done';
        } else {
          s.index++;
          s.phase = 'intermission';
          s.timer = BALANCE.intermission;
        }
      }
      break;
    }

    case 'done':
      break;
  }

  settleClearedWaves(w);
}

/**
 * Pay out for waves whose creeps have all left the board.
 *
 * Works from the lowest wave still alive, so it stays correct when waves
 * overlap and can settle several at once — a rush that stacks three waves and
 * then wipes them clears all three on the same tick.
 *
 * Leaks count as cleared: the life is already spent, and stalling the payout
 * because one creep got through would punish the player twice.
 */
function settleClearedWaves(w: World): void {
  const s = w.wave;

  let lowestLive = Infinity;
  for (const c of w.creeps) {
    if (!c.dead && c.wave < lowestLive) lowestLive = c.wave;
  }

  // Only waves that are both fully spawned and entirely gone from the board.
  const clearable = Math.min(s.dispatchedThrough, lowestLive - 1);
  while (s.clearedThrough < clearable) {
    s.clearedThrough++;
    w.money += BALANCE.waveClearReward;

    const tally = waveStats(w, s.clearedThrough);
    w.events.push({
      type: 'waveCleared',
      wave: s.clearedThrough,
      kills: tally.kills,
      bounty: tally.bounty,
      leaked: tally.leaked,
      reward: BALANCE.waveClearReward,
    });
  }

  if (s.clearedThrough >= waveCount() - 1 && w.phase === 'playing') {
    w.phase = 'won';
    w.events.push({ type: 'gameOver', won: true });
  }
}
