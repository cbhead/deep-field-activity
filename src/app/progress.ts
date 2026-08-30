/**
 * Campaign progress, in localStorage.
 *
 * Two deliberate limits. It stores **results, not runs** — no mid-match save,
 * which the plan cut on purpose; losing a run is supposed to cost you the run.
 * And unlock state is **derived, never stored**: a level is open because the one
 * before it was cleared, which is a fact already implied by the results. Storing
 * an `unlocked` flag beside them would create a second source of truth that can
 * disagree with the first, and the failure mode is a player locked out of a
 * level they have finished.
 *
 * Every read is defensive. Storage can be absent (Safari private browsing
 * throws on access, not just on write), full, or hold whatever an older version
 * of this file wrote. None of those should cost a player their campaign, and
 * none of them should stop the game booting — a corrupt record degrades to
 * "nothing cleared yet", never to a crash.
 */

import { CAMPAIGN } from '../content/levels.ts';
import { DEFAULT_DIFFICULTY, type DifficultyId } from '../content/difficulty.ts';
import type { Grade } from '../sim/analysis.ts';

const KEY = 'td-campaign';
const VERSION = 1;

/** Best-first, so a numeric comparison can decide which of two runs was better. */
const GRADE_RANK: Readonly<Record<Grade, number>> = { S: 5, A: 4, B: 3, C: 2, D: 1 };

export interface RunRecord {
  grade: Grade;
  /** Lives left at the end, and the reserve they came out of. */
  lives: number;
  startingLives: number;
  /** Simulated seconds, not wall clock — `world.time`. */
  seconds: number;
  waves: number;
}

export interface LevelRecord {
  /** Cleared at *any* difficulty. This is what opens the next level. */
  cleared: boolean;
  /** Best run per difficulty. Absent means never finished at that tier. */
  best: Partial<Record<DifficultyId, RunRecord>>;
}

export interface Progress {
  version: number;
  levels: Record<string, LevelRecord>;
  /** Preselected on the difficulty picker, so the usual choice is one click. */
  lastDifficulty: DifficultyId;
}

const empty = (): Progress => ({ version: VERSION, levels: {}, lastDifficulty: DEFAULT_DIFFICULTY });

/**
 * Reading `localStorage` at all can throw — the property access itself does in
 * Safari's private mode — so even the existence check lives inside the guard.
 */
function read(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return empty();

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return empty();

    const p = parsed as Partial<Progress>;
    // A future version's data is not something this build can interpret, and
    // guessing at it is worse than starting clean.
    if (p.version !== VERSION || typeof p.levels !== 'object' || p.levels === null) return empty();

    return {
      version: VERSION,
      levels: p.levels,
      lastDifficulty: p.lastDifficulty ?? DEFAULT_DIFFICULTY,
    };
  } catch {
    return empty();
  }
}

function write(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Full, or disabled. The run still happened and the screens still work off
    // the in-memory copy; only the memory of it is lost. Not worth interrupting
    // a player who just finished a level to say so.
  }
}

export const loadProgress = (): Progress => read();

export function levelRecord(p: Progress, levelId: string): LevelRecord {
  return p.levels[levelId] ?? { cleared: false, best: {} };
}

/** Higher grade wins; then more lives kept; then a faster clock. */
function better(a: RunRecord, b: RunRecord | undefined): boolean {
  if (b === undefined) return true;
  if (GRADE_RANK[a.grade] !== GRADE_RANK[b.grade]) return GRADE_RANK[a.grade] > GRADE_RANK[b.grade];
  if (a.lives !== b.lives) return a.lives > b.lives;
  return a.seconds < b.seconds;
}

/**
 * Record a finished run and return the updated progress.
 *
 * `won` is passed rather than inferred from the grade because a defeat also
 * earns a record — how far you got on Blackout is worth keeping — but must not
 * unlock anything.
 */
export function recordRun(
  levelId: string,
  difficulty: DifficultyId,
  run: RunRecord,
  won: boolean,
): Progress {
  const p = read();
  const existing = levelRecord(p, levelId);

  const next: LevelRecord = {
    cleared: existing.cleared || won,
    best: { ...existing.best },
  };
  if (won && better(run, existing.best[difficulty])) next.best[difficulty] = run;

  p.levels[levelId] = next;
  p.lastDifficulty = difficulty;
  write(p);
  return p;
}

export function rememberDifficulty(difficulty: DifficultyId): void {
  const p = read();
  p.lastDifficulty = difficulty;
  write(p);
}

/**
 * Level 0 is always open; level N needs level N-1 cleared.
 *
 * Derived from the records on every call rather than cached, because it is a
 * pure function of them and a cache here would be a bug waiting for the moment
 * a run finishes and nothing invalidates it.
 */
export function isUnlocked(p: Progress, index: number): boolean {
  if (index <= 0) return true;
  const prev = CAMPAIGN[index - 1];
  return prev !== undefined && levelRecord(p, prev.id).cleared;
}

/** The furthest level the player may open — where the menu puts the cursor. */
export function furthestUnlocked(p: Progress): number {
  let last = 0;
  for (let i = 0; i < CAMPAIGN.length; i++) if (isUnlocked(p, i)) last = i;
  return last;
}

export function resetProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Same as write: nothing useful to do, and nothing worth crashing over.
  }
}
