#!/bin/zsh
# The one-command match night: build the client, then serve dist/ and /ws from
# a single process on one port, bound 0.0.0.0 so Tailscale peers can reach it.
# Both players open http://<tailscale-ip>:8787/?race — nothing else to run.
# Keep the host awake: `caffeinate -i npm run play`.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

zsh scripts/build.sh
exec node --experimental-strip-types --disable-warning=ExperimentalWarning server/index.ts "$@"
