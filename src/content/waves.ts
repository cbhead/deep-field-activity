import type { EnemyId } from './enemies.ts';
import type { WaveDef, WaveGroup } from './types.ts';

/**
 * `count` enemies, one every `every` seconds, starting `after` seconds into the
 * wave. Two helpers is all it takes to keep the table below readable — the
 * alternative spelling is ten screens of object literals nobody will tune.
 */
const g = (count: number, every: number, after = 0, enemy: EnemyId = 'drifter'): WaveGroup => ({
  enemy,
  count,
  every,
  after,
});

const wave = (...groups: WaveGroup[]): WaveDef => ({ groups });

/**
 * The ten-wave arc.
 *
 * Each new contact type is introduced alone, in small numbers, one wave before
 * it appears in anger — so the wave that teaches it is survivable and the wave
 * that tests it is not a surprise. After wave 6 the table mixes types, which is
 * where a defence built around one answer starts to fail.
 *
 * HP, shield and bounty all scale per wave from BALANCE; this table is pacing
 * and composition only. Numbers here are pacing guesses — `tools/sweep.ts` is
 * what tunes the arc.
 */
export const WAVES_SWITCHBACK: readonly WaveDef[] = [
  wave(g(6, 1.2)), //                                    baseline
  wave(g(8, 1.0)),
  wave(g(6, 1.0), g(5, 0.35, 6, 'mote')), //             motes arrive, as a taste
  wave(g(6, 0.9), g(14, 0.28, 4, 'mote')), //            first real swarm
  wave(g(8, 0.85), g(1, 1, 5, 'monolith')), //           one monolith to learn on
  wave(g(6, 0.8), g(2, 3, 4, 'monolith'), g(10, 0.3, 12, 'mote')),
  wave(g(6, 0.9), g(3, 2.2, 3, 'warden'), g(1, 1, 11, 'bulwark')), // one bulwark to learn on
  wave(g(10, 0.4), g(2, 2, 6, 'cluster')), //            splitters under a rush
  wave(
    g(4, 1.0, 0, 'warden'),
    g(2, 3, 2, 'monolith'),
    g(3, 2.0, 5, 'bulwark'), //                          armour in anger
    g(4, 1.6, 8, 'cluster'),
  ),
  wave(
    g(12, 0.5), //                                       finale: all six at once
    g(4, 1.4, 3, 'warden'),
    g(3, 2.4, 6, 'monolith'),
    g(5, 1.3, 9, 'cluster'),
    g(4, 1.9, 12, 'bulwark'),
    g(16, 0.25, 16, 'mote'),
  ),
];

/**
 * Level 1's arc, under the name the rest of the codebase has always used.
 *
 * Kept as an alias rather than renamed at the call sites because `WAVES` is
 * what the balance harness, the gates and Race mode all mean by "the arc" —
 * the swept baseline. A campaign adds levels beside it; it does not get to
 * quietly redefine which table those tools measure.
 */
export const WAVES = WAVES_SWITCHBACK;

/**
 * Level 2, Cascade. Twelve waves, and its subject is **volume**.
 *
 * The map is 71 tiles of road in three full-width sweeps, which is a lot of
 * time on target — so the way to make it bite is not tougher contacts but more
 * of them than a thin defence can chew through before they reach the end. Motes
 * and Clusters carry the arc; the long road is exactly what makes a swarm
 * survivable enough to be interesting rather than instantly fatal.
 *
 * No teaching waves. By the time a player is here every type has been met on
 * Switchback, so this opens at the density that level ended on.
 */
export const WAVES_CASCADE: readonly WaveDef[] = [
  wave(g(8, 0.95), g(4, 0.45, 6, 'mote')), //            opens where Switchback closed
  wave(g(8, 0.8), g(10, 0.32, 4, 'mote')),
  wave(g(10, 0.7), g(5, 1.8, 4, 'cluster')),
  wave(g(10, 0.7), g(3, 2.2, 2, 'monolith'), g(26, 0.2, 6, 'mote')),
  wave(g(14, 0.5), g(7, 1.5, 4, 'cluster'), g(4, 1.8, 11, 'bulwark')),
  wave(g(12, 0.6), g(9, 1.2, 3, 'warden'), g(30, 0.18, 8, 'mote')), //  shields under a swarm
  wave(g(18, 0.42), g(9, 1.3, 4, 'cluster'), g(5, 2.0, 9, 'monolith')),
  wave(g(14, 0.5), g(10, 1.4, 2, 'bulwark'), g(11, 1.0, 7, 'warden')), // armour and shields together
  wave(g(22, 0.35), g(13, 1.0, 4, 'cluster'), g(38, 0.15, 10, 'mote')), // the overwhelm wave
  wave(g(16, 0.45), g(8, 1.8, 3, 'monolith'), g(12, 1.1, 6, 'bulwark'), g(12, 0.95, 11, 'warden')),
  wave(g(20, 0.38), g(15, 0.9, 3, 'cluster'), g(11, 1.5, 8, 'bulwark'), g(44, 0.14, 13, 'mote')),
  wave(
    g(26, 0.3), //                                       finale: volume, as promised
    g(16, 0.8, 3, 'cluster'),
    g(10, 1.6, 6, 'monolith'),
    g(15, 0.9, 9, 'warden'),
    g(14, 1.1, 12, 'bulwark'),
    g(54, 0.11, 14, 'mote'),
  ),
];

/**
 * Level 3, Pincer. Twelve waves, and its subject is **toughness**.
 *
 * The exact inverse of Cascade. The map's centre pocket reaches both vertical
 * lanes, so the level rewards one dense cluster of upgraded stations rather
 * than a spread — and the way to test that is contacts that need a big hit
 * rather than many small ones. Monoliths and Bulwarks lead; the swarms that
 * appear are there to punish a defence that has over-committed to single-target
 * damage and left itself nothing for a crowd.
 *
 * Fewer contacts per wave than Cascade, and each one is a harder problem.
 */
export const WAVES_PINCER: readonly WaveDef[] = [
  wave(g(8, 0.9), g(2, 2.5, 4, 'bulwark')), //           armour from the first wave
  wave(g(6, 1.0), g(2, 3.0, 2, 'monolith'), g(3, 2.0, 8, 'bulwark')),
  wave(g(8, 0.8), g(5, 1.6, 3, 'warden')),
  wave(g(6, 0.9), g(3, 2.6, 2, 'monolith'), g(5, 1.8, 8, 'bulwark')),
  wave(g(12, 0.5), g(6, 1.4, 4, 'cluster'), g(16, 0.28, 10, 'mote')), // the crowd check
  wave(g(8, 0.8), g(6, 2.0, 2, 'monolith'), g(10, 1.2, 7, 'warden')),
  wave(g(10, 0.7), g(11, 1.2, 3, 'bulwark'), g(5, 2.2, 9, 'monolith')),
  wave(g(12, 0.5), g(9, 1.2, 3, 'cluster'), g(12, 1.0, 8, 'warden')),
  wave(g(10, 0.6), g(8, 1.8, 2, 'monolith'), g(12, 1.1, 6, 'bulwark'), g(22, 0.24, 12, 'mote')),
  wave(g(12, 0.5), g(14, 1.0, 3, 'warden'), g(11, 1.3, 8, 'cluster')),
  wave(g(10, 0.7), g(10, 1.7, 2, 'monolith'), g(15, 0.9, 6, 'bulwark'), g(12, 1.1, 11, 'warden')),
  wave(
    g(14, 0.45), //                                      finale: everything hard at once
    g(11, 1.6, 2, 'monolith'),
    g(17, 0.85, 5, 'bulwark'),
    g(14, 1.0, 8, 'warden'),
    g(11, 1.2, 11, 'cluster'),
    g(28, 0.2, 14, 'mote'),
  ),
];
