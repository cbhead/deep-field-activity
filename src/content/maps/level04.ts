import type { MapSource } from '../types.ts';

/**
 * Sector 04. 26x15, two lanes of 33 tiles, 54 tiles of road.
 *
 * The first board that splits, and it splits symmetrically so the split itself
 * is the only new thing to read. One spawn, one goal, and between them a ring:
 * a wave dealt `'split'` goes half over the top and half under the bottom.
 *
 * **The centre pocket is blocked on purpose.** Without the scenery a single
 * cluster in the middle would reach both lanes and the board would be Pincer
 * with extra steps. With it, the one position that answers everything does not
 * exist, and the choice is between two thin defences and one strong one on the
 * merge.
 *
 * Merge runway is six tiles — 18% of a lane. Deliberately enough to kill a
 * Drifter and not enough to kill anything else, so guarding the merge is legal
 * but never sufficient.
 */
export const LEVEL04 = {
  id: 'level04',
  name: 'Fork',

  rows: [
    '..........................',
    '..........................',
    '..........................',
    '......##############......',
    '......#............#......',
    '......#.xx.......x.#......',
    '......#....xxxx....#......',
    'S######....xxxx....######E',
    '......#....xxxx....#......',
    '......#.xx.......x.#......',
    '......#............#......',
    '......##############......',
    '..........................',
    '..........................',
    '..........................',
  ],

  routes: [
    {
      id: 'north',
      waypoints: [
        [0, 7],
        [6, 7],
        [6, 3],
        [19, 3],
        [19, 7],
        [25, 7],
      ],
    },
    {
      id: 'south',
      waypoints: [
        [0, 7],
        [6, 7],
        [6, 11],
        [19, 11],
        [19, 7],
        [25, 7],
      ],
    },
  ],
} as const satisfies MapSource;
