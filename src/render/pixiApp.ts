import { Application, Container } from 'pixi.js';
import { COLORS } from './constants.ts';

/**
 * Draw layers, back to front. Keeping these as named containers means z-order is
 * structural rather than something we re-sort every frame.
 */
export interface Layers {
  map: Container;        // static board, drawn once
  towers: Container;
  creeps: Container;
  projectiles: Container;
  effects: Container;    // transient VFX
  overlay: Container;    // placement ghost, range circles, selection
}

export interface Renderer {
  app: Application;
  layers: Layers;
}

/** Canvas size is dictated by the map, so it is passed in rather than assumed. */
export async function createRenderer(
  mount: HTMLElement,
  width: number,
  height: number,
): Promise<Renderer> {
  const app = new Application();

  // v8: init() is ASYNC. (v7's `new Application({...})` is gone — most tutorials
  // online are still v7 and will not work.)
  await app.init({
    width,
    height,
    background: COLORS.bg,

    // Crisp on retina without changing our logical coordinate space.
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,

    antialias: true,

    // We drive rendering from our own fixed-timestep loop, so Pixi must not
    // start its own ticker. See src/app/loop.ts.
    autoStart: false,

    // WebGL rather than WebGPU: fewer driver edge cases, and nothing here needs
    // compute. Revisit only if profiling ever says to.
    preference: 'webgl',
  });

  // v8: `app.canvas`, not `app.view`.
  mount.appendChild(app.canvas);

  fitCanvas(app, mount);
  window.addEventListener('resize', () => {
    fitCanvas(app, mount);
  });

  const layers: Layers = {
    map: new Container(),
    towers: new Container(),
    creeps: new Container(),
    projectiles: new Container(),
    effects: new Container(),
    overlay: new Container(),
  };

  app.stage.addChild(
    layers.map,
    layers.towers,
    layers.creeps,
    layers.projectiles,
    layers.effects,
    layers.overlay,
  );

  return { app, layers };
}

/**
 * Letterbox the board into whatever space the window gives us, by CSS size only.
 *
 * The drawing buffer and the stage coordinate system stay fixed at the map's
 * true pixel size, so nothing downstream — placement ghosts, range circles,
 * pointer→tile mapping in M4 — has to know a scale factor exists. Pixi's event
 * system derives pointer coords from the canvas bounding rect, so it follows the
 * CSS size for free.
 *
 * Clamped to 1: past that we'd be upscaling a fixed-resolution buffer and the
 * whole board would go soft.
 */
function fitCanvas(app: Application, mount: HTMLElement): void {
  const scale = Math.min(
    1,
    mount.clientWidth / app.screen.width,
    mount.clientHeight / app.screen.height,
  );
  app.canvas.style.width = `${app.screen.width * scale}px`;
  app.canvas.style.height = `${app.screen.height * scale}px`;
}
