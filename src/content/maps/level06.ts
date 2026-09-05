import type { MapSource } from '../types.ts';

/**
 * Sector 06. 26x15, two lanes of 43 tiles, 65 tiles of road.
 *
 * The lanes swap sides at every rung. A station on one flank sees half a wave,
 * then the other half, then the first again — so nothing here holds a file
 * together for long enough to be worth lining up.
 *
 * **This is the inverse of Pincer.** Pierce is worth least on this board and
 * chain is worth most: a chain needs proximity rather than alignment, and it is
 * the only thing that reads a merge well. Four tiles of runway — 9%, the
 * tightest in the set — means the merge is not an answer either.
 */
export const LEVEL06 = {
  id: 'level06',
  name: 'Braid',

  rows: [
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '...###################....',
    '...#.....#.....#.....#....',
    '...#.....#.....#.....#....',
    'S###.xxx.#.xxx.#.xxx.####E',
    '...#.....#.....#.....#....',
    '...#.....#.....#.....#....',
    '...###################....',
    '..........................',
    '..........................',
    '..........................',
    '..........................',
  ],

  routes: [
    {
      id: 'over',
      waypoints: [
        [0, 7],
        [3, 7],
        [3, 4],
        [9, 4],
        [9, 10],
        [15, 10],
        [15, 4],
        [21, 4],
        [21, 7],
        [25, 7],
      ],
    },
    {
      id: 'under',
      waypoints: [
        [0, 7],
        [3, 7],
        [3, 10],
        [9, 10],
        [9, 4],
        [15, 4],
        [15, 10],
        [21, 10],
        [21, 7],
        [25, 7],
      ],
    },
  ],
} as const satisfies MapSource;
