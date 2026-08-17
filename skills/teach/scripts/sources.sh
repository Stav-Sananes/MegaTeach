#!/usr/bin/env bash
#
# Search the learner's own material from a harness with no `source_search` tool.
#
# Thin wrapper over bin/teach-sources.ts. It exists so the skill can name one
# stable path — a sibling of this file — instead of guessing where the repo is.
# The skill directory is normally a symlink into the repo (~/.claude/skills/teach),
# so the repo root has to be found by resolving this script's own location, not by
# walking up from wherever the skill appears to live.
#
# Usage:
#   sources.sh search "<query>" [--limit 5] [--doc <id>] [--json]
#   sources.sh read <chunk-id> [--context 1]
#   sources.sh list | doctor
#   sources.sh add <path>...
#
# Every subcommand accepts --dir <project> when .teach/ is not under $PWD.

set -euo pipefail

# Two different symlinks have to be seen through, and only one of them is the
# script file itself. `install.sh --claude` links the whole skill *directory*
# (~/.claude/skills/teach -> <repo>/skills/teach), so this file is reached through
# a symlinked ancestor and `[ -L "$0" ]` is false. `cd -P` resolves every
# component of the path, which covers that case; the loop above it covers a
# directly-linked file. `readlink -f` would do both but is GNU-only, and this has
# to run on a stock macOS shell.
script="${BASH_SOURCE[0]}"
while [ -L "$script" ]; do
  target="$(readlink "$script")"
  case "$target" in
    /*) script="$target" ;;
    *)  script="$(cd -P "$(dirname "$script")" && pwd -P)/$target" ;;
  esac
done

scripts_dir="$(cd -P "$(dirname "$script")" && pwd -P)"   # <repo>/skills/teach/scripts
repo="$(cd "$scripts_dir/../../.." && pwd)"
cli="$repo/bin/teach-sources.ts"

if [ ! -f "$cli" ]; then
  echo "teach-sources CLI not found at $cli" >&2
  echo "Fall back to grepping .teach/sources/*.txt and cite the document without a page number." >&2
  exit 69
fi

exec node "$cli" "$@"
