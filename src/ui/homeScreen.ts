/**
 * The front door.
 *
 * The game used to boot straight onto a file picker: its largest type read
 * "Choose a sector", it never said its own name at size, and a first-time
 * player met a grid with one card open and two locked — so the first thing they
 * were told was what they had not done. Meanwhile the mode with a relay server,
 * a lobby, a countdown and a wire protocol behind it was a 12px ghost link in
 * the corner.
 *
 * This screen has three jobs, and no more: say what this is, get a returning
 * player back into their run in one click, and make the two modes look like two
 * modes.
 *
 * **It branches on whether anything has been cleared**, not on a setting. A
 * first run gets one named primary action and the game's pitch; a returning run
 * gets Continue, a progress line, and the standing race record. Neither variant
 * shows a zero.
 *
 * Colour literals here follow `menuScreen.ts` and `lobbyScreen.ts` rather than
 * the renderer's theme file: the pre-game screens have always been their own
 * stylesheet, and this is not the commit to change that in.
 */
import { CAMPAIGN, levelById, type LevelDef } from '../content/levels.ts';
import { DIFFICULTIES, type DifficultyId } from '../content/difficulty.ts';
import {
  furthestUnlocked,
  levelRecord,
  loadProgress,
  resetProgress,
  type Progress,
} from '../app/progress.ts';
import { readSeries, formatSeries, describeLast } from '../app/raceSeries.ts';
import { LEGEND_STYLE, legendHtml } from './legend.ts';
import { probeRelay } from '../net/relay.ts';
import { boardThumb } from './boardThumb.ts';

export interface HomeOptions {
  /** Straight into a run: the sector to resume and the difficulty to use. */
  onPlay(level: LevelDef, difficulty: DifficultyId): void;
  /** The sector picker, for choosing something other than the obvious. */
  onCampaign(): void;
  onRace(): void;
  /**
   * The other two-player mode: one board, endless, and you buy contacts to send
   * at each other until a core goes dark.
   *
   * Its own entry rather than a toggle inside the Race lobby, because the choice
   * is made before there is a room to toggle anything in — and because a mode
   * reachable only by typing `?versus` is a mode most people never find. Inside
   * a Discord Activity the same choice lives in the lobby instead, since
   * everyone there arrives at an address nobody chose.
   */
  onVersus(): void;
  /**
   * Progress was erased. The screen is built from progress, so it has to be
   * rebuilt — this was a page reload, and is now a re-entry of the route.
   */
  onReset(): void;
}

export interface HomeScreen {
  destroy(): void;
}

const STYLE = `
/* Scrolls rather than clips — see the note on .race-screen in raceTheme.ts.
   A short landscape phone cannot show this screen in one go. */
#home-screen{position:absolute;inset:0;background:#06070d;
  overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
  overscroll-behavior:contain;
  padding-bottom:calc(env(safe-area-inset-bottom, 0px) + var(--kb, 0px));
  font:400 14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;color:#c3c5d3}
#home-screen .hm-board{position:absolute;inset:0;display:grid;place-items:center;opacity:.5}
#home-screen .hm-board svg{width:118%;height:auto}
/* A directional scrim, so the board reads as depth behind the type rather than
   as a pattern competing with it. The design's one hard rule for this screen. */
#home-screen .hm-scrim{position:absolute;inset:0;
  background:linear-gradient(105deg,rgba(6,7,13,.97) 34%,rgba(6,7,13,.72) 68%,rgba(6,7,13,.9))}
/* min-height, not height: with a fixed 100% the centred column overflows its
   own box on a short viewport and the parent scrolls past empty space instead
   of past the content. */
#home-screen .hm-wrap{position:relative;min-height:100%;display:flex;flex-direction:column;
  justify-content:center;gap:26px;max-width:960px;margin:0 auto;padding:26px 32px}
#home-screen .hm-bar{position:absolute;left:32px;right:32px;top:22px;display:flex;
  align-items:center;justify-content:space-between}
#home-screen .hm-mark{font:600 10px/1 Inter,sans-serif;letter-spacing:.22em;
  text-transform:uppercase;color:#9184d9}
#home-screen h1{margin:0;font:500 46px/1.04 Inter,sans-serif;letter-spacing:-.02em;color:#f2f3f8}
#home-screen .hm-pitch{margin:0;max-width:34em;font-size:15px;color:#9397ab}
#home-screen .hm-meta{display:flex;align-items:center;gap:16px;font-size:12px;color:#75798c}
#home-screen .hm-dot{width:7px;height:7px;border-radius:50%;background:#86e39b;
  box-shadow:0 0 8px #86e39b;display:inline-block;margin-right:7px}
/* auto-fit rather than a fixed count: three cards side by side on a desktop,
   and they wrap to two-then-one on a narrow phone without a media query. The
   min is the width at which "Send contacts at each other" still fits on two
   lines rather than four. */
#home-screen .hm-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));
  gap:14px;max-width:860px}
#home-screen .hm-card{display:flex;flex-direction:column;gap:5px;padding:15px 17px;
  border:1px solid #23263a;border-radius:12px;background:rgba(18,20,32,.72);
  text-align:left;cursor:pointer;color:inherit;font:inherit}
#home-screen .hm-card:hover{border-color:#4b4570;background:rgba(24,26,42,.86)}
#home-screen .hm-card h2{margin:0;font:500 17px/1.2 Inter,sans-serif;color:#e9e9ed}
#home-screen .hm-card p{margin:0;font-size:12px;color:#75798c}
#home-screen .hm-score{font:600 15px/1 Inter,sans-serif;color:#b5abfc;margin-top:2px}
#home-screen .hm-score em{font-style:normal;color:#75798c;font-size:12px;font-weight:400}
/* Continue is the primary action and carries a picture of what it resumes, so
   the button says which board as well as which sector. */
#home-screen .hm-continue{display:flex;align-items:center;gap:16px;padding:14px 18px;
  border:1px solid #4b4570;border-radius:12px;background:rgba(38,32,66,.6);
  cursor:pointer;color:inherit;font:inherit;text-align:left;max-width:640px}
#home-screen .hm-continue:hover{border-color:#9184d9;background:rgba(48,40,84,.7)}
#home-screen .hm-continue .thumb{border-radius:6px;flex:none}
#home-screen .hm-continue .hm-kicker{font:600 9.5px/1 Inter,sans-serif;letter-spacing:.16em;
  text-transform:uppercase;color:#9184d9}
#home-screen .hm-continue h2{margin:2px 0 0;font:500 20px/1.1 Inter,sans-serif;color:#f2f3f8}
#home-screen .hm-continue .hm-diff{font-size:12px;color:#75798c}
#home-screen .hm-continue .hm-go{margin-left:auto;font-size:19px;color:#9184d9}
#home-screen .hm-actions{display:flex;gap:12px;align-items:center}
#home-screen .hm-primary{padding:12px 22px;border:0;border-radius:9px;background:#6c5cd6;
  color:#f4f2ff;font:600 14px/1 Inter,sans-serif;cursor:pointer}
#home-screen .hm-primary:hover{background:#7d6de6}
#home-screen .hm-ghost{padding:12px 18px;border:1px solid #23263a;border-radius:9px;
  background:none;color:#9397ab;font:400 13px/1 Inter,sans-serif;cursor:pointer}
#home-screen .hm-ghost:hover{color:#e9e9ed;border-color:#4b4570}
#home-screen .hm-last{font-size:11px;color:#5d6070;margin-top:1px}
/* Relay state as a dot on the card that needs it. Grey until probed, so it
   never claims "up" on a stale check — an unanswered question looks different
   from an answered one. */
#home-screen .hm-relay{display:inline-block;width:7px;height:7px;border-radius:50%;
  background:#4b4e5e;vertical-align:middle;margin-left:7px;text-indent:-9999px;overflow:hidden}
#home-screen .hm-relay.up{background:#86e39b;box-shadow:0 0 8px #86e39b}
#home-screen .hm-relay.down{background:#e06d6d;box-shadow:0 0 8px #e06d6d}
#home-screen .hm-relaynote{max-width:640px;font-size:11.5px;color:#e06d6d;min-height:1em}
#home-screen .hm-baractions{display:flex;gap:18px}
#home-screen .hm-link{border:0;background:none;cursor:pointer;padding:0;
  font:400 12px/1 Inter,sans-serif;color:#75798c}
#home-screen .hm-link:hover{color:#cfd3e5}

/* One sheet, two contents. Both are things you look at and dismiss, so they
   share a container rather than each growing their own screen. */
#home-screen .hm-sheet{position:absolute;inset:0;z-index:20;display:grid;place-items:center;
  background:rgba(4,5,10,.82);padding:32px}
/* The display:grid above beats the hidden attribute's default display:none, so
   without this rule the sheet — an 82%-black full-bleed backdrop — covers the
   home screen permanently. DOM tests could not see it: the markup underneath
   was correct, and a programmatic click fires straight through an overlay. It
   showed up only in a screenshot. */
#home-screen .hm-sheet[hidden]{display:none}
#home-screen .hm-sheet-in{position:relative;max-width:760px;max-height:88%;overflow-y:auto;
  padding:26px 30px;border:1px solid #23263a;border-radius:14px;background:#0b0d16}
#home-screen .hm-sheet h2{margin:0 0 6px;font:500 24px/1.2 Inter,sans-serif;color:#f2f3f8}
#home-screen .hm-sheet h3{margin:16px 0 8px;font:600 10px/1 Inter,sans-serif;letter-spacing:.16em;
  text-transform:uppercase;color:#9184d9}
#home-screen .hm-close{position:absolute;right:14px;top:12px;border:0;background:none;
  cursor:pointer;color:#75798c;font-size:15px;padding:4px 6px}
#home-screen .hm-close:hover{color:#e9e9ed}
#home-screen .hm-danger-note{font-size:11.5px;color:#75798c;margin:0 0 10px;max-width:44em}
#home-screen .hm-danger{padding:9px 16px;border:1px solid #4a2a34;border-radius:8px;
  background:none;color:#e06d6d;font:600 12.5px/1 Inter,sans-serif;cursor:pointer}
#home-screen .hm-danger:hover{border-color:#e06d6d}
#home-screen .hm-danger.armed{background:rgba(224,109,109,.14);border-color:#e06d6d}

/* Focus has to be visible everywhere, because this screen is now navigable
   without a pointer. */
#home-screen :focus-visible{outline:2px solid #9184d9;outline-offset:2px;border-radius:8px}
${LEGEND_STYLE}
`;

export function createHomeScreen(parent: HTMLElement, opts: HomeOptions): HomeScreen {
  if (!document.getElementById('home-style')) {
    const style = document.createElement('style');
    style.id = 'home-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const el = document.createElement('div');
  el.id = 'home-screen';
  parent.appendChild(el);

  const progress = loadProgress();
  const cleared = CAMPAIGN.filter((l) => levelRecord(progress, l.id).cleared).length;
  const resume = resumeLevel(progress);

  el.innerHTML =
    `<div class="hm-board">${boardThumb((resume ?? CAMPAIGN[0]!).map, 1100, true)}</div>` +
    `<div class="hm-scrim"></div>` +
    `<div class="hm-bar"><span class="hm-mark">Deep Field</span>` +
    `<span class="hm-baractions">` +
    `<button class="hm-link" data-act="how">How to play</button>` +
    `<button class="hm-link" data-act="settings">Settings</button></span></div>` +
    `<div class="hm-sheet" id="hm-sheet" hidden><div class="hm-sheet-in" id="hm-sheet-in"></div></div>` +
    `<div class="hm-wrap">${cleared === 0 ? firstRun() : returning(progress, resume, cleared)}</div>`;

  // Probed when the Race card is first pointed at or focused — never on load.
  // A solo player who never races would otherwise meet a red dot every boot,
  // reporting a server they never wanted, which makes an offline single-player
  // launch feel broken. This still runs comfortably before anyone types a name,
  // which is all "relay honesty" actually asks for.
  let probed = false;
  // Both two-player modes dial the same relay, so either card is a reason to
  // ask about it and both carry the answer.
  const netCards = el.querySelectorAll<HTMLElement>('#hm-race, #hm-versus');
  const checkRelay = (): void => {
    if (probed) return;
    probed = true;
    void probeRelay().then((status) => {
      const dots = el.querySelectorAll<HTMLElement>('.hm-relay');
      const note = el.querySelector<HTMLElement>('#hm-relaynote');
      for (const dot of dots) {
        dot.className = `hm-relay ${status}`;
        dot.title = status === 'up' ? 'Relay is up' : 'Relay is not answering';
      }
      // The Tailscale requirement is stated once, here, where it is actionable
      // — rather than after a name has been typed and a connection has failed.
      if (note !== null) {
        note.textContent =
          status === 'up'
            ? ''
            : 'Relay is not answering — start it with `npm run play`, and your friend needs Tailscale up.';
      }
    });
  };
  for (const card of netCards) {
    card.addEventListener('pointerenter', checkRelay);
    card.addEventListener('focus', checkRelay);
  }
  // There is no hover on a touch screen, and the tap that would focus the card
  // also navigates away from it — so the probe never resolved and the dot
  // stayed grey forever. Probe on idle instead. The objection the hover trigger
  // was written for (a solo player meeting a red dot on every boot) is about
  // *showing* the dot, and the dot is only shown once probed.
  if (matchMedia('(pointer: coarse)').matches) {
    const idle = window.requestIdleCallback?.bind(window);
    if (idle !== undefined) idle(() => checkRelay());
    else setTimeout(checkRelay, 400);
  }

  const sheet = el.querySelector<HTMLElement>('#hm-sheet');
  const sheetIn = el.querySelector<HTMLElement>('#hm-sheet-in');

  /** Two clicks to erase, and the second one asks. See `settingsHtml`. */
  let eraseArmed = false;

  function openSheet(html: string): void {
    if (sheet === null || sheetIn === null) return;
    sheetIn.innerHTML = `<button class="hm-close" data-act="close" aria-label="Close">✕</button>${html}`;
    sheet.hidden = false;
    sheet.querySelector<HTMLElement>('.hm-close')?.focus();
  }

  function closeSheet(): void {
    if (sheet === null) return;
    sheet.hidden = true;
    eraseArmed = false;
  }

  el.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const act = target?.dataset['act'];
    if (act === undefined) return;

    if (act === 'race') opts.onRace();
    else if (act === 'versus') opts.onVersus();
    else if (act === 'campaign') opts.onCampaign();
    else if (act === 'play') {
      const level = resume ?? CAMPAIGN[0]!;
      opts.onPlay(level, progress.lastDifficulty);
    } else if (act === 'how') openSheet(legendHtml());
    else if (act === 'settings') openSheet(settingsHtml(eraseArmed));
    else if (act === 'close') closeSheet();
    else if (act === 'erase') {
      // Settings is where a destructive action belongs — off the screens with
      // Launch buttons on them — and it still asks before doing it.
      if (!eraseArmed) {
        eraseArmed = true;
        openSheet(settingsHtml(true));
        return;
      }
      resetProgress();
      opts.onReset();
    }
  });

  // Esc closes the sheet. The screen behind it is the thing you were trying to
  // get back to, so it should not take a click to do that.
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && sheet !== null && !sheet.hidden) closeSheet();
  };
  document.addEventListener('keydown', onKey);

  return {
    destroy(): void {
      document.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}

/**
 * Settings — and specifically, where Reset progress lives.
 *
 * It used to be a ghost button under the sector cards, always visible once
 * anything was cleared, on a screen that now has a Launch button on every card.
 * A destructive action does not belong one mis-click from the thing you press
 * most. Here it is two clicks from a screen with no Launch on it at all, and
 * the second click asks rather than tells.
 */
function settingsHtml(armed: boolean): string {
  return (
    `<h2>Settings</h2>` +
    `<p class="lg-lede">In-game preferences — reach circles, damage numbers and the ` +
    `route current — live in the pause menu, where you can see what they change.</p>` +
    `<h3>Campaign</h3>` +
    `<p class="hm-danger-note">Clears every recorded run and re-locks every sector. ` +
    `There is no undo.</p>` +
    `<button class="hm-danger${armed ? ' armed' : ''}" data-act="erase">` +
    `${armed ? 'Erase everything — really?' : 'Reset campaign progress'}</button>`
  );
}

/**
 * The sector Continue resumes — **last played, not furthest unlocked**.
 *
 * The two diverge the moment a player goes back to farm a better grade, and
 * then furthest-unlocked resumes a sector they deliberately left. Falls back to
 * the furthest when there is no record, and to nothing at all when the stored
 * id names a level that no longer exists — Continue is then *absent* rather
 * than a dead button.
 */
function resumeLevel(p: Progress): LevelDef | undefined {
  if (p.lastLevel !== undefined) {
    const hit = levelById(p.lastLevel);
    if (hit !== undefined) return hit;
  }
  return CAMPAIGN[furthestUnlocked(p)];
}

/**
 * First run: no locked cards and no score of zero.
 *
 * The old screen led with "0 of 3 held so far", which frames the game as a list
 * of things the player has failed to do at the exact moment they have not been
 * given a chance to do any of them. Locked sectors still exist and are still
 * discoverable — on the campaign screen, where a locked card is information
 * rather than a first impression.
 */
function firstRun(): string {
  const first = CAMPAIGN[0]!;
  const diff = DIFFICULTIES[/* the default the picker will preselect */ 'standard' as DifficultyId];
  return (
    `<h1>Deep Field</h1>` +
    `<p class="hm-pitch">A tower defense for your browser. Hold the line through ${CAMPAIGN.length} sectors, ` +
    `or race a friend on the same seed and see who survives longer.</p>` +
    `<div class="hm-actions">` +
    `<button class="hm-primary" data-act="play">Start ${first.name} →</button>` +
    // Both two-player modes, even on a first run. Somebody who opened this
    // because a friend told them to should not have to clear a sector first to
    // find the mode they were told about.
    `<button class="hm-ghost" data-act="race" id="hm-race">Race a friend</button>` +
    `<button class="hm-ghost" data-act="versus" id="hm-versus">Fight a friend</button>` +
    `</div>` +
    `<div class="hm-meta">${diff === undefined ? '' : `${diff.name} difficulty · change on the next screen`}</div>`
  );
}

/** Returning: resume in one click, and the two modes at equal weight. */
function returning(p: Progress, resume: LevelDef | undefined, cleared: number): string {
  const best = bestGrade(p);
  const top = readSeries()[0];

  const cont =
    resume === undefined
      ? ''
      : `<button class="hm-continue" data-act="play">` +
        `${boardThumb(resume.map, 96)}` +
        `<span><span class="hm-kicker">Continue · ${resume.kicker}</span>` +
        `<h2>${resume.name}</h2>` +
        `<span class="hm-diff">${DIFFICULTIES[p.lastDifficulty]?.name ?? p.lastDifficulty}</span></span>` +
        `<span class="hm-go">→</span></button>`;

  return (
    `<div><h1>Deep Field</h1>` +
    `<p class="hm-pitch">Hold the line through ${CAMPAIGN.length} sectors — or race a friend on the same ` +
    `seed and see who survives longer.</p></div>` +
    cont +
    `<div class="hm-cards">` +
    `<button class="hm-card" data-act="campaign"><h2>Campaign</h2>` +
    `<p>${CAMPAIGN.length} sectors</p>` +
    `<span class="hm-score">${cleared} held${best === null ? '' : ` <em>· best ${best}</em>`}</span>` +
    `</button>` +
    `<button class="hm-card hm-race" data-act="race" id="hm-race">` +
    `<h2>Race <i class="hm-relay" title="Checking the relay" ` +
    `aria-label="Relay status">·</i></h2>` +
    // With no history the card shows the mode's pitch rather than an empty
    // 0–0 — the same rule as first-run Continue: never open on a zero.
    (top === undefined
      ? `<p>Head to head, same seed</p><span class="hm-score"><em>Invite a friend</em></span>`
      : `<p>vs ${top.opponent}</p>` +
        `<span class="hm-score" title="${formatSeries(top.opponent, top.rec)}">` +
        `${top.rec.w}–${top.rec.l}${top.rec.t > 0 ? ` <em>· ${top.rec.t} tie${top.rec.t === 1 ? '' : 's'}</em>` : ''}` +
        `</span>` +
        // What happened, not just how it stands. This is the half that makes
        // someone want a rematch.
        (describeLast(top.rec) === null ? '' : `<p class="hm-last">last: ${describeLast(top.rec)}</p>`)) +
    `</button>` +
    // Deliberately not carrying the head-to-head line the Race card does. The
    // series store is one record per opponent across both modes — a rivalry,
    // not a league table per game — so printing the same 3–2 on both cards
    // would read as two separate tallies that happen to agree.
    `<button class="hm-card hm-versus" data-act="versus" id="hm-versus">` +
    `<h2>Versus <i class="hm-relay" title="Checking the relay" ` +
    `aria-label="Relay status">·</i></h2>` +
    `<p>One board, no finish line</p>` +
    `<span class="hm-score"><em>Send contacts at each other</em></span>` +
    `</button></div>` +
    `<div class="hm-relaynote" id="hm-relaynote"></div>`
  );
}

/** The best grade across every sector and difficulty, or null if none. */
function bestGrade(p: Progress): string | null {
  const order = ['S', 'A', 'B', 'C', 'D'];
  let best: string | null = null;
  for (const level of CAMPAIGN) {
    for (const run of Object.values(levelRecord(p, level.id).best)) {
      if (run === undefined) continue;
      if (best === null || order.indexOf(run.grade) < order.indexOf(best)) best = run.grade;
    }
  }
  return best;
}
