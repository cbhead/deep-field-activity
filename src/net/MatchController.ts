/**
 * The one place the network meets the game. The seed is injected here and
 * nowhere else: the server's `start` carries it, boot() receives it, and the
 * sim never learns the seed came from a socket rather than the URL.
 *
 * The sim stays network-blind; opponent status (N3) will flow into UI state
 * only. This module owns the protocol *flow* — connect, lobby, ready, start,
 * countdown — while presentation is delegated through RaceHooks so the same
 * controller drives the dev-grade N2 overlay, the real N3 lobby screen, and
 * headless gate scripts.
 */
import { NetClient } from './NetClient.ts';
import { STATUS_INTERVAL_MS, type LobbyPlayer, type S2C, type Standing, type TowerPin } from './protocol.ts';

/** What each side reports about itself, and hears about the other. */
export interface RaceStatus {
  /** Waves fully cleared — the first ranking metric. */
  wave: number;
  lives: number;
  /** Self-measured; never compared against the opponent's clock. */
  elapsedMs: number;
  /** Set while our tab is hidden — the opponent sees a frozen-sim badge. */
  hidden?: boolean;
  /** Tower layout, present only on frames where it changed. */
  towers?: TowerPin[];
}

export interface RaceHooks {
  /** Called once joined, and again whenever the lobby roster changes.
   *  level/diff are the creator's pick, re-dealt by the server. */
  onLobby(room: string, players: LobbyPlayer[], level: string, diff: string): void;
  /** Countdown has begun; boot() fires when it reaches zero. The seed rides
   *  along for display — it's the proof of fairness the mode rests on. */
  onCountdown(ms: number, seed: number): void;
  /** Build the world with the server's seed and the room's pick. */
  boot(seed: number, level: string, diff: string): void;
  /** The opponent's latest status blob. UI state only — the sim never sees it. */
  onPeer?(status: RaceStatus): void;
  /** Both runs are over; standings arrive already in ranking order. */
  onResult?(winnerId: string | null, standings: Standing[], reason?: 'forfeit'): void;
  /** The opponent's socket dropped (false) or they resumed their seat (true). */
  onPeerConn?(connected: boolean): void;
  /** Our own socket dropped and we're retrying (false), or we're back (true). */
  onSelfConn?(connected: boolean): void;
  onError(reason: string): void;
}

export interface RaceOptions {
  url: string;
  name: string;
  /** Omit to create a room; supply a code to join one. */
  room?: string;
  /** Creator's sector/difficulty pick; ignored by the server when joining. */
  choice?: { level: string; diff: string };
  hooks: RaceHooks;
  /**
   * N2 has no ready button, so the controller readies up as soon as it joins.
   * The N3 lobby screen sets this false and calls ready() from its button.
   */
  autoReady?: boolean;
}

export class MatchController {
  readonly client = new NetClient();
  private opts: RaceOptions;

  constructor(opts: RaceOptions) {
    this.opts = opts;
  }

  async run(): Promise<void> {
    const { url, name, room, choice, hooks, autoReady = true } = this.opts;
    this.client.onMessage = (msg) => this.handle(msg);
    this.client.onClose = () => this.onDropped();
    try {
      const joined = await this.client.connect(url, name, {
        ...(room === undefined ? {} : { room }),
        ...(room === undefined && choice !== undefined ? { level: choice.level, diff: choice.diff } : {}),
      });
      // NetClient consumes `joined` to resolve connect(), so the room code
      // must be captured here — handle() will never see that message. The
      // authoritative level/diff arrive with the first lobby broadcast.
      this.room = joined.room;
      this.playerId = joined.playerId;
      hooks.onLobby(joined.room, [], choice?.level ?? 'level01', choice?.diff ?? 'standard');
      if (autoReady) this.ready();
    } catch (err) {
      hooks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  private resulted = false;
  private reconnecting = false;

  /**
   * Socket dropped. If we ever joined and the match hasn't been settled,
   * retry with our seat id until the server lets us back in or tells us the
   * seat is gone (forfeit fired, room expired).
   */
  private onDropped(): void {
    if (this.playerId === '' || this.resulted || this.reconnecting) return;
    this.reconnecting = true;
    this.opts.hooks.onSelfConn?.(false);
    void (async () => {
      const { url, name, hooks } = this.opts;
      while (!this.resulted) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          await this.client.connect(url, name, { room: this.room, resume: this.playerId });
          this.reconnecting = false;
          hooks.onSelfConn?.(true);
          return;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          // Unreachable server → keep trying. An explicit refusal → give up.
          if (/no room|room is full/.test(reason)) {
            this.reconnecting = false;
            hooks.onError(`connection lost: ${reason}`);
            return;
          }
        }
      }
      this.reconnecting = false;
    })();
  }

  ready(flag = true): void {
    this.client.send(flag ? { t: 'ready' } : { t: 'ready', ready: false });
  }

  private pump: ReturnType<typeof setInterval> | null = null;
  private finished = false;

  /** Call after boot(): reports our progress every STATUS_INTERVAL_MS. */
  startStatusPump(sample: () => RaceStatus): void {
    this.stopStatusPump();
    this.pump = setInterval(() => {
      const status = sample();
      // sample() may call finish(); a status frame after `dead` would be noise.
      if (!this.finished) this.client.send({ t: 'status', ...status });
    }, STATUS_INTERVAL_MS);
  }

  stopStatusPump(): void {
    if (this.pump !== null) clearInterval(this.pump);
    this.pump = null;
  }

  /** The run ended (defeat or full clear). Reports final figures exactly once. */
  finish(status: RaceStatus): void {
    if (this.finished) return;
    this.finished = true;
    this.stopStatusPump();
    this.client.send({ t: 'dead', ...status });
  }

  private room = '';

  /** Our server-assigned id; '' until joined. Lets UI tell "us" from "them". */
  playerId = '';

  private handle(msg: S2C): void {
    const { hooks } = this.opts;
    switch (msg.t) {
      case 'joined':
        break; // consumed by NetClient.connect; room captured in run()
      case 'lobby':
        hooks.onLobby(this.room, msg.players, msg.level, msg.diff);
        break;
      case 'start':
        hooks.onCountdown(msg.countdownMs, msg.seed);
        // Relative delay on purpose — wall clocks are never compared across
        // machines, so "start in 3000ms" is fair under any clock skew.
        setTimeout(() => hooks.boot(msg.seed, msg.level, msg.diff), msg.countdownMs);
        break;
      case 'error':
        hooks.onError(msg.reason);
        break;
      case 'peer':
        hooks.onPeer?.({
          wave: msg.wave, lives: msg.lives, elapsedMs: msg.elapsedMs,
          ...(msg.hidden !== undefined ? { hidden: msg.hidden } : {}),
          ...(msg.towers !== undefined ? { towers: msg.towers } : {}),
        });
        break;
      case 'result':
        this.resulted = true;
        this.stopStatusPump();
        hooks.onResult?.(msg.winnerId, msg.standings, ...(msg.reason !== undefined ? [msg.reason] : []));
        break;
      case 'peerConn':
        hooks.onPeerConn?.(msg.connected);
        break;
    }
  }
}
