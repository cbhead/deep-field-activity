#!/bin/zsh
# Start Vite on the Node version this project requires. See scripts/use-node.sh.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

# exec the JS entrypoint directly, bypassing the `#!/usr/bin/env node` shebang
# that would otherwise re-resolve to the system Node 16.
exec node node_modules/vite/bin/vite.js "$@"
