import { createRenderer } from './render/pixiApp.ts';
import { createTileTextures } from './render/textures.ts';
import { buildMapLayer } from './render/mapLayer.ts';
import { tilesToPx } from './render/constants.ts';
import { LEVEL01 } from './content/maps/level01.ts';
import { parseMap } from './sim/util/grid.ts';
import { hashSeed, formatSeed } from './sim/util/rng.ts';

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

  const { app, layers } = await createRenderer(
    mount,
    tilesToPx(map.cols),
    tilesToPx(map.rows),
  );

  const textures = createTileTextures(app.renderer);
  layers.map.addChild(buildMapLayer(map, textures));

  // We own the loop, so nothing draws unless we say so (autoStart: false).
  // M2 replaces this single call with the fixed-timestep accumulator.
  app.render();

  console.info(
    `[td] "${map.name}" ${map.cols}x${map.rows}, ` +
      `${map.waypoints.length} waypoints, ${map.pathLength} tiles of path — ` +
      `seed ${formatSeed(seed)} (${seed})`,
  );
}

main().catch((err: unknown) => {
  console.error('[td] failed to start', err);
});
