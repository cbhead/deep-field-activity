/**
 * The wire contract shared by server/ and src/net/ — the one file both sides
 * import, so the two ends of the socket cannot drift apart silently.
 *
 * JSON text frames, discriminated on `t`. Cheating is an explicit non-goal:
 * the server relays what clients report and validates nothing, so decode()
 * checks shape only as far as "has a t field" and trusts the rest.
 *
 * `start.countdownMs` is deliberately relative, never an absolute timestamp —
 * clocks are never compared across machines. Each client measures its own
 * elapsedMs from its local start.
 */
export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 8787;
export const WS_PATH = '/ws';

/** 500ms: a race readout, not a mirrored sim. 2Hz is plenty for ahead/behind. */
export const STATUS_INTERVAL_MS = 500;

export type LobbyPlayer = { playerId: string; name: string; ready: boolean };

/** One placed station, for the opponent's minimap. Tile-aligned like the sim. */
export type TowerPin = { c: number; r: number; k: string; tier: number };

/** client → server. hello without a room creates one; with a room, joins it;
 *  with an instance, joins the room for that instance or creates it.
 *  `resume` is a prior playerId: reclaim that seat after a dropped socket.
 *  `level`/`diff` are the creator's pick; the server stores and re-deals them. */
export type C2S =
  | {
      t: 'hello';
      v: number;
      name: string;
      room?: string;
      resume?: string;
      level?: string;
      diff?: string;
      /**
       * A Discord Activity instance id — shared by everyone who launched the
       * activity together in one voice channel.
       *
       * Deliberately not `room`. A room code is something a human read out and
       * typed, so joining one that does not exist is an error worth reporting.
       * An instance is an address the client did not choose and cannot mistype,
       * so it means "put me in the room for this instance, and make one if
       * nobody has yet" — which is what lets two people press play at the same
       * moment and still meet.
       */
      instance?: string;
    }
  /** ready:false un-readies — allowed until the countdown is dealt. */
  | { t: 'ready'; ready?: boolean }
  /**
   * Change the room's sector and difficulty from inside the lobby. Honoured
   * only from the first seat, and only before the countdown; the server re-deals
   * the result to everyone, so the two clients cannot end up disagreeing.
   *
   * An instance room has no creation form to make that choice in — you arrive
   * already in the room — so choosing has to be something done from inside it.
   */
  | { t: 'pick'; level: string; diff: string }
  /** `hidden` rides along on visibility changes: the sim freezes with the tab.
   *  `towers` rides along only when the layout changed since the last frame. */
  | { t: 'status'; wave: number; lives: number; elapsedMs: number; hidden?: boolean; towers?: TowerPin[] }
  /** The run is over — defeat or full clear alike. lives>0 means a clear. */
  | { t: 'dead'; wave: number; lives: number; elapsedMs: number };

/** server → client */
export type S2C =
  | { t: 'joined'; playerId: string; room: string }
  | { t: 'lobby'; players: LobbyPlayer[]; level: string; diff: string }
  | { t: 'start'; seed: number; countdownMs: number; level: string; diff: string }
  | { t: 'peer'; wave: number; lives: number; elapsedMs: number; hidden?: boolean; towers?: TowerPin[] }
  | { t: 'peerConn'; connected: boolean }
  | { t: 'result'; winnerId: string | null; standings: Standing[]; reason?: 'forfeit' }
  | { t: 'error'; reason: string };

/** Final figures for one player, in ranking order: waves, lives, then time. */
export type Standing = { playerId: string; name: string; wave: number; lives: number; elapsedMs: number };

export const encode = (msg: C2S | S2C): string => JSON.stringify(msg);

function decode(raw: string): unknown | null {
  try {
    const msg: unknown = JSON.parse(raw);
    if (typeof msg === 'object' && msg !== null && typeof (msg as { t?: unknown }).t === 'string') return msg;
  } catch {
    /* not JSON — drop the frame */
  }
  return null;
}

export const decodeC2S = (raw: string): C2S | null => decode(raw) as C2S | null;
export const decodeS2C = (raw: string): S2C | null => decode(raw) as S2C | null;
