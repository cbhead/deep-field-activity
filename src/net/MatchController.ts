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
import type { LobbyPlayer, S2C } from './protocol.ts';

export interface RaceHooks {
  /** Called once joined, and again whenever the lobby roster changes. */
  onLobby(room: string, players: LobbyPlayer[]): void;
  /** Countdown has begun; boot() fires when it reaches zero. */
  onCountdown(ms: number): void;
  /** Build the world with the server's seed and start the loop. */
  boot(seed: number): void;
  onError(reason: string): void;
}

export interface RaceOptions {
  url: string;
  name: string;
  /** Omit to create a room; supply a code to join one. */
  room?: string;
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
    const { url, name, room, hooks, autoReady = true } = this.opts;
    this.client.onMessage = (msg) => this.handle(msg);
    try {
      const joined = room === undefined
        ? await this.client.connect(url, name)
        : await this.client.connect(url, name, room);
      // NetClient consumes `joined` to resolve connect(), so the room code
      // must be captured here — handle() will never see that message.
      this.room = joined.room;
      hooks.onLobby(joined.room, []);
      if (autoReady) this.ready();
    } catch (err) {
      hooks.onError(err instanceof Error ? err.message : String(err));
    }
  }

  ready(): void {
    this.client.send({ t: 'ready' });
  }

  private room = '';

  private handle(msg: S2C): void {
    const { hooks } = this.opts;
    switch (msg.t) {
      case 'joined':
        break; // consumed by NetClient.connect; room captured in run()
      case 'lobby':
        hooks.onLobby(this.room, msg.players);
        break;
      case 'start':
        hooks.onCountdown(msg.countdownMs);
        // Relative delay on purpose — wall clocks are never compared across
        // machines, so "start in 3000ms" is fair under any clock skew.
        setTimeout(() => hooks.boot(msg.seed), msg.countdownMs);
        break;
      case 'error':
        hooks.onError(msg.reason);
        break;
      case 'peer':
      case 'peerConn':
      case 'result':
        break; // N3–N4
    }
  }
}
