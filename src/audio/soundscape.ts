import type { EnemyId } from '../content/enemies.ts';
import type { SectorFieldId } from '../content/sectors.ts';
import type { TowerId } from '../content/towers.ts';
import type { SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { Coalescer, type AudioEngine } from './engine.ts';
import {
  BED_ROOT,
  BLAST,
  CHAIN_FALLOFF,
  DEATH,
  DEFEAT,
  FIRE,
  LEAK,
  PLACED,
  REJECTED,
  SELECT,
  SHIELD_BROKE,
  SOLD,
  SPLIT,
  UPGRADED,
  VICTORY,
  WAVE_CLEARED,
  WAVE_RUSHED,
  WAVE_STARTED,
} from './palette.ts';

/**
 * When each sound happens.
 *
 * The peer of `render/effects.ts`, deliberately the same shape — `onEvent` for
 * discrete instants, `update` for continuous state — because it is answering
 * the same question about the same data. Effects draws what happened; this
 * plays it.
 *
 * That file's own rule for where a new indicator goes turns out to be the rule
 * for where a new *sound* goes, and applying it is what makes this system
 * affordable:
 *
 * > if it answers "what is true right now", it is chrome; if it answers "what
 * > just happened", it is an effect.
 *
 * A shot is an instant, so Lance and Arc are one-shots. A *beam* is a state, so
 * Filament and Singularity are sustained voices read off the world every frame
 * and never triggered by an event at all. That is not a stylistic choice: those
 * two fire every 0.25s and 0.28s, which is past the rate at which the ear
 * resolves separate events, so one-shotting them would spend the whole voice
 * budget to produce a buzz.
 *
 * The second borrowed rule is `effects.ts`'s "one Graphics for each *class* of
 * thing, not one per entity". Twenty-five Filaments are **one** tone, not
 * twenty-five — a tone per station would be a twenty-five-note cluster chord,
 * which is not "more firepower", it is noise. The section is the instrument.
 *
 * Everything here is droppable, capped, and coalesced, for the reason stated in
 * `engine.ts`: past roughly twenty transients a second, playing more of them
 * makes the game sound *weaker*.
 */

/**
 * Seconds a burst of identical shots is gathered over before one voice is
 * played for the lot. At 0.07 the ceiling is ~14 reports/sec per station type,
 * comfortably under the ~20/sec where transients stop being individually
 * audible — so the cap is inaudible as a cap, which is the point.
 */
const SHOT_WINDOW = 0.07;
/** Kills coalesce a little slower; they are rarer and worth more each. */
const KILL_WINDOW = 0.05;

/**
 * Shots per second at which thinning starts, and where it is fully applied.
 *
 * Below `QUIET` every report plays at full weight — a lone Lance on an empty
 * board must still read as a distinct event. Above `DENSE` individual reports
 * are at their floor and the mass layer is carrying the weight instead.
 */
const QUIET_RATE = 6;
const DENSE_RATE = 40;
/** How quiet an individual report gets on a full board. */
const SHOT_FLOOR = 0.34;
/**
 * The same floor for the sustained voices. A shade higher than `SHOT_FLOOR`
 * because these are already low and dark — pulled as far down as the shots they
 * would stop reading as present at all, and their whole job is to be the thing
 * you notice without listening for.
 */
const SUSTAINED_FLOOR = 0.4;

/** Events turned into sound in one frame. A backlog degrades; it never piles up. */
const EVENTS_PER_FRAME_BUDGET = 24;

interface Sustained {
  gain: GainNode;
  freq: AudioParam | null;
  cutoff: AudioParam | null;
}

export class Soundscape {
  private readonly shots = new Coalescer(SHOT_WINDOW);
  private readonly kills = new Coalescer(KILL_WINDOW);
  private readonly chains = new Coalescer(SHOT_WINDOW);

  /** Built on the first frame after the context unlocks, then held for the run. */
  private filament: Sustained | null = null;
  private singularity: Sustained | null = null;
  private mass: Sustained | null = null;
  private bed: Sustained[] = [];
  private bedCutoff: AudioParam | null = null;

  private lastSelected: TowerId | null = null;
  private spawnedThisFrame = 0;
  private firedThisFrame = 0;
  /** Smoothed shots/sec. The single number the whole density system reads. */
  private fireRate = 0;
  private clock = 0;

  constructor(
    private readonly engine: AudioEngine,
    private readonly field: SectorFieldId,
  ) {}

  beginFrame(): void {
    this.spawnedThisFrame = 0;
  }

  onEvent(ev: SimEvent): void {
    switch (ev.type) {
      // Counted before the budget check: the density measurement must see every
      // shot the board actually took, or thinning would stop working at exactly
      // the moment the frame gets busy enough to need it.
      case 'towerFired':
        this.firedThisFrame++;
        if (FIRE[ev.defId] !== undefined) this.shots.add(ev.defId);
        return;

      case 'creepDamaged':
        // Arc only, and only as chain texture. `creepDamaged` is the highest
        // frequency event in the game (~50/sec) — sounding it generally is the
        // fastest way to make the mix unlistenable, so the one case kept is the
        // one that carries information the player paid for.
        if (ev.defId === 'arc') this.chains.add('arc');
        return;

      default:
        break;
    }

    if (this.spawnedThisFrame >= EVENTS_PER_FRAME_BUDGET) return;
    this.spawnedThisFrame++;

    switch (ev.type) {
      case 'blast':
        this.engine.play(BLAST);
        break;
      case 'creepKilled':
        this.kills.add(ev.defId);
        break;
      case 'creepSplit':
        this.engine.play(SPLIT);
        break;
      case 'shieldBroke':
        this.engine.play(SHIELD_BROKE);
        break;
      case 'creepLeaked':
        this.engine.play(LEAK);
        break;
      case 'waveStarted':
        this.engine.play(WAVE_STARTED);
        break;
      case 'waveCleared':
        this.engine.play(WAVE_CLEARED);
        break;
      case 'waveRushed':
        this.engine.play(WAVE_RUSHED);
        break;
      case 'towerPlaced':
        this.engine.play(PLACED);
        break;
      case 'towerUpgraded':
        this.engine.play(UPGRADED);
        break;
      case 'towerSold':
        this.engine.play(SOLD);
        break;
      case 'buildRejected':
      case 'towerActionRejected':
      case 'waveRejected':
        this.engine.play(REJECTED);
        break;
      case 'gameOver':
        this.engine.play(ev.won ? VICTORY : DEFEAT);
        break;
      default:
        break;
    }
  }

  /**
   * `dt` is wall-clock seconds, exactly as in `effects.ts`.
   *
   * This is what stops the speed control from multiplying the audio: at 4× the
   * sim emits four times the events, but the coalescer windows and the density
   * measurement are both in real seconds, so 4× comes out *busier* rather than
   * four times louder. A mix that scaled with the speed button would be
   * unusable at the setting people actually play at.
   */
  update(w: World, selected: TowerId | null, dt: number): void {
    if (!this.engine.running) return;
    this.ensureVoices();
    this.clock += dt;

    // Arming is *pulled*, not pushed, because `ui.selected` is state and there
    // is no event for it — it is written from a deck click, a hotkey, Escape,
    // and a right-click disarm. Watching the value catches all four; hooking
    // them would be four call sites and a fifth one waiting to be forgotten.
    if (selected !== this.lastSelected) {
      this.lastSelected = selected;
      if (selected !== null) this.engine.play(SELECT[selected]);
    }

    // Exponential moving average rather than the raw per-frame count: the raw
    // number swings wildly with frame pacing, and a gain that tracked it would
    // audibly pump.
    const instant = this.firedThisFrame / Math.max(dt, 1 / 240);
    this.firedThisFrame = 0;
    this.fireRate += (instant - this.fireRate) * Math.min(1, dt * 6);

    const density = clamp01((this.fireRate - QUIET_RATE) / (DENSE_RATE - QUIET_RATE));
    // The trade at the heart of the whole design: individual reports fade as the
    // board fills, and the mass layer takes over the job of conveying weight.
    const shotGain = 1 + (SHOT_FLOOR - 1) * density;

    this.shots.flush(this.clock, (key, _count, gain) => {
      const spec = FIRE[key as TowerId];
      if (spec !== undefined) this.engine.play(spec, gain * shotGain);
    });

    this.chains.flush(this.clock, (_key, _count, gain) => {
      const spec = FIRE.arc;
      if (spec !== undefined) this.engine.play(spec, gain * shotGain * CHAIN_FALLOFF);
    });

    this.kills.flush(this.clock, (key, _count, gain) => {
      this.engine.play(DEATH[key as EnemyId], gain);
    });

    this.syncStations(w, density);
    this.syncMass(density);
    this.syncBed(w);
  }

  /**
   * The two sustained station voices, aggregated across the whole board.
   *
   * Gain grows as the square root of how many stations are engaged, matching
   * how uncorrelated sources actually sum — so a second Filament is clearly
   * audible and a twelfth is not four times the eleventh.
   */
  private syncStations(w: World, density: number): void {
    // Sustained voices recede as the board fills, exactly as the one-shots do.
    //
    // Without this they were the one thing in the mix that could not lose. Shots
    // thin to a third on a full board while a sustained voice sat pinned at its
    // count ceiling, so the more stations were firing the more completely the
    // drone owned the result — the precise opposite of the intent, and it is
    // what made Filament feel like it was overtaking everything.
    const thin = 1 + (SUSTAINED_FLOOR - 1) * density;

    let filaments = 0;
    let ramp = 0;
    let singularities = 0;

    for (const t of w.towers) {
      if (t.focusId === null) continue;
      if (t.defId === 'filament') {
        filaments++;
        // Progress toward the damage ceiling, recomputed here rather than
        // imported: `rampSeconds` lives in sim/systems, which presentation does
        // not reach into. Two dials, one formula, and it is stable content.
        const seconds = t.stats.rampPerSecond > 0 ? (t.stats.rampMax - 1) / t.stats.rampPerSecond : 0;
        if (seconds > 0) ramp = Math.max(ramp, clamp01(t.focusTime / seconds));
      } else if (t.defId === 'singularity') {
        singularities++;
      }
    }

    // The ramp is the mechanic you paid for and could not previously perceive.
    //
    // **Brightness carries it, and pitch never moves.** The first version swept
    // the pitch 620→1900Hz under a resonant filter opening to 3.5kHz, and it was
    // a dogwhistle: a spectrum read of it measured the fundamental at 1898Hz, its
    // harmonic at 3797Hz, and *nothing at all* below 500Hz. That is a bare tone
    // sitting exactly on the ear's most sensitive band with no body under it,
    // which is the most attention-expensive sound it is possible to make — and
    // it was playing continuously.
    //
    // Two rules came out of that and both are load-bearing. **A rising pitch is
    // an alarm cue**, so it may not be spent on a readout that is on all the
    // time; the filter opening says "hotter" without ever saying "look at me".
    // And **a steady tone stays salient forever** where noise becomes texture the
    // ear habituates to within seconds — which is the whole reason the carrier is
    // now noise over a low body rather than an oscillator.
    //
    // The cutoff ceiling of ~1.1kHz is the part to preserve: this voice must
    // never reach the presence band again.
    this.setSustained(this.filament, filaments, 0.16 * (0.7 + ramp * 0.3) * thin, {
      cutoff: 250 + ramp * 850,
    });

    this.setSustained(this.singularity, singularities, 0.1 * thin, { cutoff: 420 });
  }

  /**
   * The mass layer: a low filtered rumble whose level tracks the true fire rate.
   *
   * This is what actually delivers "significant firepower". Individual reports
   * cannot do it — past the fusion threshold they stop reading as separate
   * events and only add level, which the limiter then takes straight back off.
   * A continuous bed under them reads as scale, and it is the one thing in the
   * mix that legitimately gets bigger the more stations are firing.
   */
  private syncMass(density: number): void {
    const m = this.mass;
    if (m === null) return;
    const ctx = this.engine.context;
    if (ctx === null) return;
    m.gain.gain.setTargetAtTime(density * 0.5, ctx.currentTime, 0.25);
    m.cutoff?.setTargetAtTime(180 + density * 340, ctx.currentTime, 0.3);
  }

  /**
   * The bed. Quiet enough to be noticed only when it stops.
   *
   * Its real job is to give the combat sounds a floor to sit on — the same
   * sounds are thin and exposed over silence and solid over a bed, at no cost to
   * the sounds themselves.
   */
  private syncBed(w: World): void {
    const ctx = this.engine.context;
    if (ctx === null || this.bed.length === 0) return;

    const fighting = w.creeps.length > 0;
    const level = w.phase !== 'playing' ? 0 : fighting ? 0.075 : 0.045;

    for (const v of this.bed) v.gain.gain.setTargetAtTime(level, ctx.currentTime, 1.2);
    // Opens up while a wave is live and closes between them. A slow filter move
    // is the cheapest way to make a static drone feel like it is responding.
    this.bedCutoff?.setTargetAtTime(fighting ? 640 : 320, ctx.currentTime, 1.5);
  }

  /**
   * `unit` is the level for a single engaged station; the count curve and the
   * density thinning are already folded into it by the caller.
   *
   * `to.freq` is optional and, for both station voices, deliberately unused —
   * see the note in `syncStations` on why pitch is not a parameter these are
   * allowed to spend.
   */
  private setSustained(
    v: Sustained | null,
    count: number,
    unit: number,
    to: { freq?: number; cutoff: number },
  ): void {
    const ctx = this.engine.context;
    if (v === null || ctx === null) return;
    const t = ctx.currentTime;
    v.gain.gain.setTargetAtTime(count === 0 ? 0 : Math.min(1, Math.sqrt(count) / 3) * unit, t, 0.08);
    if (to.freq !== undefined) v.freq?.setTargetAtTime(to.freq, t, 0.09);
    v.cutoff?.setTargetAtTime(to.cutoff, t, 0.09);
  }

  /** Built once, the first frame after a gesture creates the context. */
  private ensureVoices(): void {
    if (this.filament !== null) return;

    this.filament = this.burn(140, 250);
    this.singularity = this.tone('sine', 190, 'lowpass', 420, 1.5, 'shots');
    this.mass = this.noise('lowpass', 200, 0.9);

    const root = BED_ROOT[this.field];
    // A root, a fifth, and an octave detuned just enough to beat slowly against
    // the octave below. Three oscillators is the whole "score".
    for (const mul of [1, 1.5, 2.01]) {
      const v = this.tone('sine', root * mul, 'lowpass', 320, 0.8, 'ambient');
      if (v !== null) {
        this.bed.push(v);
        if (this.bedCutoff === null) this.bedCutoff = v.cutoff;
      }
    }
  }

  private tone(
    wave: OscillatorType,
    freq: number,
    filterType: BiquadFilterType,
    cutoff: number,
    q: number,
    bus: 'shots' | 'ambient',
  ): Sustained | null {
    const osc = this.engine.oscillator(wave, freq);
    const filter = this.engine.filter(filterType, cutoff, q);
    const gain = this.engine.sustained(bus);
    if (osc === null || filter === null || gain === null) return null;
    osc.connect(filter);
    filter.connect(gain);
    osc.start();
    return { gain, freq: osc.frequency, cutoff: filter.frequency };
  }

  /**
   * Play one palette entry by name. Dev handle, for A/B-ing a sound against the
   * one next to it without waiting for the board to produce both.
   */
  audition(name: TowerId | EnemyId): boolean {
    const spec = FIRE[name as TowerId] ?? DEATH[name as EnemyId];
    return spec === undefined ? false : this.engine.play(spec);
  }

  /**
   * Drive a sound at `rate` per second and report what the budget did with it.
   *
   * The tuning instrument for the voice cap and the coalescer. A full board of
   * Filaments is ~100 shots/sec and 4× makes it 400 — rates that are tedious to
   * reach in play and trivial to reach here, which is the point: the mix has to
   * be judged at its worst case, and the worst case is not where a playthrough
   * spends its time.
   */
  stress(name: TowerId = 'lance', rate = 60, seconds = 4): void {
    const spec = FIRE[name];
    if (spec === undefined) {
      console.warn(`[td] ${name} has no one-shot — it is a sustained voice.`);
      return;
    }
    let played = 0;
    let dropped = 0;
    const timer = setInterval(() => {
      if (this.engine.play(spec)) played++;
      else dropped++;
    }, 1000 / rate);
    setTimeout(() => {
      clearInterval(timer);
      const total = played + dropped;
      console.info(
        `[td] ${name} at ${rate}/s: ${played}/${total} played, ` +
          `${total === 0 ? 0 : Math.round((dropped / total) * 100)}% dropped by the voice budget.`,
      );
    }, seconds * 1000);
  }

  /**
   * Filtered noise over a fixed low body — a burn rather than a tone.
   *
   * The body is what a bare noise band lacks: without it the voice has no weight
   * and gets turned up to compensate, which is how it ends up loud in the one
   * region that cannot afford it. Q stays near 1: a resonant peak would put a
   * pitch back into a voice whose entire point is not having one.
   */
  private burn(bodyHz: number, cutoff: number): Sustained | null {
    const src = this.engine.noiseSource();
    const filter = this.engine.filter('lowpass', cutoff, 1.1);
    const gain = this.engine.sustained('shots');
    const body = this.engine.oscillator('triangle', bodyHz);
    const bodyMix = this.engine.mixNode(0.45);
    if (src === null || filter === null || gain === null || body === null || bodyMix === null) {
      return null;
    }
    src.connect(filter);
    filter.connect(gain);
    body.connect(bodyMix);
    bodyMix.connect(gain);
    src.start();
    body.start();
    return { gain, freq: null, cutoff: filter.frequency };
  }

  private noise(filterType: BiquadFilterType, cutoff: number, q: number): Sustained | null {
    const src = this.engine.noiseSource();
    const filter = this.engine.filter(filterType, cutoff, q);
    const gain = this.engine.sustained('ambient');
    if (src === null || filter === null || gain === null) return null;
    src.connect(filter);
    filter.connect(gain);
    src.start();
    return { gain, freq: null, cutoff: filter.frequency };
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
