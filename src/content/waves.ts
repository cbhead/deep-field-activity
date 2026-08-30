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
 * The v1 arc. One enemy type, so the shape of a wave comes entirely from count
 * and spacing: steady pressure, then a rush that punishes thin single-tower
 * coverage, then overlapping groups that punish a single choke point.
 *
 * HP and bounty scale per wave from BALANCE — this table is pacing only.
 * These numbers are a first guess; M9's headless harness is what actually
 * tunes them.
 */
export const WAVES: readonly WaveDef[] = [
  wave(g(6, 1.2)),
  wave(g(8, 1.0)),
  wave(g(11, 0.9)),
  wave(g(8, 0.45)), //                      first rush — tests burst coverage
  wave(g(13, 0.85)),
  wave(g(8, 0.8), g(8, 0.8, 7)), //         two clusters, one breath between
  wave(g(16, 0.75)),
  wave(g(12, 0.4)), //                      sustained rush
  wave(g(14, 0.7), g(6, 0.35, 11)), //      long wave with a sting in the tail
  wave(g(24, 0.55)), //                     finale
];
