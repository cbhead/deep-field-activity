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
import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyId } from '../content/difficulty.ts';
import { parseMap } from '../sim/util/grid.ts';
import {
  furthestUnlocked,
  isUnlocked,
  levelRecord,
  loadProgress,
  rememberDifficulty,
  resetProgress,
  type Progress,
} from '../app/progress.ts';

export interface MenuOptions {
  /** A blank seed means "pick one" — resolution stays in main.ts. */
  onLaunch(level: LevelDef, difficulty: DifficultyId, seed: string): void;
  onRace(): void;
}

export interface MenuScreen {
  remove(): void;
}

const STYLE = `
#menu-screen{position:absolute;inset:0;z-index:10;overflow-y:auto;background:#0b0c16;
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
#menu-screen .mn-card-blurb{font:400 12.5px/1.65 Inter,sans-serif;color:#9397ab;margin:0;min-height:62px}
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
`;

const hexSvg = (color: string, dim = false): string =>
  `<svg class="mn-hex" viewBox="0 0 40 40" aria-hidden="true" style="filter:drop-shadow(0 0 6px ${color}73)">` +
  `<path d="M20 3 L34 11 L34 29 L20 37 L6 29 L6 11 Z" fill="${color}" fill-opacity="${dim ? '.12' : '.2'}" ` +
  `stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>` +
  `<circle cx="20" cy="20" r="5.5" fill="${color}"${dim ? ' fill-opacity=".5"' : ''}/></svg>`;

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
  parent.style.position = 'relative';
  parent.appendChild(el);

  let progress: Progress = loadProgress();
  let chosen = 0;
  let difficulty: DifficultyId = progress.lastDifficulty;

  // Road length is a genuine fact about a board and the honest way to get it is
  // to parse it. Cached because parseMap walks every tile and the level list
  // re-renders on every navigation.
  const roadCache = new Map<string, number>();
  const roadLength = (level: LevelDef): number => {
    let hit = roadCache.get(level.id);
    if (hit === undefined) {
      hit = Math.round(parseMap(level.map).pathLength);
      roadCache.set(level.id, hit);
    }
    return hit;
  };

  const bar = (sub: string): string =>
    `<div class="mn-bar"><span class="mn-brand">Deep Field</span>` +
    `<span class="mn-sep"></span><span class="mn-sub">${esc(sub)}</span>` +
    `<span class="mn-right"><button class="mn-btn ghost" id="mn-race">Race a friend →</button></span></div>`;

  function wireBar(): void {
    el.querySelector('#mn-race')?.addEventListener('click', () => opts.onRace());
  }

  function bestsFor(level: LevelDef): string {
    const rec = levelRecord(progress, level.id);
    const pills = DIFFICULTY_ORDER.filter((d) => rec.best[d] !== undefined).map((d) => {
      const b = rec.best[d]!;
      return (
        `<span class="mn-best">${esc(DIFFICULTIES[d].name)} <b>${esc(b.grade)}</b> ` +
        `${b.lives}/${b.startingLives} · ${clock(b.seconds)}</span>`
      );
    });
    return pills.length > 0
      ? pills.join('')
      : `<span class="mn-none">No clear recorded</span>`;
  }

  function showLevels(): void {
    const cleared = CAMPAIGN.filter((l) => levelRecord(progress, l.id).cleared).length;

    const cards = CAMPAIGN.map((level, i) => {
      const open = isUnlocked(progress, i);
      const prev = CAMPAIGN[i - 1];
      const body = open
        ? `<div class="mn-bests">${bestsFor(level)}</div>`
        : `<div class="mn-lock">${lockSvg()}<span>Clear ${esc(prev?.name ?? '')} to open this sector</span></div>`;

      return (
        `<button class="mn-card${open ? '' : ' locked'}" data-i="${i}"${open ? '' : ' disabled'}>` +
        `<div class="mn-card-top">${open ? hexSvg('#9184d9') : lockSvg()}` +
        `<div><div class="mn-kicker">${esc(level.kicker)}</div>` +
        `<h2 class="mn-card-name">${esc(level.name)}</h2></div></div>` +
        `<p class="mn-card-blurb">${esc(level.blurb)}</p>` +
        `<div class="mn-facts"><span><b>${level.waves.length}</b> waves</span>` +
        `<span><b>${roadLength(level)}</b> tiles of road</span></div>` +
        `<div class="mn-rule"></div>${body}</button>`
      );
    }).join('');

    el.innerHTML =
      `<div class="mn-glow"></div>` +
      bar('Campaign') +
      `<div class="mn-body"><div class="mn-head">` +
      `<span class="mn-kicker">Single player</span>` +
      `<h1 class="mn-title">Choose a sector</h1>` +
      `<p class="mn-lede">Three boards, each asking a different question of the same three stations. ` +
      `Clear one to open the next — ${cleared} of ${CAMPAIGN.length} held so far.</p></div>` +
      `<div class="mn-cards">${cards}</div>` +
      (cleared > 0 ? `<button class="mn-btn ghost" id="mn-reset">Reset campaign progress</button>` : '') +
      `</div>`;

    wireBar();
    for (const card of el.querySelectorAll<HTMLElement>('.mn-card:not(.locked)')) {
      card.addEventListener('click', () => {
        chosen = Number(card.dataset['i']);
        showLaunch();
      });
    }
    el.querySelector('#mn-reset')?.addEventListener('click', () => {
      resetProgress();
      progress = loadProgress();
      showLevels();
    });
  }

  function showLaunch(): void {
    const level = CAMPAIGN[chosen]!;
    const rec = levelRecord(progress, level.id);

    const options = DIFFICULTY_ORDER.map((id) => {
      const d = DIFFICULTIES[id];
      const b = rec.best[id];
      return (
        `<button class="mn-opt${id === difficulty ? ' on' : ''}" data-d="${id}">` +
        `<div class="mn-opt-top"><span class="mn-opt-name">${esc(d.name)}</span>` +
        `<span class="mn-opt-meta">${d.startingLives} lives${b !== undefined ? ` · best ${esc(b.grade)}` : ''}</span></div>` +
        `<p class="mn-opt-blurb">${esc(d.blurb)}</p></button>`
      );
    }).join('');

    el.innerHTML =
      `<div class="mn-glow"></div>` +
      bar(level.kicker) +
      `<div class="mn-body"><div class="mn-head">` +
      `<span class="mn-kicker">${esc(level.kicker)}</span>` +
      `<h1 class="mn-title">${esc(level.name)}</h1>` +
      `<p class="mn-lede">${esc(level.blurb)}</p></div>` +
      `<div class="mn-col"><span class="mn-label">Difficulty</span>` +
      `<div class="mn-seg">${options}</div>` +
      `<div><span class="mn-label">Seed</span>` +
      `<input class="mn-field" id="mn-seed" placeholder="leave blank for a random board" ` +
      `autocomplete="off" spellcheck="false" style="margin-top:9px"/>` +
      `<p class="mn-fine">The same seed always produces the same waves — worth setting if you want ` +
      `to retry a run you just lost, or hand a friend the exact board that beat you.</p></div>` +
      `<div class="mn-row"><button class="mn-btn dim" id="mn-back">Back</button>` +
      `<button class="mn-btn" id="mn-launch">Launch</button></div>` +
      `</div></div>`;

    wireBar();

    const launch = (): void => {
      const seed = el.querySelector<HTMLInputElement>('#mn-seed')?.value.trim() ?? '';
      rememberDifficulty(difficulty);
      opts.onLaunch(level, difficulty, seed);
    };

    for (const opt of el.querySelectorAll<HTMLElement>('.mn-opt')) {
      opt.addEventListener('click', () => {
        difficulty = opt.dataset['d'] as DifficultyId;
        showLaunch();
      });
    }
    el.querySelector('#mn-back')!.addEventListener('click', () => showLevels());
    el.querySelector('#mn-launch')!.addEventListener('click', launch);
    el.querySelector('#mn-seed')!.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') launch();
    });
  }

  chosen = furthestUnlocked(progress);
  showLevels();

  return {
    remove() {
      el.remove();
      document.getElementById('menu-style')?.remove();
    },
  };
}
