/**
 * The Discord handshake: are we inside an Activity, and if so, who is playing?
 *
 * An Activity is this same web app, loaded in an iframe inside a voice channel
 * and reached through Discord's proxy. Discord hands it a set of launch
 * parameters — `frame_id`, `instance_id`, `platform` — and the Embedded App SDK
 * refuses to construct without them, so the presence of `frame_id` is both the
 * detection mechanism and the SDK's own precondition.
 *
 * The whole module is written to answer `null` cheerfully. Deep Field is a
 * working game on a plain URL over Tailscale and must stay one: this repo's
 * upstream is that game, matches are hosted that way today, and a hard
 * dependency on Discord would make every non-Discord path a special case
 * instead of the default.
 *
 * ## The flow
 *
 *   ready()  →  authorize()  →  POST /api/token  →  authenticate()
 *
 * `authorize` returns a one-time code rather than a token, because turning a
 * code into a token needs the client secret and a browser cannot hold one. The
 * server route does that half; see `handleToken` in server/index.ts.
 *
 * ## What this deliberately does not do yet
 *
 * It reads `instanceId` and hands it back, but nothing consumes it. Making the
 * voice channel's instance *be* the race room — deleting room codes, invite
 * links and the name prompt in one go — is gap #5 in docs/DISCORD-ACTIVITY.md
 * and a separate piece of work. This establishes identity; it does not yet
 * spend it.
 */

/** Who Discord says is playing, and which instance they are playing in. */
export interface ActivitySession {
  readonly userId: string;
  /** Global display name where set, falling back to the username. */
  readonly displayName: string;
  /**
   * The shared id for everyone who launched this Activity together — the
   * natural race room, once gap #5 is built.
   */
  readonly instanceId: string;
  readonly channelId: string | null;
  readonly guildId: string | null;
}

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID ?? '';

/**
 * Cheap, synchronous, and safe to call before anything is loaded.
 *
 * `frame_id` is injected by Discord when it opens the iframe. The SDK's
 * constructor throws `frame_id query param is not defined` without it, so this
 * is the guard that keeps that throw from being the app's first act on an
 * ordinary page.
 */
export const inActivity = (): boolean => new URLSearchParams(location.search).has('frame_id');

/**
 * Resolve the session, or `null` when this is not an Activity.
 *
 * Throws only when we *are* inside Discord and the handshake genuinely failed —
 * a missing client id, a server with no secret, a rejected code. The caller
 * decides how loud that is; see main.ts, which logs and plays on, because a
 * failed handshake costs the player a name, not a game.
 */
export async function connectActivity(): Promise<ActivitySession | null> {
  if (!inActivity()) return null;

  if (CLIENT_ID === '') {
    throw new Error(
      'running inside Discord but VITE_DISCORD_CLIENT_ID is unset — see docs/DISCORD-ACTIVITY.md',
    );
  }

  // Imported here rather than at the top so the SDK is a separate chunk that a
  // plain browser never downloads. It is ~40kB of code that only means anything
  // inside an iframe Discord opened.
  const { DiscordSDK } = await import('@discord/embedded-app-sdk');

  const sdk = new DiscordSDK(CLIENT_ID);
  await sdk.ready();

  // `identify` only. It is everything the game needs — a name to show on the
  // race strip — and every extra scope is another consent prompt and another
  // thing to justify. `guilds`/`applications.commands` appear in Discord's
  // sample and are not needed here.
  const { code } = await sdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });

  // No `/.proxy` prefix: it has been optional since Discord's 2025-07-30
  // change, and the relay accepts either form anyway (see stripProxy in
  // server/index.ts). If a client ever refuses the bare path again, prefixing
  // this one string and the socket path is the whole fix.
  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText;
    throw new Error(`token exchange failed (${res.status}): ${detail}`);
  }
  const { access_token } = (await res.json()) as { access_token: string };

  const auth = await sdk.commands.authenticate({ access_token });

  return {
    userId: auth.user.id,
    displayName: auth.user.global_name ?? auth.user.username,
    instanceId: sdk.instanceId,
    channelId: sdk.channelId,
    guildId: sdk.guildId,
  };
}
