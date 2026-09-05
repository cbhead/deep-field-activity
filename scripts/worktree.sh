#!/bin/zsh
# Make an isolated checkout for a parallel agent session.
#
# Why this exists: two sessions in one working tree share an index, a HEAD and a
# set of files, and they will quietly wreck each other. It is not hypothetical —
# in one afternoon a second session committed onto a branch it did not know it
# was on, switched the branch out from under the first mid-task, and pushed a
# commit the first was still writing the message for. Nothing was lost, but only
# because the two happened to be editing disjoint files.
#
# A worktree fixes the whole class: same repository, same history, same remote,
# but an independent index and checkout. Branch in one, and nothing moves in the
# other.
#
#   zsh scripts/worktree.sh audio           # new branch `audio`
#   zsh scripts/worktree.sh fix origin/main # new branch off a specific base
#   zsh scripts/worktree.sh versus          # reuse the existing `versus` branch
#
# Lands in .claude/worktrees/<name>, which is where the agent harness already
# puts the ones it makes — one convention rather than two. Git auto-ignores
# registered worktree paths, so they never show up in `git status`.
set -e
cd "${0:A:h}/.."

name="$1"
base="${2:-HEAD}"

if [ -z "$name" ]; then
  echo "usage: zsh scripts/worktree.sh <name> [base-ref]" >&2
  echo "       creates .claude/worktrees/<name> on branch <name>" >&2
  exit 1
fi

# Reject anything that would escape the worktrees directory or confuse git.
case "$name" in
  */*|.*|*' '*)
    echo "error: <name> must be a plain identifier, got '$name'." >&2
    exit 1
    ;;
esac

root="$(pwd)"
dir=".claude/worktrees/$name"

if [ -e "$dir" ]; then
  echo "error: $dir already exists." >&2
  echo "       Use it as-is, or remove it with: git worktree remove $dir" >&2
  exit 1
fi

# Reuse the branch if it already exists; only create it when it does not. Doing
# this the other way round makes the script unusable for resuming work, which is
# most of what it is for.
if git show-ref --verify --quiet "refs/heads/$name"; then
  echo "Reusing existing branch '$name'."
  git worktree add "$dir" "$name"
else
  echo "Creating branch '$name' from ${base}."
  git worktree add -b "$name" "$dir" "$base"
fi

# node_modules is ~170M and identical across worktrees the overwhelming majority
# of the time, so it is shared by symlink rather than reinstalled. This is also
# the *safer* default here: one known-good install, rather than a fresh `npm
# install` per worktree that can re-trip the rolldown native-dependency trap
# documented in the README when the system npm is stale.
#
# The exception is a branch that changes dependencies, which is detected below.
if [ -d "$root/node_modules" ]; then
  ln -s "$root/node_modules" "$dir/node_modules"
  echo "Linked node_modules -> $root/node_modules"
else
  echo "note: no node_modules in the main tree; run 'npm ci' in $dir." >&2
fi

echo

# A shared node_modules is wrong the moment the branch's dependencies differ.
# Say so at creation time rather than letting it surface as a confusing runtime
# failure three commands later.
if ! git diff --quiet "$base" -- package.json package-lock.json 2>/dev/null; then
  echo "WARNING: this branch's package.json/package-lock.json differ from $base."
  echo "         The shared node_modules is wrong for it. Replace the symlink:"
  echo "           rm $dir/node_modules && (cd $dir && npm ci)"
  echo
fi

cat <<EOF
Worktree ready:

  cd $root/$dir

Point the other session at it, and give each one its own dev port:

  PORT=5174 npm run dev

Note PORT only moves the dev server. Race mode's client dials a hardcoded
default, so a non-default port breaks joining — see the runbook's troubleshooting
table. Use the default port for the session that is hosting a race.

When the branch is merged and you are done:

  git worktree remove $dir
  git branch -d $name
EOF
