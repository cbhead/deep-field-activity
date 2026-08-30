import type { MapSource } from '../types.ts';

/**
 * Campaign level 3. 26x15 tiles, nine turns, 63 tiles of road.
 *
 * Shape goals: a symmetric double hairpin, and the symmetry is the design. The
 * centre pocket (cols 12-16, rows 3-11) is within reach of *both* vertical
 * lanes down its sides, so the strongest build is one dense cluster rather than
 * a spread — the opposite of what Cascade rewards.
 *
 * That makes it the level where splash and pierce come into their own, and it
 * is deliberately last: the pocket is only a good idea once you can afford to
 * defend a single point properly, and a player who arrives here still spreading
 * their money thin will lose on the second hairpin.
 */
export const LEVEL03 = {
  id: 'level03',
  name: 'Pincer',

  rows: [
    '..........................',
    '..........................',
    '.....#######.....#####....',
    '.....#.xxx.#..x..#...#....',
    '.....#.xxx.#.....#.x.#....',
    '.....#.xxx.#..x..#.x.#....',
    '.....#.....#.....#...#....',
    'S#####.....#.....#...####E',
    '...........#.....#........',
    '...........#..x..#xxx.....',
    '...........#.....#xxx.....',
    '...........#..x..#xxx.....',
    '...........#######........',
    '..........................',
    '..........................',
  ],

  waypoints: [
    [0, 7],
    [5, 7],
    [5, 2],
    [11, 2],
    [11, 12],
    [17, 12],
    [17, 2],
    [21, 2],
    [21, 7],
    [25, 7],
  ],
} as const satisfies MapSource;
