import type { MapSource } from '../types.ts';

/**
 * Front Line — the versus board. 26x15, two lanes of 33 tiles each.
 *
 * **This is one half of a corridor, not a whole board.** The fiction is a lane
 * running between two cores; the mechanism is the route model that already
 * exists, because each client only ever simulates the half facing it. `S` at the
 * left edge is *midfield* — where the neutral wave appears and where the other
 * side's sorties enter — and `E` at the right edge is this player's core. The
 * opponent plays the mirror of this, and nothing crosses between the two
 * simulations except one message per sortie.
 *
 * Both lanes are **the same length and a different shape**, which is the whole
 * design. A short lane and a long lane would make the send trivial — everything
 * would go down the short one — so the read has to be "which of their two
 * defences is thinner" rather than "which lane is objectively better". Crest
 * turns five times through the upper field and rewards splash and anything that
 * shoots along a file; Trough runs one fourteen-tile straight and rewards reach
 * and ramp. Neither is the correct answer to both.
 *
 * The merge is deliberately **five tiles and hard against the core**. That is
 * the same rule Fork encodes at 18% of a lane — guarding the merge is legal and
 * never sufficient — but moved to the end, where it does something Fork's
 * cannot: it makes forward and home two genuinely different investments. A
 * station near midfield meets a sortie early and sees the neutral wave first,
 * and is thirty tiles from the thing it is protecting. A station on the merge
 * covers everything and only for five tiles, so every life it saves it saves at
 * the last possible moment.
 *
 * **The scenery is load-bearing and was measured, not drawn.** The gate in
 * `tools/check.ts` walks every buildable tile at the longest purchasable reach
 * — Singularity's 3.3 at range Mk III, 4.364 tiles — and scores each one on how
 * much of *each* lane's exclusive road it covers. The rule is that committing
 * to one lane must beat hedging both by a wide margin, and the figures are:
 *
 *   with the plug     best hedge 4 tiles @ 21,8   best commit 13 @ 10,2   3.25x
 *   without it        best hedge 7 tiles @ 17,8   best commit 13 @ 10,2   1.86x
 *
 * At 1.86x the hedge is close enough to free that the two lanes stop being two
 * questions, and the board becomes Cascade with extra steps. The plug at cols
 * 17–19 is what buys the margin; the flanges at 13–16 shape the waist. Nothing
 * here was drawn by eye.
 *
 * Measured, not counted by hand: both lanes 33 tiles, 62 tiles of road, 17 of
 * scenery, 311 buildable, merge runway 5 tiles at 15% of a lane — against
 * Fork's 6 at 18%, which is the precedent this is holding itself to.
 */
export const VERSUS = {
  id: 'versus',
  name: 'Front Line',

  rows: [
    '..........................',
    '......#########...........',
    '......#.......#...........',
    'S######.......#...........',
    '..............#...........',
    '..............#######.....',
    '.............xxxxxxx#.....',
    '.................xxx#####E',
    '.............xxxxxxx#.....',
    '....................#.....',
    '....................#.....',
    'S####.............###.....',
    '....#.............#.......',
    '....###############.......',
    '..........................',
  ],

  routes: [
    {
      id: 'crest',
      waypoints: [
        [0, 3],
        [6, 3],
        [6, 1],
        [14, 1],
        [14, 5],
        [20, 5],
        [20, 7],
        [25, 7],
      ],
    },
    {
      id: 'trough',
      waypoints: [
        [0, 11],
        [4, 11],
        [4, 13],
        [18, 13],
        [18, 11],
        [20, 11],
        [20, 7],
        [25, 7],
      ],
    },
  ],
} as const satisfies MapSource;
