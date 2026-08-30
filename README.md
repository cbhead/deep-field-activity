# Deep Field

A tower defense game for your browser — hold the line through a three-sector
campaign, or race a friend head-to-head on the same seed and see who survives
longer.

![Deep Field gameplay](docs/media/gameplay.png)

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
git clone https://github.com/chandlerhead/deep-field-td.git
cd deep-field-td
npm install
caffeinate -i npm run play    # macOS: caffeinate keeps the machine awake mid-match
                              # Linux: just `npm run play`
```

The server prints the URL to open — something like
`http://100.x.y.z:8787/?race`. Open it, and the lobby shows a **room code**
and a ready-made **invite link**. Send the link to your friend (click to
select, then copy — or paste a Discord webhook once and use **Send to
Discord**). When you're both Ready, a countdown runs and the race starts on a
shared seed.

Something not working? The
[match night runbook](docs/RUNBOOK-match-night.md) has step-by-step
verification and a troubleshooting table.

## Single-player Campaign

No Tailscale, no friend, no setup beyond the clone:

```sh
npm run play
```

Open <http://localhost:8787> and start the campaign — three sectors, three
difficulties. Progress saves in your browser (localStorage), so use the same
browser to continue a run.

## Developing

```sh
npm run dev         # Vite dev server with hot reload (single-player)
npm run server      # run the race relay separately during development
npm run typecheck   # strict TypeScript, no emit
npm run lint        # ESLint
npm run check       # headless simulation gates — the balance test suite
npm run campaign    # explore the campaign arc headlessly
npm run sweep       # balance sweeps
```

The layout: `src/sim/` is the deterministic game simulation (shared by the
browser and the headless tools), `src/render/` draws it with Pixi.js,
`src/ui/` is the HUD and lobby, `src/content/` holds towers/waves/balance
numbers, `src/net/` is the race wire protocol, and `server/` is a small
WebSocket relay that also serves the built client. Design rationale lives in
[docs/design/](docs/design/README.md).

## License

[MIT](LICENSE)
