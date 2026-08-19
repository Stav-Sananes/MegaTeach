#!/usr/bin/env bash
#
# The ten-question checkpoint: what level is the learner working at, and should
# the next question be harder?
#
# Thin wrapper over bin/teach-level.ts, resolved the same way sources.sh resolves
# its CLI — the skill directory is normally a symlink into the repo, so the repo
# root has to come from this script's own resolved location.
#
# Usage:
#   level.sh [--dir <project>] [--window 10] [--json]

set -euo pipefail

script="${BASH_SOURCE[0]}"
while [ -L "$script" ]; do
  target="$(readlink "$script")"
  case "$target" in
    /*) script="$target" ;;
    *)  script="$(cd -P "$(dirname "$script")" && pwd -P)/$target" ;;
  esac
done

scripts_dir="$(cd -P "$(dirname "$script")" && pwd -P)"
repo="$(cd "$scripts_dir/../../.." && pwd)"
cli="$repo/bin/teach-level.ts"

if [ ! -f "$cli" ]; then
  echo "teach-level CLI not found at $cli" >&2
  echo "Read .teach/probe-log.jsonl and count the recent questions by depth yourself." >&2
  exit 69
fi

exec node "$cli" "$@"
