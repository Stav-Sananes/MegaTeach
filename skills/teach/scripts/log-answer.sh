#!/usr/bin/env bash
#
# Append one graded question to .teach/probe-log.jsonl.
#
# For harnesses without the `quiz` tool (Claude Code, Codex, a plain chat window).
# The shape must match what extensions/quiz writes, because /probe, `recall`, and
# the tests all read one format.
#
# Usage:
#   log-answer.sh <strand> <correct|wrong|unknown> "<question>" [phase]
#
# Example:
#   log-answer.sh linear-algebra/dual-spaces wrong "What does a 1-form eat?" probe

set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $(basename "$0") <strand> <correct|wrong|unknown> \"<question>\" [probe|teach]" >&2
  exit 64
fi

strand="$1"
result="$2"
question="$3"
phase="${4:-probe}"

case "$result" in
  correct) correct=true;  admitted=false ;;
  wrong)   correct=false; admitted=false ;;
  unknown) correct=false; admitted=true  ;;
  *) echo "result must be one of: correct, wrong, unknown (got: $result)" >&2; exit 64 ;;
esac

case "$phase" in
  probe|teach) ;;
  *) echo "phase must be probe or teach (got: $phase)" >&2; exit 64 ;;
esac

# Minimal JSON string escaping: backslash, double quote, tab, then newlines.
json_escape() {
  printf '%s' "$1" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' \
    | awk 'BEGIN { ORS = "" } NR > 1 { print "\\n" } { print }'
}

log_dir="${TEACH_LOG_DIR:-.teach}"
mkdir -p "$log_dir"

printf '{"ts":"%s","strand":"%s","phase":"%s","question":"%s","options":[],"correctIndex":-1,"answerIndex":null,"answer":"","correct":%s,"admitted":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
  "$(json_escape "$strand")" \
  "$phase" \
  "$(json_escape "$question")" \
  "$correct" \
  "$admitted" \
  >> "$log_dir/probe-log.jsonl"
