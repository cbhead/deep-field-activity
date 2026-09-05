/**
 * Thin wrapper over one WebSocket: connect, complete the hello/joined
 * handshake, then hand every later message to whoever is listening.
 *
 * Owned by MatchController (N3) and nothing else — the sim never sees the
 * network. Runs identically in the browser and Node ≥22 (global WebSocket),
 * which is what lets the smoke test drive the real client headlessly.
 */
import {
  PROTOCOL_VERSION,
  WS_PATH,
  decodeS2C,
  encode,
  type C2S,
  type MatchMode,
  type S2C,
} from './protocol.ts';

/**
 * Derive the socket URL from wherever the page came from, so dev (Vite on one
 * port, server on another), Tailscale IP, and the N6 single-port build all
 * work without configuration. wss over https, ws over http — an https page
 * hard-blocks ws with no override.
 */
export const serverUrl = (host: string, secure: boolean): string =>
  `${secure ? 'wss' : 'ws'}://${host}${WS_PATH}`;

export class NetClient {
  private ws: WebSocket | null = null;

  /** Everything after `joined` flows through these; unset means dropped. */
  onMessage: ((msg: S2C) => void) | null = null;
  onClose: (() => void) | null = null;

  /**
   * Resolves once the server answers hello with joined. No `room` creates a
   * fresh room; a code joins that one; an `instance` joins the room for that
   * Discord instance or creates it; `resume` reclaims a prior seat after a
   * dropped socket; `level`/`diff` are the creator's pick. Rejects if the
   * server answers with an error first (bad code, full room) or the socket
   * cannot open.
   */
  connect(
    url: string,
    name: string,
    opts: {
      room?: string;
      resume?: string;
      level?: string;
      diff?: string;
      instance?: string;
      mode?: MatchMode;
    } = {},
  ): Promise<{ playerId: string; room: string }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let joined = false;
      ws.onopen = () =>
        ws.send(encode({
          t: 'hello', v: PROTOCOL_VERSION, name,
          ...(opts.room === undefined ? {} : { room: opts.room }),
          ...(opts.mode === undefined ? {} : { mode: opts.mode }),
          ...(opts.resume === undefined ? {} : { resume: opts.resume }),
          ...(opts.level === undefined ? {} : { level: opts.level }),
          ...(opts.diff === undefined ? {} : { diff: opts.diff }),
          ...(opts.instance === undefined ? {} : { instance: opts.instance }),
        }));
      ws.onerror = () => reject(new Error(`could not reach ${url}`));
      ws.onclose = () => this.onClose?.();
      ws.onmessage = (ev) => {
        const msg = decodeS2C(String(ev.data));
        if (!msg) return;
        if (!joined && msg.t === 'joined') {
          joined = true;
          resolve({ playerId: msg.playerId, room: msg.room });
        } else if (!joined && msg.t === 'error') {
          reject(new Error(msg.reason));
          ws.close();
        } else {
          this.onMessage?.(msg);
        }
      };
    });
  }

  send(msg: C2S): void {
    // Quietly drop while reconnecting: a missed status blob costs nothing,
    // and send() on a non-open socket throws.
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
