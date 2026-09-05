/**
 * Race results, in the same deep-field chrome as the lobby (raceTheme):
 * verdict up top, seat-style standing cards in ranking order, the seed as the
 * reproduction handle, and rematch. The lobby spec (L1–L7) never covered this
 * screen, so it is derived from that design's language rather than a page of
 * it — same bar, same cards, same constraint set.
 *
 * Rematch works by reload: the caller stashes {name, room} in sessionStorage
 * and reloads, which re-runs the whole boot path with zero stale state — the
 * same "reload is the honest restart" call the single-player restart makes.
 */
import type { ResultReason, Standing } from '../net/protocol.ts';
import { formatSeed } from '../sim/util/rng.ts';
import { ensureRaceStyle, raceBar, hexSvg, escapeHtml, YOU, THEM } from './raceTheme.ts';
import { fmtTime } from '../net/report.ts';

export interface ResultsOptions {
  myId: string;
  winnerId: string | null;
  /** Already in ranking order: waves cleared, lives, time. */
  standings: Standing[];
  /** 'forfeit': the loser dropped and never reclaimed their seat.
   *  'core': versus — somebody's core went dark, which is how it ends. */
  reason?: ResultReason;
  /** "Cascade · Blackout" — the loadout this was raced on. */
  sector: string;
  room: string;
  seed: number;
  /** Running head-to-head line, e.g. "Series vs Vela: 3–2 (1 tie)". */
  series?: string;
  /**
   * Versus rather than Race, which changes what this screen can honestly say.
   *
   * Race ends by comparison — two finished runs, ranked. Versus ends by
   * elimination, and on an endless arc "wave 14" is a survival figure with no
   * finish line behind it, so presenting it as a *standing* would be inventing
   * a race that was never run. Same cards, different sentence.
   */
  versus?: boolean;
  onRematch(): void;
}

export function showResults(parent: HTMLElement, opts: ResultsOptions): void {
  ensureRaceStyle();

  const el = document.createElement('div');
  el.id = 'results-screen';
  el.className = 'race-screen';
  el.style.zIndex = '20';
  parent.appendChild(el);

  const won = opts.winnerId === opts.myId;
  const verdict = opts.winnerId === null ? 'DEAD HEAT' : won ? 'YOU WIN' : 'YOU LOSE';

  // What ended it, in the mode's own words. Forfeit outranks the rest because
  // it is the one ending that is *not* about the game.
  const kicker =
    opts.reason === 'forfeit'
      ? 'Match over — by forfeit'
      : opts.versus === true
        ? won
          ? 'Their core went dark'
          : 'Your core went dark'
        : 'Race over';

  // Versus is one board, so the replay handle has to name it. Without the
  // level the link replays Switchback on a versus seed, which is a different
  // board and a confusing thing to be handed.
  const replay = opts.versus === true ? `?level=versus&seed=${opts.seed}` : `?seed=${opts.seed}`;
  const leave = opts.versus === true ? '?versus' : '?race';

  const card = (s: Standing, i: number): string => {
    const mine = s.playerId === opts.myId;
    const winner = s.playerId === opts.winnerId;
    const ring = winner
      ? 'inset 0 0 0 1px rgba(145,132,217,.55),0 0 24px rgba(145,132,217,.14)'
      : mine
        ? 'inset 0 0 0 1px rgba(143,196,250,.35)'
        : 'inset 0 0 0 1px rgba(233,233,237,.12)';
    return (
      `<div class="lb-seat" style="box-shadow:${ring};min-height:74px">` +
      `<span class="lb-mono" style="width:16px">${i + 1}.</span>` +
      hexSvg(mine ? YOU : THEM, !winner && opts.winnerId !== null) +
      `<span style="display:flex;flex-direction:column;gap:3px">` +
      `<span class="lb-seat-name" style="font-size:17px">${escapeHtml(s.name)}${mine ? ' <span style="opacity:.55;font-weight:400;font-size:12px">you</span>' : ''}</span>` +
      `<span class="lb-seat-sub">${
        opts.versus === true
          ? `held ${s.wave} waves · ${s.lives} lives · ${fmtTime(s.elapsedMs)}`
          : `wave ${s.wave} · ${s.lives} lives · ${fmtTime(s.elapsedMs)}`
      }</span></span>` +
      (winner
        ? `<span class="lb-pill on" style="margin-left:auto"><i></i>${
            opts.reason === 'forfeit' ? 'By forfeit' : opts.versus === true ? 'Still standing' : 'Winner'
          }</span>`
        : '') +
      `</div>`
    );
  };

  el.innerHTML =
    raceBar(opts.sector, `room <span style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.2em;color:#cfd3e5">${opts.room}</span>`, 'match settled') +
    `<div class="lb-glow"${won || opts.winnerId === null ? '' : ' style="background:radial-gradient(circle at 50% 44%,rgba(224,109,109,.1),rgba(6,7,13,.7) 62%)"'}></div>` +
    `<div class="lb-body"><div class="lb-col" style="width:min(560px,92vw);padding-top:12px">` +
    `<div style="display:flex;flex-direction:column;gap:10px">` +
    `<span class="lb-kicker${won || opts.winnerId === null ? '' : ' bad'}">${kicker}</span>` +
    `<h1 class="lb-title" style="font-size:52px;letter-spacing:.02em">${verdict}</h1></div>` +
    `<div style="display:flex;flex-direction:column;gap:14px">${opts.standings.map(card).join('')}</div>` +
    `<span class="lb-mono">seed 0x${formatSeed(opts.seed)} · replay it solo with ${replay}</span>` +
    (opts.series !== undefined ? `<span class="lb-fine">${opts.series}</span>` : '') +
    `<div style="display:flex;align-items:center;gap:20px">` +
    `<button id="race-rematch" class="lb-btn" style="width:220px;height:50px;font-size:15px">Rematch</button>` +
    // Mode-aware, because leaving a versus match into `?race` would drop you in
    // a lobby for the other game.
    `<a href="${leave}" style="color:#75798c;text-decoration:none">leave</a>` +
    // There used to be a "match logged to Discord ✓" line here, written by
    // whichever browser held the webhook. The relay sends the report now and
    // does so after this card is already up, so the page has nothing truthful
    // to say about it — and an empty element that once meant something is worse
    // than none. The channel is the confirmation; the relay logs the failures.
    `</div></div></div>`;

  el.querySelector('#race-rematch')!.addEventListener('click', opts.onRematch);
}
