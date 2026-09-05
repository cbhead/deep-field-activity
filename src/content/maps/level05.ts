import type { MapSource } from '../types.ts';

/**
 * Sector 05. 26x15, two spawns, lanes of 31 and 28 tiles, 51 tiles of road.
 *
 * **The generous trunk is the point.** Nine tiles of merge runway — 32% of the
 * shorter lane, and the loosest figure in the set — means the central build
 * genuinely works here. That is stated rather than hidden: a board where the
 * obvious answer is wrong every time is not teaching anything.
 *
 * So the pressure has to come from composition instead of geometry, which is
 * what its wave table does. Armour arrives up the rim and numbers up the well,
 * and one cluster tuned for either is wrong for the other.
 */
export const LEVEL05 = {
  id: 'level05',
  name: 'Delta',

  rows: [
    '..........................',
    '..........................',
    'S################.........',
    '................#..xx.....',
    '................#..xx.....',
    '........xxx.....#.........',
    '........xxx.....#.........',
    '................#.........',
    '...######################E',
    '...#......................',
    '...#......................',
    '...#...xx.................',
    '...#...xx.................',
    '...#......................',
    '...S......................',
  ],

  routes: [
    {
      id: 'rim',
      waypoints: [
        [0, 2],
        [16, 2],
        [16, 8],
        [25, 8],
      ],
    },
    {
      id: 'well',
      waypoints: [
        [3, 14],
        [3, 8],
        [25, 8],
      ],
    },
  ],
} as const satisfies MapSource;
