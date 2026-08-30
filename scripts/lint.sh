#!/bin/zsh
# Lint on the Node version this project requires. See scripts/use-node.sh.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

# exec the JS entrypoint directly, bypassing the `#!/usr/bin/env node` shebang
# that would otherwise re-resolve to the system Node 16. On that version the
# failure is a misleading "structuredClone is not defined" while parsing the
# rule config, which points nowhere near the actual cause.
exec node node_modules/eslint/bin/eslint.js "$@"
