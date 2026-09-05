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
import {
  STATUS_INTERVAL_MS,
  type LobbyPlayer,
  type MatchMode,
  type ResultReason,
  type S2C,
  type Standing,
  type TowerPin,
} from './protocol.ts';

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
  /** Versus only: the rung they are on. */
  era?: number;
}

export interface RaceHooks {
  /** Called once joined, and again whenever the lobby roster changes.
   *  level/diff are the creator's pick, re-dealt by the server.
   *  `watchers` is the queue; you are seated if your id is in `players`. */
  onLobby(room: string, players: LobbyPlayer[], watchers: LobbyPlayer[], level: string, diff: string): void;
  /** Live figures for both seats — only ever sent while you are watching. */
  onWatchStatus?(standings: Standing[]): void;
  /** Countdown has begun; boot() fires when it reaches zero. The seed rides
   *  along for display — it's the proof of fairness the mode rests on. */
  onCountdown(ms: number, seed: number): void;
  /** Build the world with the server's seed and the room's pick. */
  boot(seed: number, level: string, diff: string): void;
  /** The opponent's latest status blob. UI state only — the sim never sees it. */
  onPeer?(status: RaceStatus): void;
  /**
   * A contact the opponent bought, arriving. Versus only.
   *
   * The caller turns this into an `inbound` command; the controller never
   * touches a world. That boundary is the reason this mode needed no lockstep
   * and no clock sync — a sortie is a one-way event, so the only requirement
   * is that it arrives, and the socket already guarantees that.
   */
  onInbound?(sortie: string, lane: number, kickback: number): void;
  /** One of ours reached their core. Pays back what it carried. */
  onCredit?(amount: number): void;
  /** Both runs are over; standings arrive already in ranking order. */
  onResult?(winnerId: string | null, standings: Standing[], reason?: ResultReason): void;
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
  /**
   * A Discord Activity instance. Takes the place of a room code entirely: the
   * server finds or creates the one room for that instance, so everyone who
   * launched the activity in the same voice channel meets without anyone
   * reading a code aloud.
   */
  instance?: string;
  /** Creator's sector/difficulty pick; ignored by the server when joining. */
  choice?: { level: string; diff: string };
  /** Which game this room plays. Only the server's settlement rule reads it. */
  mode?: MatchMode;
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
    const { url, name, room, instance, choice, mode, hooks, autoReady = true } = this.opts;
    this.client.onMessage = (msg) => this.handle(msg);
    this.client.onClose = () => this.onDropped();
    try {
      const joined = await this.client.connect(url, name, {
        ...(room === undefined ? {} : { room }),
        ...(instance === undefined ? {} : { instance }),
        // The pick rides along only when this client might be creating the
        // room. Joining an existing one ignores it either way — the server
        // re-deals whatever the room already decided.
        ...(room === undefined && choice !== undefined ? { level: choice.level, diff: choice.diff } : {}),
        ...(mode === undefined ? {} : { mode }),
      });
      // NetClient consumes `joined` to resolve connect(), so the room code
      // must be captured here — handle() will never see that message. The
      // authoritative level/diff arrive with the first lobby broadcast.
      this.room = joined.room;
      this.playerId = joined.playerId;
      hooks.onLobby(joined.room, [], [], choice?.level ?? 'level01', choice?.diff ?? 'standard');
      if (autoReady) this.ready();
    } catch (err) {
      hooks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  private resulted = false;
  private reconnecting = false;
  private disposed = false;
  /** The countdown's deferred boot, held so navigating away can cancel it. */
  private bootTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Let go of the socket and everything scheduled on it.
   *
   * Two of these are not hygiene. The reconnect loop below retries every two
   * seconds until the match is settled, so without a disposed flag, leaving a
   * lobby would leave a socket reconnecting to a room nobody is in for as long
   * as the page lives. And `start` defers boot() by the countdown — leaving
   * during those three seconds would otherwise build a world into a scene that
   * had already been torn down.
   */
  dispose(): void {
    this.disposed = true;
    this.stopStatusPump();
    if (this.bootTimer !== null) clearTimeout(this.bootTimer);
    this.bootTimer = null;
    this.client.onMessage = null;
    this.client.onClose = null;
    this.client.close();
  }

  /**
   * Socket dropped. If we ever joined and the match hasn't been settled,
   * retry with our seat id until the server lets us back in or tells us the
   * seat is gone (forfeit fired, room expired).
   */
  private onDropped(): void {
    if (this.disposed || this.playerId === '' || this.resulted || this.reconnecting) return;
    this.reconnecting = true;
    this.opts.hooks.onSelfConn?.(false);
    void (async () => {
      const { url, name, hooks } = this.opts;
      while (!this.resulted && !this.disposed) {
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

  /** Change the room's board. Ignored by the server unless we hold seat one. */
  pick(level: string, diff: string): void {
    this.client.send({ t: 'pick', level, diff });
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

  /**
   * Send a contact at the opponent.
   *
   * Fire-and-forget by design. There is no ack because there is nothing to
   * acknowledge — the sender has already been charged by their own sim, and a
   * frame that fails to arrive is a lost purchase either way. Adding a
   * confirmation would buy a retry path whose only honest behaviour is to send
   * a second contact, which is worse than losing one.
   *
   * Dropped after the match settles, so a click landing on the results screen
   * cannot post to a finished room.
   */
  sendSortie(sortie: string, lane: number, kickback: number): void {
    if (this.finished || this.resulted) return;
    this.client.send({ t: 'sortie', sortie, lane, kickback });
  }

  /** Report that one of *theirs* landed here, so the server can pay them. */
  reportLanded(kickback: number): void {
    if (this.resulted) return;
    this.client.send({ t: 'landed', kickback });
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
    if (this.disposed) return;
    const { hooks } = this.opts;
    switch (msg.t) {
      case 'joined':
        break; // consumed by NetClient.connect; room captured in run()
      case 'lobby':
        hooks.onLobby(this.room, msg.players, msg.watchers, msg.level, msg.diff);
        break;
      case 'watchStatus':
        hooks.onWatchStatus?.(msg.standings);
        break;
      case 'start':
        hooks.onCountdown(msg.countdownMs, msg.seed);
        // Relative delay on purpose — wall clocks are never compared across
        // machines, so "start in 3000ms" is fair under any clock skew.
        this.bootTimer = setTimeout(() => {
          this.bootTimer = null;
          if (!this.disposed) hooks.boot(msg.seed, msg.level, msg.diff);
        }, msg.countdownMs);
        break;
      case 'error':
        hooks.onError(msg.reason);
        break;
      case 'peer':
        hooks.onPeer?.({
          wave: msg.wave, lives: msg.lives, elapsedMs: msg.elapsedMs,
          ...(msg.hidden !== undefined ? { hidden: msg.hidden } : {}),
          ...(msg.towers !== undefined ? { towers: msg.towers } : {}),
          ...(msg.era !== undefined ? { era: msg.era } : {}),
        });
        break;
      case 'inbound':
        hooks.onInbound?.(msg.sortie, msg.lane, msg.kickback);
        break;
      case 'credit':
        hooks.onCredit?.(msg.amount);
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
