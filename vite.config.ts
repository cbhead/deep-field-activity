import { defineConfig, loadEnv } from 'vite';

// Declared locally rather than adding @types/node, which would make Node globals
// (Buffer, setImmediate, process) type-check inside src/sim — the eslint boundary
// bans `process` there, but the rest would slip through. Not worth it for one var.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig(({ mode }) => {
  /**
   * Say so, loudly, when this build cannot be a Discord Activity.
   *
   * `import.meta.env.VITE_DISCORD_CLIENT_ID` is substituted at build time, so
   * with no id set `CLIENT_ID` folds to `''`, the guard in
   * src/discord/activity.ts becomes statically true, and everything after it —
   * including the dynamic `import('@discord/embedded-app-sdk')` — is eliminated
   * as dead code. The build still succeeds. The bundle is simply, silently,
   * incapable of the handshake, and you would find that out inside Discord.
   *
   * That elimination is correct and worth having; it is only dangerous when it
   * is quiet. So: one line of warning here, and the SDK chunk appearing in the
   * output is the positive signal that the id was seen.
   */
  // Blank counts as missing. `cp .env.example .env` leaves the keys present and
  // empty, which is the most likely state for anyone part-way through setup —
  // and an `=== undefined` test sails straight past it, warning about nothing
  // while producing exactly the crippled bundle the warning exists to prevent.
  if ((loadEnv(mode, '.', 'VITE_')['VITE_DISCORD_CLIENT_ID'] ?? '') === '') {
    console.warn(
      '\n  ⚠ building without VITE_DISCORD_CLIENT_ID — this bundle will run as a\n' +
        '    normal web page but cannot complete the Discord Activity handshake.\n' +
        '    Set it in .env at the repo root (see .env.example) if that is not\n' +
        '    what you meant.\n',
    );
  }

  return {
    server: {
      // Bind all interfaces so a friend can reach the dev server over Tailscale.
      // Phase 2 relies on this; harmless now.
      host: true,
      // Honour a harness-assigned PORT so this can run alongside another chat's
      // dev server; 5173 stays the default for a plain `npm run dev`.
      port: Number(process.env.PORT) || 5173,
    },
    // Relative asset URLs, so one build works wherever it is mounted.
    //
    // Inside a Discord Activity the document is served through the proxy at
    // `<app_id>.discordsays.com`, and same-origin subresources may be addressed
    // with or without a `/.proxy` prefix. Absolute `/assets/…` bakes in an
    // assumption about which; `./assets/…` resolves against whatever the
    // document turned out to be, and is equally right on localhost, on a
    // tailnet IP, and behind the proxy. `base: '/.proxy/'` would also have
    // worked in Discord — and would have broken every other deployment of the
    // same build.
    base: './',
    build: {
      target: 'es2022',
    },
  };
});
