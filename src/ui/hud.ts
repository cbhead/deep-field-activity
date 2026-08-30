import { TOWERS, TOWER_IDS, type TowerId } from '../content/towers.ts';
import { css, THEME } from '../render/theme.ts';
import { waveCount } from '../sim/wavePlan.ts';
import type { World } from '../sim/world.ts';

/**
 * DOM, not Pixi.
 *
 * A tower defense HUD is 90% text. In Pixi that means bitmap fonts and
 * hand-computed layout; in DOM it is flexbox and it is done. The boundary is
 * world-anchored visuals (ghosts, range circles, health bars) in Pixi,
 * screen-anchored chrome here.
 *
 * Vanilla, not React: React fights a 60Hz mutable-state loop and needs
 * `useSyncExternalStore` to do properly, which is incidental complexity in week
 * one. The `update(world)` seam is identical if that changes later.
 */
export interface HudCallbacks {
  onSelect(id: TowerId | null): void;
}

export interface Hud {
  /** Call at ~10Hz, not 60. Every write is guarded by a value comparison. */
  update(w: World, selected: TowerId | null): void;
}

export function createHud(root: HTMLElement, cb: HudCallbacks): Hud {
  root.innerHTML = '';

  const stats = el('div', 'hud-stats');
  const money = stat(stats, 'Cash');
  const lives = stat(stats, 'Lives');
  const wave = stat(stats, 'Wave');

  const bar = el('div', 'hud-build');
  const buttons = new Map<TowerId, HTMLButtonElement>();

  for (const id of TOWER_IDS) {
    const def = TOWERS[id];
    const btn = document.createElement('button');
    btn.className = 'tower-btn';
    btn.type = 'button';
    btn.title = def.blurb;
    btn.innerHTML =
      `<span class="tower-key">${def.hotkey}</span>` +
      `<span class="tower-name">${def.name}</span>` +
      `<span class="tower-cost">$${def.cost}</span>`;
    btn.style.setProperty('--tint', css(THEME.towers[id]));
    btn.addEventListener('click', () => {
      cb.onSelect(btn.classList.contains('is-selected') ? null : id);
    });
    buttons.set(id, btn);
    bar.appendChild(btn);
  }

  const hint = el('div', 'hud-hint');
  hint.textContent = 'Click a tower or press 1-3 · Esc or right-click to cancel · Space sends the next wave';
  bar.appendChild(hint);

  root.append(stats, bar);

  // Previous values, so a 10Hz tick with nothing new touches no DOM at all.
  let lastMoney = NaN;
  let lastLives = NaN;
  let lastWave = '';
  let lastSelected: TowerId | null | undefined;

  return {
    update(w, selected) {
      if (w.money !== lastMoney) {
        lastMoney = w.money;
        money.textContent = `$${w.money}`;
        // Affordability changes only when money does.
        for (const [id, btn] of buttons) {
          btn.classList.toggle('is-poor', w.money < TOWERS[id].cost);
        }
      }

      if (w.lives !== lastLives) {
        lastLives = w.lives;
        lives.textContent = String(w.lives);
        lives.classList.toggle('is-critical', w.lives <= 5);
      }

      const waveText =
        w.wave.phase === 'done'
          ? 'done'
          : `${w.wave.index + 1}/${waveCount()}${w.wave.phase === 'intermission' ? ` · ${Math.ceil(w.wave.timer)}s` : ''}`;
      if (waveText !== lastWave) {
        lastWave = waveText;
        wave.textContent = waveText;
      }

      if (selected !== lastSelected) {
        lastSelected = selected;
        for (const [id, btn] of buttons) btn.classList.toggle('is-selected', id === selected);
      }
    },
  };
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function stat(parent: HTMLElement, label: string): HTMLElement {
  const wrap = el('div', 'hud-stat');
  const l = el('span', 'hud-stat-label');
  l.textContent = label;
  const v = el('span', 'hud-stat-value');
  wrap.append(l, v);
  parent.appendChild(wrap);
  return v;
}
