import { createRenderer } from './render/pixiApp.ts';
import { createTextures } from './render/textures.ts';
import { buildMapLayer } from './render/mapLayer.ts';
import { WorldView } from './render/worldView.ts';
import { Overlay } from './render/overlay.ts';
import { Effects } from './render/effects.ts';
import { tilesToPx } from './render/constants.ts';
import { applyHudTheme } from './render/theme.ts';
import { LEVEL01 } from './content/maps/level01.ts';
import { parseMap } from './sim/util/grid.ts';
import { hashSeed, formatSeed } from './sim/util/rng.ts';
import { createWorld } from './sim/world.ts';
import { createLoop } from './app/loop.ts';
import { attachInput } from './app/input.ts';
import { createUiState } from './app/uiState.ts';
import { createHud } from './ui/hud.ts';

/**
 * The match seed comes from the URL so any run is reproducible: `?seed=hunter2`
 * turns "reproduce that bug" and "race the same board again" into free features.
 * In Race mode (phase 2) the server supplies this instead.
 */
function resolveSeed(): number {
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null || raw === '') {
    // Presentation-layer randomness, so Math.random is correct here.
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }
  const asInt = Number(raw);
  return Number.isInteger(asInt) && asInt >= 0 ? asInt >>> 0 : hashSeed(raw);
}

/** The HUD is text; 10Hz is indistinguishable from 60 and does a sixth the work. */
const HUD_INTERVAL_MS = 100;

// Before main(), not inside it: main is async and the stylesheet resolves every
// colour through these properties, so deferring them to the first await would
// paint an unstyled HUD.
applyHudTheme();

async function main(): Promise<void> {
  const mount = document.getElementById('game-root');
  const hudRoot = document.getElementById('hud');
  if (!mount || !hudRoot) throw new Error('#game-root or #hud missing from index.html');

  const seed = resolveSeed();
  const map = parseMap(LEVEL01);
  const world = createWorld(map, seed);
  const ui = createUiState();

  const boardW = tilesToPx(map.cols);
  const boardH = tilesToPx(map.rows);
  const { app, layers } = await createRenderer(mount, boardW, boardH);

  const textures = createTextures(app.renderer);
  layers.map.addChild(buildMapLayer(map, textures));

  const view = new WorldView(layers, textures);
  const overlay = new Overlay(layers, textures);
  const effects = new Effects(layers, boardW, boardH);

  function togglePause(): void {
    ui.paused = !ui.paused;
    loop.paused = ui.paused;
  }

  const hud = createHud(hudRoot, {
    world,
    ui,
    dispatch: (cmd) => world.commands.push(cmd),
    speed: {
      get: () => loop.speed,
      set: (v) => {
        loop.speed = v;
      },
    },
    togglePause,
    // A full reload is the honest restart: it re-runs seed resolution, rebuilds
    // the world and resets every renderer pool, with no chance of a stale
    // reference surviving into the new run. Cheap, and impossible to get wrong.
    restart: () => {
      location.reload();
    },
  });

  // main.ts is the only place that knows about both halves. The sim has no
  // reference to the view; the view only ever reads the world.
  let hudDue = 0;
  let lastRenderMs = performance.now();

  const loop = createLoop(world, () => {
    const now = performance.now();
    // Wall-clock delta, clamped: effects decay at the same rate at 1x and 4x,
    // and a backgrounded tab must not fast-forward them on return.
    const dt = Math.min(0.1, (now - lastRenderMs) / 1000);
    lastRenderMs = now;

    // One drain, three consumers. Whichever ran first would otherwise starve
    // the others, which is exactly the bug that made the HUD miss wave clears.
    effects.beginFrame();
    for (const ev of world.events) {
      view.onEvent(ev);
      effects.onEvent(ev, ui.prefs);
      hud.onEvent(ev);
    }
    world.events.length = 0;

    view.sync(world, dt);
    overlay.sync(world, ui.selected, ui.hover, ui.inspecting);
    effects.update(world, dt, ui.prefs);

    if (now >= hudDue) {
      hud.update();
      hudDue = now + HUD_INTERVAL_MS;
    }

    app.render();
  });

  attachInput(app, world, ui, togglePause);
  loop.start();

  console.info(
    `[td] "${map.name}" ${map.cols}x${map.rows}, ` +
      `${map.waypoints.length} waypoints, ${map.pathLength} tiles of path — ` +
      `seed ${formatSeed(seed)} (${seed})`,
  );

  // Dev-only console handle. Stripped from production builds by the constant
  // folding on import.meta.env.DEV. Being able to poke at `td.world` and
  // `td.loop.speed` from devtools is worth far more here than in a typical app,
  // because the interesting bugs are all "what is the sim actually doing".
  if (import.meta.env.DEV) {
    (globalThis as Record<string, unknown>)['td'] = {
      world, loop, view, overlay, effects, ui, map, app, layers,
    };
  }
}

main().catch((err: unknown) => {
  console.error('[td] failed to start', err);
});
