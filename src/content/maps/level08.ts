import type { MapSource } from '../types.ts';

/**
 * Sector 08. 26x15, two spawns, four lanes of 31 tiles, 92 tiles of road.
 *
 * The finale, and the trade the whole set has been building toward. Four lanes
 * out of two spawns: an outer pair running the board's full width, and an inner
 * pair cutting the corner.
 *
 * **The strong spot exists, it is real, and it covers half the board.** The
 * central band reaches the two inner lanes at close range and the two outer
 * lanes at no range at all — so the cluster every earlier board denied is
 * finally available, and taking it still leaves half the contacts unanswered.
 *
 * Five tiles of runway, 16%. The most road in the campaign and the least
 * buildable ground, at 282 tiles.
 */
export const LEVEL08 = {
  id: 'level08',
  name: 'Crown',

  rows: [
    '..........................',
    'S####################.....',
    '......#.............#.....',
    '......#.............#.....',
    '......#.............#.....',
    '......###############.....',
    '..xx................#.....',
    '..xx.....xxx..xxx...#####E',
    '..xx................#.....',
    '......###############.....',
    '......#.............#.....',
    '......#.............#..xx.',
    '......#.............#..xx.',
    'S####################.....',
    '..........................',
  ],

  routes: [
    {
      id: 'high',
      waypoints: [
        [0, 1],
        [20, 1],
        [20, 7],
        [25, 7],
      ],
    },
    {
      id: 'inner-high',
      waypoints: [
        [0, 1],
        [6, 1],
        [6, 5],
        [20, 5],
        [20, 7],
        [25, 7],
      ],
    },
    {
      id: 'low',
      waypoints: [
        [0, 13],
        [20, 13],
        [20, 7],
        [25, 7],
      ],
    },
    {
      id: 'inner-low',
      waypoints: [
        [0, 13],
        [6, 13],
        [6, 9],
        [20, 9],
        [20, 7],
        [25, 7],
      ],
    },
  ],
} as const satisfies MapSource;
