import { createRenderer } from './render/pixiApp.ts';
import { createTextures } from './render/textures.ts';
import { buildMapLayer } from './render/mapLayer.ts';
import { WorldView } from './render/worldView.ts';
import { tilesToPx } from './render/constants.ts';
import { LEVEL01 } from './content/maps/level01.ts';
import { parseMap } from './sim/util/grid.ts';
import { hashSeed, formatSeed } from './sim/util/rng.ts';
import { createWorld } from './sim/world.ts';
import { createLoop } from './app/loop.ts';
import { attachInput } from './app/input.ts';

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

async function main(): Promise<void> {
  const mount = document.getElementById('game-root');
  if (!mount) throw new Error('#game-root missing from index.html');

  const seed = resolveSeed();
  const map = parseMap(LEVEL01);
  const world = createWorld(map, seed);

  const { app, layers } = await createRenderer(mount, tilesToPx(map.cols), tilesToPx(map.rows));

  const textures = createTextures(app.renderer);
  layers.map.addChild(buildMapLayer(map, textures));

  // main.ts is the only place that knows about both halves. The sim has no
  // reference to the view; the view only ever reads the world.
  const view = new WorldView(layers, textures);
  const loop = createLoop(world, () => {
    view.sync(world);
    app.render();
  });

  attachInput(app, world);
  loop.start();

  // Dev-only console handle. Stripped from production builds by the constant
  // folding on import.meta.env.DEV. Being able to poke at `td.world` and
  // `td.loop.speed` from devtools is worth far more here than in a typical app,
  // because the interesting bugs are all "what is the sim actually doing".
  if (import.meta.env.DEV) {
    (globalThis as Record<string, unknown>)['td'] = { world, loop, map, app };
  }

  console.info(
    `[td] "${map.name}" ${map.cols}x${map.rows}, ` +
      `${map.waypoints.length} waypoints, ${map.pathLength} tiles of path — ` +
      `seed ${formatSeed(seed)} (${seed}). Click to spawn a creep.`,
  );
}

main().catch((err: unknown) => {
  console.error('[td] failed to start', err);
});
