import { COLLAR_SECTORS, COLLAR_SPAN } from '../render/constants.ts';

/**
 * The station glyph, as inline SVG for the DOM half of the HUD.
 *
 * Deliberately a second implementation of the hexagon that `textures.ts` bakes
 * for the board, rather than a shared one: the board's version is baked neutral
 * and GPU-tinted at 40px, this one is a vector drawn at whatever size a button
 * needs. Sharing the path string across a Pixi `poly()` and an SVG `d` would
 * couple two renderers to save nine numbers.
 *
 * Everything is `currentColor`, so a caller sets `color` once on the slot and
 * the whole glyph follows — including the states where it dims.
 */
export function stationIcon(size: number): string {
  const hex = 'M20 3 L34 11 L34 29 L20 37 L6 29 L6 11 Z';
  return (
    `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">` +
    `<path d="${hex}" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>` +
    `<path d="M20 3 L20 37 M6 11 L34 29 M34 11 L6 29" stroke="currentColor" stroke-width="1" stroke-opacity=".3"/>` +
    `<circle cx="20" cy="20" r="5.5" fill="currentColor"/>` +
    `</svg>`
  );
}

/**
 * The collar sector this path occupies on the board, as a tiny dial.
 *
 * This glyph is the entire reason the board's collar is readable. The collar
 * encodes which path by *position* — colour was not available, every hue being
 * already claimed by a station or a status — and a positional code has to be
 * taught somewhere. Here is that somewhere: the upgrade button for a path shows
 * the same sector, at the same angle, that lights up around the station when you
 * buy it. The board only has to jog the memory this button forms.
 *
 * The angles come from `render/constants.ts`, shared with the board rather than
 * copied. This is the one place `stationIcon`'s duplicate-the-shape reasoning
 * does *not* apply: that hexagon is decoration, where these angles are a claim
 * about what the board is doing, and a legend that drifts from the thing it
 * explains is worse than no legend. `constants.ts` is pixi-free, so the DOM side
 * can import it without pulling in a renderer.
 */
export function pathDial(path: string): string {
  const sector = COLLAR_SECTORS.find((c) => c.path === path);
  if (sector === undefined) return '';

  const r = 8;
  const arc = (from: number, span: number, cls: string): string => {
    const a0 = (from * Math.PI) / 180;
    const a1 = ((from + span) * Math.PI) / 180;
    const x0 = 12 + Math.cos(a0) * r;
    const y0 = 12 + Math.sin(a0) * r;
    const x1 = 12 + Math.cos(a1) * r;
    const y1 = 12 + Math.sin(a1) * r;
    // Every sector is under 180°, so the large-arc flag is always 0.
    return `<path class="${cls}" d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" fill="none" stroke="currentColor" stroke-linecap="round"/>`;
  };

  // All three sectors drawn, the live one bright: the dial says "this position,
  // out of these three", which is what makes the board legible rather than just
  // decorated.
  const others = COLLAR_SECTORS.filter((c) => c.path !== path)
    .map((c) => arc(c.from, COLLAR_SPAN, 'dial-off'))
    .join('');

  return (
    `<svg class="dial" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">` +
    `${others}${arc(sector.from, COLLAR_SPAN, 'dial-on')}</svg>`
  );
}

/** Tier pips — filled up to `tier`, hollow to `max`. */
export function tierPips(tier: number, max: number): string {
  let out = '<span class="pips">';
  for (let i = 1; i <= max; i++) {
    out += `<i class="${i <= tier ? 'on' : ''}"></i>`;
  }
  return out + '</span>';
}
