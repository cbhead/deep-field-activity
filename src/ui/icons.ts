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

/** Tier pips — filled up to `tier`, hollow to `max`. */
export function tierPips(tier: number, max: number): string {
  let out = '<span class="pips">';
  for (let i = 1; i <= max; i++) {
    out += `<i class="${i <= tier ? 'on' : ''}"></i>`;
  }
  return out + '</span>';
}
