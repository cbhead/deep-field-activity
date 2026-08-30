#!/bin/zsh
# Typecheck on the Node version this project requires. See scripts/use-node.sh.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

# tsc happens to still run on the system Node 16, so this is latent rather than
# broken today — but it is one TypeScript release away from failing the same way
# eslint and vite already do. exec the JS entrypoint directly, bypassing the
# `#!/usr/bin/env node` shebang.
exec node node_modules/typescript/lib/tsc.js --noEmit "$@"
