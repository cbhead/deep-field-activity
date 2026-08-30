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
    /** Starfield. Most stars are `star`; a scattered few are `starBright`. */
    readonly star: number;
    readonly starBright: number;
    /**
     * Ground tiles draw at this alpha so the starfield shows through open
     * space. The route stays fully opaque, which is what makes it read as a
     * structure laid over the void rather than another shade of tile.
     */
    readonly groundAlpha: number;
  };

  /**
   * Per-type tints. Textures are baked neutral (see `BAKE_NEUTRAL`) and tinted
   * on the GPU, which is free and keeps every creep on one draw call.
   */
  readonly towers: Readonly<Record<TowerId, number>>;
  readonly enemies: Readonly<Record<EnemyId, number>>;

  readonly feedback: {
    /**
     * Rejected placement. There is deliberately no `valid` counterpart: a legal
     * ghost is drawn in the tint of the tower being placed, which says *which*
     * tower as well as *yes*.
     */
    readonly invalid: number;
    /** Ring around the tower the inspector is showing. */
    readonly selected: number;
    readonly rangeFillAlpha: number;
    readonly rangeStrokeAlpha: number;
    readonly tileOutlineAlpha: number;
  };

  /** Transient combat feedback, drawn by `effects.ts` and `worldView.ts`. */
  readonly fx: {
    /** A struck contact's tint is lerped toward this. Applied in `worldView`. */
    readonly hitFlash: number;
    /** Floating damage numbers, when no firing tower colour applies. */
    readonly damageText: number;
    readonly hpFull: number;
    readonly hpLow: number;
    readonly hpTrack: number;
    /** The goal flare and screen-edge rim when a creep gets through. */
    readonly leak: number;
    readonly leakBright: number;
    /** Ring drawn around a contact held in a gravity well. */
    readonly slowRing: number;
    /**
     * Outline behind in-world text.
     *
     * Canvas text sits over both the near-black field and the brightest thing
     * on screen — a contact taking a hit. A fill alone is legible on one or the
     * other, never both, so every in-world label carries this behind it.
     */
    readonly textOutline: number;
    /**
     * Overshield, drawn as a band above the hull bar.
     *
     * Deliberately *not* a ring: the gravity slow already owns that shape, and
     * two cool rings around one contact would be a puzzle rather than a
     * readout. A band over the bar says "there is a layer before the hull"
     * with no ambiguity, and reads at a glance in a crowd.
     */
    readonly shield: number;
  };

  /**
   * Bake parameters, in px unless noted. Changing these changes what
   * `createTextures` draws, so they only take effect at load.
   */
  readonly shape: {
    /** Tower silhouette. `hex` is the Deep Field station; `roundRect` was v1. */
    readonly tower: 'hex' | 'roundRect';
    readonly towerPad: number;
    readonly towerCorner: number;
    /** Barrel hub radius, as a fraction of the tile. */
    readonly hubRatio: number;
    readonly towerFillAlpha: number;
    /** Internal bracing lines on the hex station. 0 disables them. */
    readonly towerStrutAlpha: number;
    readonly strokeWidth: number;
    readonly outline: number;
    readonly outlineAlpha: number;
    /** Soft ring baked around a creep. Radius multiple, then alpha. 0 = off. */
    readonly glowRatio: number;
    readonly glowAlpha: number;
    /** Projectile halo: radius multiple of the core, then alpha. */
    readonly haloRatio: number;
    readonly haloAlpha: number;

    /**
     * The plated contact silhouette — see `drawCreep` for why armour is drawn
     * as a shape and not as another ring. A heavier rim than the plain hull's
     * 2px is most of what sells it; the seam sits at this fraction of the rim.
     */
    readonly plateWidth: number;
    readonly plateSeam: number;

    /**
     * Tier marks baked into the station, as fractions of the tile.
     *
     * A row of pips low on the hex, one per tier, plus a core that grows and
     * gains a halo. Both are baked in `BAKE_NEUTRAL` so they take the station's
     * own tint like everything else — a higher tier must read as a *stronger*
     * station, never as a different one.
     */
    readonly pipRadius: number;
    readonly pipRowY: number;
    readonly pipSpacing: number;
    /** Core radius multiplier per tier above the first. */
    readonly tierHubGrowth: number;
    /** Halo radius as a multiple of the core, and its alpha per tier above the first. */
    readonly tierGlowRatio: number;
    readonly tierGlowAlpha: number;
  };

  /** Screen-anchored chrome. Emitted as CSS custom properties at boot. */
  readonly hud: {
    readonly bg: number;
    readonly panel: number;
    readonly panelEdge: number;
    readonly slot: number;
    readonly text: number;
    /** Slightly dimmer than `text`, for values that aren't the headline. */
    readonly bright: number;
    readonly muted: number;
    /** Dimmest legible tier — hints, disabled labels. */
    readonly dim: number;
    readonly danger: number;
    readonly dangerBright: number;
    readonly accent: number;
    readonly accentSoft: number;
    readonly accentBright: number;
  };
}

/**
 * Textures are baked in this colour so `tint` can recolour them per entity.
 * Not a theme choice — a theme that changed it would break tinting entirely.
 */
export const BAKE_NEUTRAL = 0xffffff;

/**
 * Deep Field — the direction that came back from the design session.
 *
 * The board is a starfield, stations are hexagonal emplacements, and the
 * contacts are the only warm thing on screen. That last part is the contrast
 * hierarchy doing its job: everything structural sits in the blue-black end of
 * the range, so a pink creep is the brightest object in any frame it occupies.
 */
export const DEEP_FIELD: Theme = {
  id: 'deep-field',
  name: 'Deep Field',

  board: {
    bg: 0x07080f,
    // The checker has to survive `groundAlpha` compositing it back toward `bg`.
    // These were 2-4/255 apart, which after the alpha was ~1.5 — invisible, and
    // leaving the grid stroke to do the whole job of making tiles placeable.
    // Widened until the checker actually reads without competing with a star.
    ground: 0x0f1222,
    groundAlt: 0x0b0d19,
    gridLine: 0x1a1d33,
    blocked: 0x232532,
    blockedEdge: 0x2f3245,
    // The route reads *lighter* than the field it crosses, so the path is
    // legible in greyscale rather than relying on hue.
    path: 0x1b1f36,
    pathEdge: null,
    spawn: 0xf9a8d4,
    goal: 0xb5abfc,
    star: 0x6f7699,
    starBright: 0xd7dcf0,
    groundAlpha: 0.72,
  },

  towers: {
    lance: 0x8fc4fa,
    nova: 0xfcc08a,
    singularity: 0xa5eefb,
    // Green and violet, because the three above are all blue-to-orange and a
    // fourth blue would be unreadable in a crowd — the damage numbers are tinted
    // by station, so these have to separate at a glance and at 13px.
    arc: 0x86e39b,
    filament: 0xc4a6ff,
  },

  // Contacts share one warm family so "something is coming" reads before "what
  // is coming" does — they are the only warm thing on a blue-black board, and
  // that is the contrast hierarchy's whole job. Type is carried by variation
  // *within* the family, plus the size differences the defs already give them.
  enemies: {
    drifter: 0xf472b6,
    /** Palest and smallest — a swarm should read as spray, not as individuals. */
    mote: 0xfbcfe8,
    /** Deepest, to sit with its bulk. */
    monolith: 0xc2557f,
    /** Coolest of the family, so the shield's cyan ring belongs to it. */
    warden: 0xe879c9,
    /** Pushed toward red: the one whose death makes things worse. */
    cluster: 0xfb7185,
    /**
     * Desaturated toward steel — the only contact that reads as *plated* rather
     * than as flesh, which is the one thing a player needs to spot early enough
     * to stop pouring chip damage into it.
     */
    bulwark: 0xd8a0b4,
  },

  feedback: {
    invalid: 0xe06d6d,
    selected: 0xb5abfc,
    rangeFillAlpha: 0.05,
    rangeStrokeAlpha: 0.35,
    tileOutlineAlpha: 0.9,
  },

  fx: {
    hitFlash: 0xffffff,
    damageText: 0xcfe4ff,
    hpFull: 0xf472b6,
    hpLow: 0xe06d6d,
    hpTrack: 0x0b0c16,
    leak: 0xe06d6d,
    leakBright: 0xffb4b4,
    slowRing: 0xa5eefb,
    shield: 0x9fbcff,
    textOutline: 0x05060d,
  },

  shape: {
    tower: 'hex',
    towerPad: 3,
    towerCorner: 7,
    hubRatio: 0.1375,
    towerFillAlpha: 0.2,
    towerStrutAlpha: 0.3,
    strokeWidth: 2.2,
    outline: 0x000000,
    outlineAlpha: 0.35,
    glowRatio: 1.75,
    glowAlpha: 0.22,
    haloRatio: 1.9,
    haloAlpha: 0.22,
    plateWidth: 3.2,
    plateSeam: 0.62,
    pipRadius: 0.045,
    pipRowY: 0.795,
    pipSpacing: 0.15,
    tierHubGrowth: 0.24,
    tierGlowRatio: 2.3,
    tierGlowAlpha: 0.17,
  },

  hud: {
    bg: 0x090a14,
    panel: 0x141624,
    panelEdge: 0x2a2d40,
    slot: 0x232532,
    text: 0xe9e9ed,
    bright: 0xcfd3e5,
    muted: 0x9397ab,
    dim: 0x75798c,
    danger: 0xe06d6d,
    dangerBright: 0xffb4b4,
    accent: 0x9184d9,
    accentSoft: 0xb5abfc,
    accentBright: 0xd2cefd,
  },
};

/** The active theme. One binding, so swapping themes is a one-line change. */
export const THEME: Theme = DEEP_FIELD;

/** `0x60a5fa` → `"#60a5fa"`, for the DOM half of the HUD. */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** `(0x60a5fa, 0.4)` → `"rgba(96,165,250,0.4)"`, for glows and washes. */
export function rgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${alpha})`;
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
  for (const [key, value] of Object.entries(theme.hud)) {
    // panelEdge → --panel-edge
    style.setProperty(`--${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`, css(value));
  }
  for (const [id, value] of Object.entries(theme.towers)) {
    style.setProperty(`--tower-${id}`, css(value));
  }
}
