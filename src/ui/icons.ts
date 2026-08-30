import { ENEMIES, ENEMY_IDS, type EnemyId } from '../content/enemies.ts';
import type { TowerId } from '../content/towers.ts';
import { COLLAR_SECTORS, COLLAR_SPAN } from '../render/constants.ts';
import { MARK_STROKE, STATION_MARKS } from '../render/stationShape.ts';
import { THEME } from '../render/theme.ts';

/**
 * The station glyph, as inline SVG for the DOM half of the HUD.
 *
 * The **hexagon** is still a second implementation of what `textures.ts` bakes,
 * and that is still right: the board's is baked neutral and GPU-tinted at 40px,
 * this one is a vector at whatever size a button needs, and sharing a path
 * string across a Pixi `poly()` and an SVG `d` would couple two renderers for
 * decoration.
 *
 * The **mark inside it** is a different matter and comes from
 * `stationShape.ts`, shared with the bake. Five identical glyphs made the roster
 * unlearnable at a glance, and the fix is only worth anything if the shape the
 * deck teaches is the shape the board shows. That is the same argument that
 * already made `COLLAR_SECTORS` shared, applied one level down.
 *
 * Everything is `currentColor`, so a caller sets `color` once on the slot and
 * the whole glyph follows — including the states where it dims.
 */
export function stationIcon(id: TowerId, size: number): string {
  const hex = 'M20 3 L34 11 L34 29 L20 37 L6 29 L6 11 Z';
  return (
    `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">` +
    `<path d="${hex}" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>` +
    `<circle cx="20" cy="20" r="4" fill="currentColor"/>` +
    markSvg(id) +
    `</svg>`
  );
}

/**
 * A contact, drawn as the board draws it.
 *
 * The wave preview used to describe the wave in words — "4 Warden" — which
 * forced the player to translate a name into the ringed pink circle they were
 * about to see. This is the same silhouette the bake makes: a disc, or a plated
 * hexagon with an inner seam when the contact carries armour.
 *
 * **Duplicated rather than shared, unlike the station marks, and the asymmetry
 * is the point.** A station's mark is five distinct shapes each asserting a
 * mechanic; a contact is two primitives and a seam ratio. The load-bearing
 * values — `radius`, `armor`, `shield`, `plateSeam` — are already shared data
 * read straight from `ENEMIES` and `THEME.shape`, so nothing here can drift
 * except two shape formulas that have no reason to change.
 *
 * **Size is compressed, not proportional.** Radii run 0.17 to 0.46, a 2.7x
 * span: drawn literally at chip scale a Mote would be nine pixels against a
 * Monolith's twenty-six and simply illegible. The band preserves *order* — which
 * is the information — while keeping the smallest readable.
 */
export function contactIcon(id: EnemyId, size: number): string {
  const def = ENEMIES[id];
  const s = THEME.shape;

  // Order-preserving compression across the live roster, so adding a contact
  // rescales the set rather than falling off either end of a fixed table.
  const radii = ENEMY_IDS.map((e) => ENEMIES[e].radius);
  const lo = Math.min(...radii);
  const hi = Math.max(...radii);
  const t = hi === lo ? 1 : (def.radius - lo) / (hi - lo);
  const r = (0.62 + t * 0.34) * (size / 2) * 0.86;
  const c = size / 2;

  const body =
    def.armor > 0
      ? // Plated: a flat-top hexagon with an inner seam, as `drawCreep` bakes it.
        `<path d="${hexPath(c, r)}" fill="currentColor" fill-opacity=".9"/>` +
        `<path d="${hexPath(c, r * s.plateSeam)}" fill="none" stroke="var(--bg)" stroke-opacity=".55" stroke-width="${(size * 0.05).toFixed(1)}"/>`
      : `<circle cx="${c}" cy="${c}" r="${r.toFixed(1)}" fill="currentColor"/>`;

  // Shield is a BAND above the body, never a ring. `theme.ts` rejects a ring for
  // shield on purpose: the gravity slow already owns that shape on the board,
  // and teaching "ring = shield" here while the board teaches "ring = slowed"
  // would make the two unlearnable together.
  const band =
    def.shield > 0
      ? `<rect x="${(c - r).toFixed(1)}" y="${(c - r - size * 0.16).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(size * 0.075).toFixed(1)}" rx="${(size * 0.037).toFixed(1)}" fill="var(--shield)"/>`
      : '';

  return (
    `<svg class="cg c-${id}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
    band +
    body +
    `</svg>`
  );
}

/** Flat-top hexagon, matching the plated silhouette the board bakes. */
function hexPath(c: number, r: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(c + Math.cos(a) * r).toFixed(1)} ${(c + Math.sin(a) * r).toFixed(1)}`;
  });
  return `M${pts.join(' L')} Z`;
}

/**
 * The station's **live** collar, at the size the board's code deserves.
 *
 * `pathDial` teaches one sector at 13px on an upgrade button. This shows all
 * three at once, filled to the tiers actually bought — so an upgraded station
 * on the board is recognisable because the player has already seen this exact
 * arrangement at full size, rather than having to reconstruct it from three
 * tiny dials.
 *
 * Angles and span come from `COLLAR_SECTORS`, shared with the board. The fill
 * fraction uses the same `(tier - 1) / (max - 1)` the board's collar does, so a
 * Mk II reads half-filled in both places.
 */
export function collarDial(tiers: Readonly<Record<string, number>>, max: number, size = 64): string {
  const c = size / 2;
  const r = c * 0.86;

  const arcs = COLLAR_SECTORS.map(({ path, from }) => {
    const tier = tiers[path] ?? 1;
    const fill = max <= 1 ? 0 : (tier - 1) / (max - 1);
    const span = COLLAR_SPAN * fill;

    const at = (deg: number): string => {
      const a = (deg * Math.PI) / 180;
      return `${(c + Math.cos(a) * r).toFixed(1)} ${(c + Math.sin(a) * r).toFixed(1)}`;
    };
    // The full sector, dim, always — so an untouched path still shows *where*
    // it would appear. Then the bought portion over it, bright.
    const track =
      `<path d="M${at(from)} A${r} ${r} 0 0 1 ${at(from + COLLAR_SPAN)}" fill="none"` +
      ` stroke="currentColor" stroke-opacity=".16" stroke-width="4" stroke-linecap="round"/>`;
    if (span <= 0) return track;
    return (
      track +
      `<path d="M${at(from)} A${r} ${r} 0 0 1 ${at(from + span)}" fill="none"` +
      ` stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`
    );
  }).join('');

  return `<svg class="collar" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${arcs}</svg>`;
}

/** The station's mechanic mark, scaled from unit space into the 40-unit box. */
function markSvg(id: TowerId): string {
  const mark = STATION_MARKS[id];
  const u = (v: number): string => (v * 40).toFixed(1);
  const w = (MARK_STROKE * 40).toFixed(1);
  const common = `fill="none" stroke="currentColor" stroke-width="${w}" stroke-opacity=".85" stroke-linecap="round" stroke-linejoin="round"`;
  const out: string[] = [];

  for (const line of mark.lines) {
    const [head, ...rest] = line;
    if (head === undefined) continue;
    const d = `M${u(head.x)} ${u(head.y)}` + rest.map((p) => ` L${u(p.x)} ${u(p.y)}`).join('');
    out.push(`<path d="${d}" ${common}/>`);
  }

  for (const a of mark.arcs) {
    // A full ring has no start and end to draw an arc between, so it is the one
    // case that has to be a circle.
    if (a.span >= 360) {
      out.push(`<circle cx="20" cy="20" r="${u(a.r)}" ${common}/>`);
      continue;
    }
    const p = (deg: number): string => {
      const rad = (deg * Math.PI) / 180;
      return `${(20 + Math.cos(rad) * a.r * 40).toFixed(1)} ${(20 + Math.sin(rad) * a.r * 40).toFixed(1)}`;
    };
    const large = a.span > 180 ? 1 : 0;
    out.push(
      `<path d="M${p(a.from)} A${u(a.r)} ${u(a.r)} 0 ${large} 1 ${p(a.from + a.span)}" ${common}/>`,
    );
  }

  for (const d of mark.discs) {
    out.push(`<circle cx="${u(d.cx)}" cy="${u(d.cy)}" r="${u(d.r)}" fill="currentColor" fill-opacity=".85"/>`);
  }

  return out.join('');
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
