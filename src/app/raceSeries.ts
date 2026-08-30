/**
 * The running head-to-head record, per opponent name, in localStorage. Names
 * are the identity because that's what two friends actually have; a renamed
 * opponent starts a fresh series, which is the least surprising behaviour a
 * name change could buy.
 */

export interface SeriesRecord {
  w: number;
  l: number;
  t: number;
  /**
   * The most recent result, for the front door's one-line recap.
   *
   * "3–2" says how the rivalry stands; "last: won on Pincer" says what happened
   * and is the half that makes someone want a rematch. Optional because every
   * record written before this existed has none — the card simply omits the
   * line rather than inventing one.
   */
  last?: { outcome: 'w' | 'l' | 't'; sector: string };
}

const KEY = 'race-series';

type SeriesStore = Record<string, SeriesRecord>;

function load(): SeriesStore {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as SeriesStore) ?? {};
  } catch {
    return {};
  }
}

/**
 * Every series on record, most-played first.
 *
 * The front door needs this: a standing record against a named friend is the
 * single strongest reason to open the game twice, and it was invisible until
 * you were already mid-lobby. Sorted by games played so the card shows the
 * opponent you actually race, not whoever happens to be first in the object.
 */
export function readSeries(): { opponent: string; rec: SeriesRecord }[] {
  return Object.entries(load())
    .map(([opponent, rec]) => ({ opponent, rec }))
    .sort((a, b) => b.rec.w + b.rec.l + b.rec.t - (a.rec.w + a.rec.l + a.rec.t));
}

/** Fold one result in and return the updated record. */
export function recordSeries(
  opponent: string,
  outcome: 'w' | 'l' | 't',
  sector?: string,
): SeriesRecord {
  const store = load();
  const rec = store[opponent] ?? { w: 0, l: 0, t: 0 };
  rec[outcome]++;
  if (sector !== undefined) rec.last = { outcome, sector };
  store[opponent] = rec;
  localStorage.setItem(KEY, JSON.stringify(store));
  return rec;
}

/** "won on Pincer" — the half of the record that invites a rematch. */
export const describeLast = (rec: SeriesRecord): string | null =>
  rec.last === undefined
    ? null
    : `${rec.last.outcome === 'w' ? 'won' : rec.last.outcome === 'l' ? 'lost' : 'tied'} on ${rec.last.sector}`;

/** "Series vs Vela: 3–2" (+ " (1 tie)" when there are any). */
export const formatSeries = (opponent: string, rec: SeriesRecord): string =>
  `Series vs ${opponent}: ${rec.w}–${rec.l}${rec.t > 0 ? ` (${rec.t} tie${rec.t === 1 ? '' : 's'})` : ''}`;
