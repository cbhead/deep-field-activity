/**
 * In-game race strip (N3): your progress vs theirs, ahead/behind, and a toast
 * when the opponent clears a wave. Pure presentation fed by status blobs —
 * nothing here touches the sim, and a lost blob costs a readout update, not
 * correctness.
 *
 * Deliberately separate from hud.ts: the game HUD renders world state, this
 * renders network state, and the two update on different clocks.
 */
import type { RaceStatus } from '../net/MatchController.ts';
import type { TowerPin } from '../net/protocol.ts';
import type { MapDef } from '../sim/types.ts';
import { tileAt } from '../sim/util/grid.ts';
import { THEME, css } from '../render/theme.ts';

export interface RaceHud {
  /** Our own sampled status — called by the same pump that reports upstream. */
  own(status: RaceStatus): void;
  /** The opponent's latest blob. */
  peer(status: RaceStatus): void;
  /** Opponent's socket state: false shows the offline/forfeit badge. */
  peerConn(connected: boolean): void;
  /** Our socket state: false shows the reconnecting badge. */
  selfConn(connected: boolean): void;
  remove(): void;
}

const TOAST_MS = 3000;

/** Minimap pixels per tile. */
const TILE_PX = 5;

/**
 * Pin colours come from the theme's station palette, so a tower added to the
 * roster is automatically legible here — hardcoding these is how the minimap
 * would quietly stop matching the build deck the first time the roster grew.
 */
const pinColor = (kind: string): string =>
  css((THEME.towers as Record<string, number | undefined>)[kind] ?? 0xe9e9ed);

/**
 * The two opponent moments worth hearing.
 *
 * Optional, and kept as a callback rather than an engine reference so this file
 * stays what its header says it is — pure presentation fed by status blobs.
 * Both cues are deliberately quiet and heavily lowpassed at the palette end: the
 * race strip is peripheral, and an opponent cue that could be mistaken for one
 * of your own stations has cost the player attention on the board, which is the
 * only place it is worth spending.
 */
export interface RaceCues {
  opponentWave(): void;
  leadChange(): void;
}

export function createRaceHud(
  parent: HTMLElement,
  opponentName: string,
  room: string,
  map: MapDef,
  cues?: RaceCues,
): RaceHud {
  const el = document.createElement('div');
  el.id = 'race-hud';
  el.style.cssText =
    'position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:5;' +
    'padding:6px 14px;border-radius:6px;background:rgba(4,6,12,0.8);' +
    'border:1px solid rgba(255,255,255,0.2);color:var(--hud-fg,#dde4f0);' +
    'font:13px/1.5 var(--hud-font,ui-monospace,monospace);text-align:center;pointer-events:none';
  parent.style.position = 'relative';
  parent.appendChild(el);

  const toastEl = document.createElement('div');
  toastEl.id = 'race-toast';
  toastEl.style.cssText =
    'position:absolute;top:44px;left:50%;transform:translateX(-50%);z-index:5;' +
    'padding:4px 12px;border-radius:6px;background:rgba(20,40,80,0.9);' +
    'border:1px solid rgba(120,170,255,0.5);color:var(--hud-fg,#dde4f0);' +
    'font:13px/1.5 var(--hud-font,ui-monospace,monospace);opacity:0;transition:opacity 0.3s;pointer-events:none';
  parent.appendChild(toastEl);

  /** Which way the standing last resolved: 1 ahead, -1 behind, 0 not yet known. */
  let lead = 0;
  let mine: RaceStatus | null = null;
  let theirs: RaceStatus | null = null;
  let lastPeerWave = 0;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let peerOnline = true;
  let selfOnline = true;

  // The opponent's board, in miniature: local map data draws the road (both
  // players are on the same sector, so nothing about the board itself needs
  // to cross the wire), TowerPins draw what they've built on it. Static by
  // design — "what is he building?" is the question, not "where are his
  // creeps" — and a lost frame costs staleness, not correctness.
  const mini = document.createElement('div');
  mini.id = 'race-minimap';
  mini.style.cssText =
    'position:absolute;top:8px;right:10px;z-index:5;display:flex;flex-direction:column;gap:3px;' +
    'padding:7px 8px;border-radius:6px;background:rgba(4,6,12,0.8);' +
    'border:1px solid rgba(255,255,255,0.2);pointer-events:none';
  const miniLabel = document.createElement('span');
  miniLabel.style.cssText =
    'font:10px/1 var(--hud-font,ui-monospace,monospace);color:#75798c;letter-spacing:0.08em';
  miniLabel.textContent = `${opponentName}'s board`;
  const miniCanvas = document.createElement('canvas');
  miniCanvas.width = map.cols * TILE_PX;
  miniCanvas.height = map.rows * TILE_PX;
  mini.append(miniLabel, miniCanvas);
  parent.appendChild(mini);

  let pins: TowerPin[] = [];

  function drawMini(): void {
    const g = miniCanvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        if (tileAt(map, c, r) === 'path') {
          g.fillStyle = 'rgba(233,233,237,0.14)';
          g.fillRect(c * TILE_PX, r * TILE_PX, TILE_PX, TILE_PX);
        }
      }
    }
    for (const p of pins) {
      g.fillStyle = pinColor(p.k);
      // Tier reads as size: Mk I is a dot, upgrades grow toward the full tile.
      const px = Math.min(TILE_PX, 2 + p.tier);
      const off = (TILE_PX - px) / 2;
      g.fillRect(p.c * TILE_PX + off, p.r * TILE_PX + off, px, px);
    }
  }
  drawMini();

  // Reconnect banner, from the Race Lobby design's mid-race variant. One copy
  // correction vs the spec: the local sim keeps running through a drop — only
  // the reporting stops — so it says "your run continues", not "paused".
  const bannerEl = document.createElement('div');
  bannerEl.id = 'race-reconnect';
  bannerEl.style.cssText =
    'position:absolute;left:50%;bottom:96px;transform:translateX(-50%);z-index:6;display:none;' +
    'align-items:center;gap:16px;height:64px;padding:0 20px;border-radius:10px;' +
    'background:rgba(35,37,50,0.9);box-shadow:inset 0 0 0 1px rgba(252,192,138,0.35);' +
    'color:#e9e9ed;font:13px/1.4 Inter,system-ui,sans-serif;pointer-events:none;white-space:nowrap';
  bannerEl.innerHTML =
    `<span style="display:flex;flex-direction:column;gap:3px">` +
    `<span style="font-weight:600;font-size:14px">Reclaiming your seat in ${room}…</span>` +
    `<span style="font-size:11.5px;color:#9397ab">Your run continues — reporting resumes the moment the relay is back. ` +
    `${opponentName} sees you offline until then.</span></span>`;
  parent.appendChild(bannerEl);

  function toast(text: string): void {
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.style.opacity = '0';
    }, TOAST_MS);
  }

  function render(): void {
    const my = (mine ? `you · wave ${mine.wave} · ${mine.lives} lives` : 'you · —') +
      (selfOnline ? '' : ' · reconnecting…');
    let their = theirs ? `${opponentName} · wave ${theirs.wave} · ${theirs.lives} lives` : `${opponentName} · —`;
    if (!peerOnline) their += ' · OFFLINE — forfeits in 90s';
    else if (theirs?.hidden) their += ' · tab hidden';
    // Ranking order: waves cleared, then lives. Time is the third tiebreak and
    // deliberately not shown as a live comparison — clocks are never compared.
    let standing = '';
    if (mine && theirs) {
      const cmp = mine.wave - theirs.wave || mine.lives - theirs.lives;
      standing = cmp > 0 ? ' — ahead' : cmp < 0 ? ' — behind' : ' — level';
      // Only the *change* is worth a sound, and only between ahead and behind:
      // passing through level on the way is not news, and cueing it would fire
      // twice for every overtake.
      const side = cmp > 0 ? 1 : cmp < 0 ? -1 : 0;
      if (side !== 0 && lead !== 0 && side !== lead) cues?.leadChange();
      if (side !== 0) lead = side;
    }
    el.textContent = `${my}   |   ${their}${standing}`;
  }

  return {
    own(status) {
      mine = status;
      render();
    },
    peer(status) {
      if (status.wave > lastPeerWave) {
        lastPeerWave = status.wave;
        toast(`${opponentName} cleared wave ${status.wave}`);
        cues?.opponentWave();
      }
      if (status.towers !== undefined) {
        pins = status.towers;
        drawMini();
      }
      theirs = status;
      render();
    },
    peerConn(connected) {
      peerOnline = connected;
      toast(connected ? `${opponentName} reconnected` : `${opponentName} lost connection`);
      render();
    },
    selfConn(connected) {
      selfOnline = connected;
      bannerEl.style.display = connected ? 'none' : 'flex';
      render();
    },
    remove() {
      if (toastTimer !== null) clearTimeout(toastTimer);
      el.remove();
      toastEl.remove();
      bannerEl.remove();
      mini.remove();
    },
  };
}
