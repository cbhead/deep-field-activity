/**
 * How to play, as a legend rather than a tutorial.
 *
 * A new player learned the five stations from tooltips mid-wave, which is the
 * worst moment to read anything. This is static: the roster, drawn with the
 * *same* glyphs the deck and board use, one line each.
 *
 * **Every line is derived from the def.** A hand-written legend is the thing
 * that goes stale first — it would still say "pierces three" a week after
 * `pierce` was tuned, and nothing would catch it. Deriving means the legend is
 * wrong only if the game is.
 */
import { ENEMIES, ENEMY_IDS, type EnemyId } from '../content/enemies.ts';
import { TOWERS, TOWER_IDS } from '../content/towers.ts';
import type { EnemyDef } from '../content/types.ts';
import { contactIcon, stationIcon } from './icons.ts';

/**
 * What a contact asks of the player, from its own numbers.
 *
 * Ordered by what changes a decision most: a mechanic that defeats a whole
 * station type matters more than being slightly faster.
 */
function describeContact(d: EnemyDef): string {
  if (d.splitInto !== null) {
    const child = ENEMIES[d.splitInto.enemy as EnemyId];
    return `Dies into ${d.splitInto.count} ${child?.name ?? 'smaller contacts'} — killing it early is not a favour`;
  }
  if (d.armor > 0) return `Plated: every hit loses ${d.armor} to armour, so chip damage bounces off`;
  if (d.shield > 0) return `Overshield of ${d.shield} that regrows in any gap in your coverage`;

  const fastest = Math.max(...ENEMY_IDS.map((e) => ENEMIES[e].speed));
  const biggest = Math.max(...ENEMY_IDS.map((e) => ENEMIES[e].hp));
  if (d.hp === biggest) return `A wall of hull — ${d.hp} of it, and nothing clever about it`;
  if (d.speed === fastest) return `Fast and small: single-target fire cannot keep up`;
  return `The baseline everything else reads against`;
}

/** What a station does that the other four do not, from its own numbers. */
function describeStation(id: (typeof TOWER_IDS)[number]): string {
  const d = TOWERS[id];
  if (d.pierce > 0) return `Passes through ${d.pierce} more contacts — wants them lined up`;
  if (d.splashRadius > 0) return `Detonates across ${d.splashRadius.toFixed(1)} tiles — wants them bunched`;
  if (d.slowFactor < 1) {
    return `Holds contacts at ${Math.round(d.slowFactor * 100)}% speed for ${d.slowSeconds.toFixed(1)}s`;
  }
  if (d.chainJumps > 0) return `Jumps to ${d.chainJumps} more within ${d.chainRange.toFixed(1)} tiles`;
  if (d.rampPerSecond > 0) {
    const seconds = (d.rampMax - 1) / d.rampPerSecond;
    return `Ramps to ×${Number(d.rampMax.toFixed(2))} over ${seconds.toFixed(1)}s on one target`;
  }
  return d.blurb;
}

export function legendHtml(): string {
  const stations = TOWER_IDS.map(
    (id) =>
      `<li><span class="lg-ic t-${id}">${stationIcon(id, 34)}</span>` +
      `<span><b>${TOWERS[id].name}</b>${TOWERS[id].unlockWave > 0 ? ` <em>wave ${TOWERS[id].unlockWave + 1}</em>` : ''}` +
      `<span>${describeStation(id)}</span></span></li>`,
  ).join('');

  const contacts = ENEMY_IDS.map(
    (id) =>
      `<li><span class="lg-ic c-${id}">${contactIcon(id, 30)}</span>` +
      `<span><b>${ENEMIES[id].name}</b><span>${describeContact(ENEMIES[id])}</span></span></li>`,
  ).join('');

  return (
    `<h2>How to play</h2>` +
    `<p class="lg-lede">Contacts walk the road toward your core. Build stations beside it and ` +
    `stop them. A contact that reaches the core costs a life.</p>` +
    `<h3>Stations</h3><ul class="lg-list">${stations}</ul>` +
    `<h3>Contacts</h3><ul class="lg-list">${contacts}</ul>`
  );
}

export const LEGEND_STYLE = `
#home-screen .lg-lede{max-width:44em;font-size:13px;color:#9397ab;margin:0 0 4px}
#home-screen .lg-list{list-style:none;margin:0 0 6px;padding:0;display:grid;
  grid-template-columns:1fr 1fr;gap:8px 18px}
#home-screen .lg-list li{display:flex;align-items:center;gap:11px}
#home-screen .lg-ic{display:grid;place-items:center;width:38px;height:38px;flex:none}
#home-screen .lg-list b{display:block;font:600 12.5px/1.3 Inter,sans-serif;color:#e9e9ed}
#home-screen .lg-list em{font-style:normal;font-size:10px;color:#9184d9;letter-spacing:.08em}
#home-screen .lg-list span span{font-size:11.5px;color:#75798c;line-height:1.45}
`;
