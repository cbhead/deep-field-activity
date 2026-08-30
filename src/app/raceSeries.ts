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

/** Fold one result in and return the updated record. */
export function recordSeries(opponent: string, outcome: 'w' | 'l' | 't'): SeriesRecord {
  const store = load();
  const rec = store[opponent] ?? { w: 0, l: 0, t: 0 };
  rec[outcome]++;
  store[opponent] = rec;
  localStorage.setItem(KEY, JSON.stringify(store));
  return rec;
}

/** "Series vs Vela: 3–2" (+ " (1 tie)" when there are any). */
export const formatSeries = (opponent: string, rec: SeriesRecord): string =>
  `Series vs ${opponent}: ${rec.w}–${rec.l}${rec.t > 0 ? ` (${rec.t} tie${rec.t === 1 ? '' : 's'})` : ''}`;
