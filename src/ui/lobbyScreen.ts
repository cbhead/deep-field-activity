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
import type { LobbyPlayer, Standing } from '../net/protocol.ts';
import { fmtTime } from '../net/report.ts';
import { formatSeed } from '../sim/util/rng.ts';
import { CAMPAIGN, levelById } from '../content/levels.ts';
import { DIFFICULTIES, DIFFICULTY_ORDER, DEFAULT_DIFFICULTY, type DifficultyId } from '../content/difficulty.ts';
import { getWebhook, postToDiscord, saveWebhook } from './discord.ts';
import { ensureRaceStyle, raceBar, hexSvg, escapeHtml, YOU, THEM } from './raceTheme.ts';

export interface LobbyScreen {
  /** level/diff are the room's pick, as re-dealt by the server. */
  showRoster(room: string, players: LobbyPlayer[], myId: string, level: string, diff: string): void;
  /** You hold no seat: who is playing, who is ahead of you, and how long. */
  showWatching(players: LobbyPlayer[], watchers: LobbyPlayer[], myId: string, level: string, diff: string): void;
  /** Live figures while watching. Updates in place — this arrives at 2Hz. */
  showWatchStatus(standings: Standing[]): void;
  showCountdown(ms: number, seed: number): void;
  showError(reason: string): void;
  remove(): void;
}

export interface RaceChoice {
  level: string;
  diff: string;
}

/** Everything the lobby needs to ask for a seat. */
export interface JoinRequest {
  name: string;
  /** A typed room code. */
  room?: string;
  /** A Discord instance — join-or-create, no code involved. */
  instance?: string;
  /** The board to play, honoured only if this client creates the room. */
  choice?: RaceChoice;
}

export interface LobbyOptions {
  /** Room code from the URL, joined without showing the form. */
  prefillRoom?: string;
  /** Rematch rejoin: skip the form entirely and connect straight away. */
  autoJoin?: { name: string; room: string };
  /**
   * Discord identity. Its presence is what puts the whole screen in Activity
   * mode: there is no name to ask for, no code to hand out and no link to send,
   * because everyone who opened the activity in this voice channel is already
   * addressed by the same instance. The form, the deep-link screen, the invite
   * field and the webhook row all disappear, and choosing the board moves
   * inside the room — see `onPick`.
   */
  identity?: { name: string; instance: string };
  /**
   * The host:port the client actually dials for the relay socket. Required, and
   * passed in rather than re-derived here, because the two can differ: under a
   * `PORT=` override the page's own origin is not DEFAULT_PORT. Naming the real
   * target is the whole point — a failure that cites the wrong port sends you
   * debugging a port nothing ever tried to reach.
   */
  relayHost: string;
  onSubmit(join: JoinRequest): void;
  onReady(ready: boolean): void;
  /**
   * Change the room's sector/difficulty from inside the lobby. Only the first
   * seat may, and only the server decides that — this fires optimistically and
   * the authoritative answer arrives back as a lobby broadcast.
   */
  onPick(level: string, diff: string): void;
  /**
   * Back to a fresh lobby — from "Leave the room", and from "start your own
   * instead" on a deep link. Both used to assign `location.href`, which is a
   * page load; where to go is the router's decision now, not this screen's.
   */
  onLeave(): void;
}

/** Room picks come off the wire unvalidated; fall back to the baseline. */
const levelOr01 = (id: string) => levelById(id) ?? CAMPAIGN[0]!;
const diffOrStd = (id: string): DifficultyId =>
  Object.hasOwn(DIFFICULTIES, id) ? (id as DifficultyId) : DEFAULT_DIFFICULTY;


export function createLobbyScreen(parent: HTMLElement, opts: LobbyOptions): LobbyScreen {
  ensureRaceStyle();

  const el = document.createElement('div');
  el.id = 'lobby-screen';
  el.className = 'race-screen';
  parent.appendChild(el);

  // The header chip names the port we really dial, not the compiled-in default.
  // A bare hostname (relay behind a proxy on 80/443) has no port to show, so it
  // stands in whole rather than rendering an empty `:`.
  const relayChip = `relay · ${opts.relayHost.includes(':') ? `:${opts.relayHost.split(':').pop()}` : opts.relayHost}`;

  const savedName = localStorage.getItem('race-name') ?? '';
  let timer: ReturnType<typeof setInterval> | null = null;
  /** The deferred auto-rejoin, cancellable by `remove()`. */
  let joinTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPlayers: LobbyPlayer[] = [];
  let lastMyId = '';
  let lastRoom = '';
  // The room's authoritative pick, as last re-dealt by the server.
  let lastLevel = CAMPAIGN[0]!.id;
  let lastDiff: string = DEFAULT_DIFFICULTY;
  // The creator's form selection, remembered across visits.
  let pickLevel = levelOr01(localStorage.getItem('race-level') ?? '').id;
  let pickDiff: string = diffOrStd(localStorage.getItem('race-diff') ?? '');

  // The invite link must carry an address the FRIEND can reach. The server
  // knows its own Tailscale IP better than this page does (the host may have
  // opened localhost), so ask it. In dev, Vite answers 404 and the page's own
  // origin stands. Re-render the waiting screen if the answer arrives late.
  // Skipped entirely in Activity mode: `/info` exists to build an invite link
  // out of the host's tailnet address, and inside Discord there is no link to
  // build — the instance is the invitation.
  let inviteBase = location.origin;
  if (opts.identity === undefined) {
    void fetch('/info')
      .then((r) => (r.ok ? (r.json() as Promise<{ tailscaleIp: string | null; port: number }>) : null))
      .then((info) => {
        if (info?.tailscaleIp) {
          inviteBase = `http://${info.tailscaleIp}:${info.port}`;
          if (el.querySelector('.lb-bigcode') && lastRoom !== '') showRoster(lastRoom, lastPlayers, lastMyId, lastLevel, lastDiff);
        }
      })
      .catch(() => undefined);
  }

  const inviteLink = (room: string): string => `${inviteBase}/?race=${room}`;

  /**
   * "Send to Discord" posts the invite to a channel webhook the user pastes
   * in once (kept in localStorage, this browser only). A webhook is the one
   * Discord door a plain-http page can use: no OAuth, no SDK, and the POST is
   * https so there's no mixed-content problem. Discord's own embed crawler
   * can never preview a tailnet URL, so the message IS the preview.
   */
  function sendToDiscord(room: string): void {
    const btn = el.querySelector('#race-discord') as HTMLButtonElement | null;
    if (getWebhook() === null) {
      (el.querySelector('#race-discord-cfg') as HTMLElement).style.display = 'flex';
      el.querySelector<HTMLInputElement>('#race-webhook')?.focus();
      return;
    }
    if (btn) btn.textContent = 'Sending…';
    void postToDiscord(
      `Race me in ${levelOr01(lastLevel).name} (${DIFFICULTIES[diffOrStd(lastDiff)].name}) — room **${room}**\n` +
      `${inviteLink(room)}\n(Needs Tailscale up; the link only works on our tailnet.)`,
    ).then((ok) => {
      if (btn) btn.textContent = ok ? 'Sent to Discord ✓' : "Couldn't send — check the webhook";
    });
  }

  function wireDiscord(room: string): void {
    el.querySelector('#race-discord')?.addEventListener('click', () => sendToDiscord(room));
    el.querySelector('#race-webhook-save')?.addEventListener('click', () => {
      const input = el.querySelector('#race-webhook') as HTMLInputElement;
      if (!saveWebhook(input.value.trim())) {
        input.style.boxShadow = 'inset 0 0 0 1px rgba(224,109,109,.6)';
        return;
      }
      (el.querySelector('#race-discord-cfg') as HTMLElement).style.display = 'none';
      sendToDiscord(room);
    });
  }

  const discordRow = (): string =>
    `<div style="display:flex;align-items:center;gap:14px">` +
    `<button id="race-discord" class="lb-btn dim" style="height:40px;font-size:13px">Send to Discord</button>` +
    `<button class="lb-leave" onclick="const c=document.getElementById('race-discord-cfg');c.style.display=c.style.display==='none'?'flex':'none'">webhook…</button></div>` +
    `<div id="race-discord-cfg" style="display:none;flex-direction:column;gap:8px">` +
    // The size lives in .lb-webhook rather than a style= attribute so the
    // coarse-pointer 16px rule can reach it — an inline declaration wins over
    // any stylesheet, and a sub-16px field makes iOS zoom the page on focus.
    `<input id="race-webhook" class="lb-field lb-webhook" ` +
    `inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" ` +
    `placeholder="https://discord.com/api/webhooks/…" value="${localStorage.getItem('discord-webhook') ?? ''}">` +
    `<div style="display:flex;align-items:center;gap:12px">` +
    `<button id="race-webhook-save" class="lb-btn dim" style="height:36px;font-size:12px">Save & send</button>` +
    // No longer warns about configuring one machine only: match results are
    // sent by the relay now, from DISCORD_WEBHOOK_URL in its environment. This
    // webhook sends the invite and nothing else, so two browsers holding one is
    // harmless.
    `<span class="lb-fine">Discord: channel → Edit → Integrations → Webhooks → New Webhook → Copy URL. Stays in this browser, ` +
    `and sends the invite only. Match results are posted by the relay — see DISCORD_WEBHOOK_URL in .env.example.</span>` +
    `</div></div>`;

  const bar = raceBar;

  function nameField(): string {
    return `<div style="display:flex;flex-direction:column;gap:8px"><span class="lb-label">Callsign</span>` +
      `<input id="race-name" class="lb-field" placeholder="your name" value="${savedName}" maxlength="24"` +
      ` autocapitalize="words" autocomplete="nickname" autocorrect="off" enterkeyhint="go"` +
      ` aria-label="Callsign">` +
      `</div>`;
  }

  function submit(room?: string): void {
    const name = (el.querySelector('#race-name') as HTMLInputElement | null)?.value.trim() || 'pilot';
    localStorage.setItem('race-name', name);
    el.innerHTML = bar('Race', 'Race relay', 'connecting…') +
      `<div class="lb-glow"></div><div class="lb-center"><span class="lb-lede">Raising the relay…</span></div>`;
    if (room === undefined) opts.onSubmit({ name, choice: { level: pickLevel, diff: pickDiff } });
    else opts.onSubmit({ name, room });
  }

  function pickFine(): string {
    const lv = levelOr01(pickLevel);
    const df = DIFFICULTIES[diffOrStd(pickDiff)];
    return `${lv.waves.length} waves · ${df.startingLives} lives · ranked on waves cleared, then lives kept, then time.`;
  }

  function showForm(): void {
    const pills = (items: readonly { id: string; name: string }[], group: string, on: string): string =>
      `<div class="lb-picks" id="${group}">` +
      items.map((i) => `<button class="lb-pick${i.id === on ? ' on' : ''}" data-id="${i.id}">${i.name}</button>`).join('') +
      `</div>`;
    el.innerHTML = bar('Race', 'Race relay', relayChip) + `<div class="lb-glow"></div>` +
      `<div class="lb-body"><div class="lb-col">` +
      `<div style="display:flex;flex-direction:column;gap:10px">` +
      `<span class="lb-kicker">Head to head</span><h1 class="lb-title">Race</h1>` +
      `<span class="lb-lede">Two pilots, one seed. Identical waves on separate skies — you're racing their run, not fighting it.</span></div>` +
      nameField() +
      `<div style="display:flex;flex-direction:column;gap:8px"><span class="lb-label">Sector</span>` +
      pills(CAMPAIGN, 'pick-level', pickLevel) + `</div>` +
      `<div style="display:flex;flex-direction:column;gap:8px"><span class="lb-label">Difficulty</span>` +
      pills(DIFFICULTY_ORDER.map((d) => DIFFICULTIES[d]), 'pick-diff', pickDiff) + `</div>` +
      `<div style="display:flex;flex-direction:column;gap:14px">` +
      `<button id="race-create" class="lb-btn">Create a room</button>` +
      `<div class="lb-or"><span></span><b>or join one</b><span></span></div>` +
      `<div style="display:flex;gap:10px">` +
      // inputmode is `text`, NOT `numeric`: CODE_ALPHABET in server/index.ts is
      // alphanumeric. autocapitalize matches the field's own uppercase
      // transform; the value is case-safe either way, since the server
      // upper-cases what it receives.
      `<input id="race-code" class="lb-field lb-code-in" placeholder="CODE" maxlength="4"` +
      ` inputmode="text" autocapitalize="characters" autocorrect="off" autocomplete="off"` +
      ` spellcheck="false" enterkeyhint="go" aria-label="Room code">` +
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
      `<span class="lb-fine" id="pick-fine">${pickFine()}</span>` +
      `</div></div>`;
    const wirePicks = (group: string, set: (id: string) => void): void => {
      el.querySelector(`#${group}`)?.addEventListener('click', (ev) => {
        const target = (ev.target as HTMLElement).closest('.lb-pick');
        if (!(target instanceof HTMLElement) || target.dataset['id'] === undefined) return;
        set(target.dataset['id']);
        el.querySelectorAll(`#${group} .lb-pick`).forEach((p) =>
          p.classList.toggle('on', p === target));
        const fine = el.querySelector('#pick-fine');
        if (fine) fine.textContent = pickFine();
      });
    };
    wirePicks('pick-level', (id) => {
      pickLevel = id;
      localStorage.setItem('race-level', id);
    });
    wirePicks('pick-diff', (id) => {
      pickDiff = id;
      localStorage.setItem('race-diff', id);
    });
    el.querySelector('#race-create')!.addEventListener('click', () => submit());
    const joinNow = (): void => {
      const code = (el.querySelector('#race-code') as HTMLInputElement).value.trim();
      if (code.length === 4) submit(code);
    };
    el.querySelector('#race-join')!.addEventListener('click', joinNow);
    el.querySelector('#race-code')!.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') joinNow();
    });
    // Return on the callsign creates the room. showDeepLink already did this;
    // this form did not, so Return simply did nothing — and the on-screen
    // keyboard's "go" key now promises otherwise.
    el.querySelector('#race-name')!.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') submit();
    });
  }

  function showDeepLink(code: string): void {
    el.innerHTML = bar('Race', 'Race relay', relayChip) + `<div class="lb-glow"></div>` +
      `<div class="lb-body"><div class="lb-col" style="padding-top:40px">` +
      `<div style="display:flex;flex-direction:column;gap:12px">` +
      `<span class="lb-kicker">Invited to a race</span>` +
      `<h1 class="lb-title" style="font-size:44px">Room <span style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#d2cefd">${code.toUpperCase()}</span></h1>` +
      `<span class="lb-lede">The host picks the sector and difficulty — you'll see the loadout in the room. One seed, shared.</span></div>` +
      nameField() +
      `<div style="display:flex;align-items:center;gap:14px">` +
      `<button id="race-go" class="lb-btn" style="width:180px">Join room</button>` +
      `<span class="lb-fine">or <a id="race-own" href="?race" style="color:#b5abfc;text-decoration:none">start your own instead</a></span>` +
      `</div></div></div>`;
    el.querySelector('#race-go')!.addEventListener('click', () => submit(code));
    // Still a real anchor — a middle-click or "copy link" on a deep link should
    // behave like a link. Only the plain click is intercepted, so the ordinary
    // case routes in place instead of reloading the document.
    el.querySelector('#race-own')!.addEventListener('click', (ev) => {
      ev.preventDefault();
      opts.onLeave();
    });
    el.querySelector('#race-name')!.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') submit(code);
    });
  }

  /**
   * The board chooser, for Activity mode.
   *
   * On a plain URL the sector and difficulty are chosen in the creation form,
   * because there is one — you fill it in to make a room. An instance room has
   * no such moment: you are simply in it, alongside whoever else launched. So
   * the choice moves inside the room, and belongs to seat one, because two
   * people each believing they chose is a bug the seed would then disagree
   * about.
   *
   * The other seat sees the same control, disabled, rather than a different
   * screen — what is being played matters to both, and hiding it from the
   * person who cannot change it would leave them guessing.
   */
  function roomPicker(level: string, diff: string, mine: boolean): string {
    const pill = (id: string, label: string, on: boolean): string =>
      `<button class="lb-pick${on ? ' on' : ''}"${mine ? ` data-id="${id}"` : ' disabled style="opacity:.55;cursor:default"'}>${label}</button>`;
    return (
      `<div style="display:flex;flex-direction:column;gap:8px">` +
      `<span class="lb-label">Sector${mine ? '' : ' — seat one chooses'}</span>` +
      `<div class="lb-picks" id="room-level">` +
      CAMPAIGN.map((l) => pill(l.id, l.name, l.id === level)).join('') +
      `</div></div>` +
      `<div style="display:flex;flex-direction:column;gap:8px"><span class="lb-label">Difficulty</span>` +
      `<div class="lb-picks" id="room-diff">` +
      DIFFICULTY_ORDER.map((d) => pill(d, DIFFICULTIES[d].name, d === diff)).join('') +
      `</div></div>`
    );
  }

  /** Wire the room picker, if this client is allowed to use it. */
  function wireRoomPicker(mine: boolean): void {
    if (!mine) return;
    const on = (group: string, pick: (id: string) => void): void => {
      el.querySelector(`#${group}`)?.addEventListener('click', (ev) => {
        const target = (ev.target as HTMLElement).closest('.lb-pick');
        const id = target instanceof HTMLElement ? target.dataset['id'] : undefined;
        if (id === undefined) return;
        pick(id);
        // Fire and let the broadcast correct us. The server is the authority on
        // what the room is playing, and it re-deals to both clients — rendering
        // optimistically here would let the two disagree until the next lobby
        // message, which is exactly the window a countdown can start in.
        opts.onPick(lastLevel, lastDiff);
      });
    };
    on('room-level', (id) => {
      lastLevel = id;
      localStorage.setItem('race-level', id);
    });
    on('room-diff', (id) => {
      lastDiff = id;
      localStorage.setItem('race-diff', id);
    });
  }

  const seat = (p: LobbyPlayer, mine: boolean, n: number): string =>
    `<div class="lb-seat ${mine ? 'you' : 'them'}">${hexSvg(mine ? YOU : THEM)}` +
    `<span style="display:flex;flex-direction:column;gap:2px"><span class="lb-seat-name">${escapeHtml(p.name)}</span>` +
    `<span class="lb-seat-sub">${mine ? 'you' : 'opponent'} · seat ${n}</span></span>` +
    (p.ready
      ? `<span class="lb-pill on"><i></i>Ready</span>`
      : `<span class="lb-pill">Not ready</span>`) +
    `</div>`;

  /**
   * The queue's view. No seat, so no Ready button and nothing to choose — the
   * two questions worth answering are who is playing and how long until it is
   * you, and while a race runs, how it is going.
   *
   * The live figures are written into placeholders by `showWatchStatus` rather
   * than re-rendering: they arrive twice a second, and a screen that rebuilt
   * itself at 2Hz would flicker and lose any text selection.
   */
  function showWatching(
    players: LobbyPlayer[],
    watchers: LobbyPlayer[],
    myId: string,
    level: string,
    diff: string,
  ): void {
    const lv = levelOr01(level);
    const df = DIFFICULTIES[diffOrStd(diff)];
    const place = watchers.findIndex((w) => w.playerId === myId);
    const ahead = place < 0 ? 0 : place;
    const title = ahead === 0 ? "You're next" : 'Waiting for a seat';
    const lede =
      ahead === 0
        ? 'The next seat to open is yours — you will be seated automatically, no need to do anything.'
        : `${ahead} ${ahead === 1 ? 'pilot is' : 'pilots are'} ahead of you. The loser yields their seat when a race ends.`;

    el.innerHTML = bar(lv.name, `${df.name} · watching`, 'connected') +
      `<div class="lb-glow"></div>` +
      `<div class="lb-body"><div class="lb-col" style="width:min(620px,92vw)">` +
      `<div style="display:flex;flex-direction:column;gap:10px">` +
      `<span class="lb-kicker">In the queue</span>` +
      `<h1 class="lb-title" style="font-size:44px">${title}</h1>` +
      `<span class="lb-lede">${lede}</span></div>` +
      `<div style="display:flex;flex-direction:column;gap:10px" id="watch-seats">` +
      players
        .map(
          (p) =>
            `<div class="lb-seat them"><span style="display:flex;flex-direction:column;gap:2px">` +
            `<span class="lb-seat-name">${escapeHtml(p.name)}</span>` +
            `<span class="lb-seat-sub" id="watch-${p.playerId}">${p.ready ? 'ready' : 'in the lobby'}</span>` +
            `</span></div>`,
        )
        .join('') +
      `</div>` +
      `<div class="lb-rule"></div>` +
      `<span class="lb-label" style="letter-spacing:.18em">Queue</span>` +
      `<div style="display:flex;flex-direction:column;gap:6px">` +
      watchers
        .map(
          (w, i) =>
            `<span class="lb-fine"${w.playerId === myId ? ' style="color:#d2cefd"' : ''}>` +
            `${i + 1}. ${escapeHtml(w.name)}${w.playerId === myId ? ' — you' : ''}</span>`,
        )
        .join('') +
      `</div>` +
      `<button class="lb-leave" id="race-leave">Leave</button>` +
      `</div></div>`;
    el.querySelector('#race-leave')?.addEventListener('click', () => opts.onLeave());
  }

  function showWatchStatus(standings: Standing[]): void {
    for (const s of standings) {
      const line = el.querySelector(`#watch-${s.playerId}`);
      if (line) line.textContent = `wave ${s.wave} · ${s.lives} lives · ${fmtTime(s.elapsedMs)}`;
    }
  }

  function showRoster(room: string, players: LobbyPlayer[], myId: string, level: string, diff: string): void {
    lastPlayers = players;
    lastMyId = myId;
    lastRoom = room;
    lastLevel = level;
    lastDiff = diff;
    const me = players.find((p) => p.playerId === myId);
    const them = players.find((p) => p.playerId !== myId);

    const lv = levelOr01(level);
    const df = DIFFICULTIES[diffOrStd(diff)];
    const inActivityMode = opts.identity !== undefined;
    // Seat order is the server's, and seat one is whoever created the room.
    const isChooser = players[0]?.playerId === myId;

    if (players.length < 2) {
      // L3. On a plain URL the code is the whole screen, because passing it on
      // is the only job left. In an Activity there is nothing to pass on — the
      // other seat is filled by anyone in the channel opening the same
      // activity — so the screen's job becomes choosing what you'll play.
      el.innerHTML = bar(lv.name, 'Race relay', 'connected') + `<div class="lb-glow"></div>` +
        `<div class="lb-body"><div class="lb-col" style="width:min(560px,90vw)">` +
        (inActivityMode
          ? `<div style="display:flex;flex-direction:column;gap:10px">` +
            `<span class="lb-kicker">This channel's race</span>` +
            `<h1 class="lb-title" style="font-size:40px">Waiting for a second pilot</h1>` +
            `<span class="lb-lede">Anyone in this voice channel can open Deep Field to take the other seat. ` +
            `There is no code to send and no link to copy.</span></div>` +
            roomPicker(level, diff, isChooser)
          : `<span class="lb-label" style="letter-spacing:.24em">Room code — click to select</span>` +
            // inputmode=none on both: they are readonly select-on-click handles,
            // and without it iOS raises the on-screen keyboard for a field
            // nothing can be typed into — covering the very code you tapped to
            // read.
            `<input class="lb-bigcode" readonly inputmode="none" value="${room}" onclick="this.select()" ` +
            `aria-label="Room code — tap to select">` +
            `<div style="display:flex;flex-direction:column;gap:8px"><span class="lb-label">or send the link</span>` +
            `<input class="lb-field lb-link" readonly inputmode="none" value="${inviteLink(room)}" ` +
            `onclick="this.select()" aria-label="Invite link — tap to select"></div>` +
            discordRow() +
            `<span class="lb-fine" style="max-width:440px">Both fields select on click — the relay runs over plain http on your tailnet, where the browser refuses clipboard access.</span>`) +
        `</div><div class="lb-how" style="gap:16px;padding-top:8px">` +
        `<span class="lb-label" style="letter-spacing:.18em">Pilots</span>` +
        (me ? seat(me, true, 1) : '') +
        `<div class="lb-seat empty"><span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(233,233,237,.18)"><span style="width:6px;height:6px;border-radius:50%;background:rgba(233,233,237,.25)"></span></span>` +
        `<span style="display:flex;flex-direction:column;gap:2px"><span class="lb-seat-name" style="font-weight:400;color:#9397ab">Empty seat</span>` +
        `<span class="lb-seat-sub">waiting for someone to join…</span></span></div>` +
        `<div class="lb-rule" style="margin:6px 0"></div>` +
        `<div class="lb-facts">` +
        `<div><span>Sector</span><span>${lv.kicker.replace('Sector ', '')} · ${lv.name}</span></div>` +
        `<div><span>Difficulty</span><span>${df.name}</span></div>` +
        `<div><span>Waves</span><span>${lv.waves.length}</span></div>` +
        `<div><span>Starting lives</span><span>${df.startingLives}</span></div>` +
        `<div><span>Ranked by</span><span>waves · lives · time</span></div></div>` +
        `<button class="lb-leave" id="race-leave">Leave the room</button>` +
        `</div></div>`;
    } else {
      // L4/L5 — the ready action takes the emphasis; both states stay visible.
      const iAmReady = me?.ready === true;
      const kicker = iAmReady ? 'Standing by' : 'Room full';
      const title = iAmReady ? `Waiting on ${escapeHtml(them?.name ?? 'them')}` : 'Two pilots on the line';
      el.innerHTML = bar(
        lv.name,
        // The room code is dropped inside an Activity: nobody typed it, nobody
        // will read it out, and it would be the only thing on screen that
        // cannot be acted on.
        inActivityMode
          ? df.name
          : `${df.name} · room <span style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.2em;color:#cfd3e5">${room}</span>`,
        'both connected',
      ) +
        `<div class="lb-glow"></div>` +
        `<div class="lb-body"><div class="lb-col" style="width:min(1104px,92vw)">` +
        `<div style="display:flex;flex-direction:column;gap:10px">` +
        `<span class="lb-kicker">${kicker}</span><h1 class="lb-title" style="font-size:46px">${title}</h1></div>` +
        `<div style="display:flex;align-items:stretch;gap:22px;flex-wrap:wrap">` +
        `<div style="flex:1;min-width:280px">${me ? seat(me, true, 1) : ''}</div>` +
        `<span style="display:grid;place-items:center;width:44px" class="lb-sub">vs</span>` +
        `<div style="flex:1;min-width:280px">${them ? seat(them, false, 2) : ''}</div></div>` +
        // Still changeable with both seats filled, and still only by seat one:
        // agreeing on the board is a conversation people have after they see
        // who turned up, not before.
        (inActivityMode
          ? `<div style="display:flex;gap:22px;flex-wrap:wrap">${roomPicker(level, diff, isChooser)}</div>`
          : '') +
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
    el.querySelector('#race-leave')?.addEventListener('click', () => opts.onLeave());
    if (inActivityMode) wireRoomPicker(isChooser);
    // The webhook row only exists outside an Activity, so only wire it there.
    else if (players.length < 2) wireDiscord(room);
  }

  if (opts.identity !== undefined) {
    // Activity mode: no form, no code, no name to ask for. Discord already
    // answered all three, so the only honest screen here is one that says what
    // is happening while the socket opens.
    el.innerHTML = bar('Race', 'Race relay', 'connecting…') + `<div class="lb-glow"></div>` +
      `<div class="lb-center"><span class="lb-lede">Joining this channel's race as ` +
      `<b style="color:#d2cefd">${escapeHtml(opts.identity.name)}</b>…</span></div>`;
    // Deferred a tick for the same reason the rematch path is, and tracked so
    // navigating away inside that tick cannot open a socket for a dead screen.
    const { name, instance } = opts.identity;
    joinTimer = setTimeout(() => {
      joinTimer = null;
      // The pick rides along in case this client is the one that creates the
      // room; the server ignores it for whoever arrives second.
      opts.onSubmit({ name, instance, choice: { level: pickLevel, diff: pickDiff } });
    }, 0);
  } else if (opts.autoJoin !== undefined) {
    el.innerHTML = bar('Race', 'Race relay', 'rejoining…') + `<div class="lb-glow"></div>` +
      `<div class="lb-center"><span class="lb-lede">Rejoining room <b style="color:#d2cefd">${opts.autoJoin.room}</b>…</span></div>`;
    // Deferred a tick so the caller has its handle before callbacks fire.
    // Tracked, because `remove()` can now happen inside that tick: navigating
    // away mid-rejoin would otherwise open a socket for a screen that is gone.
    const { name, room } = opts.autoJoin;
    joinTimer = setTimeout(() => {
      joinTimer = null;
      opts.onSubmit({ name, room });
    }, 0);
  } else if (opts.prefillRoom !== undefined) {
    showDeepLink(opts.prefillRoom);
  } else {
    showForm();
  }

  return {
    showRoster,
    showWatching,
    showWatchStatus,

    showCountdown(ms, seed) {
      // Local rendering of a relative delay; no cross-machine clocks involved.
      const me = lastPlayers.find((p) => p.playerId === lastMyId);
      const them = lastPlayers.find((p) => p.playerId !== lastMyId);
      const endsAt = performance.now() + ms;
      const lv = levelOr01(lastLevel);
      const df = DIFFICULTIES[diffOrStd(lastDiff)];
      el.innerHTML = bar(lv.name, `${df.name} · room <span style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.2em;color:#cfd3e5">${lastRoom}</span>`, 'both ready') +
        `<div class="lb-glow"></div>` +
        `<div class="lb-center">` +
        `<span class="lb-kicker" style="letter-spacing:.3em">Both ready</span>` +
        `<div class="lb-ring"><i></i><i></i><span class="lb-count" id="race-count"></span></div>` +
        `<div class="lb-vsline"><b><i style="background:${YOU};box-shadow:0 0 8px ${YOU}e6"></i>${me?.name ?? 'you'}</b>` +
        `<em>vs</em><b><i style="background:${THEM};box-shadow:0 0 8px ${THEM}e6"></i>${escapeHtml(them?.name ?? 'opponent')}</b></div>` +
        `<div style="display:flex;flex-direction:column;align-items:center;gap:7px">` +
        `<span class="lb-mono">seed 0x${formatSeed(seed)} · ${lv.waves.length} waves · ${df.startingLives} lives</span>` +
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
        : unreachable ? `Nothing is listening at ${opts.relayHost} — the relay isn't running, or the tunnel to it is down.`
        : reason;
      el.innerHTML = bar('Race', 'Race relay', 'refused', true) +
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
      if (joinTimer !== null) clearTimeout(joinTimer);
      el.remove();
      // The stylesheet stays: it's shared race chrome and results needs it.
    },
  };
}
