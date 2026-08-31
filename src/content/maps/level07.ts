import type { MapSource } from '../types.ts';

/**
 * Sector 07. 26x15, two spawns, lanes of 20 and 50 tiles, 65 tiles of road.
 *
 * **A deliberate 2.5 : 1.** The only board in the set whose lanes are not
 * near-equal, and the asymmetry is its entire mechanism: a group released down
 * both lanes at once arrives in two separate deliveries. The chute punishes you
 * for having spent everything on the coil, and the coil is where the hull
 * actually is.
 *
 * This is also the board that made `first` targeting a real question rather
 * than a stylistic one — ranked by distance travelled, a contact two tiles from
 * the pulsar down the chute loses to one thirty tiles out on the coil. See
 * `score()` in `sim/systems/targeting.ts`.
 *
 * Six tiles of runway, which is 30% of the chute and 12% of the coil. Quoted
 * against the chute because that is the lane the runway has to stop.
 */
export const LEVEL07 = {
  id: 'level07',
  name: 'Sluice',

  rows: [
    '............S.............',
    '............#.............',
    '....#####...#.............',
    '....#...#...#.........xx..',
    '....#xxx#...#.............',
    '....#xxx#...#.............',
    '....#...#...#.............',
    '....#...#...#############E',
    '....#...#..........#......',
    '....#xxx#..........#......',
    '....#...#......xx..#......',
    '....#...#......xx..#......',
    'S####...############......',
    '..........................',
    '..........................',
  ],

  routes: [
    {
      id: 'chute',
      waypoints: [
        [12, 0],
        [12, 7],
        [25, 7],
      ],
    },
    {
      id: 'coil',
      waypoints: [
        [0, 12],
        [4, 12],
        [4, 2],
        [8, 2],
        [8, 12],
        [19, 12],
        [19, 7],
        [25, 7],
      ],
    },
  ],
} as const satisfies MapSource;
