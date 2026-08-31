#!/bin/zsh
# The one-command match night: build the client, then serve dist/ and /ws from
# a single process on one port, bound 0.0.0.0 so Tailscale peers can reach it.
# Both players open http://<tailscale-ip>:8787/?race — nothing else to run.
# Keep the host awake: `caffeinate -i npm run play`.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

# See scripts/server.sh for why .env is loaded here rather than left to Node.
# The build below reads the VITE_ half of the same file on its own, which is
# why the id has to be in place *before* this runs, not after.
envflag=()
[[ -f .env ]] && envflag=(--env-file=.env)

zsh scripts/build.sh
exec node "${envflag[@]}" --experimental-strip-types --disable-warning=ExperimentalWarning server/index.ts "$@"
