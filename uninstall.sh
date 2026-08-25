#!/usr/bin/env bash
#
# Remove MegaTeach from pi and Claude Code. Leaves .teach/ and PHILOSOPHY.md
# alone — those are the learner's data, not the tool.
#
#   ./uninstall.sh                    # the default install
#   ./uninstall.sh --as megateach     # one installed under another name

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_HOME="${PI_HOME:-$HOME/.pi/agent}"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"

skill_name="teach"
if [ "${1:-}" = "--as" ]; then
  [ "$#" -ge 2 ] || { echo "--as needs a name" >&2; exit 64; }
  skill_name="$2"
fi

# A renamed install is a real directory holding a generated SKILL.md and two
# symlinks, so the link loop below cannot remove it. Only remove one that looks
# like ours: a SKILL.md naming this skill, beside links pointing into this repo.
if [ "$skill_name" != "teach" ]; then
  dest="$CLAUDE_HOME/skills/$skill_name"
  if [ -f "$dest/SKILL.md" ] && [ "$(readlink "$dest/scripts" 2>/dev/null)" = "$REPO/skills/teach/scripts" ]; then
    rm -rf "$dest"
    echo "removed $dest"
  elif [ -e "$dest" ]; then
    echo "left $dest alone — it is not a MegaTeach install" >&2
  fi
fi

if command -v pi >/dev/null 2>&1; then
  pi remove "$REPO" 2>/dev/null || true
fi

for link in \
  "$PI_HOME/skills/teach" \
  "$PI_HOME/skills/visualize" \
  "$PI_HOME/extensions/quiz" \
  "$PI_HOME/extensions/md-log" \
  "$PI_HOME/extensions/tutor" \
  "$PI_HOME/extensions/sources" \
  "$PI_HOME/extensions/shared" \
  "$CLAUDE_HOME/skills/teach" \
  "$CLAUDE_HOME/skills/visualize"
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
