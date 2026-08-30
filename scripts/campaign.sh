#!/bin/zsh
# Probe the campaign arc headlessly. See scripts/use-node.sh for the Node dance.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh
exec node --experimental-strip-types --disable-warning=ExperimentalWarning tools/campaign.ts "$@"
