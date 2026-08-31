#!/bin/zsh
# Assert that a run releases the page when disposed. See scripts/use-node.sh for
# the Node dance.
#
# Unlike check.sh this one is not self-contained: it drives a real Chrome
# against a real dev server, because the thing under test is the browser's
# listener table and no page API exposes it. Start `npm run dev` first, or point
# TEARDOWN_BASE at something already serving the build.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

exec node --experimental-strip-types --disable-warning=ExperimentalWarning tools/teardown.ts "$@"
