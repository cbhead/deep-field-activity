# Runbook: Race Match Night

**Owner:** Chandler (host) | **Frequency:** As needed
**Last Updated:** 2026-08-30 | **Last Run:** 2026-08-30 — first confirmed cross-internet match

## Purpose

Host a two-player Race-mode session of tower-defense for a friend over Tailscale.
One process, one port, one URL. Use this every time you want to play together;
follow it start to finish the first time, then skim the bold lines after that.

The whole path — tailnet invite through `[result]` — was confirmed working
across the internet on 2026-08-30.

Throughout this runbook, `<tailscale-ip>` means the host machine's tailnet
address. Get yours from `tailscale ip -4`, or read it off the banner
`npm run play` prints at startup.

## Prerequisites

Setup (clone, install, Node version) is covered in the [README](../README.md)
— this runbook assumes `npm run play` already works on the host. Beyond that:

- [ ] Tailscale running on the host — `tailscale status` shows the host online
- [ ] Friend is **on your tailnet** and their device shows up in `tailscale status`
- [ ] Working tree in a state you're happy to build — `npm run play` builds `dist/` fresh
- [ ] Optional: a Discord channel webhook URL if you want to send the invite that way

---

## Procedure

### Step 0 — (First time only) Get the friend onto the tailnet

Send them a Tailscale invite from the admin console, have them install the client
and sign in. Then confirm from your side:

```
tailscale status
```

**Expected result:** their machine is listed with a `100.x.y.z` address.
**If it fails:** they're not on the tailnet yet — nothing below will work. Stop here.

---

### Step 1 — Start the host

```
cd <your clone> && caffeinate -i npm run play
```

`caffeinate -i` keeps the Mac awake for the whole match; without it the server
dies mid-game when the machine sleeps (Linux hosts: skip it). `npm run play`
builds the client, then serves `dist/` **and** the WebSocket from one process.

**Expected result:** the build finishes, then a banner like:

```
race server listening on 0.0.0.0:8787
  Single-player:       http://localhost:8787
  Race with a friend:  http://<tailscale-ip>:8787/?race
```

**If it fails:** see Troubleshooting. Most first-run failures are the Node version.

---

### Step 2 — Verify it's reachable before you invite anyone

From the host, in a second terminal:

```
curl -s http://<tailscale-ip>:8787/info
```

**Expected result:** `{"tailscaleIp":"<tailscale-ip>","port":8787}` — a non-null
`tailscaleIp` is what makes the in-game invite link carry an address the friend
can actually reach.

**If it fails:** `tailscaleIp` comes back `null` → Tailscale isn't up on the host,
so invite links will point at `localhost` and be useless to the friend. Bring
Tailscale up and restart the server.

---

### Step 3 — Open the lobby and create a room

Host opens:

```
http://<tailscale-ip>:8787/?race
```

Use the **tailnet IP, not localhost** — it costs nothing and it means the invite
link and the URL bar agree.

**Expected result:** the lobby screen, with a big room code and a pre-filled
invite link of the form `http://<tailscale-ip>:8787/?race=<ROOM>`.
Both fields select on click (the relay is plain http on the tailnet, where the
browser refuses clipboard access — so click-to-select, then ⌘C).

---

### Step 4 — Send the invite

Either paste the invite link to the friend directly, or hit **Send to Discord**.

First Discord use: click `webhook…`, paste a channel webhook URL (must start with
`https://discord.com/api/webhooks/`), and it posts the room code and link. The
webhook is remembered in `localStorage` under `discord-webhook`, so this is a
one-time setup.

**Expected result:** button reads `Sent to Discord ✓`.
**If it fails:** `Discord refused it — check the webhook` means a bad or revoked
webhook URL; `Couldn't reach Discord` means the host has no internet (tailnet-only
is not enough — this POST goes to the public internet).

---

### Step 5 — Both ready up, then race

Friend opens the invite link, enters a name, hits Ready. Host hits Ready.
When both are ready a 3-second countdown runs and the match starts on a shared seed.

**Expected result:** server log shows the handshake in order:

```
[conn] <ip>
[hello] "<name>" → p2 in room <CODE>
[ready] <name> (p2) ready in room <CODE>
[start] room <CODE> seed=<N>
```

Both clients must show the **same seed** — that's the fairness guarantee.
**If it fails:** if `[start]` never prints, one side isn't actually ready; you can
un-ready and re-ready to reset. Watch the race strip for the opponent's wave/lives.

---

### Step 6 — Teardown

`Ctrl-C` the `npm run play` process. That also releases the `caffeinate` hold, so
the machine can sleep again.

---

## Verification

- [ ] `curl -s http://<tailscale-ip>:8787/info` returns a non-null `tailscaleIp`
- [ ] Friend can load the invite link from **their own network**, not just yours
- [ ] Server log shows `[hello]` from an IP that is not `127.0.0.1`
- [ ] `[start] room <CODE> seed=<N>` prints once, and both screens run the same wave layout
- [ ] `[result] room <CODE> winner=<id>` prints when the run ends

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `does not provide an export named 'styleText'` during build | The old Node 16 at `/usr/local/bin/node` won the PATH race; `scripts/use-node.sh` failed to load nvm | `nvm install 22 && nvm use 22`, then re-run. Never call the JS bins directly — their `#!/usr/bin/env node` shebang re-resolves to Node 16 |
| `error: Node >=20.19 required` | nvm not loaded in that shell | Same as above; the script already unsets `npm_config_prefix` for you |
| Lobby says "Nothing is listening at …" | Relay isn't running, or Tailscale dropped | Check the `npm run play` terminal is alive; `tailscale status` on both ends |
| Friend's browser times out on the link | They're not on the tailnet, or their Tailscale is disconnected | `tailscale status` on their machine; re-run Step 0 |
| Invite link says `localhost` | `/info` returned `tailscaleIp: null` — Tailscale down on host | Bring Tailscale up, restart the server, reload the lobby |
| `OFFLINE` badge on the opponent | Missed heartbeat (15s), or their tab is hidden | Usually self-heals — they have **90s** to come back before auto-forfeit. Tell them to reload; the seat is reclaimed via `hello.resume` |
| Opponent forfeited too fast during debugging | Default `FORFEIT_MS` is 90000 | Restart with `FORFEIT_MS=600000 npm run play` |
| Countdown too fast to inspect | Default `COUNTDOWN_MS` is 3000 | Restart with `COUNTDOWN_MS=15000 npm run play` |
| `EADDRINUSE` on 8787 | An earlier server is still running | Kill it, or `PORT=8788 npm run play` — but then the friend's URL changes too |

---

## Rollback

Nothing here mutates state that outlives the process — no database, no persisted
rooms. `Ctrl-C` and re-run `npm run play` is a full reset; every room and seat is
gone and both players rejoin from the invite link.

If a bad build is the problem, `git stash` the working tree and re-run — `npm run
play` rebuilds `dist/` every time, so the previous good commit is one stash away.

---

## Known gaps (don't file these as bugs mid-match)

- The **results screen has not been redesigned** — the design spec covered lobby states L1–L7 only.
- The spec's **"Forfeit instead" button was deliberately not built**; it needs a
  protocol message to be fair. Forfeits only happen via the 90s timeout.

---

## History

| Date | Run by | Notes |
|---|---|---|
| 2026-08-30 | Chandler | Runbook written. |
| 2026-08-30 | Chandler | First confirmed cross-internet match over Tailscale — full path verified, Step 0 through `[result]`. |
