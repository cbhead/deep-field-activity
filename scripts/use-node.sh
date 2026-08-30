# Resolve the Node version this project requires. SOURCE this, don't exec it.
#
# Why this exists: the machine's default `node` is an old 16.x at
# /usr/local/bin/node, which Vite 8 cannot run on. Two things conspire to make
# that hard to escape from a spawned process:
#
#   1. npm exports npm_config_prefix=/usr/local, and nvm hard-refuses to load
#      while that is set — so merely being in a login shell is not enough.
#   2. Every JS bin's shebang is `#!/usr/bin/env node`, which re-resolves to
#      Node 16 off PATH even after nvm has loaded. Callers must therefore exec
#      `node <entrypoint.js>` directly rather than the bin.
#
# The symptom is a misleading "does not provide an export named 'styleText'"
# from rolldown, which points nowhere near the actual cause.
#
# Delete this script once the system Node at /usr/local/bin is upgraded.

# Since we are usually invoked *from* npm, clearing these is what actually
# makes nvm usable here. See note 1 above.
unset npm_config_prefix npm_config_globalconfig npm_config_global_prefix

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  # Reads .nvmrc; falls back to 22 if that fails for any reason.
  nvm use >/dev/null 2>&1 || nvm use 22 >/dev/null 2>&1 || true
fi

if [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 20 ]; then
  echo "error: Node >=20.19 required, found $(node --version 2>/dev/null || echo none)." >&2
  echo "       Run: nvm install 22 && nvm use 22" >&2
  exit 1
fi
