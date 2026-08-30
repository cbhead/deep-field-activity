/**
 * Seeded randomness.
 *
 * Race mode runs two INDEPENDENT simulations, so we do not need bit-identical
 * floats across machines (that's the heavy tax lockstep games pay, and we skip
 * it). What we do need is an identical *challenge*: both players must face the
 * same waves, with the same enemy stats, in the same order.
 *
 * The structural rule that makes that bulletproof: wave content is a pure
 * function of (seed, waveIndex) — never a sequential draw from one global
 * stream. With a single global PRNG, one extra roll on one machine (one more
 * crit, one more particle) shifts the entire stream and every subsequent wave
 * silently diverges. Deriving a fresh stream per wave makes wave 23 identical
 * regardless of what happened in waves 1-22.
 */

export type Rng = () => number;

/**
 * mulberry32. 32-bit state, integer-only ops via Math.imul (so no float drift),
 * and statistically far better than a tower defense needs. Six lines.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent, reproducible streams keyed by purpose and index. */
export const STREAM = {
  WAVE: 1,
  SPAWN: 2,
  COMBAT: 3,
} as const;

export type StreamId = (typeof STREAM)[keyof typeof STREAM];

export function streamFor(seed: number, purpose: StreamId, index: number): Rng {
  let h = seed ^ Math.imul(purpose, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x2545f491);
  return mulberry32(h >>> 0);
}

export const randRange = (r: Rng, lo: number, hi: number): number => lo + r() * (hi - lo);

export const randInt = (r: Rng, lo: number, hiExclusive: number): number =>
  lo + Math.floor(r() * (hiExclusive - lo));

export const chance = (r: Rng, p: number): boolean => r() < p;

export function pick<T>(r: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() from empty array');
  return items[Math.floor(r() * items.length)]!;
}

/** FNV-1a, so match seeds can be readable strings ("hunter2") rather than ints. */
export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Render as a stable 8-char hex code for display / sharing. */
export const formatSeed = (seed: number): string =>
  (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
