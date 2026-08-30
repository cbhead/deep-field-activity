/**
 * The one Discord door a plain-http page has: a channel webhook the user
 * pastes in once. Shared by the lobby's invite button and the post-match
 * report, so both land in the same channel — the channel history becomes the
 * match ledger. The URL stays in localStorage, this browser only; configure
 * it on ONE machine, because every browser with a webhook posts results.
 */
import type { Standing } from '../net/protocol.ts';
import { formatSeed } from '../sim/util/rng.ts';
import { fmtTime } from './resultsScreen.ts';

const KEY = 'discord-webhook';
export const WEBHOOK_PREFIX = 'https://discord.com/api/webhooks/';

export const getWebhook = (): string | null => localStorage.getItem(KEY);

/** False means the URL doesn't look like a Discord webhook; nothing saved. */
export function saveWebhook(url: string): boolean {
  if (!url.startsWith(WEBHOOK_PREFIX)) return false;
  localStorage.setItem(KEY, url);
  return true;
}

/** Resolves true when Discord accepted the message. Never throws. */
export function postToDiscord(content: string): Promise<boolean> {
  const hook = getWebhook();
  if (hook === null) return Promise.resolve(false);
  return fetch(hook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  }).then(
    (r) => r.ok,
    () => false,
  );
}

/**
 * One match, one message. The seed is included because it's the reproduction
 * handle — "rematch that exact board" is `?seed=` away in single player.
 */
export function matchReport(
  sector: string,
  room: string,
  seed: number,
  winnerId: string | null,
  standings: Standing[],
  forfeit: boolean,
): string {
  const winner = winnerId !== null ? standings.find((s) => s.playerId === winnerId) : undefined;
  const loser = standings.find((s) => s.playerId !== winner?.playerId);
  const headline = winner === undefined
    ? `Dead heat between ${standings.map((s) => s.name).join(' and ')}`
    : forfeit
      ? `${winner.name} wins by forfeit over ${loser?.name ?? 'their opponent'}`
      : `${winner.name} defeats ${loser?.name ?? 'their opponent'}`;
  const lines = standings.map(
    (s) => `${s.name} — wave ${s.wave} · ${s.lives} lives · ${fmtTime(s.elapsedMs)}`,
  );
  return `🏁 **${headline}**\n${sector} · room ${room} · seed 0x${formatSeed(seed)}\n${lines.join('\n')}`;
}
