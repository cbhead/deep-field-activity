#!/bin/zsh
# Re-take the README captures. Needs `npm run dev` already serving.
# See tools/shots.ts for why this is scripted rather than done by hand.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

exec node --experimental-strip-types --disable-warning=ExperimentalWarning tools/shots.ts "$@"
