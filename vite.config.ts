import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Bind all interfaces so a friend can reach the dev server over Tailscale.
    // Phase 2 relies on this; harmless now.
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
});
