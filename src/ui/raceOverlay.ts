/**
 * Dev-grade race status overlay for N2: room code, waiting state, countdown.
 * Deliberately bare — the real lobby screen (create/join form, ready button)
 * replaces this at N3. It reuses the HUD's CSS variables so it doesn't fight
 * the theme, but earns no styling budget beyond that.
 */
import type { LobbyPlayer } from '../net/protocol.ts';

export interface RaceOverlay {
  lobby(room: string, players: LobbyPlayer[]): void;
  countdown(ms: number): void;
  error(reason: string): void;
  remove(): void;
}

export function createRaceOverlay(parent: HTMLElement): RaceOverlay {
  const el = document.createElement('div');
  el.id = 'race-overlay';
  el.style.cssText = [
    'position:absolute', 'inset:0', 'display:grid', 'place-items:center',
    'background:rgba(0,0,0,0.75)', 'color:var(--hud-fg, #eee)', 'z-index:10',
    'font:16px/1.6 var(--hud-font, monospace)', 'text-align:center', 'white-space:pre-line',
  ].join(';');
  parent.style.position = 'relative';
  parent.appendChild(el);

  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    lobby(room, players) {
      const roster = players.map((p) => `${p.name}${p.ready ? ' — ready' : ''}`).join('\n');
      el.textContent =
        `ROOM ${room}\n\n` +
        (players.length < 2 ? `waiting for opponent…\nsend this code: ${room}\n\n` : '') +
        roster;
    },
    countdown(ms) {
      // Local rendering of a relative delay; no cross-machine clocks involved.
      const endsAt = performance.now() + ms;
      const tick = (): void => {
        const left = Math.max(0, endsAt - performance.now());
        el.textContent = `starting in ${Math.ceil(left / 1000)}…`;
      };
      tick();
      timer = setInterval(tick, 200);
    },
    error(reason) {
      el.textContent = `race error: ${reason}\n\nreload to try again`;
    },
    remove() {
      if (timer !== null) clearInterval(timer);
      el.remove();
    },
  };
}
