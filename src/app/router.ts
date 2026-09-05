/**
 * Where you are, as a value rather than as a side effect of the address bar.
 *
 * The game used to navigate by assigning `location.search`, which is a full
 * page load: the world, the renderer and every listener died with the document
 * and were rebuilt from scratch. That was a legitimate design — it is impossible
 * to leak a stale reference across a reload — and it is exactly what a Discord
 * Activity cannot do. Inside the iframe the launch parameters (`frame_id`,
 * `instance_id`, …) are handed to the app once, and every reload costs a fresh
 * SDK handshake. See docs/DISCORD-ACTIVITY.md §4.
 *
 * So navigation becomes: parse a Route out of the query, swap the mounted scene
 * in place, and push the new query with `history.pushState`.
 *
 * **Foreign query parameters are preserved.** `toSearch` deletes only the keys
 * this module owns and writes the rest back untouched. That is the single most
 * important line in the file for the port — Discord's parameters must survive
 * every navigation the game makes — and it is why routes are serialised through
 * here rather than by building a query string at the call site.
 *
 * Back and forward now work, which they never did before: `popstate` re-enters
 * the parsed route without pushing history.
 */
import { CAMPAIGN, levelById } from '../content/levels.ts';
import { DIFFICULTIES, DEFAULT_DIFFICULTY, type DifficultyId } from '../content/difficulty.ts';
import type { MatchMode } from '../net/protocol.ts';

export type Route =
  /** The front door. */
  | { readonly k: 'home' }
  /** The campaign picker. */
  | { readonly k: 'sectors' }
  /**
   * One run. `seed` is the raw URL text, not a resolved number: absent means
   * "roll a fresh board on every mount", which is what makes remount-as-restart
   * behave the way a reload used to.
   */
  | {
      readonly k: 'run';
      readonly level: string;
      readonly difficulty: DifficultyId;
      readonly seed: string | null;
      readonly bank: number | null;
    }
  /**
   * The lobby, and the match it becomes. A room code deep-links into one.
   *
   * `mode` rides on this route rather than getting a route of its own, because
   * `?versus` is `?race` with the mode flipped and shares every line of the
   * screen behind it — the lobby, room codes, the invite link, resume and
   * forfeit are one problem, solved once.
   *
   * It has to be part of the *address*: the invite link is what carries the mode
   * to the other player, and a versus host handing out a `?race=` link drops
   * their friend into the right room playing the wrong game.
   */
  | { readonly k: 'race'; readonly room: string | null; readonly mode: MatchMode };

/** Keys this module owns. Everything else in the query belongs to somebody else. */
const OWNED = ['race', 'versus', 'level', 'difficulty', 'seed', 'bank', 'sectors'] as const;

/**
 * Three entries, and the order matters — unchanged from the URL contract this
 * replaces. `?level=` plays a named campaign level; `?seed=` alone still means
 * "level 1 on this seed", which is what the plan documented and what the
 * fairness gate and every bug report already use. Anything else is the menu.
 */
export function parseRoute(search: string): Route {
  const p = new URLSearchParams(search);

  // Versus is checked first so that a URL carrying both is unambiguous rather
  // than order-of-parameters dependent. `?versus` wins because it is the more
  // specific request — nobody types both by accident, but a rewritten link can.
  const versus = p.get('versus');
  if (versus !== null) return { k: 'race', room: versus === '' ? null : versus, mode: 'versus' };

  const race = p.get('race');
  if (race !== null) return { k: 'race', room: race === '' ? null : race, mode: 'race' };

  const named = p.get('level');
  const level = named !== null ? levelById(named) : p.has('seed') ? CAMPAIGN[0] : undefined;
  if (level === undefined) return p.has('sectors') ? { k: 'sectors' } : { k: 'home' };

  const rawDiff = p.get('difficulty');
  const difficulty: DifficultyId =
    rawDiff !== null && Object.hasOwn(DIFFICULTIES, rawDiff) ? (rawDiff as DifficultyId) : DEFAULT_DIFFICULTY;

  // Absent must be `null`, not 0. `Number(null)` is 0 and 0 passes the `>= 0`
  // test, so the obvious parse resolves an *absent* `bank` to a carried bank of
  // nothing — and `resolveRules` floors a supplied bank at BANK_FLOOR (0.6) of
  // the tier's starting money, so every run launched without `?bank` opened on
  // 150 instead of 250 on Standard. An empty `?bank=` is absent too, for the
  // same reason: `Number('')` is also 0.
  //
  // This used to be preserved here on purpose. A navigation refactor was the
  // wrong commit to silently move every opening board in, so the note said to
  // fix it deliberately upstream and re-sweep. That has happened — deep-field-td
  // restored the tier's opening money and swept the floor separately — and the
  // reason to hold is therefore gone. The Activity and the web build have to
  // open on the same number or they are not the same game.
  const rawBank = p.get('bank');
  const carried = rawBank === null || rawBank === '' ? Number.NaN : Number(rawBank);
  const bank = Number.isFinite(carried) && carried >= 0 ? Math.floor(carried) : null;

  return { k: 'run', level: level.id, difficulty, seed: p.get('seed'), bank };
}

/**
 * A Route back into a query string, keeping any parameter this module does not
 * own. `current` is the query being replaced — normally `location.search`.
 */
export function toSearch(route: Route, current: string): string {
  const p = new URLSearchParams(current);
  for (const k of OWNED) p.delete(k);

  switch (route.k) {
    case 'home':
      break;
    case 'sectors':
      p.set('sectors', '');
      break;
    case 'race':
      p.set(route.mode === 'versus' ? 'versus' : 'race', route.room ?? '');
      break;
    case 'run':
      p.set('level', route.level);
      p.set('difficulty', route.difficulty);
      if (route.seed !== null) p.set('seed', route.seed);
      if (route.bank !== null) p.set('bank', String(route.bank));
      break;
  }

  const q = p.toString();
  return q === '' ? '' : `?${q}`;
}

export interface Router {
  /** The route currently mounted. */
  readonly route: Route;
  /** Navigate, pushing history. */
  go(route: Route): void;
  /**
   * Re-enter the current route from scratch, without touching history.
   *
   * This is what `restart` means now. It is deliberately not `go(route)`: a run
   * with no pinned `?seed=` resolves a fresh board on every mount, so
   * re-entering the same route is a new game — which is precisely what
   * `location.reload()` used to buy, and why the restart button never needed a
   * seed of its own.
   */
  remount(): void;
  /** Enter the initial route. Separate from creation so the caller's scene
   *  factory can reference the router it is about to be handed. */
  start(): void;
  dispose(): void;
}

export function createRouter(onRoute: (route: Route) => void): Router {
  let route = parseRoute(location.search);

  const onPop = (): void => {
    route = parseRoute(location.search);
    onRoute(route);
  };
  window.addEventListener('popstate', onPop);

  return {
    get route(): Route {
      return route;
    },
    go(next: Route): void {
      const search = toSearch(next, location.search);
      history.pushState(null, '', `${location.pathname}${search}${location.hash}`);
      route = next;
      onRoute(next);
    },
    remount(): void {
      onRoute(route);
    },
    start(): void {
      onRoute(route);
    },
    dispose(): void {
      window.removeEventListener('popstate', onPop);
    },
  };
}
