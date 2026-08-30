/**
 * The Race lobby screen (N3): create or join with a 4-char code, see who's in
 * the room, ready up, count down. Replaces the N2 dev-grade overlay.
 *
 * Self-contained DOM on purpose — it lives and dies before the game exists,
 * shares nothing with the in-game HUD, and keeps its styles inline so it can't
 * fight the game stylesheet. The room code is a select-on-click <input>, NOT a
 * clipboard button: over Tailscale the page is plain http, which is not a
 * secure context, and navigator.clipboard silently fails there (and only
 * there — it works on localhost, which is exactly how that bug would ship).
 */
import type { LobbyPlayer } from '../net/protocol.ts';

export interface LobbyScreen {
  showRoster(room: string, players: LobbyPlayer[]): void;
  showCountdown(ms: number): void;
  showError(reason: string): void;
  remove(): void;
}

export interface LobbyOptions {
  /** Room code from the URL, joined without showing the form. */
  prefillRoom?: string;
  /** Rematch rejoin: skip the form entirely and connect straight away. */
  autoJoin?: { name: string; room: string };
  onSubmit(name: string, room?: string): void;
  onReady(): void;
}

const box = (el: HTMLElement): void => {
  el.style.cssText +=
    ';position:absolute;inset:0;display:grid;place-items:center;z-index:10;' +
    'background:rgba(4,6,12,0.88);color:var(--hud-fg,#dde4f0);text-align:center;' +
    'font:15px/1.7 var(--hud-font,ui-monospace,monospace)';
};

export function createLobbyScreen(parent: HTMLElement, opts: LobbyOptions): LobbyScreen {
  const el = document.createElement('div');
  el.id = 'lobby-screen';
  box(el);
  parent.style.position = 'relative';
  parent.appendChild(el);

  const savedName = localStorage.getItem('race-name') ?? '';
  let timer: ReturnType<typeof setInterval> | null = null;
  let readySent = false;

  function submit(room?: string): void {
    const name = (el.querySelector('#race-name') as HTMLInputElement).value.trim() || 'pilot';
    localStorage.setItem('race-name', name);
    el.innerHTML = `<div>connecting…</div>`;
    if (room === undefined) opts.onSubmit(name);
    else opts.onSubmit(name, room);
  }

  function showForm(): void {
    el.innerHTML =
      `<div style="display:grid;gap:14px;min-width:280px">` +
      `<div style="font-size:20px;letter-spacing:2px">RACE</div>` +
      `<input id="race-name" placeholder="your name" value="${savedName}" style="${inputCss}">` +
      `<button id="race-create" style="${buttonCss}">create room</button>` +
      `<div style="opacity:0.7">— or join —</div>` +
      `<div style="display:flex;gap:8px;justify-content:center">` +
      `<input id="race-code" placeholder="CODE" maxlength="4" style="${inputCss};width:7ch;text-transform:uppercase">` +
      `<button id="race-join" style="${buttonCss}">join</button>` +
      `</div></div>`;
    el.querySelector('#race-create')!.addEventListener('click', () => submit());
    const joinNow = (): void => {
      const code = (el.querySelector('#race-code') as HTMLInputElement).value.trim();
      if (code.length === 4) submit(code);
    };
    el.querySelector('#race-join')!.addEventListener('click', joinNow);
    el.querySelector('#race-code')!.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') joinNow();
    });
  }

  if (opts.autoJoin !== undefined) {
    el.innerHTML = `<div>rejoining room <b>${opts.autoJoin.room}</b>…</div>`;
    // Deferred a tick so the caller has its handle before callbacks fire.
    const { name, room } = opts.autoJoin;
    setTimeout(() => opts.onSubmit(name, room), 0);
  } else if (opts.prefillRoom !== undefined) {
    // Deep link: name still matters, so show a one-field form.
    el.innerHTML =
      `<div style="display:grid;gap:14px">` +
      `<div>joining room <b>${opts.prefillRoom.toUpperCase()}</b></div>` +
      `<input id="race-name" placeholder="your name" value="${savedName}" style="${inputCss}">` +
      `<button id="race-go" style="${buttonCss}">join</button></div>`;
    el.querySelector('#race-go')!.addEventListener('click', () => submit(opts.prefillRoom));
  } else {
    showForm();
  }

  return {
    showRoster(room, players) {
      const roster = players
        .map((p) => `<div>${p.name} ${p.ready ? '· ready' : ''}</div>`)
        .join('');
      el.innerHTML =
        `<div style="display:grid;gap:14px;min-width:280px">` +
        `<div style="opacity:0.7">room code</div>` +
        `<input readonly value="${room}" onclick="this.select()" ` +
        `style="${inputCss};font-size:28px;letter-spacing:8px;text-align:center;width:8ch;justify-self:center">` +
        (players.length < 2 ? `<div style="opacity:0.7">waiting for opponent…</div>` : '') +
        `<div>${roster}</div>` +
        (players.length === 2 && !readySent ? `<button id="race-ready" style="${buttonCss}">ready</button>` : '') +
        (readySent ? `<div style="opacity:0.7">waiting for the other player to ready up…</div>` : '');
      el.querySelector('#race-ready')?.addEventListener('click', () => {
        readySent = true;
        opts.onReady();
        this.showRoster(room, players);
      });
    },
    showCountdown(ms) {
      // Local rendering of a relative delay; no cross-machine clocks involved.
      const endsAt = performance.now() + ms;
      const tick = (): void => {
        const left = Math.max(0, endsAt - performance.now());
        el.innerHTML = `<div style="font-size:42px">${Math.ceil(left / 1000)}</div>`;
      };
      tick();
      timer = setInterval(tick, 100);
    },
    showError(reason) {
      el.innerHTML = `<div>race error: ${reason}<br><br><a href="?race" style="color:inherit">back to lobby</a></div>`;
    },
    remove() {
      if (timer !== null) clearInterval(timer);
      el.remove();
    },
  };
}

const inputCss =
  'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.25);' +
  'color:inherit;font:inherit;padding:8px 10px;border-radius:4px;outline:none';
const buttonCss =
  'background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.3);' +
  'color:inherit;font:inherit;padding:8px 14px;border-radius:4px;cursor:pointer';
