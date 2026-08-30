#!/bin/zsh
# Run the Race-mode relay server. See scripts/use-node.sh for the Node dance.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

# Same deal as check.sh: the server is plain TypeScript with no bundler, so
# Node's type stripping runs it directly.
exec node --experimental-strip-types --disable-warning=ExperimentalWarning server/index.ts "$@"
