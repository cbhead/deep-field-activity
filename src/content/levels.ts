/**
 * The campaign: an ordered list binding a board to an arc.
 *
 * A level is exactly those two things plus its presentation copy. It is not a
 * difficulty — that is a separate axis in `difficulty.ts`, chosen per run, so
 * three levels and three tiers are nine runs rather than nine hand-tuned
 * tables. Keeping them orthogonal is what stops the campaign from becoming a
 * place balance quietly forks.
 *
 * Order is progression order, and it is the only thing that defines it: the
 * menu unlocks level N once level N-1 has been cleared, so inserting a level
 * here inserts it into the campaign with no other edit.
 */

import { LEVEL01 } from './maps/level01.ts';
import { LEVEL02 } from './maps/level02.ts';
import { LEVEL03 } from './maps/level03.ts';
import { WAVES_SWITCHBACK, WAVES_CASCADE, WAVES_PINCER } from './waves.ts';
import type { SectorFieldId } from './sectors.ts';
import type { MapSource, WaveDef } from './types.ts';

export interface LevelDef {
  readonly id: string;
  /** The board's name. Doubles as the level's name — there is one per level. */
  readonly name: string;
  /** All-caps label above the name on the level card. */
  readonly kicker: string;
  /** Two lines at most: what this board asks of the player, not its story. */
  readonly blurb: string;
  readonly map: MapSource;
  readonly waves: readonly WaveDef[];
  /**
   * Which ground this sector is set in — an id resolved to colours in
   * `render/theme.ts`, never a colour itself. See `sectors.ts`.
   *
   * The one presentation *concept* content names, as opposed to the
   * presentation *copy* in `kicker` and `blurb`. It earns that because three
   * boards that look identical make the campaign feel like one board with the
   * label changed, and the renderer cannot know which is which on its own.
   */
  readonly field: SectorFieldId;
}

export const CAMPAIGN: readonly LevelDef[] = [
  {
    id: 'level01',
    name: LEVEL01.name,
    kicker: 'Sector 01',
    blurb:
      'Six turns and a short road. Every contact type shows up here for the first time, one wave before it matters.',
    map: LEVEL01,
    waves: WAVES_SWITCHBACK,
    field: 'switchback',
  },
  {
    id: 'level02',
    name: LEVEL02.name,
    kicker: 'Sector 02',
    blurb:
      'Three long sweeps and an open middle band. More road buys you time — and the waves spend all of it on numbers.',
    map: LEVEL02,
    waves: WAVES_CASCADE,
    field: 'cascade',
  },
  {
    id: 'level03',
    name: LEVEL03.name,
    kicker: 'Sector 03',
    blurb:
      'A symmetric double hairpin around a pocket that reaches both lanes. Build one strong point, not five weak ones.',
    map: LEVEL03,
    waves: WAVES_PINCER,
    field: 'pincer',
  },
];

export const levelById = (id: string): LevelDef | undefined => CAMPAIGN.find((l) => l.id === id);

export const levelIndex = (id: string): number => CAMPAIGN.findIndex((l) => l.id === id);
