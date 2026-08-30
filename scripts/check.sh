#!/bin/zsh
# Run the simulation gates headlessly. See scripts/use-node.sh for the Node dance.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

# No bundler: the sim is plain TypeScript with no DOM or renderer dependency, so
# Node's own type stripping runs it directly. That the gates can run at all is
# itself a check on the sim/render boundary.
exec node --experimental-strip-types --disable-warning=ExperimentalWarning tools/check.ts "$@"
