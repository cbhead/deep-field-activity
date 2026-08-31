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
| 2 | ~~**`/.proxy/` prefixing.**~~ **Done, and the premise was wrong** — the prefix has been optional since 2025-07-30, so nothing hardcodes it. See §5. | |
| 3 | ~~**The OAuth handshake.**~~ **Built, unverified.** See §5. | |
| 4 | **Navigation.** `location.search = '?race'` and its siblings in `src/main.ts` throw away Discord's launch params (`frame_id`, `instance_id`) and break the SDK on reload. | **The real refactor**, and bigger than the eight call sites suggest — see §4. Also drags in the rematch-by-reload path, which leans on `sessionStorage` surviving a navigation. |
| 5 | ~~**Rooms become the instance.**~~ **Done**, and verified with two real clients. See §7. | |
| 6 | ~~**Match reports move server-side.**~~ **Done**, and verified against a stub webhook. See §8. | |
| 7 | ~~**More than two people.**~~ **Done** — the rest queue, watch, and are seated in turn. See §9. | |
| 8 | **Terms of Service and Privacy Policy URLs.** Required by Discord before an app can be verified — a gap the original survey missed entirely. | Drafted and served; see §6. Two placeholders still to fill, and they need a host that is up when a reviewer looks. |

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

### The router, now that teardown holds

`src/app/router.ts` parses a `Route` out of the query, and `main.ts` became a
scene manager: one mounted scene at a time, each returning its own `dispose`.
The pieces worth knowing:

- **`toSearch` deletes only the keys the router owns and writes everything else
  back.** That single behaviour is what makes the port possible — Discord's
  launch parameters survive every navigation the game makes. It is asserted in
  the gate with a stand-in `frame_id`.
- **Restart is `remount`, not `go`.** Re-entering a route re-resolves the seed,
  so an unpinned run deals a fresh board and a `?seed=`-pinned one does not —
  precisely what `location.reload()` used to buy. Both directions are asserted.
- **A generation counter guards the mount race.** `startGame` awaits the
  renderer's async init, which is long enough for a second navigation to land;
  the loser now discards itself instead of installing over the winner.
- **`MatchController` gained a `dispose`.** Two of its jobs are not hygiene: the
  reconnect loop retries every two seconds until the match settles, and the
  countdown defers `boot()` by three seconds. Leaving a lobby used to be a
  document load, so neither could outlive the screen. Now they can, and would
  have — the deferred boot would have built a world into a torn-down scene.
- **Back and forward work**, which they never did before.

Two things deliberately did *not* change. The URL contract is identical —
`?level=`, `?seed=`, `?race=CODE` and bare `?seed=` all still mean what they
meant, so existing invite links and bug reports keep working. And the rematch
handoff, which used to travel through `sessionStorage` because a reload ate
everything else, is now a module-level variable claimed once: transient intent
is not an address, and `?race=ABCD` should not also mean "skip the form".

What is still reload-shaped and untested: the match itself. The gate proves the
lobby mounts and unmounts, but a real race needs two clients and a relay, so
the rematch path and mid-match disposal have been reasoned about rather than
observed.

## §5 — The proxy and the handshake, as actually built

The survey's §1 rows 2 and 3, corrected against the current SDK (v2.5.0) and
docs rather than memory. **The survey was wrong about the prefix.**

### `/.proxy` is optional now, so nothing hardcodes it

The prefix was mandatory on same-origin requests when Activities launched.
Discord's 2025-07-30 change made `/<path>` and `/.proxy/<path>` behave
identically, and the official docs no longer mention the prefix at all. So:

- **The client never writes it.** `fetch('/api/token')` and the relay socket at
  `/ws` are addressed plainly.
- **`vite.config.ts` sets `base: './'`,** not `base: '/.proxy/'`. Relative asset
  URLs resolve against whatever the document turned out to be, which is right on
  localhost, on a tailnet IP, *and* behind the proxy. Hardcoding the prefix
  would have worked in Discord and broken every other deployment of the same
  build — and this repo's whole premise is that the plain-URL game keeps working.
- **The server accepts both.** `stripProxy` in `server/index.ts` removes a
  leading `/.proxy` from HTTP paths and from the socket upgrade. One string
  operation, and the client never has to know which world it is in. If Discord
  ever reverses the policy, prefixing two strings on the client is the whole fix.

The socket needed one structural change: `ws` was given a fixed `path`, and the
path is now two paths, so the upgrade is handled manually and anything that is
not the relay is refused rather than upgraded.

### The handshake

`src/discord/activity.ts`, gated on the `frame_id` parameter — which is both how
you detect an Activity and the SDK constructor's own precondition, since it
throws `frame_id query param is not defined` without one.

    ready() → authorize() → POST /api/token → authenticate()

`authorize` yields a one-time code, not a token, because the exchange needs the
client secret; `handleToken` in `server/index.ts` does that half and forwards
only the access token. Scope is `identify` alone — a name to show on the race
strip is all the game wants, and every extra scope is another consent prompt to
justify. Discord's own sample asks for `guilds` and `applications.commands`;
neither is needed here.

**Failure is soft.** A missing id, an unconfigured relay or a rejected code logs
loudly and plays on. Deep Field is a working game on a plain URL and must stay
one; turning a misconfigured Activity into a black screen would be a worse
outcome than one missing a pre-filled name.

### The trap worth knowing

`import.meta.env.VITE_DISCORD_CLIENT_ID` is substituted **at build time**. With
no id set, the guard in `connectActivity` folds to a constant `true`, and
everything after it — including `import('@discord/embedded-app-sdk')` — is
eliminated as dead code. The build succeeds. It emits no SDK chunk. The bundle
is silently incapable of the handshake, and you would discover that inside
Discord.

That elimination is correct and worth having: a plain-web build genuinely should
not ship 147kB of SDK, and the dynamic import is what buys that. It is only
dangerous when quiet, so the build now prints a warning when the id is absent,
and the SDK chunk appearing in the output is the positive signal that it was
seen. **Set `VITE_DISCORD_CLIENT_ID` before building anything you intend to
serve to Discord.**

### Setting it up

Two values, one file. From
[the developer portal](https://discord.com/developers/applications), with your
application open:

| `.env` key | Portal location | Secret? |
|---|---|---|
| `VITE_DISCORD_CLIENT_ID` | **General Information → Application ID** (identical to OAuth2 → Client ID) | No — it ships in the bundle |
| `DISCORD_CLIENT_SECRET` | **OAuth2 → Client Secret → Reset Secret**, shown once | Yes |

```sh
cp .env.example .env     # then fill in the two blanks
npm run play             # build + serve, reading .env for both halves
```

Then you need a public HTTPS origin for Discord's proxy to forward to, which is
gap #1 in its cheap form: `npm run tunnel` builds, serves, and opens a
**Tailscale Funnel**, printing the hostname to paste into
**Activities → URL Mappings**. Funnel rather than a `cloudflared` quick tunnel
because the hostname is stable — the mapping is a hand-filled web form, and a
tunnel that renames itself every run means editing that form every session.

The whole sequence, including the portal steps and how to tell whether the
handshake actually happened, is [docs/RUNBOOK-activity.md](RUNBOOK-activity.md).

Two things about that file are easy to get wrong, and both used to be silent:

- **The id is read at build time, the secret at run time.** `npm run play`
  builds and then serves, so `.env` must be complete *before* it runs. Editing
  the id and restarting only the server changes nothing — the old bundle is
  still on disk.
- **Node does not read `.env` by itself.** Vite reads the `VITE_` half for the
  build, which made it look as though the whole file was loaded, while the
  secret never reached the relay and the handshake failed with an unexplained
  503. `scripts/server.sh` and `scripts/play.sh` now pass `--env-file` when the
  file exists, and `npm run proxy` asserts that credentials in the environment
  actually reach the token route.

`.env.example` asked for the application id twice, under two names, which was a
trap rather than a feature. The server now falls back to `VITE_DISCORD_CLIENT_ID`,
so `DISCORD_CLIENT_ID` is an override nobody normally sets.

### What is verified, and what is not

`npm run proxy` starts the built relay and asserts the prefix is optional both
ways, that the socket upgrades on `/ws` and `/.proxy/ws` and is refused
elsewhere, that the token route answers honestly when it has no credentials
instead of crashing, and — the check that would have caught the `.env` bug —
that credentials in the environment reach it, by watching a fake code get a 502
from Discord rather than a 503 from us. `npm run teardown` additionally asserts that a *failed*
handshake leaves the game playable — its URL carries a `frame_id`, so every run
exercises the misconfigured-Activity path. The production build was confirmed to
boot and render a board with `base: './'`.

**The handshake itself is unverified.** It needs a registered Discord
application, a client secret, and a public HTTPS origin, none of which exist
yet. Every line of it is written from the SDK's own type declarations rather
than from a working run, and the first real launch should be treated as the test.

## §6 — Terms and privacy

Discord requires both as public URLs before an application can be verified. They
live in `public/`, so the existing static handler ships them with the build, and
the server resolves extensionless paths to `.html` so the URLs are `/terms` and
`/privacy` rather than something with a file extension in it.

    https://<your-public-origin>/terms
    https://<your-public-origin>/privacy

**These are drafts, not legal advice.** They are boilerplate in structure, but
the privacy policy is deliberately not generic: it was written against the code
and names the actual `localStorage` keys, what the relay holds in memory and for
how long, the `identify`-only OAuth scope, and the fact that the relay prints
display names and connecting IP addresses to its own terminal. A reviewer can
check every claim in it against the source, which is the point — a policy that
overstates what a game collects is as wrong as one that understates it.

Filled in: the contact address is `cbhead@icloud.com`, and the governing law is
Indiana — the operator's own state, which is the convention, since the point of
the clause is that a dispute lands somewhere the operator is actually subject to.
The terms also carry the usual carve-out saying they cannot remove a consumer
protection someone's local law makes unwaivable.

**Hosting.** Serving them from the relay means they are only reachable while the
tunnel is running, and a reviewer will look when they look. So
`.github/workflows/pages.yml` publishes them to GitHub Pages, deploying the same
`public/` files the game ships rather than a copy — the policy makes specific
claims about what the code stores, so the two must not be able to drift.

That workflow needs Pages enabled once, by hand:

> **Settings → Pages → Build and deployment → Source: GitHub Actions**

then re-run the *Legal pages* workflow. This cannot be automated from inside the
job: creating a Pages site requires administration rights, and a workflow token
gets at most `pages: write`, which only covers deploying to a site that already
exists. Once it has run, the canonical URLs are:

    https://cbhead.github.io/deep-field-activity/terms.html
    https://cbhead.github.io/deep-field-activity/privacy.html

Those are the ones to give Discord — not the tunnel's, which are only up while
the laptop is.

If the game's data handling changes — a new stored key, a wider scope, anything
persisted server-side — the privacy policy is now a file that has to change with
it, which is the reason to keep it in the repository rather than in a web form.

## §7 — Rooms became the channel

The change that makes this feel like a Discord app rather than a website in a
frame. Everyone who opens the activity in one voice channel shares an
`instanceId`, so that *is* the room, and four things stop having a job: the room
code, the invite link, the `/info` tailnet lookup, and the name prompt.

**The protocol grew two things.** `hello.instance` means join-or-create, which
is deliberately not what `room` means — a room code is something a human typed,
so a missing one is an error worth reporting, while a missing instance room is
just the first of the two players arriving. Both press play at the same moment
and whichever socket lands first is arbitrary, so the distinction matters.

And `pick`, because an instance room has no creation form to choose a board in —
you are simply *in* it. Choosing moved inside the room and belongs to seat one;
the other seat sees the same control disabled, since what you are about to play
matters to both. The server re-deals every pick to both clients, so the two
cannot end up disagreeing about the board a shared seed is for.

The relay keeps a second index, instance → room code, rather than keying rooms
by instance. The code is still what the logs, the results card and the match
report call a game, and a snowflake would be a poor substitute in all three: the
instance is how you *find* the room, the code is what the room is *called*.

**A security fix rode along, and had to.** Player names were interpolated
straight into `innerHTML` in five places. With typed callsigns that was a
friends-only hazard; with Discord display names the trust boundary moves from
"the person I invited" to "anyone who can join the voice channel", and a name is
rendered on the *opponent's* machine. `escapeHtml` in `ui/raceTheme.ts` now
covers all five. Verified by giving the lobby a display name containing an
`onerror` payload and confirming it did not fire.

**This is the first race path in the repo that is actually observed.** Every
previous claim about Race mode here was reasoned from the code, because it needs
two clients and a relay. It does not need a *browser*, though — the relay speaks
JSON over a socket. `npm run rooms` starts a real relay and drives it with a
pair of real clients, asserting that two pilots in one channel land in the same
room with no code exchanged, that seat one's pick propagates and seat two's is
ignored, that a third is refused with a message that distinguishes "full" from
"already under way", that another channel gets its own room, and that both
clients are dealt the same seed and the same board.

What that still does not cover is the match itself — whether the game then plays
correctly across two machines is what a real match night is for.

## §8 — The relay files the report

Match reports used to be posted by whichever browser had a webhook pasted into
it. That cannot work inside an Activity — the iframe's CSP will not let the page
reach `discord.com/api/webhooks` — and it came with a caveat that was really an
admission: *set this on one machine only, or results arrive twice.*

So the relay sends them. It already decides the result, it is a single place,
and it has no CSP. `DISCORD_WEBHOOK_URL` in its environment turns reports on;
unset means none, which is a fine way to run.

- **The formatter moved to `src/net/report.ts`**, DOM-free, because `src/ui/` is
  unimportable from Node. `fmtTime` went with it and the results card now imports
  it back from there.
- **The room remembers its seed.** It was only ever broadcast, and by the time a
  match settles the start message is long gone — but the seed is the report's
  reproduction handle, so it is the thing worth keeping.
- **The report drops the series tally.** That running "who leads the rivalry"
  line is each client's own reckoning out of its own localStorage, so the two
  players do not necessarily agree on it, and publishing one of them as though
  it were the score was always slightly dishonest. It still appears on the
  results card, where it is plainly *your* record.
- **`src/ui/discord.ts` shrank to the invite button**, which is Tailscale-only
  and already hidden inside an Activity — there is no link to send when the
  instance *is* the invitation.
- **The results card lost its "logged to Discord ✓" line.** The page has nothing
  truthful to say about a post it no longer makes, which happens after the card
  is already up. The channel is the confirmation; the relay logs failures.

Verified for real rather than mocked: `npm run rooms` stands up a local HTTP
server, points the relay's `DISCORD_WEBHOOK_URL` at it, plays a match to a
result, and asserts exactly one post arrives naming the winner, the sector by
name rather than id, the seed, and both pilots' figures — with no browser
holding a webhook anywhere.

## §9 — Everyone else

The relay seats two and a voice channel routinely holds five, so being turned
away was the first thing three of them met from a game they had just opened
together. They now join a queue, watch the race live, and are seated in turn.

**Winner stays on** — but only when somebody is waiting. With an empty queue
nothing moves and a rematch behaves exactly as it always did. That condition is
the whole design: a queue that never advances is not a queue, and two friends
rematching forever while three others watch is the situation this exists to fix.
So when there *is* a queue, the loser goes to the back and its head takes the
seat. The loser is the last standing, which is already the ranking's answer.

**A client works out its own role from one thing:** whether its id is in
`lobby.players` or `lobby.watchers`. That is deliberately the only signal, so
there is nowhere for two sources of truth to disagree, and promotion needs no
message of its own — the next roster simply lists you elsewhere and the screen
changes.

`watchStatus` carries both sides, because a watcher has no board of their own to
read; seated players learn about each other through `peer`, which carries one
opponent and no names. It rides on the existing status relay rather than a timer
of its own, so it inherits the pump's 2Hz and costs nothing when nobody waits.

Three guards on the server matter more than they look. A watcher's `ready` would
show them as about to play; a watcher's `status` would put a spectator into the
standings they are watching; and a watcher's `dead` would be *actively wrong* —
`finals` settles the match on reaching two entries, so it would have ended a race
with one real player's figures and a spectator's. `seatNext` also refuses to act
mid-match, because a seat vacated during a race belongs to whoever left until the
forfeit timer says otherwise, and filling it would drop a stranger onto a board
already in progress with someone else's lives.

`npm run rooms` covers all of it with real clients: a third and fourth admitted
rather than refused and queued in arrival order, a watcher receiving both sides
live with names, and after the result — Ada wins, Cy takes Bo's seat, Bo goes to
the back behind Dee.

## Relationship to upstream

`git pull upstream main` still works and should stay working. Fixes to the sim,
balance, or rendering belong upstream and flow down; everything in §1 is
Activity-only and stays here. Files shared with upstream are left untouched
unless the port genuinely needs them, so that merges stay boring — which is why
the stale `tower-defense` strings in `server/index.ts` and the runbook were not
renamed when this repo was seeded.
