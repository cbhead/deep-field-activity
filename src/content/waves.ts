import type { EnemyId } from './enemies.ts';
import type { WaveDef, WaveGroup } from './types.ts';

/**
 * `count` enemies, one every `every` seconds, starting `after` seconds into the
 * wave. Two helpers is all it takes to keep the table below readable — the
 * alternative spelling is ten screens of object literals nobody will tune.
 */
const g = (count: number, every: number, after = 0, enemy: EnemyId = 'drifter'): WaveGroup => ({
  enemy,
  count,
  every,
  after,
});

const wave = (...groups: WaveGroup[]): WaveDef => ({ groups });

/**
 * A group dealt evenly across every lane, and a factory for one pinned to a
 * named lane.
 *
 * Three spellings rather than one `g` with a fifth argument, because on a
 * multi-lane board the lane is not a detail of the group — it is most of what
 * the group *is*. `rim(4, 2, 0, 'bulwark')` says "armour up the rim" in the
 * shape of the sentence a designer would use; `g(4, 2, 0, 'bulwark', 'rim')`
 * buries it behind three positional numbers.
 *
 * `g` keeps meaning "lane 0", which on the five single-lane boards is the only
 * lane and is why their tables did not have to change.
 */
const s = (count: number, every: number, after = 0, enemy: EnemyId = 'drifter'): WaveGroup => ({
  enemy,
  count,
  every,
  after,
  route: 'split',
});

const lane =
  (route: string) =>
  (count: number, every: number, after = 0, enemy: EnemyId = 'drifter'): WaveGroup => ({
    enemy,
    count,
    every,
    after,
    route,
  });

/**
 * The ten-wave arc.
 *
 * Each new contact type is introduced alone, in small numbers, one wave before
 * it appears in anger — so the wave that teaches it is survivable and the wave
 * that tests it is not a surprise. After wave 6 the table mixes types, which is
 * where a defence built around one answer starts to fail.
 *
 * HP, shield and bounty all scale per wave from BALANCE; this table is pacing
 * and composition only. Numbers here are pacing guesses — `tools/sweep.ts` is
 * what tunes the arc.
 */
export const WAVES_SWITCHBACK: readonly WaveDef[] = [
  wave(g(6, 1.2)), //                                    baseline
  wave(g(8, 1.0)),
  wave(g(6, 1.0), g(5, 0.35, 6, 'mote')), //             motes arrive, as a taste
  wave(g(6, 0.9), g(14, 0.28, 4, 'mote')), //            first real swarm
  wave(g(8, 0.85), g(1, 1, 5, 'monolith')), //           one monolith to learn on
  wave(g(6, 0.8), g(2, 3, 4, 'monolith'), g(10, 0.3, 12, 'mote')),
  wave(g(6, 0.9), g(3, 2.2, 3, 'warden'), g(1, 1, 11, 'bulwark')), // one bulwark to learn on
  wave(g(10, 0.4), g(2, 2, 6, 'cluster')), //            splitters under a rush
  wave(
    g(4, 1.0, 0, 'warden'),
    g(2, 3, 2, 'monolith'),
    g(3, 2.0, 5, 'bulwark'), //                          armour in anger
    g(4, 1.6, 8, 'cluster'),
  ),
  wave(
    g(12, 0.5), //                                       finale: all six at once
    g(4, 1.4, 3, 'warden'),
    g(3, 2.4, 6, 'monolith'),
    g(5, 1.3, 9, 'cluster'),
    g(4, 1.9, 12, 'bulwark'),
    g(16, 0.25, 16, 'mote'),
  ),
];

/**
 * Level 1's arc, under the name the rest of the codebase has always used.
 *
 * Kept as an alias rather than renamed at the call sites because `WAVES` is
 * what the balance harness, the gates and Race mode all mean by "the arc" —
 * the swept baseline. A campaign adds levels beside it; it does not get to
 * quietly redefine which table those tools measure.
 */
export const WAVES = WAVES_SWITCHBACK;

/**
 * Level 2, Cascade. Twelve waves, and its subject is **volume**.
 *
 * The map is 71 tiles of road in three full-width sweeps, which is a lot of
 * time on target — so the way to make it bite is not tougher contacts but more
 * of them than a thin defence can chew through before they reach the end. Motes
 * and Clusters carry the arc; the long road is exactly what makes a swarm
 * survivable enough to be interesting rather than instantly fatal.
 *
 * No teaching waves. By the time a player is here every type has been met on
 * Switchback, so this opens at the density that level ended on.
 */
export const WAVES_CASCADE: readonly WaveDef[] = [
  wave(g(8, 0.95), g(4, 0.45, 6, 'mote')), //            opens where Switchback closed
  wave(g(8, 0.8), g(10, 0.32, 4, 'mote')),
  wave(g(10, 0.7), g(5, 1.8, 4, 'cluster')),
  wave(g(10, 0.7), g(3, 2.2, 2, 'monolith'), g(26, 0.2, 6, 'mote')),
  wave(g(14, 0.5), g(7, 1.5, 4, 'cluster'), g(4, 1.8, 11, 'bulwark')),
  wave(g(12, 0.6), g(9, 1.2, 3, 'warden'), g(30, 0.18, 8, 'mote')), //  shields under a swarm
  wave(g(18, 0.42), g(9, 1.3, 4, 'cluster'), g(5, 2.0, 9, 'monolith')),
  wave(g(14, 0.5), g(10, 1.4, 2, 'bulwark'), g(11, 1.0, 7, 'warden')), // armour and shields together
  wave(g(22, 0.35), g(13, 1.0, 4, 'cluster'), g(38, 0.15, 10, 'mote')), // the overwhelm wave
  wave(g(16, 0.45), g(8, 1.8, 3, 'monolith'), g(12, 1.1, 6, 'bulwark'), g(12, 0.95, 11, 'warden')),
  wave(g(20, 0.38), g(15, 0.9, 3, 'cluster'), g(11, 1.5, 8, 'bulwark'), g(44, 0.14, 13, 'mote')),
  wave(
    g(26, 0.3), //                                       finale: volume, as promised
    g(16, 0.8, 3, 'cluster'),
    g(10, 1.6, 6, 'monolith'),
    g(15, 0.9, 9, 'warden'),
    g(14, 1.1, 12, 'bulwark'),
    g(54, 0.11, 14, 'mote'),
  ),
];

/**
 * Level 3, Pincer. Twelve waves, and its subject is **toughness**.
 *
 * The exact inverse of Cascade. The map's centre pocket reaches both vertical
 * lanes, so the level rewards one dense cluster of upgraded stations rather
 * than a spread — and the way to test that is contacts that need a big hit
 * rather than many small ones. Monoliths and Bulwarks lead; the swarms that
 * appear are there to punish a defence that has over-committed to single-target
 * damage and left itself nothing for a crowd.
 *
 * Fewer contacts per wave than Cascade, and each one is a harder problem.
 */
export const WAVES_PINCER: readonly WaveDef[] = [
  wave(g(8, 0.9), g(2, 2.5, 4, 'bulwark')), //           armour from the first wave
  wave(g(6, 1.0), g(2, 3.0, 2, 'monolith'), g(3, 2.0, 8, 'bulwark')),
  wave(g(8, 0.8), g(5, 1.6, 3, 'warden')),
  wave(g(6, 0.9), g(3, 2.6, 2, 'monolith'), g(5, 1.8, 8, 'bulwark')),
  wave(g(12, 0.5), g(6, 1.4, 4, 'cluster'), g(16, 0.28, 10, 'mote')), // the crowd check
  wave(g(8, 0.8), g(6, 2.0, 2, 'monolith'), g(10, 1.2, 7, 'warden')),
  wave(g(10, 0.7), g(11, 1.2, 3, 'bulwark'), g(5, 2.2, 9, 'monolith')),
  wave(g(12, 0.5), g(9, 1.2, 3, 'cluster'), g(12, 1.0, 8, 'warden')),
  wave(g(10, 0.6), g(8, 1.8, 2, 'monolith'), g(12, 1.1, 6, 'bulwark'), g(22, 0.24, 12, 'mote')),
  wave(g(12, 0.5), g(14, 1.0, 3, 'warden'), g(11, 1.3, 8, 'cluster')),
  wave(g(10, 0.7), g(10, 1.7, 2, 'monolith'), g(15, 0.9, 6, 'bulwark'), g(12, 1.1, 11, 'warden')),
  wave(
    g(14, 0.45), //                                      finale: everything hard at once
    g(11, 1.6, 2, 'monolith'),
    g(17, 0.85, 5, 'bulwark'),
    g(14, 1.0, 8, 'warden'),
    g(11, 1.2, 11, 'cluster'),
    g(28, 0.2, 14, 'mote'),
  ),
];

/**
 * Level 4, Fork. Twelve waves, and its subject is **the split itself**.
 *
 * Everything a player has learned so far assumes one file of contacts. This
 * board halves it, and the table's job is to make that legible before it makes
 * it hard — so wave 1 is Drifters and nothing else, dealt evenly, and the only
 * new information is that they arrive in two places.
 *
 * The single-lane waves are the teaching, not the difficulty. A group pinned to
 * `north` while `south` stays empty is the board admitting what it costs to
 * cover only one side, and it appears early so the lesson is cheap.
 */
const north = lane('north');
const south = lane('south');

export const WAVES_FORK: readonly WaveDef[] = [
  wave(s(7, 0.8)), //                                    the split, with nothing else in it
  wave(north(5, 0.85), south(5, 0.85, 3)), //            the same wave, one lane at a time
  wave(s(8, 0.7), s(8, 0.3, 5, 'mote')),
  wave(s(7, 0.8), north(2, 2.4, 4, 'bulwark')), //       armour commits to one side
  wave(s(9, 0.55), s(4, 1.6, 4, 'cluster')),
  wave(s(7, 0.7), s(2, 2.6, 3, 'monolith'), s(12, 0.26, 8, 'mote')),
  wave(s(8, 0.6), s(5, 1.3, 3, 'warden'), south(2, 2.2, 9, 'bulwark')),
  wave(s(9, 0.5), s(5, 1.3, 4, 'cluster'), s(4, 2.2, 9, 'monolith')),
  wave(north(7, 0.65), south(7, 0.65), s(6, 1.2, 5, 'warden')), //  both sides, at once
  wave(s(8, 0.55), s(4, 1.8, 2, 'monolith'), s(6, 1.3, 6, 'bulwark'), s(14, 0.24, 11, 'mote')),
  wave(s(9, 0.5), s(7, 1.1, 3, 'cluster'), s(6, 1.5, 8, 'bulwark')),
  wave(
    s(11, 0.4), //                                       finale
    s(5, 1.7, 3, 'monolith'),
    s(7, 1.0, 6, 'bulwark'),
    s(7, 1.1, 9, 'warden'),
    s(6, 1.3, 12, 'cluster'),
    s(16, 0.22, 15, 'mote'),
  ),
];

/**
 * Level 5, Delta. Twelve waves, and its subject is **two problems at once**.
 *
 * The board is the generous one — nine tiles of merge runway, the loosest in
 * the campaign — so the central build genuinely works and the geometry cannot
 * supply the pressure. The table has to.
 *
 * **Armour up the rim, numbers up the well.** That split is the whole design:
 * a cluster tuned to chew through Bulwarks is the wrong cluster for forty
 * Motes, and the two arrive down different roads at the same time. Guarding the
 * trunk answers both badly rather than either well.
 */
const rim = lane('rim');
const well = lane('well');

export const WAVES_DELTA: readonly WaveDef[] = [
  wave(rim(8, 0.9)), //                                  the rim, alone
  wave(well(3, 1.0), well(10, 0.45, 3, 'mote')), //      the well, alone
  wave(rim(7, 1.0), well(10, 0.35, 3, 'mote')), //       and now both, which costs a third station
  wave(rim(2, 2.4, 0, 'bulwark'), rim(6, 1.0, 4), well(6, 0.4, 2, 'mote'), well(4, 0.9, 7)), // the thesis
  wave(rim(2, 2.6, 0, 'monolith'), rim(5, 1.1, 5), well(3, 1.5, 3, 'cluster'), well(7, 0.4, 9, 'mote')),
  wave(rim(3, 2.0, 0, 'bulwark'), rim(4, 1.6, 5, 'warden'), well(9, 0.32, 3, 'mote'), well(5, 0.8, 9)),
  wave(rim(3, 2.2, 0, 'monolith'), well(5, 1.3, 4, 'cluster'), well(8, 0.5, 9)),
  wave(rim(3, 1.9, 0, 'bulwark'), rim(3, 2.4, 5, 'monolith'), well(17, 0.24, 4, 'mote')),
  wave(rim(5, 1.4, 0, 'warden'), well(7, 1.2, 3, 'cluster'), well(10, 0.4, 8, 'mote')),
  wave(rim(3, 1.8, 0, 'monolith'), rim(5, 1.4, 5, 'bulwark'), well(18, 0.2, 3, 'mote')),
  wave(rim(5, 1.6, 0, 'bulwark'), rim(3, 2.0, 6, 'monolith'), well(7, 1.0, 3, 'cluster'), well(13, 0.24, 10, 'mote')),
  wave(
    rim(7, 1.4, 0, 'bulwark'), //                        finale: both roads, both problems
    rim(5, 1.8, 4, 'monolith'),
    rim(7, 1.2, 8, 'warden'),
    well(8, 0.9, 2, 'cluster'),
    well(20, 0.15, 6, 'mote'),
    well(8, 0.55, 12),
  ),
];

/**
 * Level 6, Braid. Twelve waves, and its subject is **nothing ever lines up**.
 *
 * The lanes swap sides at every rung, so a file assembled on one flank is
 * broken by the next crossing. Almost everything here is `'split'` — pinning a
 * group to one lane would hand the player the one thing the board is built to
 * deny, which is a predictable side.
 *
 * Composition leans on spread rather than on toughness: Motes and Clusters over
 * Monoliths. This is the board where chain is worth most and pierce least, and
 * the table is what makes that true rather than merely claimed.
 */
export const WAVES_BRAID: readonly WaveDef[] = [
  wave(s(6, 0.7), s(6, 0.35, 4, 'mote')),
  wave(s(7, 0.6), s(8, 0.3, 3, 'mote')),
  wave(s(6, 0.65), s(4, 1.4, 3, 'cluster')),
  wave(s(8, 0.5), s(12, 0.24, 4, 'mote'), s(2, 2.6, 9, 'monolith')),
  wave(s(7, 0.55), s(6, 1.2, 2, 'cluster'), s(4, 1.4, 7, 'warden')),
  wave(s(9, 0.45), s(16, 0.2, 3, 'mote'), s(3, 1.9, 8, 'bulwark')),
  wave(s(8, 0.5), s(7, 1.0, 2, 'cluster'), s(6, 1.1, 7, 'warden')),
  wave(s(10, 0.4), s(19, 0.17, 3, 'mote'), s(6, 1.5, 9, 'bulwark')),
  wave(s(9, 0.45), s(8, 0.9, 2, 'cluster'), s(7, 1.1, 6, 'warden'), s(3, 2.2, 11, 'monolith')),
  wave(s(11, 0.36), s(22, 0.15, 3, 'mote'), s(6, 1.3, 8, 'bulwark')),
  wave(s(10, 0.4), s(9, 0.85, 2, 'cluster'), s(8, 1.0, 6, 'warden'), s(16, 0.2, 12, 'mote')),
  wave(
    s(13, 0.3), //                                       finale: spread, never a file
    s(10, 0.75, 3, 'cluster'),
    s(9, 0.95, 6, 'warden'),
    s(6, 1.5, 9, 'bulwark'),
    s(3, 2.2, 12, 'monolith'),
    s(28, 0.11, 14, 'mote'),
  ),
];

/**
 * Level 7, Sluice. Twelve waves, and its subject is **two deliveries**.
 *
 * The lanes are 20 tiles and 50, deliberately, so a group released down both at
 * once arrives twice — once almost immediately, and once much later. Every
 * group here names its lane; `'split'` would waste the one board whose whole
 * mechanism is that the lanes are not interchangeable.
 *
 * **The hull is on the coil and the tempo is on the chute.** Spend everything
 * on the long road and the chute kills you in the gap; spend it on the chute
 * and nothing on the board can chew a Monolith. The `after` figures matter more
 * here than anywhere else in the campaign — a chute group released nine seconds
 * late lands *with* the coil group that left at zero.
 */
const chute = lane('chute');
const coil = lane('coil');

export const WAVES_SLUICE: readonly WaveDef[] = [
  wave(coil(8, 0.9), chute(3, 1.2, 7)), //               released later, and still lands first
  wave(coil(9, 0.8), chute(5, 0.8, 6), chute(5, 0.35, 12, 'mote')),
  wave(coil(2, 2.4, 0, 'monolith'), coil(8, 0.9, 4), chute(6, 0.6, 9)), // hull takes the slow road
  wave(coil(2, 2.4, 0, 'bulwark'), coil(8, 0.85, 5), chute(6, 0.4, 10, 'mote'), chute(4, 0.9, 14)),
  wave(coil(3, 2.1, 0, 'bulwark'), coil(7, 1.0, 5), chute(3, 1.4, 11, 'cluster'), chute(5, 0.7, 15)),
  wave(coil(3, 2.2, 0, 'monolith'), coil(6, 1.2, 5, 'warden'), chute(7, 0.3, 10, 'mote'), chute(5, 0.8, 15)),
  wave(coil(4, 1.7, 0, 'bulwark'), coil(6, 1.0, 4), chute(4, 1.2, 9, 'cluster'), chute(6, 0.45, 14)),
  wave(coil(5, 2.0, 0, 'monolith'), coil(5, 1.1, 6, 'warden'), chute(12, 0.22, 10, 'mote')),
  wave(coil(6, 1.3, 0, 'bulwark'), coil(3, 2.2, 5, 'monolith'), chute(6, 0.95, 11, 'cluster')),
  wave(coil(6, 1.2, 0, 'warden'), chute(14, 0.19, 8, 'mote'), chute(5, 1.3, 14, 'cluster')),
  wave(coil(5, 1.8, 0, 'monolith'), coil(8, 1.0, 5, 'bulwark'), chute(8, 0.85, 12, 'cluster')),
  wave(
    coil(5, 1.6, 0, 'monolith'), //                     finale: the hull leaves first
    coil(8, 0.9, 4, 'bulwark'),
    coil(8, 1.0, 9, 'warden'),
    chute(9, 0.5, 12), //                               and the chute lands on top of it
    chute(18, 0.15, 16, 'mote'),
    chute(5, 1.1, 20, 'cluster'),
  ),
];

/**
 * Level 8, Crown. Twelve waves, and its subject is **half is not enough**.
 *
 * Four lanes, and the central band genuinely reaches two of them at close range
 * — the strong position every earlier board refused to provide. The table's job
 * is to make taking it correct and still insufficient, so `'split'` carries the
 * arc: dealt round-robin across four lanes, a group of twenty is five down each
 * road and the inner pair is exactly half of it.
 *
 * The pinned waves are where it bites. A group on `high` and `low` together
 * skips the inner lanes altogether, which is the board asking what the cluster
 * in the middle is doing right now.
 */
const high = lane('high');
const low = lane('low');
const innerHigh = lane('inner-high');
const innerLow = lane('inner-low');

export const WAVES_CROWN: readonly WaveDef[] = [
  wave(s(6, 0.6)), //                                   four lanes, four at a time
  wave(s(6, 0.55), s(9, 0.3, 4, 'mote')),
  wave(high(3, 0.9), low(3, 0.9), s(3, 1.5, 5, 'cluster')), //  the outer pair, alone
  wave(s(6, 0.5), s(1, 2.2, 3, 'monolith'), s(6, 1.2, 8, 'warden')),
  wave(innerHigh(4, 1.1), innerLow(4, 1.1), s(3, 1.7, 4, 'bulwark')),
  wave(s(9, 0.42), s(11, 0.22, 3, 'mote'), s(6, 1.3, 9, 'cluster')),
  wave(high(4, 0.8, 0, 'bulwark'), low(4, 0.8, 0, 'bulwark'), s(6, 0.5, 5)), //  outer armour
  wave(s(9, 0.4), s(4, 1.8, 2, 'monolith'), s(6, 1.0, 6, 'warden'), s(6, 1.1, 11, 'cluster')),
  wave(s(10, 0.36), s(14, 0.18, 3, 'mote'), s(6, 1.4, 9, 'bulwark')),
  wave(high(6, 0.7), low(6, 0.7), innerHigh(4, 1.2, 5, 'monolith'), innerLow(4, 1.2, 5, 'monolith')),
  wave(s(10, 0.35), s(7, 0.9, 3, 'cluster'), s(7, 1.1, 7, 'warden'), s(6, 1.3, 11, 'bulwark')),
  wave(
    s(13, 0.28), //                                      finale: everything, down every road
    s(6, 1.4, 3, 'monolith'),
    s(9, 0.85, 6, 'bulwark'),
    s(7, 0.95, 9, 'warden'),
    s(6, 1.05, 12, 'cluster'),
    s(26, 0.1, 15, 'mote'),
  ),
];
