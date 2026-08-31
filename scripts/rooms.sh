#!/bin/zsh
# Assert that two clients launching the same Discord Activity land in the same
# race. See scripts/use-node.sh for the Node dance.
#
# Self-contained: it starts its own relay on its own port and drives it with a
# pair of real socket clients. No browser and no build required — this is the
# protocol, not the page.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

exec node --experimental-strip-types --disable-warning=ExperimentalWarning tools/rooms.ts "$@"
