/**
 * Race results (N4): winner, final standings, rematch. Same deliberately-bare
 * styling as the lobby screen — both are flagged for the Phase 2 facelift.
 *
 * Rematch works by reload: the caller stashes {name, room} in sessionStorage
 * and reloads, which re-runs the whole boot path with zero stale state — the
 * same "reload is the honest restart" call the single-player restart makes.
 */
import type { Standing } from '../net/protocol.ts';

export interface ResultsOptions {
  myId: string;
  winnerId: string | null;
  /** Already in ranking order: waves cleared, lives, time. */
  standings: Standing[];
  /** 'forfeit': the loser dropped and never reclaimed their seat. */
  reason?: 'forfeit';
  onRematch(): void;
}

const fmtTime = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function showResults(parent: HTMLElement, opts: ResultsOptions): void {
  const el = document.createElement('div');
  el.id = 'results-screen';
  el.style.cssText =
    'position:absolute;inset:0;display:grid;place-items:center;z-index:20;' +
    'background:rgba(4,6,12,0.88);color:var(--hud-fg,#dde4f0);text-align:center;' +
    'font:15px/1.9 var(--hud-font,ui-monospace,monospace)';
  parent.style.position = 'relative';
  parent.appendChild(el);

  const outcome =
    opts.winnerId === null ? 'DEAD HEAT' : opts.winnerId === opts.myId ? 'YOU WIN' : 'YOU LOSE';
  const headline = opts.reason === 'forfeit'
    ? `${outcome} <span style="font-size:14px;opacity:0.7">— by forfeit</span>`
    : outcome;

  const rows = opts.standings
    .map((s, i) =>
      `<div${s.playerId === opts.myId ? ' style="opacity:1"' : ' style="opacity:0.75"'}>` +
      `${i + 1}. ${s.name} — wave ${s.wave} · ${s.lives} lives · ${fmtTime(s.elapsedMs)}</div>`,
    )
    .join('');

  el.innerHTML =
    `<div style="display:grid;gap:16px;min-width:300px">` +
    `<div style="font-size:26px;letter-spacing:3px">${headline}</div>` +
    `<div>${rows}</div>` +
    `<button id="race-rematch" style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.3);color:inherit;font:inherit;padding:8px 14px;border-radius:4px;cursor:pointer">rematch</button>` +
    `<a href="?race" style="color:inherit;opacity:0.7">leave</a></div>`;

  el.querySelector('#race-rematch')!.addEventListener('click', opts.onRematch);
}
