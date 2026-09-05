/**
 * The front door: campaign level select and difficulty.
 *
 * Built the same way as `lobbyScreen.ts` — one injected stylesheet, one root
 * element, and each state a function that rewrites `innerHTML` and rewires its
 * own listeners. Full rewrites rather than toggling visibility because these
 * screens are small, mutually exclusive, and each has its own listeners; the
 * alternative is a growing set of `.hidden` rules and stale handlers.
 *
 * The screen renders progress but never decides it. Which levels are open comes
 * from `app/progress.ts`, which derives it from results — so this file has no
 * opinion about unlocking and cannot disagree with the stored record.
 */

import { CAMPAIGN, type LevelDef } from '../content/levels.ts';
import { boardFacts, boardThumb } from './boardThumb.ts';
import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyId } from '../content/difficulty.ts';
import {
  furthestUnlocked,
  isUnlocked,
  levelRecord,
  loadProgress,
  rememberLaunch,
  type Progress,
} from '../app/progress.ts';

export interface MenuOptions {
  /** A blank seed means "pick one" — resolution stays in main.ts. */
  onLaunch(level: LevelDef, difficulty: DifficultyId, seed: string): void;
  onRace(): void;
  /** Escape — back to the home screen this was reached from. */
  onBack(): void;
}

export interface MenuScreen {
  remove(): void;
}

const STYLE = `
#menu-screen{position:absolute;inset:0;z-index:10;background:#0b0c16;
  overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
  overscroll-behavior:contain;
  padding-bottom:calc(env(safe-area-inset-bottom, 0px) + var(--kb, 0px));
  color:#e9e9ed;font:400 14px/1.5 Inter,system-ui,sans-serif}
#menu-screen .mn-glow{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(circle at 50% 40%,rgba(145,132,217,.14),rgba(6,7,13,.6) 62%)}
#menu-screen .mn-bar{position:relative;display:flex;align-items:center;gap:14px;height:52px;padding:0 40px}
#menu-screen .mn-brand{font:600 10.5px/1 Inter,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#9184d9}
#menu-screen .mn-sep{width:1px;height:14px;background:rgba(233,233,237,.16)}
#menu-screen .mn-sub{font:400 10.5px/1 Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#75798c}
#menu-screen .mn-right{margin-left:auto;display:flex;align-items:center;gap:16px}
#menu-screen .mn-body{position:relative;display:flex;flex-direction:column;align-items:center;
  gap:34px;padding:44px 48px 64px}
#menu-screen .mn-head{display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center}
#menu-screen .mn-kicker{font:600 10px/1 Inter,sans-serif;letter-spacing:.24em;text-transform:uppercase;color:#b5abfc}
#menu-screen .mn-title{font:500 56px/1.05 Inter,sans-serif;letter-spacing:-.03em;margin:0}
#menu-screen .mn-lede{font:400 14px/1.7 Inter,sans-serif;color:#9397ab;max-width:520px;text-wrap:pretty;margin:0}

#menu-screen .mn-cards{display:flex;gap:20px;flex-wrap:wrap;justify-content:center}
#menu-screen .mn-card{position:relative;display:flex;flex-direction:column;gap:14px;width:min(304px,88vw);
  padding:22px;border-radius:12px;background:rgba(20,22,36,.82);
  box-shadow:inset 0 0 0 1px rgba(233,233,237,.1);text-align:left;cursor:pointer;
  border:none;color:inherit;font:inherit}
#menu-screen .mn-card:hover{box-shadow:inset 0 0 0 1px rgba(145,132,217,.55),0 0 30px rgba(145,132,217,.14)}
#menu-screen .mn-card.locked{cursor:not-allowed;opacity:.5}
#menu-screen .mn-card.locked:hover{box-shadow:inset 0 0 0 1px rgba(233,233,237,.1)}
#menu-screen .mn-card-top{display:flex;align-items:flex-start;gap:10px}
#menu-screen .mn-card-name{font:500 22px/1.15 Inter,sans-serif;letter-spacing:-.01em;margin:0}
/* Hidden on desktop, where the card's blurb lives in the name's tooltip and
   the 62px it used to occupy was deliberately reclaimed. Shown on touch, which
   has no tooltip to read it from. Same for the difficulty blurb. */
#menu-screen .mn-card-blurb,
#menu-screen .mn-diff-blurb{display:none;margin:0}
@media (pointer: coarse){
  #menu-screen .mn-card-blurb{display:block;font:400 12.5px/1.65 Inter,sans-serif;color:#9397ab}
  #menu-screen .mn-diff-blurb{display:block;font:400 12px/1.6 Inter,sans-serif;color:#75798c}
}
#menu-screen .mn-facts{display:flex;gap:14px;font:400 11px/1 Inter,sans-serif;color:#75798c}
#menu-screen .mn-facts b{font-weight:600;color:#cfd3e5}
#menu-screen .mn-rule{height:1px;background:linear-gradient(90deg,rgba(233,233,237,.14),transparent)}
#menu-screen .mn-bests{display:flex;gap:6px;flex-wrap:wrap;min-height:24px;align-items:center}
#menu-screen .mn-best{display:flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:6px;
  background:rgba(35,37,50,.8);font:400 10.5px/1 Inter,sans-serif;color:#9397ab}
#menu-screen .mn-best b{font:600 11px/1 ui-monospace,Menlo,monospace;color:#d2cefd}
#menu-screen .mn-none{font:400 11px/1 Inter,sans-serif;color:#5d6070;font-style:italic}
#menu-screen .mn-lock{display:flex;align-items:center;gap:7px;font:400 11.5px/1.4 Inter,sans-serif;color:#75798c}

#menu-screen .mn-seg{display:flex;flex-direction:column;gap:9px;width:min(452px,90vw)}
#menu-screen .mn-opt{display:flex;flex-direction:column;gap:5px;padding:14px 16px;border-radius:9px;
  background:rgba(20,22,36,.82);box-shadow:inset 0 0 0 1px rgba(233,233,237,.1);cursor:pointer;
  border:none;color:inherit;font:inherit;text-align:left}
#menu-screen .mn-opt:hover{box-shadow:inset 0 0 0 1px rgba(145,132,217,.4)}
#menu-screen .mn-opt.on{box-shadow:inset 0 0 0 1px rgba(145,132,217,.75);background:rgba(145,132,217,.1)}
#menu-screen .mn-opt-top{display:flex;align-items:center;gap:10px}
#menu-screen .mn-opt-name{font:600 14px/1 Inter,sans-serif;color:#e9e9ed}
#menu-screen .mn-opt-meta{margin-left:auto;font:400 11px/1 ui-monospace,Menlo,monospace;color:#75798c}
#menu-screen .mn-opt-blurb{font:400 12px/1.6 Inter,sans-serif;color:#9397ab;margin:0}

#menu-screen .mn-col{display:flex;flex-direction:column;gap:22px;width:min(452px,90vw);align-items:stretch}
#menu-screen .mn-label{font:600 10px/1 Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#75798c}
#menu-screen .mn-field{display:flex;align-items:center;height:44px;padding:0 14px;border-radius:8px;
  background:rgba(35,37,50,.72);box-shadow:inset 0 0 0 1px rgba(233,233,237,.16);border:none;outline:none;
  font:400 15px/1 Inter,sans-serif;color:#e9e9ed;width:100%;box-sizing:border-box}
#menu-screen .mn-field:focus{box-shadow:inset 0 0 0 1px rgba(145,132,217,.6)}
/* 16px or iOS zooms the page on focus and never zooms back. See raceTheme.ts. */
@media (pointer: coarse) { #menu-screen .mn-field{font-size:16px;height:52px} }
#menu-screen .mn-fine{font:400 11.5px/1.6 Inter,sans-serif;color:#5d6070;margin:0}
#menu-screen .mn-btn{display:flex;align-items:center;justify-content:center;height:46px;padding:0 20px;
  border:1px solid #9184d9;border-radius:8px;background:none;cursor:pointer;
  font:600 14px/1 Inter,sans-serif;color:#d2cefd;box-shadow:0 0 22px rgba(145,132,217,.2)}
#menu-screen .mn-btn:hover{background:rgba(145,132,217,.12)}
#menu-screen .mn-btn.dim{border-color:rgba(233,233,237,.18);color:#cfd3e5;box-shadow:none}
#menu-screen .mn-btn.ghost{border:none;color:#75798c;box-shadow:none;height:auto;padding:6px;
  font:400 12px/1 Inter,sans-serif;align-self:center}
#menu-screen .mn-btn.ghost:hover{color:#cfd3e5;background:none}
#menu-screen .mn-row{display:flex;gap:12px}
#menu-screen .mn-row .mn-btn{flex:1}
#menu-screen .mn-hex{width:26px;height:26px;flex:none}

/* The board itself, at the top of its own card. A locked sector shows it
   dimmed rather than hidden: you can see what you are working toward. */
#menu-screen .mn-thumb{margin:-6px -6px 2px;border-radius:8px;overflow:hidden;line-height:0}
#menu-screen .mn-thumb svg{width:100%;height:auto;display:block}
#menu-screen .mn-card.locked .mn-thumb{opacity:.55}

/* Best grade as ONE badge. Three per-difficulty pills were a table pretending
   to be a chip set; the breakdown lives in the tooltip, where you look it up
   rather than scan it. */
#menu-screen .mn-grade{margin-left:auto;display:grid;place-items:center;width:28px;height:28px;
  border-radius:7px;background:rgba(145,132,217,.14);
  font:600 14px/1 ui-monospace,Menlo,monospace;color:#d2cefd;flex:none}
#menu-screen .mn-grade.none{background:rgba(35,37,50,.7);color:#4b4e5e}

/* Difficulty on the card, so it is the same click as the launch — it used to
   cost a whole second screen to choose the option almost always chosen the
   same way. Numerals, not blurbs; the blurb is the tooltip. */
#menu-screen .mn-seg.tight{flex-direction:row;gap:6px;width:auto}
#menu-screen .mn-diff{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;
  padding:7px 4px;border-radius:7px;border:none;cursor:pointer;
  background:rgba(35,37,50,.7);color:#9397ab;font:600 11px/1 Inter,sans-serif}
#menu-screen .mn-diff em{font:400 9.5px/1 Inter,sans-serif;font-style:normal;color:#5d6070}
#menu-screen .mn-diff:hover{color:#e9e9ed}
#menu-screen .mn-diff.on{background:rgba(145,132,217,.2);color:#e9e9ed;
  box-shadow:inset 0 0 0 1px rgba(145,132,217,.6)}
#menu-screen .mn-diff.on em{color:#b5abfc}

#menu-screen .mn-card .mn-btn{height:38px;font-size:13px}
#menu-screen .mn-seedrow{display:flex;align-items:center;gap:14px}
#menu-screen .mn-seedbox{width:min(452px,90vw)}
#menu-screen .mn-keys{font:400 10.5px/1 Inter,sans-serif;color:#4b4e5e;letter-spacing:.04em}
/* The keyboard cursor. Without a visible mark, arrow keys move something the
   player cannot see, which is worse than not supporting them. */
#menu-screen .mn-card.cursor{box-shadow:inset 0 0 0 2px rgba(145,132,217,.8),
  0 0 34px rgba(145,132,217,.2)}
#menu-screen:focus{outline:none}
#menu-screen :focus-visible{outline:2px solid #9184d9;outline-offset:2px;border-radius:8px}
`;

/**
 * `hexSvg` is gone: a generic hexagon was standing in for a board nobody could
 * see. The card draws the actual route now, which is both more specific and the
 * thing the player is choosing between.
 */

const lockSvg = (): string =>
  `<svg class="mn-hex" viewBox="0 0 40 40" aria-hidden="true">` +
  `<rect x="10" y="18" width="20" height="15" rx="3" fill="none" stroke="#75798c" stroke-width="2.4"/>` +
  `<path d="M15 18 v-4 a5 5 0 0 1 10 0 v4" fill="none" stroke="#75798c" stroke-width="2.4"/></svg>`;

/** Anything that reaches innerHTML and did not come from this file. */
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const clock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function createMenuScreen(parent: HTMLElement, opts: MenuOptions): MenuScreen {
  if (!document.getElementById('menu-style')) {
    const style = document.createElement('style');
    style.id = 'menu-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const el = document.createElement('div');
  el.id = 'menu-screen';
  parent.appendChild(el);

  const progress: Progress = loadProgress();
  let chosen = 0;
  let difficulty: DifficultyId = progress.lastDifficulty;


  const bar = (sub: string): string =>
    `<div class="mn-bar"><span class="mn-brand">Deep Field</span>` +
    `<span class="mn-sep"></span><span class="mn-sub">${esc(sub)}</span>` +
    `<span class="mn-right"><span class="mn-keys">↑↓ sector · 1–3 difficulty · ↵ launch</span>` +
    `<button class="mn-btn ghost" id="mn-race">Race a friend →</button></span></div>`;

  function wireBar(): void {
    el.querySelector('#mn-race')?.addEventListener('click', () => opts.onRace());
  }

  /**
   * The best grade across every difficulty, as **one** badge.
   *
   * It used to be a pill per difficulty — "Standard A 14/20 · 4:38" — three of
   * them stacking. Three pills is a table pretending to be a chip set: it costs
   * a 62px block to say something a single letter says, and the per-difficulty
   * breakdown is a thing you look up, not a thing you scan.
   */
  function bestBadge(level: LevelDef): string {
    const rec = levelRecord(progress, level.id);
    const order: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };
    let best: string | null = null;
    const detail: string[] = [];

    for (const d of DIFFICULTY_ORDER) {
      const b = rec.best[d];
      if (b === undefined) continue;
      detail.push(`${DIFFICULTIES[d].name} ${b.grade} · ${b.lives}/${b.startingLives} · ${clock(b.seconds)}`);
      if (best === null || (order[b.grade] ?? 9) < (order[best] ?? 9)) best = b.grade;
    }

    return best === null
      ? `<span class="mn-grade none" title="No clear recorded">—</span>`
      : `<span class="mn-grade" title="${esc(detail.join('\n'))}">${esc(best)}</span>`;
  }

  /**
   * One screen: every sector, its board, and the difficulty in the same click
   * as the launch.
   *
   * The picker used to spend a 62px block of prose per card describing a shape,
   * then send the player to a *second* screen to choose a difficulty they
   * almost always choose the same way. The board is drawn now, the blurb is a
   * tooltip, and Launch is on the card.
   *
   * A locked sector shows its board **dimmed rather than hidden** — you can see
   * what you are working toward, which is the point of having it on screen at
   * all — and says "Hold X to open", because the game says *held* everywhere
   * else ("Sector held", "Waves held"). One verb.
   */
  function showLevels(): void {
    const cleared = CAMPAIGN.filter((l) => levelRecord(progress, l.id).cleared).length;

    const cards = CAMPAIGN.map((level, i) => {
      const open = isUnlocked(progress, i);
      const prev = CAMPAIGN[i - 1];
      const facts = boardFacts(level.map);

      const diffs = DIFFICULTY_ORDER.map((id) => {
        const d = DIFFICULTIES[id];
        return (
          `<button class="mn-diff${id === difficulty ? ' on' : ''}" data-d="${id}" data-i="${i}"` +
          ` title="${esc(d.blurb)}">${esc(d.name)}` +
          `<em>${d.startingLives} lives</em></button>`
        );
      }).join('');

      return (
        `<div class="mn-card${open ? '' : ' locked'}${open && i === chosen ? ' cursor' : ''}">` +
        `<div class="mn-thumb">${boardThumb(level.map, 256, !open)}</div>` +
        `<div class="mn-card-top"><div><div class="mn-kicker">${esc(level.kicker)}</div>` +
        // The blurb moves to a tooltip: good writing about a shape the player
        // can now simply see. It comes back as text on touch, where there is no
        // tooltip to move it to — .mn-card-blurb has been sitting unused in the
        // stylesheet since that change.
        `<h2 class="mn-card-name" title="${esc(level.blurb)}">${esc(level.name)}</h2></div>` +
        `${open ? bestBadge(level) : lockSvg()}</div>` +
        `<p class="mn-card-blurb">${esc(level.blurb)}</p>` +
        `<div class="mn-facts"><span><b>${level.waves.length}</b> waves</span>` +
        `<span><b>${facts.road}</b> road</span>` +
        // Lanes only where there is more than one. A card reading "1 lane" is
        // noise on the boards that have always had one, and the numeral is only
        // interesting as the thing that makes the back half of the campaign
        // different from the front.
        (facts.lanes > 1
          ? `<span><b>${facts.lanes}</b> lanes</span>`
          : `<span><b>${facts.turns}</b> turns</span>`) +
        `</div>` +
        (open
          ? `<div class="mn-seg tight">${diffs}</div>` +
            // The selected difficulty explains itself in words, mirroring how
            // the targeting control labels only its active mode.
            `<p class="mn-diff-blurb">${esc(DIFFICULTIES[difficulty].blurb)}</p>` +
            `<button class="mn-btn" data-launch="${i}">Launch →</button>`
          : `<div class="mn-lock">Hold ${esc(prev?.name ?? '')} to open</div>`) +
        `</div>`
      );
    }).join('');

    const seedRow =
      progress.lastSeed === undefined
        ? `<button class="mn-btn ghost" id="mn-seed-open">Set a seed</button>` +
          `<span class="mn-fine">same seed, same waves</span>`
        : `<button class="mn-btn ghost" id="mn-seed-open">Set a seed</button>` +
          `<button class="mn-btn ghost" id="mn-replay">Replay last board</button>`;

    el.innerHTML =
      `<div class="mn-glow"></div>` +
      bar('Campaign') +
      `<div class="mn-body"><div class="mn-head">` +
      `<span class="mn-kicker">Single player</span>` +
      `<h1 class="mn-title">Choose a sector</h1>` +
      `<p class="mn-lede">${CAMPAIGN.length} boards, each asking a different question of the same five ` +
      `stations. The last five split the road, so covering it is no longer one decision. ` +
      `${cleared} of ${CAMPAIGN.length} held.</p></div>` +
      `<div class="mn-cards">${cards}</div>` +
      // Collapsed by default. An advanced field had permanent primary space and
      // thirty-one words of justification, in the path of every launch.
      `<div class="mn-seedrow">${seedRow}</div>` +
      `<div class="mn-seedbox" id="mn-seedbox" hidden>` +
      `<input class="mn-field" id="mn-seed" placeholder="blank for a random board" ` +
      `autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off" ` +
      `enterkeyhint="go" aria-label="Seed"/></div>` +
      `</div>`;

    wireBar();

    for (const b of el.querySelectorAll<HTMLElement>('.mn-diff')) {
      b.addEventListener('click', () => {
        difficulty = b.dataset['d'] as DifficultyId;
        showLevels();
      });
    }
    for (const b of el.querySelectorAll<HTMLElement>('[data-launch]')) {
      b.addEventListener('click', () => launch(Number(b.dataset['launch'])));
    }
    el.querySelector('#mn-seed-open')?.addEventListener('click', () => {
      const box = el.querySelector<HTMLElement>('#mn-seedbox');
      if (box === null) return;
      box.hidden = !box.hidden;
      if (!box.hidden) el.querySelector<HTMLInputElement>('#mn-seed')?.focus();
    });
    el.querySelector('#mn-replay')?.addEventListener('click', () => {
      launch(chosen, progress.lastSeed ?? '');
    });
  }

  /** Blank still means random, and a typed seed still reproduces exactly. */
  function launch(index: number, forced?: string): void {
    const level = CAMPAIGN[index];
    if (level === undefined) return;
    const seed = forced ?? el.querySelector<HTMLInputElement>('#mn-seed')?.value.trim() ?? '';
    chosen = index;
    rememberLaunch(difficulty, seed);
    opts.onLaunch(level, difficulty, seed);
  }


  /**
   * The front door was the one mouse-only screen in the game.
   *
   * The in-game HUD is fully keyboard-driven — hotkeys arm stations, Esc
   * cancels, Tab toggles the deck — and then launching a run required a
   * pointer. Arrows move the sector cursor, 1–3 pick a difficulty, Enter
   * launches, Esc goes back.
   *
   * Bound on the element rather than the document so it dies with the screen,
   * and skipped while a text field has focus — otherwise typing "3" into the
   * seed box would silently change the difficulty.
   */
  function onKey(ev: KeyboardEvent): void {
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (ev.key === 'Enter') launch(chosen);
      if (ev.key === 'Escape') (ev.target as HTMLElement).blur();
      return;
    }

    const open = CAMPAIGN.map((_, i) => i).filter((i) => isUnlocked(progress, i));
    if (open.length === 0) return;
    const at = Math.max(0, open.indexOf(chosen));

    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        chosen = open[(at + 1) % open.length]!;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        chosen = open[(at - 1 + open.length) % open.length]!;
        break;
      case '1':
      case '2':
      case '3': {
        const pick = DIFFICULTY_ORDER[Number(ev.key) - 1];
        if (pick === undefined) return;
        difficulty = pick;
        break;
      }
      case 'Enter':
        ev.preventDefault();
        launch(chosen);
        return;
      case 'Escape':
        ev.preventDefault();
        // Back to the home screen, which is where this screen was reached from.
        opts.onBack();
        return;
      default:
        return;
    }

    ev.preventDefault();
    showLevels();
  }

  el.tabIndex = -1;
  el.addEventListener('keydown', onKey);

  chosen = furthestUnlocked(progress);
  showLevels();
  el.focus();

  return {
    remove() {
      el.remove();
      document.getElementById('menu-style')?.remove();
    },
  };
}
