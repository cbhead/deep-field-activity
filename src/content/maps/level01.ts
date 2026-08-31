import type { MapSource } from '../types.ts';

/**
 * The v1 map. 26x15 tiles, six turns, 43 tiles of road.
 *
 * Shape goals: enough straight run for slow projectiles to land, a couple of
 * places where one tower covers two lanes (so placement is a decision rather
 * than "put it anywhere"), and open ground on both sides of the mid-board
 * switchback where the best builds should end up.
 */
export const LEVEL01 = {
  id: 'level01',
  name: 'Switchback',

  rows: [
    '..........................',
    '..........................',
    'S#######..................',
    '.......#.....#######......',
    '.......#.....#.....#......',
    '..xx...#.....#.....#......',
    '..xx...#.....#.....#......',
    '.......#######.....#......',
    '...................#......',
    '...................#......',
    '...................#......',
    '...................######E',
    '..........................',
    '......................xx..',
    '......................xx..',
  ],

  routes: [
    {
      id: 'main',
      waypoints: [
        [0, 2],
        [7, 2],
        [7, 7],
        [13, 7],
        [13, 3],
        [19, 3],
        [19, 11],
        [25, 11],
      ],
    },
  ],
} as const satisfies MapSource;
