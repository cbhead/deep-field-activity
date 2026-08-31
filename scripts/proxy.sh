#!/bin/zsh
# Assert the relay serves the app the way Discord's proxy will ask for it.
# See scripts/use-node.sh for the Node dance.
#
# Self-contained: it starts its own copy of the relay on its own port. Run
# `npm run build` first, since the server serves dist/.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

exec node --experimental-strip-types --disable-warning=ExperimentalWarning tools/proxy.ts "$@"
