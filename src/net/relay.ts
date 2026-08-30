/**
 * Where the relay is, and whether it is answering.
 *
 * `relayHost()` was an expression inline in `main.ts`, reachable only once the
 * player had already chosen Race. The front door needs the same answer to probe
 * with — and it has to be *the same* answer, because a probe aimed at a
 * different port from the socket is worse than no probe: it would report a
 * healthy relay the game cannot reach, or a dead one it can.
 *
 * That is not hypothetical. Until recently the client derived its socket from
 * the compiled-in `DEFAULT_PORT` while the page was served from somewhere else,
 * so `PORT=` silently broke Race. One derivation, one place.
 */
import { DEFAULT_PORT } from './protocol.ts';

/**
 * Under Vite the page comes from the dev server while the relay listens
 * separately, so the default port has to be named. In the `npm run play` build
 * one process serves both, so the page's own origin *is* the relay — and taking
 * `location.host` rather than the port `/info` reports is what survives a
 * tunnel, where the port the browser reached is not the port the server bound.
 */
export const relayHost = (): string =>
  import.meta.env.DEV ? `${location.hostname}:${DEFAULT_PORT}` : location.host;

export type RelayStatus = 'up' | 'down';

/**
 * Ask the relay whether it is there.
 *
 * **Deliberately not called on load.** A solo player who never races would
 * otherwise meet a red dot every boot, reporting a server they never wanted —
 * which makes an offline single-player launch feel broken. The Race card probes
 * when it is focused or hovered, which is still comfortably before anyone types
 * a name, and that is all the honesty requirement actually asks for.
 *
 * Aborted rather than left hanging: a probe with no timeout can sit pending for
 * the browser's full connect timeout and then report "down" long after the
 * player has moved on, which is a stale claim rather than a slow one.
 *
 * **`no-cors`, and the response is deliberately not read.** Under Vite the page
 * is served from one port and the relay listens on another, so a normal `fetch`
 * of `/info` is cross-origin — the browser blocks it and the probe reports
 * "down" for a relay that is running perfectly well. That false negative is
 * worse than no dot at all, and it is what this did on the first attempt.
 *
 * The alternative was to put `Access-Control-Allow-Origin` on `/info`, and that
 * is the wrong trade: `/info` returns the host's Tailscale address, so opening
 * it to every origin would let any page the player visits read their tailnet IP
 * while the server happens to be up. A reachability probe does not need to read
 * anything.
 *
 * So the signal is *resolution versus rejection*: an opaque response means
 * something answered on that port, and a rejection means nothing did. It cannot
 * prove the responder is our relay — but the question the dot answers is "can a
 * race start right now", and for that this is honest.
 */
export async function probeRelay(timeoutMs = 1500): Promise<RelayStatus> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    await fetch(`${location.protocol}//${relayHost()}/info`, {
      mode: 'no-cors',
      signal: abort.signal,
      cache: 'no-store',
    });
    return 'up';
  } catch {
    // Refused, aborted, offline — all the same answer to the only question
    // being asked.
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}
