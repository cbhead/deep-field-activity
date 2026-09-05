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
export const PROTOCOL_VERSION = 2;
export const DEFAULT_PORT = 8787;
export const WS_PATH = '/ws';

/** 500ms: a race readout, not a mirrored sim. 2Hz is plenty for ahead/behind. */
export const STATUS_INTERVAL_MS = 500;

export type LobbyPlayer = { playerId: string; name: string; ready: boolean };

/**
 * Which game the room is playing.
 *
 * The server needs this for exactly one reason: how a match settles. Race ranks
 * two completed runs; versus ends the moment a core does, so the first `dead`
 * to arrive loses and the server must not wait for the second. Everything else
 * it does is mode-blind, and deliberately.
 *
 * Absent means `'race'`, which is what a v1 client would have meant.
 */
export type MatchMode = 'race' | 'versus';

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
       *
       * Orthogonal to `mode`. An instance says *which* room; `mode` says what is
       * played in it. The channel's room can host either game.
       */
      instance?: string;
      mode?: MatchMode;
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
  | {
      t: 'status';
      wave: number;
      lives: number;
      elapsedMs: number;
      hidden?: boolean;
      towers?: TowerPin[];
      /** Versus only. The rung they are on — the whole tension of the mode, so
       *  it has to be visible without seeing their board. */
      era?: number;
    }
  /** The run is over — defeat or full clear alike. lives>0 means a clear. */
  | { t: 'dead'; wave: number; lives: number; elapsedMs: number }
  /**
   * I bought a contact and it is walking at you. Relayed verbatim as `inbound`.
   *
   * `kickback` travels with it rather than being recomputed on arrival: it is a
   * fraction of what the *sender* paid, and a Monolith walks for the better
   * part of a minute — re-deriving it on the receiving board would price it
   * against a wave that had not started when it was bought.
   *
   * No tick, no timestamp, and none is needed. Nothing in either world depends
   * on the other's state — a sortie is a one-way event and the only shared
   * value in the match is the seed — so there is nothing two clocks could
   * disagree about. It needs to *arrive*, not to arrive at an agreed instant,
   * and the socket already guarantees that.
   */
  | { t: 'sortie'; sortie: string; lane: number; kickback: number }
  /** One of theirs reached my core. Relayed to its sender as `credit`. */
  | { t: 'landed'; kickback: number };

/** server → client */
export type S2C =
  | { t: 'joined'; playerId: string; room: string }
  /**
   * The room, to everyone in it — seated or not.
   *
   * `watchers` is the queue, in the order it will be seated. A client works out
   * its own role by looking for its id: in `players` it holds a seat, in
   * `watchers` it is waiting. That is deliberately the only signal, so there is
   * no second place for the two to disagree, and being promoted needs no
   * message of its own — the next roster simply has you in a different list.
   */
  | { t: 'lobby'; players: LobbyPlayer[]; watchers: LobbyPlayer[]; level: string; diff: string }
  /**
   * Live figures for both seats, sent only to watchers. Seated players learn
   * about each other through `peer`, which carries one opponent and no names;
   * a watcher needs both sides and has no board of their own to read.
   */
  | { t: 'watchStatus'; standings: Standing[] }
  | { t: 'start'; seed: number; countdownMs: number; level: string; diff: string }
  | {
      t: 'peer';
      wave: number;
      lives: number;
      elapsedMs: number;
      hidden?: boolean;
      towers?: TowerPin[];
      era?: number;
    }
  | { t: 'peerConn'; connected: boolean }
  /** Their sortie, arriving. The mirror of the sender's `sortie` frame. */
  | { t: 'inbound'; sortie: string; lane: number; kickback: number }
  /** One of mine landed on them. Pays back what it carried. */
  | { t: 'credit'; amount: number }
  | { t: 'result'; winnerId: string | null; standings: Standing[]; reason?: ResultReason }
  | { t: 'error'; reason: string };

/**
 * Why the match ended, when it was not simply "both runs finished".
 *
 * `'core'` is versus's ordinary ending and not an exception the way `'forfeit'`
 * is — a core going dark *is* how the mode concludes. It is reported anyway so
 * the results screen can say "their core went dark" rather than reaching for
 * the Race ranking, which on an endless arc would be comparing two numbers that
 * never had a finish line to be measured against.
 */
export type ResultReason = 'forfeit' | 'core';

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
