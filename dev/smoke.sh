#!/usr/bin/env bash
#
# End-to-end smoke test against a real pi session, with no model and no API key.
#
# `npm test` proves the tools behave when called directly. This proves pi loads
# the package, registers the tools and commands, validates arguments against the
# schemas, and routes results back — the half that unit tests cannot see.
#
#   ./dev/smoke.sh
#
# Skips (exit 0) when pi is not installed:
#   npm install -g --ignore-scripts @earendil-works/pi-coding-agent

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi is not on PATH."
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

failures=0
pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# Run one scripted step in $WORK, capturing stdout and stderr together.
#
# --mode json because plain print mode shows only the final assistant message,
# and most of what is worth asserting here lives in the tool results.
run_step() {
  SMOKE_STEP="$1" pi \
    -e "$REPO" \
    -e "$REPO/dev/smoke-faux.ts" \
    --provider faux --model faux-1 \
    --no-session --mode json \
    -p "smoke" 2>&1 || true
}

expect() { # expect <label> <pattern> <text>
  if printf '%s' "$3" | grep -qa -- "$2"; then pass "$1"; else
    fail "$1 (expected to find: $2)"
    printf '%s\n' "$3" | sed 's/^/        /' | head -20
  fi
}

refute() { # refute <label> <pattern> <text>
  if printf '%s' "$3" | grep -qa -- "$2"; then fail "$1 (should not contain: $2)"; else pass "$1"; fi
}

cd "$WORK"

echo "inventory"
out="$(run_step inventory)"
expect "every command registers"       "probe, link, teach, philosophy, source"          "$out"
expect "every tool registers"          "quiz, recall, note, delegate, source_search, source_read" "$out"
expect "the teach skill is discovered" "SMOKE skill: loaded"                            "$out"

echo "quiz"
out="$(run_step quiz)"
expect "the session completes"                "SMOKE-OK quiz"                    "$out"
expect "the probe log is written"             "differential-forms/one-forms"     "$(cat .teach/probe-log.jsonl)"
expect "an unanswered question counts as admitted" '"admitted":true'             "$(cat .teach/probe-log.jsonl)"
expect "recall reads back what quiz wrote"    "Prior measurements"               "$out"

echo "quiz-invalid"
out="$(run_step quiz-invalid)"
expect "an ungradeable question is rejected"  "out of range"                     "$out"
refute "and is not logged as a measurement"   "Out of range?"                    "$(cat .teach/probe-log.jsonl)"

echo "note"
: > "$WORK/lesson.md"
printf '{"path":"%s/lesson.md","ts":"2026-01-01T00:00:00.000Z"}\n' "$WORK" > .teach/link.json
out="$(run_step note)"
expect "the note is appended"        "graph TD"                     "$(cat "$WORK/lesson.md")"
expect "LaTeX survives the round trip" 'alpha(v)'                   "$(cat "$WORK/lesson.md")"
expect "the heading is written"      "## Plan"                      "$(cat "$WORK/lesson.md")"

echo "note-unlinked"
rm -f .teach/link.json
out="$(run_step note-unlinked)"
expect "an unlinked note tells the model what to ask for" "run /link" "$out"

echo "sources"
out="$(run_step sources-empty)"
expect "an empty library points at /source add" "source add" "$out"

# Build a library the way /source add would, then let the model retrieve from it.
mkdir -p .teach/sources
printf 'A one-form is a linear map from vectors to scalars.\f' > .teach/sources/smoke-notes.txt
printf 'The exterior derivative generalises grad, curl, and divergence.\n' >> .teach/sources/smoke-notes.txt
cat > .teach/sources/manifest.json <<'JSON'
{
  "version": 1,
  "docs": [
    {
      "id": "smoke-notes",
      "title": "smoke-notes.md",
      "path": "/tmp/smoke-notes.md",
      "addedAt": "2026-01-01T00:00:00.000Z",
      "pages": 2,
      "chars": 120,
      "hash": "smoke",
      "extractedBy": "test"
    }
  ]
}
JSON

out="$(run_step sources)"
expect "the passage is found"                 "generalises grad"       "$out"
expect "it is cited with a turnable page"     "smoke-notes.md p.2"     "$out"
expect "the chunk id is returned for re-reading" "chunk smoke-notes#2" "$out"
expect "source_read returns neighbours"       "chunk smoke-notes#1"    "$out"

echo "delegate"
out="$(run_step delegate-unknown)"
expect "an unknown agent is named, with the real ones listed" "svg-maker" "$out"

out="$(run_step delegate)"
# Without credentials the subagent cannot answer. What matters is that a child
# process really started and its failure came back as an error, not a hang.
if printf '%s' "$out" | grep -qa "Subagent exited with code"; then
  pass "the subagent process runs and its failure surfaces (no credentials here)"
elif printf '%s' "$out" | grep -qa "SMOKE-OK delegate"; then
  pass "the subagent process runs and returns"
else
  fail "delegate neither returned nor reported an error"
  printf '%s\n' "$out" | sed 's/^/        /' | head -20
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "smoke: all checks passed"
else
  echo "smoke: $failures check(s) failed"
  exit 1
fi
