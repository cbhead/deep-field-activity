import type { Graphics } from 'pixi.js';

/**
 * Shared Graphics primitives for the chrome layers.
 *
 * One function so far, and it earns the file on its own: it is the only place
 * that knows about a trap both chrome modules would otherwise rediscover.
 */

/**
 * Stroke an arc as its own sub-path.
 *
 * Every arc in the renderer goes through here, and that is the point.
 * `Graphics.arc` behaves like the canvas primitive it wraps: with a path already
 * open it draws a connecting line from the current point to where the arc
 * begins. Because a chrome layer carries one Graphics for every entity it draws,
 * that trap is live on all but the *first* arc of a frame — so it does not show
 * up in isolation, only once a second arc exists.
 *
 * It has already been shipped once: every slowed contact trailed a diagonal back
 * to whatever shape preceded it, which looked convincingly like a projectile bug
 * and was chased into the projectile data before the arc call was suspected.
 * Seeding the sub-path with `moveTo` is the whole fix, and putting it behind one
 * function is what stops the next indicator paying for it again.
 */
export function strokeArc(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  style: { width: number; color: number; alpha: number },
): void {
  g.moveTo(cx + Math.cos(from) * r, cy + Math.sin(from) * r)
    .arc(cx, cy, r, from, to)
    .stroke(style);
}
