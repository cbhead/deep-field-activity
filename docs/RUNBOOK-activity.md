# Runbook: Launch the Discord Activity

**Owner:** Chandler (host) | **Frequency:** As needed
**Last Updated:** 2026-08-31 | **Last Run:** 2026-08-31 — first successful launch

> **Status.** The activity launches and the handshake completes: the iframe
> loads, the SDK constructs, and `ready → authorize → /api/token → authenticate`
> runs through to a signed-in player. Steps 0–6 have now been walked end to end
> at least once, and the troubleshooting rows for the two failures actually hit
> — `Integration Required Code Grant` and `listener already exists` — are
> observed rather than predicted.
>
> **Still unexercised: a real race between two people inside Discord.** Instance
> rooms and the queue are verified by script against the live public origin, and
> a full two-player match is verified over Tailscale, but nobody has yet played
> one human against another *in a voice channel*. The rows below about rooms and
> queueing remain predictions until that happens.

## Purpose

Serve Deep Field into a Discord voice channel as an Activity, from your laptop,
for testing in a server you control.

This does not replace [match night](RUNBOOK-match-night.md) — the Tailscale path
is the one that works and has hosted a real cross-internet match. This is the
port being exercised.

Throughout, `<funnel-host>` means this machine's public Funnel hostname — the
`<machine>.<tailnet>.ts.net` name Tailscale gives it. `npm run tunnel` prints
yours, or:

```sh
tailscale status --json | sed -n 's/.*"DNSName": "\(.*\)\.".*/\1/p' | head -1
```

It is left as a placeholder rather than written out for the same reason the
match-night runbook does not name a tailnet address: while the funnel is open
that hostname is a live public URL, and a repository is a poor place to publish
one.

## Prerequisites

- [ ] `npm run play` already works (see the [README](../README.md))
- [ ] A Discord application at <https://discord.com/developers/applications>
- [ ] A Discord server you can add the app to and start a voice channel in
- [ ] Tailscale signed in — `tailscale status` shows this machine
- [ ] Funnel available on the tailnet (Step 1 tells you if it is not)

---

## Procedure

### Step 0 — (First time only) Fill in `.env`

**The file goes in the repo root, beside `package.json`** — the same directory
you run `npm` from. It is a dotfile, so Finder and a plain `ls` both hide it;
`ls -a` shows it.

```sh
cd ~/dev/deep-field-activity     # wherever you cloned it
cp .env.example .env
open -e .env                     # or: code .env / vim .env
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

Optionally add `DISCORD_WEBHOOK_URL` (channel → Edit Channel → Integrations →
Webhooks) and the relay posts one message per finished race, turning the channel
into the match ledger. Read at run time, so this one *is* just a restart.

Check it landed where the tooling looks:

```sh
grep -c . .env        # non-zero, and run from the repo root
```

`npm run tunnel` refuses with the full path if the file is missing, and names
which value is still blank if it is there but unfilled — so if Step 3 starts,
this step is done.

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

- **Bot → Requires OAuth2 Code Grant** — make sure this is **off**. If it is on,
  the handshake fails with `Integration Required Code Grant` at the authorize
  step, and nothing in this repo can work around it.
- **Activities → Settings** — enable Activities for the app.
- **Activities → URL Mappings** — add:

      PREFIX   /
      TARGET   <funnel-host>

  Hostname only. No `https://`, no trailing slash, no port.

While you are in there, **Legal → Terms of Service URL / Privacy Policy URL**:

    https://<funnel-host>/terms
    https://<funnel-host>/privacy

These are only needed for verification, not to launch the app in your own
server. Both pages ship with the build and are complete. Before submitting for
verification, move them somewhere that stays up — served from here they only
exist while the tunnel does, and a reviewer will look when they look. See §6 of
[DISCORD-ACTIVITY.md](DISCORD-ACTIVITY.md).

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
curl -sI https://<funnel-host>/ | head -1
curl -s  https://<funnel-host>/info
```

`200` and a JSON blob. If this fails, Discord has no chance — fix it here,
where the error messages are yours rather than an iframe's.

### Step 5 — Launch it

Join a voice channel in your test server → **Activities** (the rocket) → your
app. It should load the front door.

If it is not in the rocket menu, check **Settings → Supported Platforms** in the
portal — an activity with no platform ticked does not appear — and that you have
**Developer Mode** on in Discord (User Settings → Advanced).

### Step 5a — Getting a second person in

**This is not "send them a link".** An unverified Activity is playable only by
the app's team members and by people explicitly added as **App Testers**, and
only in a server with **fewer than 25 members**. A friend who simply joins the
voice channel will not see it.

So, once each:

1. Portal → your app → **App Testers** → **Invite**, and send them that link.
   (Adding them to the app's **Team** works too, and gives them more than they
   need.)
2. They accept, and join your test server.

Then, every time:

3. You both join the **same voice channel** — the instance is the channel, so
   this is what puts you in the same race.
4. One of you starts it from the rocket menu. The other sees the activity tile
   in the voice channel with **Join Activity**.
5. For someone not yet in the channel: right-click the voice channel →
   **Invite to Join**, which gives a link you can paste in chat.

Note what is *not* involved: no room code, no seed, no invite link from inside
the game. The lobby does not ask, because the voice channel already answered.
That is gap #5 working, and it is the thing to confirm — if either of you is
asked for a name or shown a room code, the handshake did not complete and you
are looking at the plain-URL lobby.

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
- [ ] `Race` opened the lobby with **no name prompt and no room code**
- [ ] A second person — added as an App Tester — took the other seat from the
      same voice channel, with nothing sent between you
- [ ] A third saw the queue and the race live, rather than being turned away
- [ ] Ctrl-C stopped the public URL answering

---

## Troubleshooting

Mostly predicted, not observed. Correct it as you learn.

| Symptom | Likely cause | Fix |
|---|---|---|
| `tailscale funnel` prints a link and exits | HTTPS certs or the funnel node attribute not enabled for the tailnet | Follow the link; both are one-time admin-console changes |
| `listener already exists for port 443` | A funnel is already serving this machine — usually the Step 1 check, left running in another terminal | Not a problem. `npm run tunnel` reuses it now. If you would rather start clean, Ctrl-C that terminal, or `tailscale funnel --https=443 off` |
| The public URL returns **502** | The funnel is up and forwarding, but nothing is listening on 8787 behind it | The relay is not running. `npm run play` in the repo, or re-run `npm run tunnel`. A 502 is good news in one sense: it proves the mapping and the funnel are correct |
| Activity shows a blank or endlessly loading frame | The URL Mapping target is wrong, or the tunnel is down | Step 4's `curl`. Target is a bare hostname — a `https://` prefix or trailing slash in that form is the classic cause |
| **`Integration Required Code Grant`** | The app has **Bot → Requires OAuth2 Code Grant** switched on. It forces a full authorization-code flow before the integration is created, which the Activity handshake cannot complete | Portal → your app → **Bot** → uncheck **Requires OAuth2 Code Grant** → Save, then relaunch. Nothing in this repo causes or can fix it. Worth reading as progress: it means the iframe loaded, the SDK constructed, `ready()` resolved and `authorize()` reached Discord — only the grant was refused |
| Game loads but no `[td] Discord activity:` line | Bundle built without `VITE_DISCORD_CLIENT_ID`, so the handshake was eliminated as dead code | Check `.env`, re-run `npm run tunnel`, and watch for its warning. `npm run build` prints one too |
| Console shows `token exchange failed (503)` | The relay has no `DISCORD_CLIENT_SECRET` | It is read at run time from `.env`; confirm the file exists and restart. `npm run proxy` asserts this path |
| Console shows `token exchange failed (502)` | Discord rejected the exchange — usually a stale or wrong client secret | Reset the secret in the portal, update `.env`, restart. The relay's terminal logs the upstream status |
| `frame_id query param is not defined` | The page was opened outside Discord with the SDK forced somehow | Should be impossible — `inActivity()` gates construction on exactly that parameter. If you see it, that guard has a hole |
| Race lobby asks for a name or shows a room code | The Discord handshake did not complete, so the lobby fell back to its plain-URL form | Same cause as a missing `[td] Discord activity:` line — the identity is what puts the lobby in Activity mode |
| Both pilots end up in *different* rooms | They are not in the same instance — separate voice channels, or one relaunched the activity | Both must launch from the same channel. `npm run rooms` asserts the server side of this |
| A friend cannot see the activity at all | Unverified activities are playable only by team members and invited **App Testers**, in servers under 25 members | Portal → **App Testers** → Invite. Not a bug, and not something a link can route around — see Step 5a |
| The activity is missing from the rocket menu | No platform ticked under **Settings → Supported Platforms**, or Developer Mode off | Tick desktop (and mobile if wanted); User Settings → Advanced → Developer Mode |
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

- **The frame is Discord's.** An activity cannot make itself fullscreen — the
  SDK exposes layout as an event to observe (`FOCUSED`/`PIP`/`GRID`), never a
  command to set. Players expand it with Discord's own **Expand Activity**
  control. What the game can do is fill whatever frame it is handed, which it
  now does at any size; it used to stop growing past about 1600px wide.
- **Winner stays on.** With people queuing, the loser yields their seat at the
  end of a race. Two friends who want to rematch each other repeatedly need the
  queue to be empty — which is the intended trade, but worth knowing before
  someone is surprised by it.
- **Mobile is not expected to work well.** The board and HUD scale as one unit,
  so a phone in landscape cannot reach a 44px touch target.

---

## History

| Date | Run by | Notes |
|---|---|---|
| 2026-08-30 | Claude | Runbook written alongside `npm run tunnel`. Funnel chosen over a cloudflared quick tunnel for the stable hostname. Steps 0–2 and 4–7 are unexecuted; the tunnel tool's hostname resolution and SDK-in-bundle check were verified in isolation, and the funnel itself was never opened — that needs a human decision to publish the machine. |
| 2026-08-31 | Chandler + Claude | **First successful launch.** Two failures on the way, both now documented: `listener already exists for port 443` (the Step 1 funnel check, left running — the tool blamed the admin console for it and now reuses it instead), and `Integration Required Code Grant` (**Bot → Requires OAuth2 Code Grant** was on; a portal toggle no code can work around). Between them, the public origin was verified from outside: `/`, `/info`, `/terms`, `/privacy` and `/.proxy/index.html` all 200; the 147kB SDK chunk fetchable; `POST /api/token` answering **502 rather than 503**, which proves the relay reached Discord with real credentials; `wss://…/ws` **and** `wss://…/.proxy/ws` both completing a hello/joined — WebSockets do survive Tailscale Funnel, which was the largest open unknown; and three scripted clients landing in one instance room with the third queued. |
