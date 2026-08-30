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

export interface RaceHud {
  /** Our own sampled status — called by the same pump that reports upstream. */
  own(status: RaceStatus): void;
  /** The opponent's latest blob. */
  peer(status: RaceStatus): void;
  remove(): void;
}

const TOAST_MS = 3000;

export function createRaceHud(parent: HTMLElement, opponentName: string): RaceHud {
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

  let mine: RaceStatus | null = null;
  let theirs: RaceStatus | null = null;
  let lastPeerWave = 0;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function toast(text: string): void {
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.style.opacity = '0';
    }, TOAST_MS);
  }

  function render(): void {
    const my = mine ? `you · wave ${mine.wave} · ${mine.lives} lives` : 'you · —';
    const their = theirs ? `${opponentName} · wave ${theirs.wave} · ${theirs.lives} lives` : `${opponentName} · —`;
    // Ranking order: waves cleared, then lives. Time is the third tiebreak and
    // deliberately not shown as a live comparison — clocks are never compared.
    let standing = '';
    if (mine && theirs) {
      const cmp = mine.wave - theirs.wave || mine.lives - theirs.lives;
      standing = cmp > 0 ? ' — ahead' : cmp < 0 ? ' — behind' : ' — level';
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
      }
      theirs = status;
      render();
    },
    remove() {
      if (toastTimer !== null) clearTimeout(toastTimer);
      el.remove();
      toastEl.remove();
    },
  };
}
