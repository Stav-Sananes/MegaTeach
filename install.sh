#!/usr/bin/env bash
#
# Install MegaTeach into pi, Claude Code, or both.
#
#   ./install.sh              # pi (default)
#   ./install.sh --claude     # Claude Code
#   ./install.sh --all        # both
#
# For pi this prefers `pi install <path>`, which registers the package in
# settings.json and picks up extensions, skills, and future additions from the
# manifest. If the pi CLI is not on PATH it falls back to symlinks.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_HOME="${PI_HOME:-$HOME/.pi/agent}"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"

target="pi"
case "${1:-}" in
  --claude) target="claude" ;;
  --all)    target="all" ;;
  --pi|"")  target="pi" ;;
  -h|--help)
    sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "unknown option: $1 (try --pi, --claude, --all)" >&2
    exit 64
    ;;
esac

install_pi() {
  if command -v pi >/dev/null 2>&1; then
    echo "Registering $REPO with pi…"
    pi install "$REPO"
    echo
    echo "Installed. Start pi, then:"
    echo "  /link ~/vault/learn/topic.md"
    echo "  /teach <topic>"
    return
  fi

  echo "pi not found on PATH — falling back to symlinks in $PI_HOME."
  mkdir -p "$PI_HOME/skills" "$PI_HOME/extensions"
  ln -sfn "$REPO/skills/teach"          "$PI_HOME/skills/teach"
  ln -sfn "$REPO/extensions/quiz"       "$PI_HOME/extensions/quiz"
  ln -sfn "$REPO/extensions/md-log"     "$PI_HOME/extensions/md-log"
  ln -sfn "$REPO/extensions/tutor"      "$PI_HOME/extensions/tutor"
  # The extensions import shared modules by relative path; symlink it too so the
  # tree resolves the same way it does in the repo.
  ln -sfn "$REPO/extensions/shared"     "$PI_HOME/extensions/shared"
  echo "Linked into $PI_HOME. Start pi and run /reload."
}

install_claude() {
  echo "Linking the teach skill and agents into $CLAUDE_HOME…"
  mkdir -p "$CLAUDE_HOME/skills" "$CLAUDE_HOME/agents"
  ln -sfn "$REPO/skills/teach" "$CLAUDE_HOME/skills/teach"
  for agent in "$REPO"/agents/*.md; do
    ln -sfn "$agent" "$CLAUDE_HOME/agents/$(basename "$agent")"
  done
  echo
  echo "Installed. In Claude Code:"
  echo "  /teach   (or just: teach me <topic>)"
  echo
  echo "Claude Code has no quiz tool, so the skill uses AskUserQuestion and logs"
  echo "each answer with skills/teach/scripts/log-answer.sh. Same log, same map."
}

case "$target" in
  pi)     install_pi ;;
  claude) install_claude ;;
  all)    install_pi; echo; install_claude ;;
esac

echo
if [ ! -f "$PWD/PHILOSOPHY.md" ]; then
  echo "You have no PHILOSOPHY.md here. Write one before your first session:"
  echo "  cp \"$REPO/PHILOSOPHY.example.md\" ./PHILOSOPHY.md && \$EDITOR ./PHILOSOPHY.md"
  echo "Until you do, you get this repo's default teaching style, which is not yours."
fi
