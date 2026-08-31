# Deep Field — the source designs

Six documents from Claude Design sessions, kept here because they are the
*reasoning* behind a lot of the current code and that reasoning is not
recoverable from the code itself. Each one carries short rationales explaining
why a surface looks the way it does — those paragraphs are the valuable part,
and they are why these are worth 250kB of repository.

Open any of them in a browser to read it. `support.js` is the runtime they need
and is generic (a React-based template compiler), not design content.

## The set, in the order they were written

| | what it drove |
|---|---|
| **Tower Defense HUD - States** | The ten-state HUD: build deck, inspector, armed and locked slots, the overlay cards. |
| **Race Lobby** | The head-to-head lobby — room codes, the roster, the countdown. |
| **Deep Field - Build Spec** | Sixteen surfaces as before/after: the board layer, the deck, and the status-effect channels. |
| **Deep Field - Front Door** | The home screen, sector cards on real board thumbnails, and the Race entry. |
| **Deep Field - Contact Spec Final** | Six contacts that read as six silhouettes, and the status channels that ride on them. |
| **Deep Field - Map Spec** | Sectors 04–08, and the one model change they need: a map carries routes, plural. |

The first five are **built**. The map spec is **not** — it is the only one here
describing a game that does not exist yet, so it reads as a proposal rather than
a record. What is not built is tracked in the plan at
`~/.claude/plans/i-want-to-start-effervescent-dolphin.md`, which also records
the execution order and the decisions taken along the way.

## Read them with three caveats

These caveats are about the five built specs. The map spec is exempt from all
three, and deliberately so — see below.

**The numbers are stale, in all of them.** They were authored against earlier
balance passes: the HUD spec shows Arrow $60 / Cannon $110 / Frost $85 and the
old "Cheap, fast, long reach" blurb, from before the stations were renamed.
Live values are in `src/content/`, and the HUD reads from those — so the running
game deliberately does not match these mockups.

**Some "before" panels describe code that had already moved on.** The build
spec's 3.2 says "nothing is drawn" for the Filament ramp, when `drawSpinUp` had
been drawing it for some time; its 3.1 describes the slow indicator as a plain
ring when the shipped one is a clock carrying both remaining time and bite.
Building the "after" without checking the "before" would have meant rebuilding
working code — and in 3.1's case, replacing a richer readout with a poorer one.

**Some numbers are wrong, not merely stale.** Two were caught by measuring
rather than by reading:

- The build spec's grid mask, `radial-gradient(125% 120% …, #000 40%,
  transparent 92%)`, computes on a 26×15 board to a mask of 1.0 along the
  mid-edges and 0.659 in the corners — a fade nobody would ever see. The
  shipped values land at ~0.82 and ~0.42.
- The front door's "turn count derives from `waypoints.length - 2`" gives
  7 / 7 / 9 against real heading changes of 6 / 6 / 8. Switchback's own blurb
  says "six turns", so implementing it literally would have printed a numeral
  contradicting the prose beside it.

> **Where a mock and its acceptance checklist disagree, the checklist wins.**
> The build spec says so itself, and that rule is what makes the stale panels
> harmless: build against the checklist, and check the "before" against the
> code rather than against the picture.

## The map spec's numbers were measured, and they hold

The standing caveat above is that the numbers in these documents are stale or
wrong. The map spec is the exception, and it is worth recording *that it was
checked* rather than trusting it twice.

Every one of its five boards was run through the same rules `parseMap` enforces
— right angles, no duplicate waypoints, never off-board, never off-path, union
coverage with no orphaned road — plus its own printed figures for road tiles,
buildable tiles, per-route length and merge runway. All 25 routes and all 25
figures are exact. Two of the three earlier specs shipped arithmetic that was
wrong on contact with a real board; this one does not, so the ASCII rows and
route tables in §3 can be transcribed into `src/content/maps/` as authoritative
rather than as a starting point.

What it does **not** carry, and what therefore has to be decided in code:

- **No palettes.** It names five `SectorFieldId`s and says lanes are "value
  steps of the route accent — no new hues", but authors none of the ~40 values
  a `SectorField` needs. The five new fields are derived from the existing
  three under that rule.
- **No wave tables.** §5 says "five wave tables" and stops. Roughly sixty waves
  of composition are authoring work, and `tools/sweep.ts` re-baselines them.
- **No ordering rule for `first`/`last` targeting.** `targeting.ts` ranks by
  `Creep.progress`, which stops being comparable the moment two lanes have
  different lengths — on Sluice, deliberately 2.5 : 1, a contact two tiles from
  the goal down the chute loses "first" to one thirty tiles out on the coil.
  Remaining distance to the goal is the rule that survives the change; distance
  travelled is not.

## Deliberate departures

Recorded here so they are not read as drift. Each is argued in the commit that
made it:

- **Shield is drawn as a band, never a ring.** The gravity slow already owns
  that shape on the board, and teaching "ring = shield" in the deck while the
  board teaches "ring = slowed" makes the pair unlearnable.
- **Targeting labels the active mode** rather than hiding all four names behind
  hover. `title` never fires on touch, the glyphs are unguessable, and the
  control mutates game state.
- **The route's spill is a second stroke, not a blurred strip.** Blur means a
  Pixi filter, and filters are not used here.
- **The relay probe reads nothing.** The design wanted a status dot; the direct
  implementation would have needed CORS on `/info`, which serves the host's
  Tailscale address.

## What these are not

A component library. Nothing here is imported or built against, `docs/**` is
excluded from lint, and `/design-sync` does not apply to this repo — there are
no React components to sync. Treat them as documentation.
