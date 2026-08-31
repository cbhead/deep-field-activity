/**
 * The lobby's "Send to Discord" invite button, and nothing else.
 *
 * A channel webhook is the one Discord door a plain-http page has: no OAuth, no
 * SDK, and the POST is https so there is no mixed-content problem. That is
 * still true for *inviting* someone to a tailnet race, which is the only job
 * left here.
 *
 * Match reports used to go out through this same webhook, from whichever
 * browser had one pasted in. They now leave from the relay — see
 * `net/report.ts` for why, and `server/index.ts` for where. Inside a Discord
 * Activity this whole module is unreachable anyway: the invite button does not
 * exist there, because there is no link to send.
 */

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
