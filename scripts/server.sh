#!/bin/zsh
# Run the Race-mode relay server. See scripts/use-node.sh for the Node dance.
set -e
cd "${0:A:h}/.."
. scripts/use-node.sh

# Load .env if there is one, so DISCORD_CLIENT_SECRET actually reaches the
# token route. Node does not read .env by itself, and Vite's loading of it
# covers only the VITE_ half, at build time — without this line, filling in
# .env looks like it worked and the handshake fails with an unexplained 503.
#
# Tested rather than passed unconditionally: --env-file-if-exists prints a
# notice for a missing file, and a Tailscale host who never touches Discord
# should not be told about a file they were right not to create.
envflag=()
[[ -f .env ]] && envflag=(--env-file=.env)

# Same deal as check.sh: the server is plain TypeScript with no bundler, so
# Node's type stripping runs it directly.
exec node "${envflag[@]}" --experimental-strip-types --disable-warning=ExperimentalWarning server/index.ts "$@"
