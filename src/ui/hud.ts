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
import { stationIcon, tierPips } from './icons.ts';

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
 * is unchanged the region is skipped entirely, and when it changes the region's
 * markup is rebuilt in one write. That keeps the original property — a tick
 * where nothing visible changed touches no DOM at all — while letting the
 * markup be as large as the design needs.
 *
 * Because regions are rebuilt wholesale, nothing binds listeners to their
 * contents. One delegated click handler on the root reads `data-act`, so
 * controls survive a rebuild without any re-binding.
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
    }
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

    update() {
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
    },
  };
}

/** A region that rebuilds only when its key changes. */
function region(el: HTMLElement): (key: string, html: () => string) => void {
  let last: string | null = null;
  return (key, html) => {
    if (key === last) return;
    last = key;
    el.innerHTML = html();
  };
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
    label = `wave ${s.index + 1} · ${aliveInWave(w, s.index)} of ${s.plan.length} alive`;
    fill = s.plan.length === 0 ? 0 : s.spawned / s.plan.length;
  } else {
    label = 'last wave out';
    fill = 1;
  }

  const speeds = SPEEDS.map(
    (v) =>
      `<button data-act="speed" data-v="${v}" class="${v === speed ? 'on' : ''}">${v}×</button>`,
  ).join('');

  return (
    `<div class="stat"><label>Cash</label><b>$${w.money}</b></div>` +
    `<div class="stat"><label>Lives</label><b class="${w.lives <= 5 ? 'crit' : ''}">${w.lives}</b></div>` +
    `<div class="stat"><label>Waves held</label><b>${cleared} / ${total}</b></div>` +
    `<div class="ribbon"><span>${label}</span>` +
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

function deckKey(w: World, ui: UiState, inspected: Tower | undefined): string {
  const s = w.wave;
  return [
    ui.deckOpen ? 'o' : 'c',
    ui.selected ?? '-',
    inspected
      ? `${inspected.id}:${inspected.tiers.damage}${inspected.tiers.range}${inspected.tiers.effect}:${inspected.targeting}:${inspected.kills}`
      : '-',
    // Affordability of every slot, plus the two buttons the inspector prices.
    w.money,
    s.index,
    s.phase,
    Math.ceil(s.timer),
    // Only the collapsed strip shows a live enemy count. Including it
    // unconditionally would rebuild the whole open deck on every kill.
    ui.deckOpen ? '' : aliveInWave(w, s.index),
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
    return `<div class="strip">${renderStripStatus(w)}${handle}</div>`;
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

function renderStripStatus(w: World): string {
  const s = w.wave;
  const dotClass = w.lives <= 5 ? 'dot crit' : 'dot';
  const text =
    s.phase === 'spawning'
      ? `Wave ${s.index + 1} running — ${aliveInWave(w, s.index)} of ${s.plan.length} alive`
      : s.phase === 'intermission'
        ? `Wave ${s.index + 1} in ${Math.ceil(s.timer)}s`
        : 'Last wave out';
  return `<span class="strip-status"><i class="${dotClass}"></i>${text}</span>`;
}

function renderSlots(w: World, ui: UiState): string {
  return TOWER_IDS.map((id) => {
    const def = TOWERS[id];
    if (!isUnlocked(w, id)) {
      return (
        `<div class="slot locked"><span>Locked<br>wave ${def.unlockWave + 1}</span></div>`
      );
    }
    const poor = w.money < def.cost;
    const cls = ['slot', `t-${id}`, ui.selected === id ? 'armed' : '', poor ? 'poor' : '']
      .filter(Boolean)
      .join(' ');
    return (
      `<button class="${cls}" data-act="arm" data-id="${id}" title="${def.blurb}">` +
      `<kbd>${def.hotkey}</kbd>${stationIcon(30)}` +
      `<span class="name">${def.name}</span>` +
      `<span class="cost">$${def.cost}</span></button>`
    );
  }).join('');
}

// --------------------------------------------------------------- detail

function renderDetail(w: World, ui: UiState, inspected: Tower | undefined): string {
  if (inspected !== undefined) return renderInspector(w, inspected);
  if (ui.selected !== null) return renderArmed(ui.selected);
  return renderNextContact(w);
}

function stat(label: string, value: string, cls = ''): string {
  return `<span class="cell"><label>${label}</label><b class="${cls}">${value}</b></span>`;
}

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
function mechanics(d: TowerStats): string {
  const parts: string[] = [];
  if (d.pierce > 0) parts.push(`Passes through ${d.pierce} more`);
  if (d.splashRadius > 0) parts.push(`Blast ${d.splashRadius.toFixed(1)} tiles`);
  if (d.slowFactor < 1) {
    // toFixed, because upgraded values are sums of floats and `1.2000000000002s`
    // is not a stat, it is a bug report.
    parts.push(`Slows to ${Math.round(d.slowFactor * 100)}% for ${d.slowSeconds.toFixed(1)}s`);
  }
  if (d.chainJumps > 0) {
    parts.push(`Jumps to ${d.chainJumps} more within ${d.chainRange.toFixed(1)} tiles`);
  }
  if (d.rampPerSecond > 0) {
    // Stated as the ceiling and the time to reach it, because those are the two
    // numbers a placement decision turns on — "×3.5" alone says nothing about
    // whether anything on this board stands still long enough to see it.
    const seconds = (d.rampMax - 1) / d.rampPerSecond;
    parts.push(`Ramps to ×${Number(d.rampMax.toFixed(2))} over ${seconds.toFixed(1)}s on one target`);
  }
  return parts.join(' · ');
}

function renderArmed(id: TowerId): string {
  const d = TOWERS[id];
  return (
    `<div class="head t-${id}">${stationIcon(26)}<b>${d.name} — placing</b>` +
    `<span class="blurb">${d.blurb}</span></div>` +
    `<div class="cells">${stat('Dmg', String(d.damage))}${stat(
      'Rate',
      (1 / d.fireInterval).toFixed(1),
    )}${stat('Rng', d.range.toFixed(1))}${stat('Cost', `$${d.cost}`, 'accent')}</div>` +
    `<div class="special">${mechanics(d)}</div>` +
    `<div class="hint">Click to place · <b>Esc</b> or right-click to cancel</div>`
  );
}

function renderInspector(w: World, t: Tower): string {
  const d = TOWERS[t.defId];
  const s = t.stats;
  const nextDamage = nextStats(t, 'damage')?.damage ?? null;

  const modes = TARGET_MODES.map(
    (m) =>
      `<button data-act="target" data-mode="${m}" class="${t.targeting === m ? 'on' : ''}">${TARGET_LABEL[m]}</button>`,
  ).join('');

  return (
    `<div class="head t-${t.defId}">${stationIcon(28)}` +
    `<b>${d.name} · Mk ${'I'.repeat(visualTier(t))}</b>` +
    `<span class="blurb">tile ${t.col},${t.row} · ${Math.round(t.damageDealt)} dmg dealt</span>` +
    `</div>` +
    // Current values only — each path button carries its own `now → next`
    // preview, so an arrow here would say the same thing twice.
    `<div class="cells">${stat('Dmg', String(s.damage), 'accent')}${stat(
      'Rate',
      (1 / s.fireInterval).toFixed(1),
    )}${stat('Rng', s.range.toFixed(1))}${stat('Kills', String(t.kills))}</div>` +
    // Live stats, not the def: this line is where an effect purchase becomes
    // visible in numbers, including the secondary dial the button omits.
    `<div class="special">${mechanics(s)}</div>` +
    renderArmourLine(w, t, nextDamage) +
    `<div class="paths">${renderPathButtons(w, t)}</div>` +
    `<div class="actions"><div class="seg targeting">${modes}</div>` +
    `<button class="btn" data-act="sell">Sell +$${sellValue(t)}</button></div>`
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

    if (cost === null) {
      return `<span class="path maxed"><label>${label}</label><b>${value}</b>${pips}<em>Max</em></span>`;
    }
    return (
      `<button class="path${w.money < cost ? ' poor' : ''}" data-act="upgrade" data-path="${path}">` +
      `<label>${label}</label><b>${value}</b>${pips}<em>$${cost}</em></button>`
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

  return (
    `<div class="line armour">` +
    `${ref.inbound ? 'Inbound' : 'On the board'}: <b>${name}</b> · ` +
    `<b${cls}>${formatDamage(now)}${after === null ? '' : ` → ${formatDamage(after)}`}</b> per hit · ` +
    `armour eats ${Math.round((1 - kept) * 100)}%` +
    `</div>`
  );
}



/**
 * What is coming, drawn from `planWave` — the same pure function the spawner
 * uses, so the preview cannot promise a wave the sim won't deliver.
 */
function renderNextContact(w: World): string {
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

  const chips = groups
    .map((g) => `<span class="chip c-${g.enemy}">${g.n} ${ENEMIES[g.enemy].name}</span>`)
    .join('');

  return (
    `<div class="head"><i class="dot contact"></i><b>Wave ${s.index + 1}</b>` +
    `<span class="blurb">${plan.length} contacts</span></div>` +
    `<div class="chips">${chips}</div>` +
    `<div class="hint">Toughest: ${ENEMIES[toughest.enemy].name}, ${toughest.hp}` +
    (toughest.shield > 0 ? ` + ${toughest.shield} shield` : ' hp') +
    `</div>`
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
