#!/usr/bin/env bash
#
# Append one graded question to .teach/probe-log.jsonl.
#
# For harnesses without the `quiz` tool (Claude Code, Codex, a plain chat window).
# The shape must match what extensions/quiz writes, because /probe, `recall`, and
# the tests all read one format.
#
# Usage:
#   log-answer.sh <strand> <correct|wrong|unknown> "<question>" [phase] \
#                 [--answer "<the correct option>"] [--why "<one sentence>"] [--depth 1-5] [--reason sound|thin]
#
# Example:
#   log-answer.sh linear-algebra/dual-spaces wrong "What does a 1-form eat?" probe \
#     --answer "A vector, returning a scalar" \
#     --why "A 1-form is a linear map from the tangent space to R."
#
# --answer and --why are what make the log a debrief rather than a scoreboard.
# Nothing shows them to the learner; the probe phase stays silent either way.

set -euo pipefail

usage() {
  echo "usage: $(basename "$0") <strand> <correct|wrong|unknown> \"<question>\" [probe|teach]" \
       "[--answer \"<correct option>\"] [--why \"<one sentence>\"] [--depth 1-5]" >&2
  exit 64
}

if [ "$#" -lt 3 ]; then
  usage
fi

strand="$1"
result="$2"
question="$3"
shift 3

phase="probe"
correct_answer=""
rationale=""
depth=""
grounded=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    probe|teach) phase="$1" ;;
    --answer)
      [ "$#" -ge 2 ] || { echo "--answer needs a value" >&2; exit 64; }
      correct_answer="$2"
      shift
      ;;
    --why)
      [ "$#" -ge 2 ] || { echo "--why needs a value" >&2; exit 64; }
      rationale="$2"
      shift
      ;;
    --reason)
      [ "$#" -ge 2 ] || { echo "--reason needs a value" >&2; exit 64; }
      case "$2" in
        sound) grounded=true ;;
        thin)  grounded=false ;;
        *) echo "--reason must be sound or thin (got: $2)" >&2; exit 64 ;;
      esac
      shift
      ;;
    --depth)
      [ "$#" -ge 2 ] || { echo "--depth needs a value" >&2; exit 64; }
      case "$2" in
        [1-5]) depth="$2" ;;
        *) echo "--depth must be 1..5 (got: $2)" >&2; exit 64 ;;
      esac
      shift
      ;;
    *) echo "unexpected argument: $1" >&2; usage ;;
  esac
  shift
done

case "$result" in
  correct) correct=true;  admitted=false ;;
  wrong)   correct=false; admitted=false ;;
  unknown) correct=false; admitted=true  ;;
  *) echo "result must be one of: correct, wrong, unknown (got: $result)" >&2; exit 64 ;;
esac

# Minimal JSON string escaping: backslash, double quote, tab, then newlines.
json_escape() {
  printf '%s' "$1" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' \
    | awk 'BEGIN { ORS = "" } NR > 1 { print "\\n" } { print }'
}

# An untagged question is logged without the field rather than with a wrong one:
# a guessed depth would move the level reading on evidence nobody supplied.
depth_field=""
if [ -n "$depth" ]; then
  depth_field=",\"depth\":$depth"
fi

# Same rule for the reason: absent means never asked, which is not the same as asked
# and found wanting. Only a reason that was actually heard writes this field.
grounded_field=""
if [ -n "$grounded" ]; then
  grounded_field=",\"grounded\":$grounded"
fi

log_dir="${TEACH_LOG_DIR:-.teach}"
mkdir -p "$log_dir"

printf '{"ts":"%s","strand":"%s","phase":"%s","question":"%s","options":[],"correctIndex":-1,"answerIndex":null,"answer":"","correct":%s,"admitted":%s,"correctAnswer":"%s","rationale":"%s"%s%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
  "$(json_escape "$strand")" \
  "$phase" \
  "$(json_escape "$question")" \
  "$correct" \
  "$admitted" \
  "$(json_escape "$correct_answer")" \
  "$(json_escape "$rationale")" \
  "$depth_field" \
  "$grounded_field" \
  >> "$log_dir/probe-log.jsonl"
