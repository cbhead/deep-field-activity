#!/bin/zsh
# Serve the Activity on a public HTTPS origin via Tailscale Funnel, so Discord's
# proxy has somewhere real to forward to. See scripts/use-node.sh for the Node
# dance.
#
# Builds and starts the relay itself — this is `npm run play` plus a public
# name. Ctrl-C stops both.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

exec node --experimental-strip-types --disable-warning=ExperimentalWarning tools/tunnel.ts "$@"
