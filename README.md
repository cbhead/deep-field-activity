# Deep Field — Discord Activity

> **This is the Activity experiment, not the game's home.** The finished,
> playable Deep Field lives at
> [cbhead/deep-field-td](https://github.com/cbhead/deep-field-td); this repo
> forked from it at `1e2469a` and is porting it to run inside a Discord voice
> channel via the Embedded App SDK. All seven gaps in
> [docs/DISCORD-ACTIVITY.md](docs/DISCORD-ACTIVITY.md) are closed, and as of
> 2026-08-31 the activity launches and signs a player in for real. To run it,
> follow [docs/RUNBOOK-activity.md](docs/RUNBOOK-activity.md). What has *not*
> happened yet is two people racing each other inside a voice channel.
>
> Upstream is wired up as a remote, so sim and balance fixes still flow down:
> `git pull upstream main`. Everything below this line describes the game as it
> works **today** — over Tailscale, unchanged from upstream. It stays accurate
> until the port actually lands, and each section gets rewritten as the thing it
> describes is replaced.

A tower defense game for your browser — hold the line through a three-sector
campaign, or race a friend head-to-head on the same seed and see who survives
longer.

![Switchback under fire: the route lit from dim at the spawn to bright at the pulsar, six stations ringing it, contacts mid-run, and the build deck along the bottom](docs/media/gameplay.png)

Five station types across three sectors — Switchback, Cascade and Pincer, 34
waves in all — at three difficulty tiers. The simulation is deterministic: a
seed fixes every wave's composition and timing, which is what makes a fair
race possible in the first place.

## Someone sent me an invite link

You don't need to download anything. You need two things:

1. **Tailscale** — a free app that puts your computer on your friend's private
   network. [Download it](https://tailscale.com/download), then sign in using
   the invite your friend sent you (they'll send it from their Tailscale admin
   page).
2. **The invite link** — it looks like `http://100.x.y.z:8787/?race=ABCD`.
   Open it in your browser once Tailscale is running.

Type a name, hit **Ready**, and you're racing. That's it — no Node, no
terminal, no cloning.

If the page won't load: your Tailscale isn't connected, or your friend's
server isn't running. Ask them to check both.

## I want to host a match

You'll need:

- **macOS or Linux** (Windows: use [WSL](https://learn.microsoft.com/windows/wsl/install)) with `zsh` installed
- **Node.js 20.19 or newer** — [nodejs.org](https://nodejs.org) (the repo's `.nvmrc` says 22; nvm users are handled automatically)
- **A [Tailscale](https://tailscale.com) account**, with your friend invited to
  your tailnet (Tailscale admin console → **Invite users**)

Then:

```sh
git clone https://github.com/cbhead/deep-field-td.git
cd deep-field-td
npm install
caffeinate -i npm run play    # macOS: caffeinate keeps the machine awake mid-match
                              # Linux: just `npm run play`
```

The server prints the URL to open — something like
`http://100.x.y.z:8787/?race`. Open it, pick a sector and difficulty, and the
lobby hands you a **room code** and a ready-made **invite link**:

![The Race lobby holding room: a large room code, the tailnet invite link, a Send to Discord button, and a pilots panel with one seat filled and one waiting](docs/media/race-lobby.png)

Send the link to your friend — click to select, then copy, or paste a Discord
webhook once and use **Send to Discord**. Both fields are select-on-click
rather than copy buttons on purpose: over Tailscale the page is plain http,
which isn't a secure context, so the browser refuses clipboard access.

When you're both **Ready**, a three-second countdown runs and the race starts
on a shared seed.

> If port 8787 is already taken, `PORT=8790 npm run play` moves the whole
> thing — page and relay together — and the lobby's invite link follows the new
> port automatically.

Something not working? The
[match night runbook](docs/RUNBOOK-match-night.md) has step-by-step
verification and a troubleshooting table.

### What a race looks like

Both pilots get identical waves. You see their standing — wave, lives, elapsed
time, and a minimap of the stations they've built — but never their board:

![An in-progress race: the opponent strip reads "you · wave 7 · 20 lives | VEGA · wave 5 · 17 lives — ahead", with VEGA's board shown as a minimap in the top right](docs/media/race.png)

Runs are ranked on waves cleared, then lives kept, then time. Lose your
connection and you can reclaim the same seat and carry on; walk away and it's a
forfeit after 90 seconds.

## Single-player campaign

No Tailscale, no friend, no setup beyond the clone:

```sh
npm run play
```

Open <http://localhost:8787>. The home screen picks up where you left off —
Continue resumes the sector you last played, at the difficulty you last used:

![The Deep Field home screen: the game's name over a dimmed board, a Continue button showing the sector it resumes, and Campaign and Race cards side by side](docs/media/home.png)

Three sectors, three difficulties — Recon (30 lives), Standard (20), and
Blackout (14 lives and tougher contacts). Each card draws its own board, so you
can see the shape you are choosing rather than read about it; a locked sector
shows its board dimmed rather than hiding it. Difficulty is on the card, so
launching is one click:

![The sector picker: three cards, each showing its real board as a thumbnail, with waves, road length and turn count as numerals, difficulty inline, and the third sector locked but still showing its board](docs/media/sectors.png)

Money you finish a sector with carries into the next one.

Every station upgrades along three independent paths, and the board shows which
one you've committed to. Select a station to see what it's actually doing —
damage dealt, kills, and what it does to the contact type currently on the
board:

![A Singularity station selected: its reach ring on the board, and an inspector showing the station wearing its upgrade collar at full size, its slow figures as numeral chips, and three upgrade cards](docs/media/inspector.png)

Progress saves in your browser (localStorage), so use the same browser to
continue a run.

## Developing

```sh
npm run dev         # Vite dev server with hot reload (single-player)
npm run server      # run the race relay separately during development
npm run typecheck   # strict TypeScript, no emit
npm run lint        # ESLint
npm run check       # headless simulation gates — the balance test suite
npm run campaign    # explore the campaign arc headlessly
npm run sweep       # balance sweeps
npm run shots       # re-take the README screenshots (needs `npm run dev` running)
```

The screenshots above are scripted rather than taken by hand — see
`tools/shots.ts`. They went stale the moment the board was rebuilt and nothing
caught it, because a screenshot has no typechecker; making them one command
means they can be refreshed as part of landing a visual change instead of when
somebody remembers. It drives a real Chrome over the DevTools protocol, so the
simulation actually runs, and it fails loudly if a screen it expected is not on
screen. The two race captures are still taken by hand: they need two clients and
a relay between them, and faking that would photograph something the game does
not do.

`npm run play` is the single-port build: it bundles the client and serves both
the page and the WebSocket relay from one process, so the socket follows
whatever port the page came from. The two-process split above is dev-only —
there Vite serves the page while `npm run server` holds the relay on 8787, so
that port is the one case the client has to name explicitly.

The layout: `src/sim/` is the deterministic game simulation (shared by the
browser and the headless tools), `src/render/` draws it with Pixi.js,
`src/ui/` is the HUD and lobby, `src/content/` holds towers/waves/balance
numbers, `src/net/` is the race wire protocol, and `server/` is a small
WebSocket relay that also serves the built client. Design rationale lives in
[docs/design/](docs/design/README.md).

## License

[MIT](LICENSE)
