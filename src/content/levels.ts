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
import { LEVEL04 } from './maps/level04.ts';
import { LEVEL05 } from './maps/level05.ts';
import { LEVEL06 } from './maps/level06.ts';
import { LEVEL07 } from './maps/level07.ts';
import { LEVEL08 } from './maps/level08.ts';
import {
  WAVES_SWITCHBACK,
  WAVES_CASCADE,
  WAVES_PINCER,
  WAVES_FORK,
  WAVES_DELTA,
  WAVES_BRAID,
  WAVES_SLUICE,
  WAVES_CROWN,
} from './waves.ts';
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
  {
    id: 'level04',
    name: LEVEL04.name,
    kicker: 'Sector 04',
    blurb:
      'The road splits, and a wave splits with it. The middle is blocked, so there is no one place that answers both halves.',
    map: LEVEL04,
    waves: WAVES_FORK,
    field: 'fork',
  },
  {
    id: 'level05',
    name: LEVEL05.name,
    kicker: 'Sector 05',
    blurb:
      'Two spawns onto one generous trunk. The central build works here — but armour comes up the rim and numbers up the well.',
    map: LEVEL05,
    waves: WAVES_DELTA,
    field: 'delta',
  },
  {
    id: 'level06',
    name: LEVEL06.name,
    kicker: 'Sector 06',
    blurb:
      'The lanes trade sides at every rung. Nothing stays lined up long enough to shoot through, and the merge is four tiles.',
    map: LEVEL06,
    waves: WAVES_BRAID,
    field: 'braid',
  },
  {
    id: 'level07',
    name: LEVEL07.name,
    kicker: 'Sector 07',
    blurb:
      'A short chute and a long coil, 20 tiles against 50. One wave, two arrivals — and the hull is always on the slow road.',
    map: LEVEL07,
    waves: WAVES_SLUICE,
    field: 'sluice',
  },
  {
    id: 'level08',
    name: LEVEL08.name,
    kicker: 'Sector 08',
    blurb:
      'Four lanes out of two spawns. The strong position is real and it covers half the board — which leaves the other half.',
    map: LEVEL08,
    waves: WAVES_CROWN,
    field: 'crown',
  },
];

export const levelById = (id: string): LevelDef | undefined => CAMPAIGN.find((l) => l.id === id);

export const levelIndex = (id: string): number => CAMPAIGN.findIndex((l) => l.id === id);
