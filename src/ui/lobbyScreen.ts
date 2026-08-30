/**
 * The Race lobby, implementing the Claude Design spec vendored at
 * docs/design/Race Lobby.dc.html — states L1 (entry), L2 (deep link),
 * L3 (waiting), L4/L5 (ready up / standing by), L6 (countdown), L7 (failure).
 *
 * Self-contained on purpose — it lives and dies before the game exists, so it
 * injects its own stylesheet and shares nothing with the in-game HUD.
 *
 * Two constraints from the spec survive any future restyle:
 * - The room code and invite link are select-on-click fields, never a
 *   clipboard button: over Tailscale the page is plain http, which is not a
 *   secure context, and navigator.clipboard fails there — on the friend's
 *   machine but not on localhost, exactly where a demo wouldn't catch it.
 * - Readiness is server truth: the button renders from the roster broadcast,
 *   not from a local flag, and un-ready is allowed until the seed is dealt.
 */
import { DEFAULT_PORT, type LobbyPlayer } from '../net/protocol.ts';
import { formatSeed } from '../sim/util/rng.ts';

export interface LobbyScreen {
  showRoster(room: string, players: LobbyPlayer[], myId: string): void;
  showCountdown(ms: number, seed: number): void;
  showError(reason: string): void;
  remove(): void;
}

export interface LobbyFacts {
  /** Map name — "Switchback" — shown as the sector. */
  sector: string;
  waves: number;
  lives: number;
}

export interface LobbyOptions {
  /** Room code from the URL, joined without showing the form. */
  prefillRoom?: string;
  /** Rematch rejoin: skip the form entirely and connect straight away. */
  autoJoin?: { name: string; room: string };
  facts: LobbyFacts;
  onSubmit(name: string, room?: string): void;
  onReady(ready: boolean): void;
}

const STYLE = `
#lobby-screen{position:absolute;inset:0;z-index:10;overflow:hidden;background:#0b0c16;
  color:#e9e9ed;font:400 14px/1.5 Inter,system-ui,sans-serif}
#lobby-screen .lb-glow{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(circle at 50% 46%,rgba(145,132,217,.14),rgba(6,7,13,.6) 62%)}
#lobby-screen .lb-bar{position:relative;display:flex;align-items:center;gap:14px;height:52px;padding:0 40px}
#lobby-screen .lb-brand{font:600 10.5px/1 Inter,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#9184d9}
#lobby-screen .lb-sep{width:1px;height:14px;background:rgba(233,233,237,.16)}
#lobby-screen .lb-sub{font:400 10.5px/1 Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#75798c}
#lobby-screen .lb-conn{margin-left:auto;display:flex;align-items:center;gap:7px;font:400 10.5px/1 Inter,sans-serif;color:#9397ab}
#lobby-screen .lb-dot{width:6px;height:6px;border-radius:50%;background:#b5abfc;box-shadow:0 0 8px rgba(181,171,252,.8)}
#lobby-screen .lb-dot.bad{background:#e06d6d;box-shadow:0 0 8px rgba(224,109,109,.8)}
#lobby-screen .lb-body{position:relative;display:flex;gap:72px;justify-content:center;align-items:flex-start;
  padding:56px 64px;flex-wrap:wrap}
#lobby-screen .lb-col{display:flex;flex-direction:column;gap:26px;width:min(452px,90vw)}
#lobby-screen .lb-kicker{font:600 10px/1 Inter,sans-serif;letter-spacing:.24em;text-transform:uppercase;color:#b5abfc}
#lobby-screen .lb-kicker.bad{color:#e06d6d}
#lobby-screen .lb-title{font:500 56px/1.05 Inter,sans-serif;letter-spacing:-.03em;margin:0}
#lobby-screen .lb-lede{font:400 14px/1.7 Inter,sans-serif;color:#9397ab;max-width:420px;text-wrap:pretty}
#lobby-screen .lb-label{font:600 10px/1 Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#75798c}
#lobby-screen .lb-field{display:flex;align-items:center;height:44px;padding:0 14px;border-radius:8px;
  background:rgba(35,37,50,.72);box-shadow:inset 0 0 0 1px rgba(233,233,237,.16);border:none;outline:none;
  font:400 15px/1 Inter,sans-serif;color:#e9e9ed;width:100%;box-sizing:border-box}
#lobby-screen .lb-field:focus{box-shadow:inset 0 0 0 1px rgba(145,132,217,.6)}
#lobby-screen .lb-btn{display:flex;align-items:center;justify-content:center;height:46px;padding:0 20px;
  border:1px solid #9184d9;border-radius:8px;background:none;cursor:pointer;
  font:600 14px/1 Inter,sans-serif;color:#d2cefd;box-shadow:0 0 22px rgba(145,132,217,.2)}
#lobby-screen .lb-btn:hover{background:rgba(145,132,217,.12)}
#lobby-screen .lb-btn.dim{border-color:rgba(233,233,237,.18);color:#cfd3e5;box-shadow:none}
#lobby-screen .lb-btn.ghost{border-color:rgba(145,132,217,.35);color:#9397ab;box-shadow:none}
#lobby-screen .lb-or{display:flex;align-items:center;gap:12px}
#lobby-screen .lb-or span{flex:1;height:1px;background:linear-gradient(to right,transparent,rgba(233,233,237,.16))}
#lobby-screen .lb-or span:last-child{background:linear-gradient(to left,transparent,rgba(233,233,237,.16))}
#lobby-screen .lb-or b{font:400 10.5px/1 Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#75798c}
#lobby-screen .lb-code-in{width:7.5ch;text-transform:uppercase;font:600 20px/1 ui-monospace,Menlo,monospace;
  letter-spacing:.42em;text-align:center;padding:0 8px}
#lobby-screen .lb-how{display:flex;flex-direction:column;gap:22px;width:min(400px,90vw);padding-top:56px}
#lobby-screen .lb-how-item{display:flex;gap:14px}
#lobby-screen .lb-how-n{font:400 11px/1.3 ui-monospace,Menlo,monospace;color:#9184d9;padding-top:2px}
#lobby-screen .lb-how-t{font:600 13px/1.4 Inter,sans-serif;display:block}
#lobby-screen .lb-how-d{font:400 12px/1.65 Inter,sans-serif;color:#9397ab}
#lobby-screen .lb-rule{height:1px;background:linear-gradient(to right,rgba(233,233,237,.16) 0,rgba(233,233,237,.16) 220px,transparent 320px)}
#lobby-screen .lb-fine{font:400 11.5px/1.6 Inter,sans-serif;color:#75798c}
#lobby-screen .lb-bigcode{display:flex;align-items:center;justify-content:center;height:112px;border-radius:10px;
  background:rgba(35,37,50,.6);box-shadow:inset 0 0 0 1px rgba(145,132,217,.4),0 0 40px rgba(145,132,217,.1);
  border:none;outline:none;width:100%;box-sizing:border-box;text-align:center;
  font:500 64px/1 ui-monospace,Menlo,monospace;letter-spacing:.28em;color:#e9e9ed;
  text-shadow:0 0 26px rgba(181,171,252,.45)}
#lobby-screen .lb-link{font:400 12.5px/1 ui-monospace,Menlo,monospace;color:#9397ab;height:40px}
#lobby-screen .lb-seat{display:flex;align-items:center;gap:16px;min-height:66px;padding:0 18px;border-radius:10px;
  background:rgba(35,37,50,.7);box-shadow:inset 0 0 0 1px rgba(233,233,237,.12)}
#lobby-screen .lb-seat.you{box-shadow:inset 0 0 0 1px rgba(143,196,250,.4)}
#lobby-screen .lb-seat.them{box-shadow:inset 0 0 0 1px rgba(252,192,138,.35)}
#lobby-screen .lb-seat.empty{background:rgba(20,22,36,.4)}
#lobby-screen .lb-seat-name{font:600 15px/1.2 Inter,sans-serif}
#lobby-screen .lb-seat-sub{font:400 11px/1.2 Inter,sans-serif;color:#75798c}
#lobby-screen .lb-pill{margin-left:auto;padding:5px 11px;border-radius:6px;background:rgba(233,233,237,.08);
  font:600 11px/1 Inter,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#9397ab;display:flex;align-items:center;gap:7px}
#lobby-screen .lb-pill.on{background:rgba(145,132,217,.14);color:#b5abfc}
#lobby-screen .lb-pill.on i{width:5px;height:5px;border-radius:50%;background:#b5abfc;box-shadow:0 0 6px rgba(181,171,252,.9);display:block}
#lobby-screen .lb-facts{display:flex;flex-direction:column;gap:9px;max-width:280px}
#lobby-screen .lb-facts div{display:flex;justify-content:space-between;font:400 11.5px/1 Inter,sans-serif}
#lobby-screen .lb-facts span:first-child{color:#75798c}
#lobby-screen .lb-facts span:last-child{color:#cfd3e5}
#lobby-screen .lb-leave{background:none;border:none;cursor:pointer;font:400 12px/1 Inter,sans-serif;color:#75798c;padding:0;text-align:left}
#lobby-screen .lb-leave:hover{color:#b5abfc}
#lobby-screen .lb-center{position:relative;display:flex;flex-direction:column;align-items:center;gap:26px;padding-top:64px}
#lobby-screen .lb-ring{position:relative;display:grid;place-items:center;width:220px;height:220px}
#lobby-screen .lb-ring i{position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(181,171,252,.28),0 0 60px rgba(145,132,217,.22)}
#lobby-screen .lb-ring i+i{inset:26px;box-shadow:inset 0 0 0 1px rgba(181,171,252,.14)}
#lobby-screen .lb-count{font:500 108px/1 Inter,sans-serif;color:#f5f4ff;text-shadow:0 0 40px rgba(181,171,252,.55)}
#lobby-screen .lb-vsline{display:flex;align-items:center;gap:20px;font:600 14px/1 Inter,sans-serif}
#lobby-screen .lb-vsline em{font:400 11px/1 Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#75798c;font-style:normal}
#lobby-screen .lb-vsline b i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:9px}
#lobby-screen .lb-mono{font:400 11.5px/1 ui-monospace,Menlo,monospace;color:#9397ab}
#lobby-screen .lb-hex{width:26px;height:26px;flex:none}
`;

const hexSvg = (color: string, dim = false): string =>
  `<svg class="lb-hex" viewBox="0 0 40 40" style="filter:drop-shadow(0 0 6px ${color}73)">` +
  `<path d="M20 3 L34 11 L34 29 L20 37 L6 29 L6 11 Z" fill="${color}" fill-opacity="${dim ? '.14' : '.2'}" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>` +
  `<circle cx="20" cy="20" r="5.5" fill="${color}"${dim ? ' fill-opacity=".6"' : ''}/></svg>`;

const YOU = '#8fc4fa';
const THEM = '#fcc08a';

export function createLobbyScreen(parent: HTMLElement, opts: LobbyOptions): LobbyScreen {
  if (!document.getElementById('lobby-style')) {
    const style = document.createElement('style');
    style.id = 'lobby-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const el = document.createElement('div');
  el.id = 'lobby-screen';
  parent.style.position = 'relative';
  parent.appendChild(el);

  const savedName = localStorage.getItem('race-name') ?? '';
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastPlayers: LobbyPlayer[] = [];
  let lastMyId = '';
  let lastRoom = '';

  const bar = (sub: string, conn: string, bad = false): string =>
    `<div class="lb-bar"><span class="lb-brand">${opts.facts.sector}</span><span class="lb-sep"></span>` +
    `<span class="lb-sub">${sub}</span>` +
    `<span class="lb-conn"><span class="lb-dot${bad ? ' bad' : ''}"></span>${conn}</span></div>`;

  function nameField(): string {
    return `<div style="display:flex;flex-direction:column;gap:8px"><span class="lb-label">Callsign</span>` +
      `<input id="race-name" class="lb-field" placeholder="your name" value="${savedName}" maxlength="24">` +
      `</div>`;
  }

  function submit(room?: string): void {
    const name = (el.querySelector('#race-name') as HTMLInputElement | null)?.value.trim() || 'pilot';
    localStorage.setItem('race-name', name);
    el.innerHTML = bar('Race relay', 'connecting…') +
      `<div class="lb-glow"></div><div class="lb-center"><span class="lb-lede">Raising the relay…</span></div>`;
    if (room === undefined) opts.onSubmit(name);
    else opts.onSubmit(name, room);
  }

  function showForm(): void {
    const f = opts.facts;
    el.innerHTML = bar('Race relay', `relay · :${DEFAULT_PORT}`) + `<div class="lb-glow"></div>` +
      `<div class="lb-body"><div class="lb-col">` +
      `<div style="display:flex;flex-direction:column;gap:10px">` +
      `<span class="lb-kicker">Sector 01</span><h1 class="lb-title">Race</h1>` +
      `<span class="lb-lede">Two pilots, one seed. Identical waves on separate skies — you're racing their run, not fighting it.</span></div>` +
      nameField() +
      `<div style="display:flex;flex-direction:column;gap:14px">` +
      `<button id="race-create" class="lb-btn">Create a room</button>` +
      `<div class="lb-or"><span></span><b>or join one</b><span></span></div>` +
      `<div style="display:flex;gap:10px">` +
      `<input id="race-code" class="lb-field lb-code-in" placeholder="CODE" maxlength="4">` +
      `<button id="race-join" class="lb-btn dim" style="flex:1">Join</button>` +
      `</div></div></div>` +
      `<div class="lb-how"><span class="lb-label" style="letter-spacing:.18em">How a race works</span>` +
      `<div class="lb-how-item"><span class="lb-how-n">01</span><span><span class="lb-how-t">One seed, two boards</span>` +
      `<span class="lb-how-d">The relay hands both pilots the same seed, so every wave arrives in the same order with the same jitter. Nothing about the board is luck.</span></span></div>` +
      `<div class="lb-how-item"><span class="lb-how-n">02</span><span><span class="lb-how-t">Ahead or behind, live</span>` +
      `<span class="lb-how-d">Wave, lives and elapsed time cross the wire twice a second. You see their standing, never their board.</span></span></div>` +
      `<div class="lb-how-item"><span class="lb-how-n">03</span><span><span class="lb-how-t">Your seat is held</span>` +
      `<span class="lb-how-d">Lose the connection and you can reclaim the same seat and carry on. Walk away and it's a forfeit.</span></span></div>` +
      `<div class="lb-rule"></div>` +
      `<span class="lb-fine">${f.waves} waves · ${f.lives} lives · ranked on waves cleared, then lives kept, then time.</span>` +
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

  function showDeepLink(code: string): void {
    const f = opts.facts;
    el.innerHTML = bar('Race relay', `relay · :${DEFAULT_PORT}`) + `<div class="lb-glow"></div>` +
      `<div class="lb-body"><div class="lb-col" style="padding-top:40px">` +
      `<div style="display:flex;flex-direction:column;gap:12px">` +
      `<span class="lb-kicker">Invited to a race</span>` +
      `<h1 class="lb-title" style="font-size:44px">Room <span style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#d2cefd">${code.toUpperCase()}</span></h1>` +
      `<span class="lb-lede">Sector 01 · ${f.sector} — ${f.waves} waves, ${f.lives} lives, one seed shared with your opponent.</span></div>` +
      nameField() +
      `<div style="display:flex;align-items:center;gap:14px">` +
      `<button id="race-go" class="lb-btn" style="width:180px">Join room</button>` +
      `<span class="lb-fine">or <a href="?race" style="color:#b5abfc;text-decoration:none">start your own instead</a></span>` +
      `</div></div></div>`;
    el.querySelector('#race-go')!.addEventListener('click', () => submit(code));
    el.querySelector('#race-name')!.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') submit(code);
    });
  }

  const seat = (p: LobbyPlayer, mine: boolean, n: number): string =>
    `<div class="lb-seat ${mine ? 'you' : 'them'}">${hexSvg(mine ? YOU : THEM)}` +
    `<span style="display:flex;flex-direction:column;gap:2px"><span class="lb-seat-name">${p.name}</span>` +
    `<span class="lb-seat-sub">${mine ? 'you' : 'opponent'} · seat ${n}</span></span>` +
    (p.ready
      ? `<span class="lb-pill on"><i></i>Ready</span>`
      : `<span class="lb-pill">Not ready</span>`) +
    `</div>`;

  function showRoster(room: string, players: LobbyPlayer[], myId: string): void {
    lastPlayers = players;
    lastMyId = myId;
    lastRoom = room;
    const me = players.find((p) => p.playerId === myId);
    const them = players.find((p) => p.playerId !== myId);

    if (players.length < 2) {
      // L3 — the code is the whole screen; passing it on is the only job.
      el.innerHTML = bar('Race relay', 'connected') + `<div class="lb-glow"></div>` +
        `<div class="lb-body"><div class="lb-col" style="width:min(560px,90vw)">` +
        `<span class="lb-label" style="letter-spacing:.24em">Room code — click to select</span>` +
        `<input class="lb-bigcode" readonly value="${room}" onclick="this.select()">` +
        `<div style="display:flex;flex-direction:column;gap:8px"><span class="lb-label">or send the link</span>` +
        `<input class="lb-field lb-link" readonly value="${location.origin}/?race=${room}" onclick="this.select()"></div>` +
        `<span class="lb-fine" style="max-width:440px">Both fields select on click — the relay runs over plain http on your tailnet, where the browser refuses clipboard access.</span>` +
        `</div><div class="lb-how" style="gap:16px;padding-top:8px">` +
        `<span class="lb-label" style="letter-spacing:.18em">Pilots</span>` +
        (me ? seat(me, true, 1) : '') +
        `<div class="lb-seat empty"><span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(233,233,237,.18)"><span style="width:6px;height:6px;border-radius:50%;background:rgba(233,233,237,.25)"></span></span>` +
        `<span style="display:flex;flex-direction:column;gap:2px"><span class="lb-seat-name" style="font-weight:400;color:#9397ab">Empty seat</span>` +
        `<span class="lb-seat-sub">waiting for someone to join…</span></span></div>` +
        `<div class="lb-rule" style="margin:6px 0"></div>` +
        `<div class="lb-facts">` +
        `<div><span>Sector</span><span>01 · ${opts.facts.sector}</span></div>` +
        `<div><span>Waves</span><span>${opts.facts.waves}</span></div>` +
        `<div><span>Starting lives</span><span>${opts.facts.lives}</span></div>` +
        `<div><span>Ranked by</span><span>waves · lives · time</span></div></div>` +
        `<button class="lb-leave" id="race-leave">Leave the room</button>` +
        `</div></div>`;
    } else {
      // L4/L5 — the ready action takes the emphasis; both states stay visible.
      const iAmReady = me?.ready === true;
      const kicker = iAmReady ? 'Standing by' : 'Room full';
      const title = iAmReady ? `Waiting on ${them?.name ?? 'them'}` : 'Two pilots on the line';
      el.innerHTML = bar(`Room <span style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.2em;color:#cfd3e5">${room}</span>`, 'both connected') +
        `<div class="lb-glow"></div>` +
        `<div class="lb-body"><div class="lb-col" style="width:min(1104px,92vw)">` +
        `<div style="display:flex;flex-direction:column;gap:10px">` +
        `<span class="lb-kicker">${kicker}</span><h1 class="lb-title" style="font-size:46px">${title}</h1></div>` +
        `<div style="display:flex;align-items:stretch;gap:22px;flex-wrap:wrap">` +
        `<div style="flex:1;min-width:280px">${me ? seat(me, true, 1) : ''}</div>` +
        `<span style="display:grid;place-items:center;width:44px" class="lb-sub">vs</span>` +
        `<div style="flex:1;min-width:280px">${them ? seat(them, false, 2) : ''}</div></div>` +
        `<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">` +
        (iAmReady
          ? `<button id="race-unready" class="lb-btn ghost" style="width:260px;height:52px">You're ready</button>` +
            `<span class="lb-fine" style="max-width:420px">The countdown starts the instant they confirm. You can un-ready until then.</span>`
          : `<button id="race-ready" class="lb-btn" style="width:260px;height:52px;font-size:15px">Ready</button>` +
            `<span class="lb-fine" style="max-width:420px">Both ready starts a three-second countdown. The seed is issued at that point, not before — nobody gets a head start on the board.</span>`) +
        `<button class="lb-leave" id="race-leave">Leave the room</button>` +
        `</div></div></div>`;
      el.querySelector('#race-ready')?.addEventListener('click', () => opts.onReady(true));
      el.querySelector('#race-unready')?.addEventListener('click', () => opts.onReady(false));
    }
    el.querySelector('#race-leave')?.addEventListener('click', () => {
      location.href = '?race';
    });
  }

  if (opts.autoJoin !== undefined) {
    el.innerHTML = bar('Race relay', 'rejoining…') + `<div class="lb-glow"></div>` +
      `<div class="lb-center"><span class="lb-lede">Rejoining room <b style="color:#d2cefd">${opts.autoJoin.room}</b>…</span></div>`;
    // Deferred a tick so the caller has its handle before callbacks fire.
    const { name, room } = opts.autoJoin;
    setTimeout(() => opts.onSubmit(name, room), 0);
  } else if (opts.prefillRoom !== undefined) {
    showDeepLink(opts.prefillRoom);
  } else {
    showForm();
  }

  return {
    showRoster,

    showCountdown(ms, seed) {
      // Local rendering of a relative delay; no cross-machine clocks involved.
      const me = lastPlayers.find((p) => p.playerId === lastMyId);
      const them = lastPlayers.find((p) => p.playerId !== lastMyId);
      const endsAt = performance.now() + ms;
      const f = opts.facts;
      el.innerHTML = bar(`Room <span style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.2em;color:#cfd3e5">${lastRoom}</span>`, 'both ready') +
        `<div class="lb-glow"></div>` +
        `<div class="lb-center">` +
        `<span class="lb-kicker" style="letter-spacing:.3em">Both ready</span>` +
        `<div class="lb-ring"><i></i><i></i><span class="lb-count" id="race-count"></span></div>` +
        `<div class="lb-vsline"><b><i style="background:${YOU};box-shadow:0 0 8px ${YOU}e6"></i>${me?.name ?? 'you'}</b>` +
        `<em>vs</em><b><i style="background:${THEM};box-shadow:0 0 8px ${THEM}e6"></i>${them?.name ?? 'opponent'}</b></div>` +
        `<div style="display:flex;flex-direction:column;align-items:center;gap:7px">` +
        `<span class="lb-mono">seed 0x${formatSeed(seed)} · ${f.waves} waves · ${f.lives} lives</span>` +
        `<span class="lb-fine">Identical waves on both boards.</span></div></div>`;
      const count = el.querySelector('#race-count')!;
      const tick = (): void => {
        count.textContent = String(Math.max(1, Math.ceil((endsAt - performance.now()) / 1000)));
      };
      tick();
      timer = setInterval(tick, 100);
    },

    showError(reason) {
      // L7 — every reason the relay can send gets a plain sentence and a way
      // forward. The reconnect banner lives in the race strip, not here.
      const fullRoom = /room is full/.test(reason);
      const noRoom = /^no room/.test(reason);
      const unreachable = /could not reach/.test(reason);
      const title = fullRoom ? 'That room already has two pilots'
        : noRoom ? `No room called ${reason.replace('no room ', '')}`
        : unreachable ? 'The relay is not answering'
        : 'The race hit a snag';
      const lede = fullRoom ? "A race is two seats and both are taken. Start your own room and send the code, or wait for theirs to finish."
        : noRoom ? 'That code has expired or was mistyped — codes are four characters, and rooms close a minute after both pilots leave.'
        : unreachable ? `Nothing is listening at ${location.host} — the relay isn't running, or the tunnel to it is down.`
        : reason;
      el.innerHTML = bar('Race relay', 'refused', true) +
        `<div class="lb-glow" style="background:radial-gradient(circle at 50% 44%,rgba(224,109,109,.12),rgba(6,7,13,.7) 62%)"></div>` +
        `<div class="lb-body"><div class="lb-col" style="width:min(600px,90vw);padding-top:24px">` +
        `<div style="display:flex;flex-direction:column;gap:12px">` +
        `<span class="lb-kicker bad">Couldn't join</span>` +
        `<h1 class="lb-title" style="font-size:44px">${title}</h1>` +
        `<span class="lb-lede" style="max-width:470px">${lede}</span></div>` +
        `<div style="display:flex;gap:12px">` +
        `<button id="race-again" class="lb-btn" style="width:200px">Create a room</button>` +
        `<button id="race-retry" class="lb-btn dim" style="width:170px">${unreachable ? 'Try again' : 'Try another code'}</button>` +
        `</div></div></div>`;
      el.querySelector('#race-again')!.addEventListener('click', () => showForm());
      el.querySelector('#race-retry')!.addEventListener('click', () => showForm());
    },

    remove() {
      if (timer !== null) clearInterval(timer);
      el.remove();
      document.getElementById('lobby-style')?.remove();
    },
  };
}
