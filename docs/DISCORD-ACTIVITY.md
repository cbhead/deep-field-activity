# Porting Deep Field to a Discord Activity

An Activity is a web app Discord loads in an iframe inside a voice channel,
served through a proxy at `https://<app_id>.discordsays.com`. This document is
the charter for that port: what the game already gets right, what has to change,
and which of it is a trap.

Forked from `cbhead/deep-field-td` at `1e2469a`. §1–§3 are the original survey,
written by reading the code before any port work started; the claims about
Discord's platform are from working knowledge rather than a fresh pass over
their docs, so re-check them against the current SDK before trusting them with a
day of work. §4 is written after the fact and supersedes the survey's estimate
of gap #4 — the first piece actually built.

## Why this is a shorter trip than it looks

The usual reason a browser game can't become an Activity is that it assumes
several origins — a CDN for assets, a separately hosted socket server, fonts
from Google. Everything must instead come through one proxied origin, and
retrofitting that is where ports die. Deep Field is already shaped that way, by
accident of having been built for one friend on one Tailscale box:

- **One process serves the client and the relay on one port**
  (`server/index.ts`). That is the Activity model exactly.
- **The socket URL is derived from `location`, never compiled in**
  (`src/net/relay.ts`), and `serverUrl()` already picks `wss` on an https page.
  The comment there records a bug where the client dialled `DEFAULT_PORT` while
  the page came from elsewhere; the fix — one derivation, one place — is the
  seam this port needs.
- **No external assets.** No `@font-face`, no CDN, no remote URL anywhere in
  `src/`. Discord's CSP blocks those, and there are none to block.
- **The sim never sees the network.** Seed in, status blobs out. The port
  should not touch `src/sim/` at all; if it starts to, something has gone wrong.

## §1 — What has to change

| # | Gap | Notes |
|---|---|---|
| 1 | **A public HTTPS origin.** The proxy needs somewhere real to forward to; today the server is Tailscale-only over plain http. | Already the project's stated next goal, so this is shared work rather than a tax the Activity imposes. |
| 2 | **`/.proxy/` prefixing.** Inside the iframe, same-origin requests carry that prefix. Means `base` in `vite.config.ts`, `WS_PATH`, and the `/info` probe. | Expected to be client-only — the proxy strips the prefix before forwarding, so `server/index.ts` shouldn't care. Verify rather than assume. |
| 3 | **The OAuth handshake.** `@discord/embedded-app-sdk`: `ready()` → `authorize()` → a new server route trading the code for a token using the client secret → `authenticate()`. | The secret is env-only and must never reach the client bundle or this repo. |
| 4 | **Navigation.** `location.search = '?race'` and its siblings in `src/main.ts` throw away Discord's launch params (`frame_id`, `instance_id`) and break the SDK on reload. | **The real refactor**, and bigger than the eight call sites suggest — see §4. Also drags in the rematch-by-reload path, which leans on `sessionStorage` surviving a navigation. |
| 5 | **Rooms become the instance.** Everyone who launches in the same voice channel is already in the same room; `instanceId` replaces the generated code. | Net deletion: room codes, invite links, the `/info` Tailscale lookup, and name entry all stop having a job. Names come from the Discord profile. |
| 6 | **Match reports move server-side.** The client can't reach `discord.com/api/webhooks` through the CSP. | `src/ui/discord.ts` keeps its formatter; only the transport moves. |
| 7 | **More than two people.** The relay seats exactly two and answers "room is full" to the third. A voice channel routinely holds five. | Needs a spectator or queue path. Not hard, but it's the first impression. |

## §2 — Cost

**A private Activity, playable with friends in one server: one or two focused
sessions.** No review process — create the app, enable Activities, add a URL
mapping, and testers can launch it. That's items 1–6, and only #4 has teeth.

**An App Directory listing: much further out**, and it runs into a wall already
documented upstream. Listing effectively requires mobile support; the board and
HUD scale as a single unit, so phone landscape cannot reach a 44px touch target
without rewriting the build deck to scale independently. That rewrite is the
real cost of going public, and it is worth deciding *before* the port starts
whether public is the goal — it changes what "done" means.

## §3 — Why bother

The port deletes the two things that actually cost the project players. The one
hiccup in the first cross-internet match was onboarding: a friend has to install
Tailscale, join a tailnet, and open an IP-address URL. Inside an Activity that
entire path collapses to pressing a button in a voice channel, and the room
code, the invite link, and the name prompt collapse with it.

## §4 — What gap #4 actually costs (revised after doing half of it)

The survey above counted call sites, which was the wrong unit. Rewriting
`location.search = …` into a router is an afternoon. The expensive part is that
**nothing in the game could be torn down**, because `location.reload()` had
always been the teardown — and the code says so out loud, in `startGame`: *"a
reload rebuilds the world and every renderer pool with no chance of a stale
reference surviving"*. That comment is load-bearing. An in-place router without
teardown does not merely leak; it produces a page where a dead run still handles
your keystrokes.

What was missing, and is now built:

- `attachInput` bound about a dozen listeners on `window`, `document` and the
  canvas with no way to unbind. They now go through a tracked `on` helper and
  come back in `dispose()`.
- `createLoop`'s `visibilitychange` listener survived `stop()`. Now bound in
  `start` and unbound in `stop`, so the pair is symmetric.
- `watchViewport` held a `ResizeObserver` on `<html>`, two resize listeners and
  an `orientationchange` that schedules a refit *300ms late*. A refit after the
  Application is destroyed throws; it is now unbound, and guarded by a disposed
  flag for the timeout already in flight.
- `fitCanvas` cached the last fit in module scope keyed on the viewport alone,
  so a second renderer at the same viewport would skip fitting entirely and
  leave a canvas that had never been sized. The key now includes the board, and
  a new renderer resets it.
- The `td-ingame` class — which arms the portrait "rotate to play" wall — was
  added and never removed, so navigating back to a menu would leave it armed
  over a screen it was explicitly designed not to cover.
- `createHud` had no destroy, and `#hud` is a fixture of the page: a second HUD
  would have bound a second click handler over the first.

None of that is visible in a screenshot and none of it is a type error, so
`npm run teardown` asserts it directly — it drives a real Chrome and reads the
listener table over the DevTools protocol, which is the only place the truth
lives. It ends with the check that actually matters: after `dispose()`,
dispatching a keydown, a resize and a visibilitychange at the dead page throws
nothing and nobody is listening.

The router itself is still to come. It now has something safe to stand on.

## Relationship to upstream

`git pull upstream main` still works and should stay working. Fixes to the sim,
balance, or rendering belong upstream and flow down; everything in §1 is
Activity-only and stays here. Files shared with upstream are left untouched
unless the port genuinely needs them, so that merges stay boring — which is why
the stale `tower-defense` strings in `server/index.ts` and the runbook were not
renamed when this repo was seeded.
