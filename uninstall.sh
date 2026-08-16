#!/usr/bin/env bash
#
# Remove MegaTeach from pi and Claude Code. Leaves .teach/ and PHILOSOPHY.md
# alone — those are the learner's data, not the tool.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_HOME="${PI_HOME:-$HOME/.pi/agent}"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"

if command -v pi >/dev/null 2>&1; then
  pi remove "$REPO" 2>/dev/null || true
fi

for link in \
  "$PI_HOME/skills/teach" \
  "$PI_HOME/extensions/quiz" \
  "$PI_HOME/extensions/md-log" \
  "$PI_HOME/extensions/tutor" \
  "$PI_HOME/extensions/sources" \
  "$PI_HOME/extensions/shared" \
  "$CLAUDE_HOME/skills/teach"
do
  if [ -L "$link" ]; then
    rm -f "$link"
    echo "removed $link"
  fi
done

for agent in "$REPO"/agents/*.md; do
  link="$CLAUDE_HOME/agents/$(basename "$agent")"
  if [ -L "$link" ]; then
    rm -f "$link"
    echo "removed $link"
  fi
done

echo "Done. Your probe log in .teach/ and your PHILOSOPHY.md were not touched."
