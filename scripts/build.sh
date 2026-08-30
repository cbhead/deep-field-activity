#!/bin/zsh
# Typecheck then bundle, on the Node version this project requires.
# See scripts/use-node.sh.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

# Both entrypoints are exec'd as JS directly, bypassing the
# `#!/usr/bin/env node` shebang that would re-resolve to the system Node 16.
# Vite 8 is the one that fails loudest there: rolldown imports `styleText` from
# node:util, which Node 16 does not export.
node node_modules/typescript/lib/tsc.js --noEmit
exec node node_modules/vite/bin/vite.js build "$@"
