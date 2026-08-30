import { defineConfig } from 'vite';

// Declared locally rather than adding @types/node, which would make Node globals
// (Buffer, setImmediate, process) type-check inside src/sim — the eslint boundary
// bans `process` there, but the rest would slip through. Not worth it for one var.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  server: {
    // Bind all interfaces so a friend can reach the dev server over Tailscale.
    // Phase 2 relies on this; harmless now.
    host: true,
    // Honour a harness-assigned PORT so this can run alongside another chat's
    // dev server; 5173 stays the default for a plain `npm run dev`.
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    target: 'es2022',
  },
});
