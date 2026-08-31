/**
 * The mixer: an AudioContext, a voice budget, and the synthesis primitives every
 * sound in the game is built from.
 *
 * This file knows *how* to make a sound. It knows nothing about what any of them
 * mean — that is `palette.ts`, which is pure data, and `soundscape.ts`, which
 * decides when to ask. The split is the one `theme.ts` and the renderer already
 * have, for the same reason: retuning how the game sounds should be a one-file
 * diff that never touches game logic.
 *
 * Three rules shape this file, and they are the reason the game does not turn
 * into a roar when the board fills up.
 *
 * **Nothing exists until a gesture.** Browsers refuse to start an AudioContext
 * outside a user gesture, and one constructed early comes up `suspended` and
 * stays there. So the whole graph is built lazily on `unlock()` and every entry
 * point no-ops until then. A silent game is the correct behaviour before the
 * first click, not a bug to work around.
 *
 * **The voice budget is a hard cap, and it steals by priority.** 25 stations at
 * 4× speed is several hundred shots a second (see the note on
 * `MAX_VOICES`). Past roughly twenty transients a second the ear stops hearing
 * events and starts hearing texture, so playing all of them costs CPU and
 * headroom to make the game sound *weaker*. A kill must be able to interrupt a
 * shot; a shot must never interrupt a kill.
 *
 * **`Math.random` is correct here and nowhere else in the audio path's reach.**
 * Per-shot pitch and gain jitter is presentation, exactly like the particle
 * scatter in `effects.ts`, and drawing it from the sim's seeded stream would
 * desync two Race clients the moment one dropped a frame.
 */

/** Where a sound sits in the mix. Each bus is a gain stage the mixer can move. */
export type BusName =
  /** Station fire. The bus that gets ducked and thinned as the board fills. */
  | 'shots'
  /** Kills, blasts, leaks — the payoffs the shots are ducked *for*. */
  | 'impacts'
  /** Clicks, purchases, rejections. Never ducked: a click must always answer. */
  | 'ui'
  /** The bed and the mass layer. Continuous, quiet, and under everything. */
  | 'ambient';

/**
 * One synthesis layer. A sound is one or more of these stacked — a "tick" is
 * usually a noise burst plus a tone, because either alone reads as thin.
 */
export interface SoundLayer {
  kind: 'tone' | 'noise';
  /** Ignored for `noise`. */
  wave?: OscillatorType;
  /** Start frequency in Hz. For `noise`, the band centre. */
  freq: number;
  /** Sweep target. A downward sweep is what makes a shot read as travelling. */
  freqEnd?: number;
  filter?: {
    type: BiquadFilterType;
    freq: number;
    q: number;
    freqEnd?: number;
  };
  gain: number;
  /** Seconds. Kept near-instant for anything percussive. */
  attack: number;
  /** Seconds to silence. This is the number that decides whether density muds. */
  decay: number;
}

export interface SoundSpec {
  layers: readonly SoundLayer[];
  /**
   * Higher wins a contested voice. The ordering that matters:
   * shots are the cheapest thing in the game and must lose to everything.
   */
  priority: number;
  bus: BusName;
  /** ± fraction of pitch variance per play. Zero is the machine-gun artifact. */
  pitchJitter?: number;
  /** ± fraction of gain variance per play. */
  gainJitter?: number;
  /**
   * Ducks the `shots` bus by this fraction when the sound plays, so a payoff
   * reads over sustained fire instead of competing with it.
   */
  duck?: number;
}

/**
 * Simultaneous voices. Chosen against the worst case rather than the typical
 * one: the ceiling is 25 stations (`sim/systems/targeting.ts`), the two fastest
 * fire every 0.25s and 0.28s, and the speed control multiplies by 4 — so an
 * unbudgeted mix would be asked for several hundred voices a second.
 *
 * 20 is well below where the ear stops resolving separate events, which means
 * the cap is doing musical work and not merely protecting the CPU. Raising it
 * makes the game *muddier*, not fuller.
 */
const MAX_VOICES = 20;

/** Length of the reusable white-noise table. Long enough that loops are unhearable. */
const NOISE_SECONDS = 2;

interface Voice {
  priority: number;
  startedAt: number;
  gain: GainNode;
  /** Sources to stop when this voice is cut short or expires. */
  sources: AudioScheduledSourceNode[];
  endsAt: number;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  buses: Record<BusName, GainNode>;
  noise: AudioBuffer;
}

export class AudioEngine {
  private graph: Graph | null = null;
  private voices: Voice[] = [];

  private volume = 0.6;
  private muted = false;

  /** Cleared once a real gesture has built the graph, so we only try once. */
  private unlockFailed = false;

  /** Live only while a graph exists. Read by the mass layer to thin the mix. */
  get running(): boolean {
    return this.graph !== null;
  }

  get context(): AudioContext | null {
    return this.graph?.ctx ?? null;
  }

  get now(): number {
    return this.graph?.ctx.currentTime ?? 0;
  }

  /** Active voices, for the dev stress helper and the mass-layer crossfade. */
  get voiceCount(): number {
    return this.voices.length;
  }

  /**
   * Build the graph. Safe to call on every gesture — it returns immediately once
   * a context exists, and a browser that refuses outright is remembered so we do
   * not throw on every click for the rest of the session.
   */
  unlock(): void {
    if (this.graph !== null || this.unlockFailed) return;

    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      this.unlockFailed = true;
      return;
    }

    // A limiter, not a compressor doing tone-shaping. Its whole job is that the
    // sum of twenty voices cannot clip: hard ratio, fast attack, high threshold.
    // Without it a wave dying all at once is a click on every set of speakers.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    limiter.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    master.connect(limiter);

    const buses = {
      shots: ctx.createGain(),
      impacts: ctx.createGain(),
      ui: ctx.createGain(),
      ambient: ctx.createGain(),
    } satisfies Record<BusName, GainNode>;

    // Static bus trim. Shots sit well below the payoffs on purpose — this is the
    // static half of "shots get quieter as the board fills"; the duck and the
    // mass-layer crossfade are the dynamic half.
    buses.shots.gain.value = 0.5;
    buses.impacts.gain.value = 0.9;
    buses.ui.gain.value = 0.7;
    buses.ambient.gain.value = 0.35;
    for (const bus of Object.values(buses)) bus.connect(master);

    // One white-noise table, reused by every noise layer in the game at a random
    // offset. Generating a buffer per shot would allocate megabytes a minute.
    const noise = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.graph = { ctx, master, buses, noise };

    // Constructed inside a gesture it should already be running; resume covers
    // the case where the gesture was consumed before we got here.
    if (ctx.state === 'suspended') void ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyMasterGain();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMasterGain();
  }

  private applyMasterGain(): void {
    const g = this.graph;
    if (g === null) return;
    const target = this.muted ? 0 : this.volume;
    // Ramped, not assigned: a step change on a live gain node is an audible click.
    g.master.gain.setTargetAtTime(target, g.ctx.currentTime, 0.02);
  }

  /**
   * A raw gain node on a bus, for the sustained voices that outlive a single
   * event — the Filament tone, the Singularity hum, the mass layer, the bed.
   *
   * Deliberately outside the voice budget. These are continuous by design and
   * there are a bounded number of them, so letting a burst of shots steal the
   * bed would be exactly backwards.
   */
  sustained(bus: BusName): GainNode | null {
    const g = this.graph;
    if (g === null) return null;
    const node = g.ctx.createGain();
    node.gain.value = 0;
    node.connect(g.buses[bus]);
    return node;
  }

  /**
   * A bare gain node, unconnected — for sub-mixing inside a composite sustained
   * voice, where a layer needs its own trim before reaching the voice's gain.
   * `sustained` cannot serve: it wires straight to a bus.
   */
  mixNode(value: number): GainNode | null {
    const g = this.graph;
    if (g === null) return null;
    const node = g.ctx.createGain();
    node.gain.value = value;
    return node;
  }

  /** A looping noise source, for the mass layer. Caller owns stopping it. */
  noiseSource(): AudioBufferSourceNode | null {
    const g = this.graph;
    if (g === null) return null;
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    return src;
  }

  /** An oscillator, for the bed and the sustained station voices. */
  oscillator(type: OscillatorType, freq: number): OscillatorNode | null {
    const g = this.graph;
    if (g === null) return null;
    const osc = g.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    return osc;
  }

  filter(type: BiquadFilterType, freq: number, q: number): BiquadFilterNode | null {
    const g = this.graph;
    if (g === null) return null;
    const f = g.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /**
   * Play a one-shot.
   *
   * `gainScale` is how the caller thins a sound without editing the palette —
   * the coalescer uses it to make one voice stand for several, and the mass
   * layer uses it to fade individual shots out as density rises.
   *
   * Returns false when the budget dropped it, which the dev stress helper
   * reports and nothing else needs to care about.
   */
  play(spec: SoundSpec, gainScale = 1): boolean {
    const g = this.graph;
    if (g === null || this.muted || gainScale <= 0.001) return false;

    const t = g.ctx.currentTime;
    this.reap(t);

    if (!this.claim(spec.priority, t)) return false;

    // Presentation jitter — deliberately Math.random, see the file note.
    const pitch = 1 + (spec.pitchJitter ?? 0) * (Math.random() * 2 - 1);
    const level = gainScale * (1 + (spec.gainJitter ?? 0) * (Math.random() * 2 - 1));

    const voiceGain = g.ctx.createGain();
    voiceGain.gain.value = 1;
    voiceGain.connect(g.buses[spec.bus]);

    const sources: AudioScheduledSourceNode[] = [];
    let endsAt = t;

    for (const layer of spec.layers) {
      const end = this.renderLayer(g, layer, voiceGain, t, pitch, level, sources);
      if (end > endsAt) endsAt = end;
    }

    if (sources.length === 0) {
      voiceGain.disconnect();
      return false;
    }

    const voice: Voice = { priority: spec.priority, startedAt: t, gain: voiceGain, sources, endsAt };
    this.voices.push(voice);

    // Disconnect on the last source ending, so the graph does not grow a node
    // per shot fired for the length of the match.
    const last = sources[sources.length - 1];
    if (last !== undefined) {
      last.onended = (): void => {
        voiceGain.disconnect();
        const i = this.voices.indexOf(voice);
        if (i >= 0) this.voices.splice(i, 1);
      };
    }

    if (spec.duck !== undefined && spec.duck > 0) this.duck(spec.duck);

    return true;
  }

  /** One layer of a spec, scheduled and self-stopping. Returns its end time. */
  private renderLayer(
    g: Graph,
    layer: SoundLayer,
    dest: GainNode,
    t: number,
    pitch: number,
    level: number,
    sources: AudioScheduledSourceNode[],
  ): number {
    const env = g.ctx.createGain();
    const peak = Math.max(0.0001, layer.gain * level);

    // Linear attack, exponential decay. Exponential is how amplitude actually
    // dies and is the difference between a "tick" and a "beep"; it cannot reach
    // zero, so the tail is clamped to a floor and the node is stopped after it.
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peak, t + layer.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + layer.attack + layer.decay);

    let tail: AudioNode = env;
    if (layer.filter !== undefined) {
      const f = g.ctx.createBiquadFilter();
      f.type = layer.filter.type;
      f.Q.value = layer.filter.q;
      f.frequency.setValueAtTime(layer.filter.freq * pitch, t);
      if (layer.filter.freqEnd !== undefined) {
        f.frequency.exponentialRampToValueAtTime(
          Math.max(20, layer.filter.freqEnd * pitch),
          t + layer.attack + layer.decay,
        );
      }
      f.connect(env);
      tail = f;
    }
    env.connect(dest);

    const stop = t + layer.attack + layer.decay + 0.02;

    if (layer.kind === 'noise') {
      const src = g.ctx.createBufferSource();
      src.buffer = g.noise;
      // A random offset into the shared table, so repeated shots are not
      // bit-identical noise — the cheapest variation available.
      const offset = Math.random() * (NOISE_SECONDS - 0.25);
      src.connect(tail);
      src.start(t, offset);
      src.stop(stop);
      sources.push(src);
    } else {
      const osc = g.ctx.createOscillator();
      osc.type = layer.wave ?? 'sine';
      osc.frequency.setValueAtTime(Math.max(20, layer.freq * pitch), t);
      if (layer.freqEnd !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(20, layer.freqEnd * pitch),
          t + layer.attack + layer.decay,
        );
      }
      osc.connect(tail);
      osc.start(t);
      osc.stop(stop);
      sources.push(osc);
    }

    return stop;
  }

  /**
   * Take a voice slot, stealing one if the budget is full.
   *
   * Steals the lowest-priority voice, oldest first among equals — and refuses
   * outright if nothing playing is cheaper than the incoming sound. That refusal
   * is the important half: it is what stops a wall of shots from chopping up the
   * kill that the player actually needs to hear.
   */
  private claim(priority: number, t: number): boolean {
    if (this.voices.length < MAX_VOICES) return true;

    let worst: Voice | undefined;
    for (const v of this.voices) {
      if (
        worst === undefined ||
        v.priority < worst.priority ||
        (v.priority === worst.priority && v.startedAt < worst.startedAt)
      ) {
        worst = v;
      }
    }

    if (worst === undefined || worst.priority >= priority) return false;

    this.kill(worst, t);
    return true;
  }

  private kill(v: Voice, t: number): void {
    // A short fade rather than an immediate stop: cutting a live oscillator
    // mid-cycle is a click, which is louder than the sound being stolen.
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0.0001, t + 0.01);
    for (const s of v.sources) {
      try {
        s.stop(t + 0.02);
      } catch {
        // Already stopped. Nothing to do.
      }
    }
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /** Drop voices whose scheduled end has passed, in case `onended` never fired. */
  private reap(t: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v !== undefined && v.endsAt < t) this.voices.splice(i, 1);
    }
  }

  /**
   * Pull the shot bus down and let it back up.
   *
   * This is the mechanism behind "a hit needs relative silence around it to land
   * as a hit". A Monolith dying under twelve stations of fire is inaudible
   * without it, however loud its own sound is made — loudness competes, but
   * ducking creates the hole the payoff sits in.
   */
  duck(amount: number): void {
    const g = this.graph;
    if (g === null) return;
    const t = g.ctx.currentTime;
    const bus = g.buses.shots;
    const floor = 0.5 * (1 - Math.min(0.85, amount));
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(floor, t + 0.015);
    bus.gain.setTargetAtTime(0.5, t + 0.02, 0.09);
  }

  /** Stop everything and drop the graph. For teardown between matches. */
  dispose(): void {
    const g = this.graph;
    if (g === null) return;
    for (const v of [...this.voices]) this.kill(v, g.ctx.currentTime);
    this.voices = [];
    void g.ctx.close();
    this.graph = null;
  }
}

/**
 * Collapses a burst of the same sound into one voice.
 *
 * The highest-value component in the system. Eight Lances that come ready on the
 * same tick are one Lance sound at a little more gain, not eight — which is both
 * what the ear already does to them and what keeps nineteen voice slots free for
 * things that are not the tenth identical shot.
 *
 * Gain grows as the square root of the count, which is roughly how summed
 * uncorrelated sources actually add — two shots read as louder than one, but
 * nowhere near twice as loud.
 *
 * The ceiling binds at a count of three, which is deliberate and not a limit
 * worth raising. Past a handful, the thing that should be growing is the mass
 * layer, not the individual report: letting this keep climbing would put the
 * growth back into the transients, which is exactly where it stops reading as
 * scale and turns into level for the limiter to take straight off again.
 */
export class Coalescer {
  private readonly pending = new Map<string, number>();
  private readonly lastFlush = new Map<string, number>();

  constructor(
    /** Seconds a burst is gathered over before it is played. */
    private readonly window: number,
  ) {}

  add(key: string): void {
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
  }

  /**
   * Emit every key whose window has closed. `now` is wall-clock seconds, so the
   * rate is a property of what the player can hear and not of the speed control
   * — which is what stops 4× from firing four times the sounds.
   */
  flush(now: number, emit: (key: string, count: number, gain: number) => void): void {
    for (const [key, count] of this.pending) {
      const last = this.lastFlush.get(key) ?? 0;
      if (now - last < this.window) continue;
      this.lastFlush.set(key, now);
      this.pending.delete(key);
      emit(key, count, Math.min(1.6, Math.sqrt(count)));
    }
  }

  clear(): void {
    this.pending.clear();
    this.lastFlush.clear();
  }
}
