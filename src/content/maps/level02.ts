import type { MapSource } from '../types.ts';

/**
 * Campaign level 2. 26x15 tiles, seven turns, 71 tiles of road.
 *
 * Shape goals: much longer road than Switchback, laid out as three sweeps that
 * run the full width of the board. The point is the middle band (rows 6-8) —
 * it is open ground sandwiched between the second and third sweeps, so a
 * station placed there covers two lanes at once and the whole level becomes a
 * question of how much you commit to that band versus the entry run.
 *
 * The long straights are also the first place slow projectiles are comfortable,
 * which is what makes this the level where Lance stops being a liability.
 */
export const LEVEL02 = {
  id: 'level02',
  name: 'Cascade',

  rows: [
    '..........................',
    'S######################...',
    '......xxxxx...xxxxx...#...',
    '......xxxxx...xxxxx...#...',
    '......................#...',
    '...####################...',
    '...#......................',
    '...#..xxxx...xxxx.........',
    '...#..xxxx...xxxx.........',
    '...####################...',
    '......xxxxx...xxxxx...#...',
    '......xxxxx...xxxxx...#...',
    '......................#...',
    '......................###E',
    '..........................',
  ],

  waypoints: [
    [0, 1],
    [22, 1],
    [22, 5],
    [3, 5],
    [3, 9],
    [22, 9],
    [22, 13],
    [25, 13],
  ],
} as const satisfies MapSource;
