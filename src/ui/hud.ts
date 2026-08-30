import { BALANCE } from '../content/balance.ts';
import { TOWERS, TOWER_IDS, type TowerId } from '../content/towers.ts';
import type { TowerStats } from '../content/types.ts';
import { ENEMIES, type EnemyId } from '../content/enemies.ts';
import type { UiState } from '../app/uiState.ts';
import {
  describeGaps,
  coverage,
  formatClock,
  grade,
  nextGradeHint,
  toughestArmour,
  formatDamage,
} from '../sim/analysis.ts';
import { sellValue, upgradeCost, isUnlocked, nextStats, visualTier } from '../sim/build.ts';
import { planWave, waveCount } from '../sim/wavePlan.ts';
import {
  TARGET_MODES,
  UPGRADE_PATHS,
  type Command,
  type SimEvent,
  type TargetMode,
  type Tower,
  type UpgradePath,
} from '../sim/types.ts';
import { effectiveDamage } from '../sim/damage.ts';
import { towerById, type World } from '../sim/world.ts';
import { collarDial, contactIcon, pathDial, stationIcon, tierPips } from './icons.ts';

/**
 * DOM, not Pixi.
 *
 * A tower defense HUD is 90% text. In Pixi that means bitmap fonts and
 * hand-computed layout; in DOM it is flexbox and it is done. The boundary is
 * world-anchored visuals (ghosts, reach circles, health bars) in Pixi,
 * screen-anchored chrome here.
 *
 * **Rendering strategy.** The HUD updates at 10Hz, and at this size guarding
 * every individual text node by hand stops being maintainable. Instead each
 * region computes a short *key* describing everything it displays; when the key
 * is unchanged the region is skipped entirely, and when it changes the new
 * markup is *morphed* onto the live DOM — only the nodes that actually differ
 * are touched, and everything else keeps its identity. That last part is a
 * playability requirement, not an optimisation: the deck's key changes on
 * every kill and every timer second, and a wholesale `innerHTML` rebuild that
 * lands between a player's mouse-down and mouse-up destroys the button they
 * are pressing — the browser then fires no click at all, and the control feels
 * dead until they mash it. Morphing keeps the pressed element alive through
 * the update, along with its `:hover`/`:active` states.
 *
 * Because regions render from strings, nothing binds listeners to their
 * contents. One delegated click handler on the root reads `data-act`, so
 * controls need no re-binding no matter how the DOM is patched.
 */
export interface HudPorts {
  world: World;
  ui: UiState;
  dispatch(cmd: Command): void;
  /** Live view of the loop's speed and pause flag; the HUD writes both. */
  speed: { get(): number; set(v: number): void };
  togglePause(): void;
  restart(): void;

  /**
   * Campaign navigation, absent in Race mode.
   *
   * Optional because the end-of-run cards are shared: Race reaches the same
   * defeat and victory screens, and there is no campaign to go back to from
   * one. When this is absent the cards render exactly as they always did.
   */
  campaign?: CampaignPorts;
}

export interface CampaignPorts {
  /** Back to the level select. */
  menu(): void;
  /** The following level's name, or null when this one ends the campaign. */
  nextName: string | null;
  /** Start the following level at the same difficulty. */
  next(): void;
}

export interface Hud {
  /** Call at ~10Hz, not 60. Regions with an unchanged key do no work. */
  update(): void;
  /** Fed from the single event drain in main.ts. */
  onEvent(ev: SimEvent): void;
}

const SPEEDS = [1, 2, 4];
const TARGET_LABEL: Record<TargetMode, string> = {
  first: 'First',
  last: 'Last',
  strong: 'Strong',
  close: 'Close',
};

/** Direction of travel for first/last, mass for strong, proximity for close. */
const TARGET_GLYPH: Record<TargetMode, string> = {
  first: '▶',
  last: '◀',
  strong: '▲',
  close: '◎',
};

/** How long the wave-cleared summary stays up, in ms of wall clock. */
const CLEAR_TOAST_MS = 3200;
/**
 * The breach banner is deliberately shorter-lived than the clear summary: it is
 * an alarm, not a report, and one that outstayed the moment would still be on
 * screen during the next leak.
 */
const BREACH_TOAST_MS = 1600;

export function createHud(root: HTMLElement, ports: HudPorts): Hud {
  const { world: w, ui } = ports;

  root.innerHTML =
    '<div class="top"></div><div class="deck"></div><div class="overlay"></div>';
  const topEl = root.querySelector<HTMLElement>('.top')!;
  const deckEl = root.querySelector<HTMLElement>('.deck')!;
  const overlayEl = root.querySelector<HTMLElement>('.overlay')!;

  const top = region(topEl);
  const deck = region(deckEl);
  const overlay = region(overlayEl);

  /** Latest wave-cleared summary, and when it expires. */
  let clearToast: Extract<SimEvent, { type: 'waveCleared' }> | null = null;
  let clearToastUntil = 0;
  /** Lives remaining at the moment of the most recent leak, and its expiry. */
  let breachLives = 0;
  let breachUntil = 0;

  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (el === null) return;
    act(el.dataset['act']!, el.dataset);
    // Reflect the press now, not at the next 10Hz tick: a button whose state
    // change shows up 100ms later reads as a button that didn't take.
    update();
  });

  function act(action: string, data: DOMStringMap): void {
    switch (action) {
      case 'arm': {
        const id = data['id'] as TowerId;
        ui.selected = ui.selected === id ? null : id;
        if (ui.selected !== null) ui.inspecting = null;
        break;
      }
      case 'send':
        ports.dispatch({ type: 'startWave' });
        break;
      case 'deck':
        ui.deckOpen = !ui.deckOpen;
        break;
      case 'speed':
        ports.speed.set(Number(data['v']));
        break;
      case 'pause':
        ports.togglePause();
        break;
      case 'restart':
        ports.restart();
        break;
      case 'menu':
        ports.campaign?.menu();
        break;
      case 'next':
        ports.campaign?.next();
        break;
      case 'upgrade':
        if (ui.inspecting !== null) {
          ports.dispatch({
            type: 'upgradeTower',
            id: ui.inspecting,
            path: data['path'] as UpgradePath,
          });
        }
        break;
      case 'sell':
        if (ui.inspecting !== null) {
          ports.dispatch({ type: 'sellTower', id: ui.inspecting });
          ui.inspecting = null;
        }
        break;
      case 'target':
        if (ui.inspecting !== null) {
          ports.dispatch({
            type: 'setTargeting',
            id: ui.inspecting,
            mode: data['mode'] as TargetMode,
          });
        }
        break;
      case 'pref-reach':
        ui.prefs.reachCircles = data['v'] === 'always' ? 'always' : 'hover';
        break;
      case 'pref-damage':
        ui.prefs.damageNumbers = data['v'] === 'on';
        break;
      case 'pref-stream':
        ui.prefs.stream = data['v'] === 'on';
        break;
    }
  }

  function update(): void {
    const inspected = ui.inspecting === null ? undefined : towerById(w, ui.inspecting);
    if (inspected === undefined && ui.inspecting !== null) ui.inspecting = null;

    const now = performance.now();
    const toastLive = clearToast !== null && now < clearToastUntil;
    const breachLive = now < breachUntil;

    top(topKey(w, ports.speed.get(), ui.paused), () => renderTop(w, ports.speed.get(), ui.paused));

    deck(deckKey(w, ui, inspected), () => renderDeck(w, ui, inspected));

    overlay(
      `${w.phase}|${ui.paused ? 'p' : ''}|${toastLive ? clearToast!.wave : ''}|${
        breachLive ? `b${breachLives}` : ''
      }`,
      () =>
        renderOverlay(w, ui, toastLive ? clearToast : null, breachLive ? breachLives : null, ports.campaign),
    );
  }

  return {
    onEvent(ev) {
      if (ev.type === 'waveCleared') {
        clearToast = ev;
        clearToastUntil = performance.now() + CLEAR_TOAST_MS;
      }
      if (ev.type === 'creepLeaked') {
        // Read lives here, not at render time: several can leak inside one
        // frame and the banner should name the count at the moment it fired.
        breachLives = w.lives;
        breachUntil = performance.now() + BREACH_TOAST_MS;
      }
      // A sold or destroyed station must not leave the inspector showing a
      // ghost. Cheaper and more reliable than having the inspector re-check.
      if (ev.type === 'towerSold' && ui.inspecting === ev.id) ui.inspecting = null;
    },

    update,
  };
}

/** A region that re-renders only when its key changes. */
function region(el: HTMLElement): (key: string, html: () => string) => void {
  let last: string | null = null;
  const tpl = document.createElement('template');
  return (key, html) => {
    if (key === last) return;
    last = key;
    tpl.innerHTML = html();
    morphChildren(el, tpl.content);
  };
}

/**
 * Make `el`'s children match `want`'s in place. Nodes are matched by position
 * and tag: a match is patched (attributes, text, then its own children), a
 * mismatch is replaced, and the tail is appended or trimmed. Positional
 * matching is deliberate — every region renders a fixed structure per key, so
 * an insertion cascade costs a few extra attribute writes, never correctness.
 */
function morphChildren(el: Node, want: Node): void {
  const have = el.childNodes;
  const wish = want.childNodes;
  for (let i = 0; i < wish.length; i++) {
    const w = wish[i]!;
    const h = have[i];
    if (h === undefined) {
      el.appendChild(w.cloneNode(true));
      continue;
    }
    const sameKind =
      h.nodeType === w.nodeType &&
      (h.nodeType !== Node.ELEMENT_NODE ||
        (h as Element).tagName === (w as Element).tagName);
    if (!sameKind) {
      el.replaceChild(w.cloneNode(true), h);
      continue;
    }
    if (w.nodeType === Node.ELEMENT_NODE) {
      morphAttrs(h as Element, w as Element);
      morphChildren(h, w);
    } else if (h.nodeValue !== w.nodeValue) {
      h.nodeValue = w.nodeValue;
    }
  }
  while (have.length > wish.length) el.removeChild(el.lastChild!);
}

function morphAttrs(h: Element, w: Element): void {
  for (const name of h.getAttributeNames()) {
    if (!w.hasAttribute(name)) h.removeAttribute(name);
  }
  for (const name of w.getAttributeNames()) {
    const v = w.getAttribute(name)!;
    if (h.getAttribute(name) !== v) h.setAttribute(name, v);
  }
}

// ---------------------------------------------------------------- top bar

function topKey(w: World, speed: number, paused: boolean): string {
  const s = w.wave;
  return [
    w.money,
    w.lives,
    s.clearedThrough,
    s.index,
    s.phase,
    Math.ceil(s.timer),
    aliveInWave(w, s.index),
    speed,
    paused,
  ].join('|');
}

function renderTop(w: World, speed: number, paused: boolean): string {
  const s = w.wave;
  const total = waveCount(w.rules);
  const cleared = Math.min(s.clearedThrough + 1, total);

  let label: string;
  let fill: number;
  if (s.phase === 'intermission') {
    label = `wave ${s.index + 1} · in ${Math.ceil(s.timer)}s`;
    fill = 1 - Math.max(0, s.timer) / BALANCE.intermission;
  } else if (s.phase === 'spawning') {
    // A contact glyph rather than the word "alive": the deck is teaching this
    // vocabulary two rows down, and one dot the player already recognises beats
    // a noun. Not three anonymous dots, which invite reading "3 alive".
    label =
      `wave ${s.index + 1} · <i class="dot contact"></i>${aliveInWave(w, s.index)}` +
      ` of ${s.plan.length}`;
    fill = s.plan.length === 0 ? 0 : s.spawned / s.plan.length;
  } else {
    label = 'last wave out';
    fill = 1;
  }

  // The alarm is the width of the screen rather than one red digit, because a
  // player at four lives is looking at the board, not at the stat cells — and
  // the collapsed deck's status strip, which used to carry this, is gone.
  //
  // The fill's *geometry* is untouched: `--ribbon` recolours it, so it still
  // reads as a progress value rather than as a second quantity. If it ever
  // starts reading as "42% doomed", drop `.crit` to a rim and border only and
  // leave the fill on the accent.
  const crit = w.lives <= BALANCE.critLives;

  const speeds = SPEEDS.map(
    (v) =>
      `<button data-act="speed" data-v="${v}" class="${v === speed ? 'on' : ''}">${v}×</button>`,
  ).join('');

  return (
    // No sigil. Costs lost theirs in the deck, and a currency mark repeated on
    // every price is a character the player has already agreed to.
    `<div class="stat"><label>Cash</label><b>${w.money}</b></div>` +
    `<div class="stat"><label>Lives</label><b class="${crit ? 'crit' : ''}">${w.lives}</b></div>` +
    `<div class="stat"><label>Waves held</label><b>${cleared} / ${total}</b></div>` +
    `<div class="ribbon${crit ? ' crit' : ''}"><span>${label}</span>` +
    `<i style="width:${(clamp01(fill) * 100).toFixed(1)}%"></i></div>` +
    `<div class="seg speeds">${speeds}</div>` +
    `<button class="icon" data-act="pause" title="Pause (Esc)">${paused ? '▶' : '❚❚'}</button>`
  );
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function aliveInWave(w: World, wave: number): number {
  let n = 0;
  for (const c of w.creeps) if (!c.dead && c.wave === wave) n++;
  return n;
}

// ------------------------------------------------------------------- deck

/**
 * A **constant** while the deck is closed, and that is the point.
 *
 * The closed deck is one static handle. It used to carry a live status strip
 * repeating the Incoming ribbon forty pixels above it, in the same words, in
 * space that belongs to the board — so the key folded in the alive count and
 * the whole region rebuilt on every kill to redraw text that had not changed
 * meaning. Two live readouts of one fact is one readout and one distraction,
 * and the duplicate was the one sitting on the play area.
 *
 * The early return is therefore load-bearing rather than an optimisation, and
 * it is a trapdoor: anything live added to the closed deck later will silently
 * freeze. `tools/check.ts` asserts the invariance.
 */
export function deckKey(w: World, ui: UiState, inspected: Tower | undefined): string {
  if (!ui.deckOpen) return 'c';

  const s = w.wave;
  return [
    'o',
    ui.selected ?? '-',
    inspected
      ? `${inspected.id}:${inspected.tiers.damage}${inspected.tiers.range}${inspected.tiers.effect}:${inspected.targeting}:${inspected.kills}`
      : '-',
    // Affordability of every slot, plus the two buttons the inspector prices.
    w.money,
    s.index,
    s.phase,
    Math.ceil(s.timer),
    // The inspector prices the armed station against this, and while the deck
    // is open nothing else in this key changes when the last Bulwark dies.
    inspected ? (toughestArmour(w)?.defId ?? '-') : '',
  ].join('|');
}

function renderDeck(w: World, ui: UiState, inspected: Tower | undefined): string {
  const handle =
    `<button class="handle" data-act="deck">Deck <span>${ui.deckOpen ? '▼' : '▲'}</span>` +
    `<kbd>Tab</kbd></button>`;

  if (!ui.deckOpen) {
    // The handle alone. Everything the strip used to say, the ribbon says
    // better and higher up; its one non-duplicate — the lives alarm — moved
    // there in `renderTop`.
    return `<div class="strip">${handle}</div>`;
  }

  return (
    `<div class="panel">` +
    `<section class="build"><h6>Build${ui.selected ? ' · armed' : ''}</h6>` +
    `<div class="slots">${renderSlots(w, ui)}</div></section>` +
    `<span class="sep"></span>` +
    `<section class="detail">${renderDetail(w, ui, inspected)}</section>` +
    `<span class="sep"></span>` +
    `<section class="send">${handle}${renderSend(w)}</section>` +
    `</div>`
  );
}

/**
 * The five build slots, in five states.
 *
 * The state that mattered most was the one that did not exist: **"can't afford"
 * and "locked" used to share one signal** — a dimmed slot — for two unrelated
 * facts, so the player had to read to find out which. Now short states the gap
 * as a number and locked states the wave and nothing else. They can no longer
 * be confused because they no longer look alike.
 *
 * Cost is a corner numeral with no sigil, name is a caps footer, and the glyph
 * carries the mechanic (see `stationShape.ts`) so the roster is learnable at a
 * glance rather than by reading five names.
 *
 * The blurb stays in `title` and stays figure-free. That is what stops it going
 * stale: `mechanics()` derives the numbers from the def, so a tuned `pierce`
 * updates the panel while prose saying "pierces three" would quietly start
 * lying.
 */
export function renderSlots(w: World, ui: UiState): string {
  return TOWER_IDS.map((id) => {
    const def = TOWERS[id];

    // Locked says one thing: when. No cost, no shortfall, nothing to weigh —
    // it is not a decision yet.
    if (!isUnlocked(w, id)) {
      return (
        `<div class="slot locked" aria-label="${def.name}, unlocks at wave ${def.unlockWave + 1}">` +
        `${stationIcon(id, 40)}<span class="wave">Wave ${def.unlockWave + 1}</span></div>`
      );
    }

    const short = def.cost - w.money;
    const poor = short > 0;
    const cls = ['slot', `t-${id}`, ui.selected === id ? 'armed' : '', poor ? 'poor' : '']
      .filter(Boolean)
      .join(' ');

    return (
      `<button class="${cls}" data-act="arm" data-id="${id}" title="${def.blurb}">` +
      `<kbd>${def.hotkey}</kbd>` +
      `<span class="corner">${def.cost}</span>` +
      stationIcon(id, 40) +
      // Naming the gap turns "no" into "not yet, and by this much" — which is
      // the difference between a dead control and a plan.
      (poor ? `<span class="short">short ${short}</span>` : '') +
      `<span class="name">${def.name}</span></button>`
    );
  }).join('');
}

// --------------------------------------------------------------- detail

function renderDetail(w: World, ui: UiState, inspected: Tower | undefined): string {
  if (inspected !== undefined) return renderInspector(w, inspected);
  if (ui.selected !== null) return renderArmed(ui.selected);
  return renderNextContact(w);
}

/**
 * `stat()` and `mechanics()` lived here and are gone.
 *
 * Both rendered a *label* beside a value — "Dmg 8", "Slows to 74% for 1.2s" —
 * and labels were most of the word count that made the inspector the densest
 * surface in the game to read while under attack. `mechanicChips` and
 * `axisChips` replace them with bare numerals carrying units, and move the
 * sentence into `title` where it costs nothing on screen.
 *
 * The one piece of `mechanics()` worth restating: upgraded values are sums of
 * floats, so every figure is `toFixed`. `1.2000000000002s` is not a stat, it is
 * a bug report.
 */

/**
 * What this station does that the others don't, in numbers.
 *
 * Derived from the def rather than written into the blurb: a blurb saying
 * "pierces three" becomes a lie the moment `pierce` is tuned, and this game's
 * balance dials move. The blurb carries the identity, this carries the figures,
 * and only one of them can go stale.
 *
 * The stat cells deliberately do not cover these — Dmg/Rate/Rng are the axes
 * every station shares and are worth comparing side by side, where the special
 * is exactly the thing that has no counterpart to compare against.
 */
/**
 * The station's own numbers as numeral chips, in its tint.
 *
 * Wordless by construction, which is what lets the inspector hit its budget:
 * `↓74%` and `1.2s` say what "Slows to 74% for 1.2s" said, in a form the eye
 * takes in without reading. The full sentence survives in `title`, which costs
 * nothing on screen.
 *
 * Station-specific first and in tint, shared axes after and in neutral — so the
 * thing that distinguishes this station from the other four leads.
 */
function mechanicChips(d: TowerStats): string {
  const chips: string[] = [];
  const chip = (v: string, hint: string): string => `<b class="mc" title="${hint}">${v}</b>`;

  if (d.pierce > 0) chips.push(chip(`↷${d.pierce}`, `Passes through ${d.pierce} more`));
  if (d.splashRadius > 0) {
    chips.push(chip(`◎${d.splashRadius.toFixed(1)}`, `Blast ${d.splashRadius.toFixed(1)} tiles`));
  }
  if (d.slowFactor < 1) {
    chips.push(chip(`↓${Math.round(d.slowFactor * 100)}%`, `Slows to ${Math.round(d.slowFactor * 100)}%`));
    chips.push(chip(`${d.slowSeconds.toFixed(1)}s`, `for ${d.slowSeconds.toFixed(1)} seconds`));
  }
  if (d.chainJumps > 0) {
    chips.push(chip(`⤳${d.chainJumps}`, `Jumps to ${d.chainJumps} more`));
    chips.push(chip(`${d.chainRange.toFixed(1)}tl`, `within ${d.chainRange.toFixed(1)} tiles`));
  }
  if (d.rampPerSecond > 0) {
    const seconds = (d.rampMax - 1) / d.rampPerSecond;
    chips.push(chip(`×${Number(d.rampMax.toFixed(2))}`, `Ramps to x${d.rampMax} on one target`));
    chips.push(chip(`${seconds.toFixed(1)}s`, `over ${seconds.toFixed(1)} seconds`));
  }

  return `<span class="mech">${chips.join('')}</span>`;
}

/** Damage, rate and range — the three every station has, so always neutral. */
function axisChips(d: TowerStats): string {
  return (
    `<span class="axes">` +
    `<b title="Damage per shot">${formatDamage(d.damage)}</b>` +
    `<b title="Shots per second">${(1 / d.fireInterval).toFixed(1)}/s</b>` +
    `<b title="Reach in tiles">${d.range.toFixed(1)}tl</b>` +
    `</span>`
  );
}


/**
 * The armed state — the moment the player is choosing *where*.
 *
 * It used to spend thirty-one words re-explaining *what*, including a hint the
 * player has read every time they have ever armed a tower. The identity is a
 * picture now: the station at 48px wearing its own mark, its numbers first and
 * in tint, the shared axes after and in neutral.
 *
 * Cost stays visible, because it is the number the decision turns on. The
 * cancel hint shrinks to a keycap. The board ghost's legal/illegal colouring
 * remains the primary yes/no — this panel never becomes where placement
 * validity is read.
 */
export function renderArmed(id: TowerId): string {
  const d = TOWERS[id];
  return (
    `<div class="head t-${id}">${stationIcon(id, 48)}` +
    `<div class="lede"><b>${d.name}</b>` +
    `<span class="blurb" title="${d.blurb}">placing · ${d.cost}</span></div>` +
    `<kbd>Esc</kbd></div>` +
    `<div class="t-${id}">${mechanicChips(d)}</div>` +
    axisChips(d)
  );
}

export function renderInspector(w: World, t: Tower): string {
  const d = TOWERS[t.defId];
  const s = t.stats;
  const nextDamage = nextStats(t, 'damage')?.damage ?? null;

  // Iconic, with **the active mode labelled** — not labels-on-hover.
  //
  // Four unlabelled glyphs would be unguessable (Strong and Close especially),
  // `title` never fires on touch, and this control mutates game state so a
  // mis-click has a cost. Naming only the selected one costs exactly one word,
  // is self-teaching — the player sees "First" beside its glyph and learns the
  // glyph — and works without a pointer. `aria-label` on all four regardless.
  const modes = TARGET_MODES.map((m) => {
    const on = t.targeting === m;
    return (
      `<button data-act="target" data-mode="${m}" class="${on ? 'on' : ''}"` +
      ` aria-label="${TARGET_LABEL[m]}" title="${TARGET_LABEL[m]}">${TARGET_GLYPH[m]}` +
      (on ? `<span>${TARGET_LABEL[m]}</span>` : '') +
      `</button>`
    );
  }).join('');

  return (
    `<div class="inspector">` +
    // Portrait column: the station wearing its real collar at 64px, so the
    // board's positional upgrade code is taught at full size rather than by a
    // 24px afterthought on a button. The board only has to jog this memory.
    `<div class="portrait t-${t.defId}">${stationIcon(t.defId, 44)}` +
    `${collarDial(t.tiers, BALANCE.upgrade.maxTier)}` +
    `<span class="mk">Mk ${'I'.repeat(visualTier(t))}</span></div>` +
    `<div class="body">` +
    `<div class="head t-${t.defId}"><b>${d.name}</b>` +
    `<span class="blurb" title="tile ${t.col},${t.row} · ${Math.round(t.damageDealt)} damage dealt">` +
    `${t.kills} kills</span></div>` +
    // Live stats, not the def: this is where an effect purchase becomes visible
    // in numbers, including the secondary dial the upgrade card omits.
    `<div class="t-${t.defId}">${mechanicChips(s)}</div>` +
    axisChips(s) +
    renderArmourLine(w, t, nextDamage) +
    `</div>` +
    `<div class="upgrades">${renderPathButtons(w, t)}</div>` +
    `<div class="actions"><div class="seg targeting">${modes}</div>` +
    `<button class="btn" data-act="sell">Sell ${sellValue(t)}</button></div>` +
    `</div>`
  );
}

/**
 * The three upgrade tracks, one button each: damage and range are shared
 * axes, the third is whatever `effectUpgrade` says this station deepens.
 * Every preview is computed by `nextStats` — the same function the purchase
 * runs — so the button can never promise a number the sim won't deliver.
 */
function renderPathButtons(w: World, t: Tower): string {
  return UPGRADE_PATHS.map((path) => {
    const cost = upgradeCost(t, path);
    const next = nextStats(t, path);
    const { label, value } = pathPreview(t, path, next);
    const pips = tierPips(t.tiers[path], BALANCE.upgrade.maxTier);

    // The dial shows where this path sits on the station's collar, so the
    // board's positional code is taught at the moment the player buys into it.
    const dial = pathDial(path);

    if (cost === null) {
      return `<span class="path maxed"><label>${dial}${label}</label><b>${value}</b>${pips}<em>Max</em></span>`;
    }
    return (
      `<button class="path${w.money < cost ? ' poor' : ''}" data-act="upgrade" data-path="${path}">` +
      `<label>${dial}${label}</label><b>${value}</b>${pips}<em>$${cost}</em></button>`
    );
  }).join('');
}

function pathPreview(
  t: Tower,
  path: UpgradePath,
  next: TowerStats | null,
): { label: string; value: string } {
  const s = t.stats;
  if (path === 'damage') {
    return {
      label: 'Damage',
      value: next === null ? String(s.damage) : `${s.damage} → ${next.damage}`,
    };
  }
  if (path === 'range') {
    return {
      label: 'Range',
      value: next === null ? s.range.toFixed(1) : `${s.range.toFixed(1)} → ${next.range.toFixed(1)}`,
    };
  }

  // The effect button previews the *headline* stat — the first key in
  // `perTier`. A secondary dial (Singularity's duration, Filament's spin-up)
  // shows up in the mechanics line instead; two arrows on one small button
  // read as noise.
  const d = TOWERS[t.defId];
  const key = Object.keys(d.effectUpgrade.perTier)[0] as keyof TowerStats;
  return {
    label: d.effectUpgrade.name,
    value:
      next === null
        ? effectValue(key, s[key])
        : `${effectValue(key, s[key])} → ${effectValue(key, next[key])}`,
  };
}

/** Compact display for an effect path's headline stat. */
function effectValue(key: keyof TowerStats, v: number): string {
  switch (key) {
    case 'slowFactor':
      return `${Math.round(v * 100)}%`;
    case 'splashRadius':
    case 'chainRange':
      return v.toFixed(1);
    case 'rampMax':
      return `×${Number(v.toFixed(2))}`;
    default:
      // Counts (pierce, chain jumps): sums of integers, safe to print raw.
      return String(v);
  }
}

/**
 * What this station actually lands on the toughest armour in play.
 *
 * Only rendered when something armoured is in play, because for the first six
 * waves it would be noise — and the whole reason it exists is that the Dmg cell
 * is *misleading* against armour, not merely incomplete. A Singularity Mk I
 * reads "Dmg 3" and lands 0.45 on a Bulwark; a player upgrading it to fight
 * Bulwarks is being misled by the panel.
 *
 * A `.line` beneath the cells rather than a fifth cell: `.cells` is a fixed
 * four-column grid that already holds exactly four, so a fifth would wrap to a
 * lone orphan on a second row.
 */
function renderArmourLine(w: World, t: Tower, next: number | null): string {
  const ref = toughestArmour(w);
  if (ref === null) return '';

  const now = effectiveDamage(t.stats.damage, ref.armor);
  const after = next === null ? null : effectiveDamage(next, ref.armor);
  const kept = now / t.stats.damage;

  // Flagged past half, so "this is the wrong tool for that" reads without the
  // player doing the division.
  const cls = kept <= 0.5 ? ' class="bad"' : '';
  const name = ENEMIES[ref.defId].name;

  // A proportional bar rather than a percentage: the sliver *is* the 16%, so
  // the player reads how much of every hit survives instead of doing the
  // subtraction. The contact glyph names which one, so the line costs no words
  // — the sentence it replaced survives in `title`.
  const label =
    `${ref.inbound ? 'Inbound' : 'On the board'}: ${name} · ` +
    `${formatDamage(now)} of ${formatDamage(t.stats.damage)} per hit · ` +
    `armour eats ${Math.round((1 - kept) * 100)}%`;

  return (
    `<div class="line armour" title="${label}">` +
    `${contactIcon(ref.defId, 18)}` +
    `<span class="bar"><i style="width:${(kept * 100).toFixed(1)}%"></i></span>` +
    `<b${cls}>${formatDamage(now)}${after === null ? '' : ` → ${formatDamage(after)}`}</b>` +
    `</div>`
  );
}



/**
 * What is coming, drawn from `planWave` — the same pure function the spawner
 * uses, so the preview cannot promise a wave the sim won't deliver.
 */
export function renderNextContact(w: World): string {
  const s = w.wave;
  if (s.phase === 'done' && w.creeps.length === 0) {
    return `<div class="head"><b>Route clear</b></div><div class="hint">Nothing else is coming.</div>`;
  }

  const plan = planWave(w.seed, s.index, w.rules);
  if (plan.length === 0) {
    return `<div class="head"><b>Wave ${s.index + 1}</b></div>`;
  }

  // Grouped by type, in order of first arrival.
  //
  // This used to read `plan[0]`'s name and hp and apply them to `plan.length`,
  // which was true only while there was one contact type. With six it announced
  // wave 10 as "40 × Drifter" when barely a quarter of it was Drifters — a
  // confident lie, in the one panel whose entire job is telling the player what
  // to prepare for.
  const groups: { enemy: EnemyId; n: number; hp: number; shield: number }[] = [];
  for (const p of plan) {
    const hit = groups.find((g) => g.enemy === p.enemy);
    if (hit === undefined) groups.push({ enemy: p.enemy, n: 1, hp: p.hp, shield: p.shield });
    else hit.n++;
  }

  // Effective health, so a Warden's overshield counts toward "toughest" — it is
  // health the player has to chew through whatever pool it sits in.
  const toughest = groups.reduce((a, b) => (b.hp + b.shield > a.hp + a.shield ? b : a));

  // The real glyph at the real tint, not the name. The panel's whole job is
  // "prepare for this", and it was describing the wave in a language the board
  // does not use — the player had to translate "4 Warden" into the ringed pink
  // circle they were about to see. Armour and shield are visible *before* the
  // wave rather than only during it, which is the point at which they are still
  // actionable.
  const chips = groups
    .map(
      (g) =>
        `<span class="chip c-${g.enemy}" title="${g.n} × ${ENEMIES[g.enemy].name}">` +
        `${contactIcon(g.enemy, 26)}<b>${g.n}</b></span>`,
    )
    .join('');

  return (
    `<div class="head"><i class="dot contact"></i><b>Wave ${s.index + 1}</b>` +
    `<span class="blurb">${plan.length} inbound</span></div>` +
    `<div class="chips">${chips}</div>` +
    // One effective-health figure, because the biggest glyph above already
    // named which contact it belongs to. Shield counts: it is health the player
    // has to chew through whichever pool it sits in.
    `<div class="hint">Toughest <b>${toughest.hp + toughest.shield}</b> ehp</div>`
  );
}

// ----------------------------------------------------------------- send

function renderSend(w: World): string {
  const s = w.wave;

  if (s.phase === 'spawning') {
    return (
      `<span class="btn send-btn flat">Wave ${s.index + 1} running</span>` +
      `<span class="hint">Wait for it to finish spawning</span>`
    );
  }
  if (s.phase === 'done') {
    return (
      `<span class="btn send-btn flat">No waves left</span>` +
      `<span class="hint">Clear the board to finish</span>`
    );
  }

  const bonus = Math.round(Math.max(0, s.timer) * BALANCE.rushBonusPerSecond);
  return (
    `<button class="btn send-btn primary" data-act="send">Send wave ${s.index + 1}` +
    (bonus > 0 ? ` <em>+$${bonus}</em>` : '') +
    `</button>` +
    `<span class="hint">Sending early pays the remaining timer as cash</span>`
  );
}

// -------------------------------------------------------------- overlays

function renderOverlay(
  w: World,
  ui: UiState,
  toast: Extract<SimEvent, { type: 'waveCleared' }> | null,
  breachLives: number | null,
  campaign: CampaignPorts | undefined,
): string {
  if (w.phase === 'lost') return renderDefeat(w, campaign);
  if (w.phase === 'won') return renderVictory(w, campaign);
  if (ui.paused) return renderPaused(w, ui);
  // A breach outranks a clear: they can overlap when the last creep of a wave
  // is the one that got through, and the bad news is the news.
  if (breachLives !== null) return renderBreach(breachLives);
  if (toast !== null) return renderClearToast(toast);
  return '';
}

/**
 * The leak banner. Three signals fire together — this, the goal flare, and the
 * screen-edge rim in `effects.ts` — so a leak is legible whether the player was
 * watching the core or the deck.
 */
function renderBreach(lives: number): string {
  return (
    `<div class="breach">` +
    `<i class="dot crit"></i>` +
    `<b>CORE BREACHED</b>` +
    `<span>${lives} ${lives === 1 ? 'life' : 'lives'} remaining</span>` +
    `</div>`
  );
}

function renderClearToast(ev: Extract<SimEvent, { type: 'waveCleared' }>): string {
  const item = (v: string, label: string, cls = ''): string =>
    `<span class="item"><b class="${cls}">${v}</b><label>${label}</label></span>`;
  return (
    `<div class="card toast">` +
    `<span class="eyebrow">Wave ${ev.wave + 1} cleared</span>` +
    `<div class="items">` +
    item(`+$${ev.bounty}`, `bounty · ${ev.kills} kills`) +
    item(`+$${ev.reward}`, 'clear bonus', 'accent') +
    (ev.leaked > 0 ? item(`−${ev.leaked}`, 'leaked', 'danger') : '') +
    `</div></div>`
  );
}

function renderPaused(w: World, ui: UiState): string {
  const toggle = (
    act: string,
    opts: readonly [string, string][],
    active: string,
  ): string =>
    `<div class="seg">` +
    opts
      .map(
        ([v, label]) =>
          `<button data-act="${act}" data-v="${v}" class="${v === active ? 'on' : ''}">${label}</button>`,
      )
      .join('') +
    `</div>`;

  return (
    `<div class="scrim"></div><div class="card">` +
    `<span class="eyebrow">${w.map.name}</span><h2>Paused</h2>` +
    `<div class="rows">` +
    `<div class="row"><span>Reach circles</span>${toggle(
      'pref-reach',
      [
        ['hover', 'Hover'],
        ['always', 'Always'],
      ],
      ui.prefs.reachCircles,
    )}</div>` +
    `<div class="row"><span>Damage numbers</span>${toggle(
      'pref-damage',
      [
        ['on', 'On'],
        ['off', 'Off'],
      ],
      ui.prefs.damageNumbers ? 'on' : 'off',
    )}</div>` +
    // Defaults *off* for anyone whose system asks for reduced motion, so this
    // row is where they would turn it on rather than where they discover it has
    // been running all along.
    `<div class="row"><span>Route current</span>${toggle(
      'pref-stream',
      [
        ['on', 'On'],
        ['off', 'Off'],
      ],
      ui.prefs.stream ? 'on' : 'off',
    )}</div>` +
    `</div>` +
    `<div class="hr"></div>` +
    `<button class="btn primary wide" data-act="pause">Resume <em>Esc</em></button>` +
    `<button class="btn wide" data-act="restart">Restart sector</button>` +
    `</div>`
  );
}

function renderDefeat(w: World, campaign: CampaignPorts | undefined): string {
  const cov = coverage(w);
  return (
    `<div class="scrim lost"></div><div class="card lost">` +
    `<span class="eyebrow danger">Sector lost</span>` +
    `<h2>The core went dark on wave ${w.wave.index + 1}</h2>` +
    `<div class="grid3">` +
    `${bigStat('Waves held', `${Math.max(0, w.wave.clearedThrough + 1)} / ${waveCount(w.rules)}`)}` +
    `${bigStat('Contacts killed', String(w.stats.kills))}` +
    `${bigStat('Leaks', String(w.stats.leaks), 'danger')}` +
    `</div>` +
    `<div class="note danger"><span class="eyebrow danger">What broke</span>` +
    `<p>${describeGaps(cov)}</p></div>` +
    `<button class="btn primary wide" data-act="restart">Retry sector</button>` +
    (campaign === undefined ? '' : `<button class="btn wide" data-act="menu">Choose another sector</button>`)
  );
}

function renderVictory(w: World, campaign: CampaignPorts | undefined): string {
  const g = grade(w);
  const hint = nextGradeHint(w);
  return (
    `<div class="scrim won"></div><div class="card won">` +
    `<div class="head-row"><div><span class="eyebrow accent">Sector held</span>` +
    `<h2>All ${waveCount(w.rules)} waves turned back</h2></div>` +
    `<span class="grade">${g}</span></div>` +
    `<div class="grid3">` +
    `${bigStat('Lives kept', `${w.lives} / ${w.rules.startingLives}`)}` +
    `${bigStat('Contacts killed', String(w.stats.kills))}` +
    `${bigStat('Time', formatClock(w.time))}` +
    `</div>` +
    (hint === null
      ? ''
      : `<div class="note accent"><span class="eyebrow accent">Next grade up</span><p>${hint}</p></div>`) +
    victoryActions(campaign, Math.floor(w.money))
  );
}

/**
 * The buttons under a win.
 *
 * Whatever the player is most likely to want next is the primary, and that
 * differs by where they are: mid-campaign it is the level they just unlocked,
 * at the end of the campaign there is nothing to unlock and replaying for a
 * better grade is the only thing left, and in Race mode none of this exists.
 */
function victoryActions(campaign: CampaignPorts | undefined, bank: number): string {
  if (campaign === undefined) {
    return `<button class="btn primary wide" data-act="restart">Play again</button>`;
  }
  if (campaign.nextName === null) {
    return (
      `<div class="note accent"><span class="eyebrow accent">Campaign complete</span>` +
      `<p>Every sector held. The grades are still there to beat — and Blackout is still waiting.</p></div>` +
      `<button class="btn primary wide" data-act="menu">Choose a sector</button>` +
      `<button class="btn wide" data-act="restart">Play again</button>`
    );
  }
  // The bank is stated here, on the button, and in the note — because a rule the
  // player only discovers *after* it has already cost them is not a rule they
  // can play around. Naming the amount and what it replaces is the whole reason
  // saving becomes a decision rather than a surprise.
  return (
    `<div class="note accent"><span class="eyebrow accent">Banked</span>` +
    `<p><b>$${bank}</b> left over becomes your entire starting budget on ` +
    `${campaign.nextName} — it replaces the usual amount rather than adding to ` +
    `it. Coming back to this sector from the menu always starts fresh.</p></div>` +
    `<button class="btn primary wide" data-act="next">` +
    `Next sector: ${campaign.nextName} <em>with $${bank}</em></button>` +
    `<button class="btn wide" data-act="restart">Play again</button>` +
    `<button class="btn wide" data-act="menu">Choose another sector</button>`
  );
}

function bigStat(label: string, value: string, cls = ''): string {
  return `<span class="big"><label>${label}</label><b class="${cls}">${value}</b></span>`;
}
