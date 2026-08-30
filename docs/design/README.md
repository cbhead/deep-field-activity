# Deep Field — the source design

`Tower Defense HUD - States.dc.html` is the ten-state HUD spec that came out of a
Claude Design session, kept here because it is the *reasoning* behind a lot of
the current code and that reasoning is not recoverable from the code itself.
Each state carries a short rationale explaining why it looks the way it does —
those paragraphs are the valuable part.

Open it in a browser to view it; `support.js` is the runtime it needs and is
generic (a React-based template compiler), not design content.

## Read it with two caveats

**The numbers are stale.** It was authored against an earlier balance pass and
shows Arrow $60 / Cannon $110 / Frost $85, Arrow at range 3.0, and the old
"Cheap, fast, long reach" blurb. Live values are in `src/content/towers.ts` and
`src/content/balance.ts`, and the HUD reads from those — so the running game
deliberately does not match these mockups.

**Not all of it is built.** Implemented, still to do, and the reasons for the
gaps are tracked in the plan at
`~/.claude/plans/i-want-to-start-effervescent-dolphin.md`. The short version:
everything is built except a fourth tower behind the unlock gate, multi-sector
navigation, the "ways out" chips on the can't-afford state, hit flash, and audio.

## What it is not

A component library. This is a static spec — nothing here is imported or built
against, and `/design-sync` does not apply to this repo (there are no React
components to sync). Treat it as documentation.
