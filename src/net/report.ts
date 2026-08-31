/**
 * The match report, and the time format it shares with the results card.
 *
 * Here rather than in `ui/` because the *server* composes and sends this now.
 * It used to be posted by whichever browser had a webhook pasted into it, which
 * carried a caveat — "configure this on one machine only, or results arrive
 * twice" — and a hard limit: inside a Discord Activity the page cannot reach
 * `discord.com/api/webhooks` at all, because the iframe's CSP does not allow it.
 * The relay has no such restriction, already knows the result (it decides it),
 * and is a single place, so exactly one report goes out without anyone being
 * told to configure only one machine.
 *
 * Kept DOM-free on purpose: `src/ui/` is unimportable from Node, and this is
 * the piece both ends need.
 */
import type { Standing } from './protocol.ts';
import { formatSeed } from '../sim/util/rng.ts';

export const fmtTime = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * One match, one message. The seed is included because it's the reproduction
 * handle — "rematch that exact board" is `?seed=` away in single player.
 *
 * No series tally. The running "who leads the rivalry" line is each client's
 * own reckoning, held in that browser's localStorage, so the two players do not
 * necessarily agree on it — publishing one of them as though it were the score
 * was always a little dishonest, and the server has no version of its own. It
 * still appears on the results card, where it is plainly *your* record.
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
