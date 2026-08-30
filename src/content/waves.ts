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
export const WAVES: readonly WaveDef[] = [
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
