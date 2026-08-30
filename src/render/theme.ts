import type { EnemyId } from '../content/enemies.ts';
import type { TowerId } from '../content/towers.ts';

/**
 * Every colour in the game, in one file.
 *
 * This exists so that "apply a theme" is a one-file swap rather than a diff
 * across `constants.ts`, two content files and a stylesheet. Two consequences
 * are worth stating:
 *
 *  - **Colour lives in the renderer, not in content.** A tower's tint used to
 *    sit on `TowerDef` alongside its damage and cost. Harmless — no simulation
 *    code ever read it — but it put presentation inside the pure layer, and it
 *    meant a reskin touched files the sim imports. Balance and looks now have
 *    no file in common.
 *  - **One representation.** Colours are numbers, because that is what Pixi
 *    takes; the HUD's CSS custom properties are generated from those same
 *    numbers by `applyHudTheme`. The background used to be written twice, as
 *    `0x0f172a` here and `#0f172a` in the stylesheet. Now it cannot drift.
 */
export interface Theme {
  readonly id: string;
  readonly name: string;

  /** The board itself. Static, baked into tile textures once at load. */
  readonly board: {
    readonly bg: number;
    readonly ground: number;
    readonly groundAlt: number;
    readonly gridLine: number;
    readonly blocked: number;
    readonly blockedEdge: number;
    readonly path: number;
    /**
     * `null` means the path tile gets no edge stroke, so the route reads as one
     * continuous road rather than 43 separate tiles. That is a deliberate look
     * and this is where a theme opts out of it.
     */
    readonly pathEdge: number | null;
    readonly spawn: number;
    readonly goal: number;
  };

  /**
   * Per-type tints. Textures are baked neutral (see `BAKE_NEUTRAL`) and tinted
   * on the GPU, which is free and keeps every creep on one draw call.
   */
  readonly towers: Readonly<Record<TowerId, number>>;
  readonly enemies: Readonly<Record<EnemyId, number>>;

  readonly feedback: {
    /**
     * Rejected placement. There is deliberately no matching `valid` colour: a
     * legal ghost is drawn in the tint of the tower being placed, which says
     * *which* tower as well as *yes*.
     */
    readonly invalid: number;
    readonly rangeFillAlpha: number;
    readonly rangeStrokeAlpha: number;
    readonly tileOutlineAlpha: number;
  };

  /**
   * Bake parameters, in px unless noted. Changing these changes what
   * `createTextures` draws, so they only take effect at load.
   */
  readonly shape: {
    readonly towerPad: number;
    readonly towerCorner: number;
    /** Barrel hub radius, as a fraction of the tile. */
    readonly hubRatio: number;
    readonly towerFillAlpha: number;
    readonly strokeWidth: number;
    readonly outline: number;
    readonly outlineAlpha: number;
    /** Projectile halo radius as a multiple of the core, and its alpha. */
    readonly haloRatio: number;
    readonly haloAlpha: number;
  };

  /** Screen-anchored chrome. Emitted as CSS custom properties at boot. */
  readonly hud: {
    readonly bg: number;
    readonly panel: number;
    readonly panelEdge: number;
    readonly text: number;
    readonly muted: number;
    readonly danger: number;
    /** Fallback tint for a build button before its tower colour is applied. */
    readonly accent: number;
  };
}

/**
 * Textures are baked in this colour so `tint` can recolour them per entity.
 * Not a theme choice — a theme that changed it would break tinting entirely.
 */
export const BAKE_NEUTRAL = 0xffffff;

export const DEFAULT_THEME: Theme = {
  id: 'slate',
  name: 'Slate',

  board: {
    bg: 0x0f172a,
    ground: 0x1a2e2a,
    groundAlt: 0x182a26,
    gridLine: 0x24413a,
    blocked: 0x334155,
    blockedEdge: 0x475569,
    path: 0x3f3a2f,
    pathEdge: null,
    spawn: 0xf87171,
    goal: 0x38bdf8,
  },

  towers: {
    arrow: 0x60a5fa,
    cannon: 0xfb923c,
    frost: 0x67e8f9,
  },

  enemies: {
    grunt: 0xf472b6,
  },

  feedback: {
    invalid: 0xef4444,
    rangeFillAlpha: 0.08,
    rangeStrokeAlpha: 0.55,
    tileOutlineAlpha: 0.9,
  },

  shape: {
    towerPad: 4,
    towerCorner: 7,
    hubRatio: 0.19,
    towerFillAlpha: 0.32,
    strokeWidth: 2,
    outline: 0x000000,
    outlineAlpha: 0.35,
    haloRatio: 1.9,
    haloAlpha: 0.22,
  },

  hud: {
    bg: 0x0f172a,
    panel: 0x1e293b,
    panelEdge: 0x334155,
    text: 0xe2e8f0,
    muted: 0x94a3b8,
    danger: 0xef4444,
    accent: 0x60a5fa,
  },
};

/** The active theme. One binding, so swapping themes is a one-line change. */
export const THEME: Theme = DEFAULT_THEME;

/** `0x60a5fa` → `"#60a5fa"`, for the DOM half of the HUD. */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * Push the HUD palette into CSS custom properties.
 *
 * Call this before first paint — `styles.css` declares no colour of its own, so
 * until this runs every `var(--panel)` is unresolved. `color-scheme: dark` in
 * the stylesheet covers the gap so the flash is dark rather than white.
 */
export function applyHudTheme(theme: Theme = THEME): void {
  const { style } = document.documentElement;
  style.setProperty('--bg', css(theme.hud.bg));
  style.setProperty('--panel', css(theme.hud.panel));
  style.setProperty('--panel-edge', css(theme.hud.panelEdge));
  style.setProperty('--text', css(theme.hud.text));
  style.setProperty('--muted', css(theme.hud.muted));
  style.setProperty('--danger', css(theme.hud.danger));
  style.setProperty('--accent', css(theme.hud.accent));
}
