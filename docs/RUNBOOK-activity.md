# Runbook: Launch the Discord Activity

**Owner:** Chandler (host) | **Frequency:** As needed
**Last Updated:** 2026-08-30 | **Last Run:** never — this has not yet been run end to end

> **Read this first.** Nothing below Step 3 has ever been executed. The handshake
> is written from the SDK's type declarations, not from a working launch, and
> the first time you run this you are testing it, not using it. Expect to find
> something. The [Troubleshooting](#troubleshooting) table is stocked with
> failures predicted from the code rather than observed, and is the part most
> likely to be wrong.

## Purpose

Serve Deep Field into a Discord voice channel as an Activity, from your laptop,
for testing in a server you control.

This does not replace [match night](RUNBOOK-match-night.md) — the Tailscale path
is the one that works and has hosted a real cross-internet match. This is the
port being exercised.

## Prerequisites

- [ ] `npm run play` already works (see the [README](../README.md))
- [ ] A Discord application at <https://discord.com/developers/applications>
- [ ] A Discord server you can add the app to and start a voice channel in
- [ ] Tailscale signed in — `tailscale status` shows this machine
- [ ] Funnel available on the tailnet (Step 1 tells you if it is not)

---

## Procedure

### Step 0 — (First time only) Fill in `.env`

```sh
cp .env.example .env
```

Two values, both from your app in the developer portal:

| Key | Portal location | Secret? |
|---|---|---|
| `VITE_DISCORD_CLIENT_ID` | **General Information → Application ID** | No — it ships in the bundle |
| `DISCORD_CLIENT_SECRET` | **OAuth2 → Client Secret → Reset Secret** (shown once) | Yes |

They are two different things despite both being "credentials": the id is
public and is compiled *into* the client, the secret stays on the relay and
never reaches a browser. The commented-out `DISCORD_CLIENT_ID` at the bottom of
the file is an override; leave it alone.

**The id is read at build time.** `npm run tunnel` builds and then serves, so
`.env` has to be complete before you start it. Editing the id and restarting
only the server changes nothing — the old bundle is still on disk.

### Step 1 — (First time only) Enable Funnel

```sh
tailscale funnel 8787
```

If the tailnet is not set up for it, this prints a link and does nothing.
Follow it: Funnel needs **HTTPS certificates** enabled (admin console → DNS)
and the **funnel node attribute** in the ACL policy. Both are one-time and both
need your admin account.

Ctrl-C once it works — Step 3 starts it properly.

### Step 2 — (First time only) Point Discord at this machine

In the developer portal, with your app open:

- **Activities → Settings** — enable Activities for the app.
- **Activities → URL Mappings** — add:

      PREFIX   /
      TARGET   chandlers-macbook-pro.tail58cbdb.ts.net

  Hostname only. No `https://`, no trailing slash, no port.

This is why the runbook uses Funnel rather than a `cloudflared` quick tunnel:
the hostname is derived from the machine and does not change, so this form is
filled in once. A quick tunnel issues a fresh random name every run and you
would be re-editing this before every session.

### Step 3 — Go live

```sh
npm run tunnel
```

One command: builds the client, starts the relay on 8787, opens the funnel, and
prints the public origin with the mapping to check it against.

Watch for the warning it prints if the built bundle contains no Discord SDK.
That means it was built without `VITE_DISCORD_CLIENT_ID`, and the whole
handshake was stripped as dead code — the game will load in Discord and play,
and nobody will be signed in. Fix `.env` and run it again.

### Step 4 — Verify the origin before opening Discord

From anywhere:

```sh
curl -sI https://chandlers-macbook-pro.tail58cbdb.ts.net/ | head -1
curl -s  https://chandlers-macbook-pro.tail58cbdb.ts.net/info
```

`200` and a JSON blob. If this fails, Discord has no chance — fix it here,
where the error messages are yours rather than an iframe's.

### Step 5 — Launch it

Join a voice channel in your test server → **Activities** (the rocket) → your
app. It should load the front door.

### Step 6 — Confirm the handshake actually happened

The thing most likely to be quietly broken. In the Activity, open devtools
(`Ctrl+Shift+I` works in the Discord desktop client) and look for:

```
[td] Discord activity: <your name> in instance <id>
```

That line means the full `ready → authorize → /api/token → authenticate` round
trip completed. Its absence — or `[td] Discord handshake failed` — means it
didn't, and the game will still be playable, because failure is deliberately
soft. **A playable game is not evidence the handshake worked.** Check the line.

The relay's terminal is the other half of the story: `/api/token` failures are
logged there with the upstream status, and that is where a bad secret shows up.

### Step 7 — Teardown

Ctrl-C the `npm run tunnel` terminal. That stops the relay and closes the
funnel; the public URL stops answering. Confirm with the `curl` from Step 4 —
it should now fail.

---

## Verification

The run was a success if all of these are true:

- [ ] The front door rendered inside the Discord iframe
- [ ] `[td] Discord activity: …` appeared in the Activity's console
- [ ] A single-player sector started and was playable
- [ ] `Race` opened the lobby and created a room
- [ ] Ctrl-C stopped the public URL answering

---

## Troubleshooting

Mostly predicted, not observed. Correct it as you learn.

| Symptom | Likely cause | Fix |
|---|---|---|
| `tailscale funnel` prints a link and exits | HTTPS certs or the funnel node attribute not enabled for the tailnet | Follow the link; both are one-time admin-console changes |
| Activity shows a blank or endlessly loading frame | The URL Mapping target is wrong, or the tunnel is down | Step 4's `curl`. Target is a bare hostname — a `https://` prefix or trailing slash in that form is the classic cause |
| Game loads but no `[td] Discord activity:` line | Bundle built without `VITE_DISCORD_CLIENT_ID`, so the handshake was eliminated as dead code | Check `.env`, re-run `npm run tunnel`, and watch for its warning. `npm run build` prints one too |
| Console shows `token exchange failed (503)` | The relay has no `DISCORD_CLIENT_SECRET` | It is read at run time from `.env`; confirm the file exists and restart. `npm run proxy` asserts this path |
| Console shows `token exchange failed (502)` | Discord rejected the exchange — usually a stale or wrong client secret | Reset the secret in the portal, update `.env`, restart. The relay's terminal logs the upstream status |
| `frame_id query param is not defined` | The page was opened outside Discord with the SDK forced somehow | Should be impossible — `inActivity()` gates construction on exactly that parameter. If you see it, that guard has a hole |
| Race lobby shows a tailnet invite link | `/info` still reports the host's Tailscale IP, which is meaningless inside Discord | Expected today. Rooms become the Discord instance in gap #5, which deletes invite links entirely |
| `EADDRINUSE` on 8787 | An earlier relay is still running | `kill $(lsof -nP -tiTCP:8787 -sTCP:LISTEN)` |
| Assets 404 inside Discord but work on the tunnel URL | A path assumption that survives only outside the proxy | `base: './'` in `vite.config.ts` exists to prevent this; `npm run proxy` covers the prefix cases. Capture the failing URL before changing anything |

---

## Rollback

There is nothing to roll back — this hosts from a laptop and leaves no state.
Ctrl-C is the rollback. If the funnel is somehow still serving after that:

```sh
tailscale funnel --https=443 off
tailscale funnel status
```

The Tailscale path is unaffected by any of this; `npm run play` still works
exactly as [match night](RUNBOOK-match-night.md) describes.

---

## Known gaps (don't file these as bugs mid-test)

- **Rooms are not the voice channel yet.** Everyone still types a name and
  trades a room code, inside a client that already knows who they are. Gap #5.
- **The relay seats exactly two.** A third person gets "room is full". Gap #7.
- **Match reports still post from the browser** to a webhook pasted into
  localStorage, which the CSP may well block inside the iframe. Gap #6.
- **Mobile is not expected to work well.** The board and HUD scale as one unit,
  so a phone in landscape cannot reach a 44px touch target.

---

## History

| Date | Run by | Notes |
|---|---|---|
| 2026-08-30 | Claude | Runbook written alongside `npm run tunnel`. Funnel chosen over a cloudflared quick tunnel for the stable hostname. Steps 0–2 and 4–7 are unexecuted; the tunnel tool's hostname resolution and SDK-in-bundle check were verified in isolation, and the funnel itself was never opened — that needs a human decision to publish the machine. |
