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
import { furthestUnlocked, levelRecord, loadProgress, type Progress } from '../app/progress.ts';
import { readSeries, formatSeries, describeLast } from '../app/raceSeries.ts';
import { probeRelay } from '../net/relay.ts';
import { boardThumb } from './boardThumb.ts';

export interface HomeOptions {
  /** Straight into a run: the sector to resume and the difficulty to use. */
  onPlay(level: LevelDef, difficulty: DifficultyId): void;
  /** The sector picker, for choosing something other than the obvious. */
  onCampaign(): void;
  onRace(): void;
}

export interface HomeScreen {
  destroy(): void;
}

const STYLE = `
#home-screen{position:absolute;inset:0;overflow:hidden;background:#06070d;
  font:400 14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;color:#c3c5d3}
#home-screen .hm-board{position:absolute;inset:0;display:grid;place-items:center;opacity:.5}
#home-screen .hm-board svg{width:118%;height:auto}
/* A directional scrim, so the board reads as depth behind the type rather than
   as a pattern competing with it. The design's one hard rule for this screen. */
#home-screen .hm-scrim{position:absolute;inset:0;
  background:linear-gradient(105deg,rgba(6,7,13,.97) 34%,rgba(6,7,13,.72) 68%,rgba(6,7,13,.9))}
#home-screen .hm-wrap{position:relative;height:100%;display:flex;flex-direction:column;
  justify-content:center;gap:26px;max-width:960px;margin:0 auto;padding:0 32px}
#home-screen .hm-bar{position:absolute;left:32px;right:32px;top:22px;display:flex;
  align-items:center;justify-content:space-between}
#home-screen .hm-mark{font:600 10px/1 Inter,sans-serif;letter-spacing:.22em;
  text-transform:uppercase;color:#9184d9}
#home-screen h1{margin:0;font:500 46px/1.04 Inter,sans-serif;letter-spacing:-.02em;color:#f2f3f8}
#home-screen .hm-pitch{margin:0;max-width:34em;font-size:15px;color:#9397ab}
#home-screen .hm-meta{display:flex;align-items:center;gap:16px;font-size:12px;color:#75798c}
#home-screen .hm-dot{width:7px;height:7px;border-radius:50%;background:#86e39b;
  box-shadow:0 0 8px #86e39b;display:inline-block;margin-right:7px}
#home-screen .hm-cards{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:640px}
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
  parent.style.position = 'relative';
  parent.appendChild(el);

  const progress = loadProgress();
  const cleared = CAMPAIGN.filter((l) => levelRecord(progress, l.id).cleared).length;
  const resume = resumeLevel(progress);

  el.innerHTML =
    `<div class="hm-board">${boardThumb((resume ?? CAMPAIGN[0]!).map, 1100, true)}</div>` +
    `<div class="hm-scrim"></div>` +
    `<div class="hm-bar"><span class="hm-mark">Deep Field</span></div>` +
    `<div class="hm-wrap">${cleared === 0 ? firstRun() : returning(progress, resume, cleared)}</div>`;

  // Probed when the Race card is first pointed at or focused — never on load.
  // A solo player who never races would otherwise meet a red dot every boot,
  // reporting a server they never wanted, which makes an offline single-player
  // launch feel broken. This still runs comfortably before anyone types a name,
  // which is all "relay honesty" actually asks for.
  let probed = false;
  const raceCard = el.querySelector<HTMLElement>('#hm-race');
  const checkRelay = (): void => {
    if (probed) return;
    probed = true;
    void probeRelay().then((status) => {
      const dot = el.querySelector<HTMLElement>('#hm-relay');
      const note = el.querySelector<HTMLElement>('#hm-relaynote');
      if (dot !== null) {
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
  raceCard?.addEventListener('pointerenter', checkRelay);
  raceCard?.addEventListener('focus', checkRelay);

  el.addEventListener('click', (ev) => {
    const act = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset['act'];
    if (act === undefined) return;
    if (act === 'race') opts.onRace();
    else if (act === 'campaign') opts.onCampaign();
    else if (act === 'play') {
      const level = resume ?? CAMPAIGN[0]!;
      opts.onPlay(level, progress.lastDifficulty);
    }
  });

  return {
    destroy(): void {
      el.remove();
    },
  };
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
    `<p class="hm-pitch">A tower defense for your browser. Hold the line through three sectors, ` +
    `or race a friend on the same seed and see who survives longer.</p>` +
    `<div class="hm-actions">` +
    `<button class="hm-primary" data-act="play">Start ${first.name} →</button>` +
    `<button class="hm-ghost" data-act="race">Race a friend</button>` +
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
    `<p class="hm-pitch">Hold the line through three sectors — or race a friend on the same ` +
    `seed and see who survives longer.</p></div>` +
    cont +
    `<div class="hm-cards">` +
    `<button class="hm-card" data-act="campaign"><h2>Campaign</h2>` +
    `<p>${CAMPAIGN.length} sectors</p>` +
    `<span class="hm-score">${cleared} held${best === null ? '' : ` <em>· best ${best}</em>`}</span>` +
    `</button>` +
    `<button class="hm-card hm-race" data-act="race" id="hm-race">` +
    `<h2>Race <i class="hm-relay" id="hm-relay" title="Checking the relay">·</i></h2>` +
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
