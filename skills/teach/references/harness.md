# Harness adaptation, and the logging contract

Read this before the first graded question, whichever harness you are in.

---

## Harness adaptation

This skill is written for a harness that provides the tools below. Everything above
is unchanged either way; only the mechanism differs.

| Capability | pi (this repo's extensions) | Claude Code / other |
|---|---|---|
| Graded question | `quiz` tool | `AskUserQuestion`, then append the result yourself |
| Prior measurements | `recall` tool | Read `.teach/probe-log.jsonl` |
| Durable lesson file | `note` tool after `/link` | `Write`/`Edit` to the file the learner names |
| Isolated subagent | `delegate` tool | `Task`/`Agent` tool with the definitions in `agents/` |
| The learner's sources | `source_search` / `source_read` | `<this-skill-dir>/scripts/sources.sh` — same retrieval, same citations |
| Level checkpoint | `<this-skill-dir>/scripts/level.sh` | the same script, either way |

Without `source_search`, reach the library through that script rather than
grepping the extracted text. It runs the identical BM25 index and returns the
identical citations, so a lesson does not change its account of the learner's
textbook when it moves between harnesses — and `p.N` comes out right, which grep
cannot do. Use the absolute path of the directory you read this SKILL.md from,
for the same reason as `log-answer.sh` below:

```bash
<this-skill-dir>/scripts/sources.sh list                        # is there a library at all?
<this-skill-dir>/scripts/sources.sh search "<query>" --limit 5
<this-skill-dir>/scripts/sources.sh read <chunk-id>
```

Add `--dir <project>` when the learner's `.teach/` is not under the working
directory, and `--json` when you want to parse rather than read. If the script
will not run, fall back to `Grep` over `.teach/sources/*.txt` and cite the
document without a page number rather than inventing one.

Note on `quiz` during the probe: it deliberately shows the learner **nothing** —
not the correct answer, not the rationale. Do not refer back to a reason they have
not heard. In the teach phase it shows both.

Without the `quiz` tool you must still commit before you see the answer: state the
correct option to yourself in your reasoning, ask, and then log the attempt.

### When the graded question is `AskUserQuestion`

The tool asks; it does not grade. Four constraints follow from that, and none of
them change the probe — only how you run it.

- **Two to four options.** `quiz` takes up to six and appends "I don't know"
  itself; `AskUserQuestion` does neither. Include an "I'm not sure" option
  yourself on anything hard — a confident wrong answer and an honest blank are
  different data — and accept that it costs you a distractor slot.
- **One question per call.** The tool accepts up to four questions at once. Do
  not use that. Each answer decides what you should ask next, so a batch of four
  is four questions asked blind.
- **`header` is capped at about twelve characters.** Name the strand, not the
  question.
- **Roughly sixty seconds to answer.** Keep questions readable at a glance. The
  learner can hold the prompt open by starting to type in the free-text option;
  if that is still too tight — long derivations, anything needing paper — write
  the question into their lesson file instead and ask for a typed answer. Log it
  identically either way.

**Never ask from inside a subagent.** `AskUserQuestion` does not work there.
Subagents draw, diagram, and fact-check; quizzing stays in the main session.

### Steer yourself — nothing else will

`quiz` returns a direction after every answer: *probe deeper*, or *this is at or
past the edge, probe shallower*. `AskUserQuestion` returns the learner's pick and
nothing more. On this path the steering is yours to supply, and it is the part
that quietly goes missing — the questions keep coming, all at the same depth,
and the probe turns into a quiz show.

So after every answer, before you write the next question, say which move you
are making and why:

- **Right** → deeper on this strand. Same strand, one level harder.
- **Wrong** → shallower on this strand. Same strand, one level easier — not the
  same question rephrased, and not a different topic.
- **"I'm not sure"** → shallower, exactly as for wrong.
- **Right at the depth below a miss** → boundary located. Name it, write it into
  the map, and only now start a new strand.

If you cannot name the move, you have lost the binary search and are sampling at
random. Go back to the last answer and work out which side of it you are on.

A typed free-text answer is better data than a forced pick, not worse. "B, but
only if the writes are on the same row" tells you where the boundary is far more
precisely than B does. Log what they actually said, grade the substance, and let
the hedge steer the next question.
Log it with the script that sits beside this file. **Use the absolute path of the
directory you read this SKILL.md from** — the skill is usually installed outside
the learner's project (`~/.claude/skills/teach/`, `~/.pi/agent/skills/teach/`), so
a path relative to the working directory will not exist:

```bash
<this-skill-dir>/scripts/log-answer.sh <strand> <correct|wrong|unknown> "<question>" [probe|teach] \
  --answer "<the correct option, in words>" \
  --why "<one sentence: why that answer is the answer>"
```

**Pass `--answer` and `--why` on every call.** Without them the log is a
scoreboard — it knows you got a question wrong and cannot tell you what the
answer was. With them it is a debrief that outlives the session, which matters
because the probe deliberately shows the learner nothing at the time. Writing
them costs you one line; reconstructing them a week later is impossible.

Logging the rationale is not the same as revealing it. Nothing displays these
fields, so the probe stays silent. Read them back at the end of the probe and
write the debrief into the learner's lesson file then — that is when the
measurement is over and explaining is free.

If you cannot locate or run the script, append the line yourself — the format is
the contract, not the script:

```bash
mkdir -p .teach && cat >> .teach/probe-log.jsonl <<'EOF'
{"ts":"<ISO-8601>","strand":"<strand>","phase":"probe","question":"<question>","options":[],"correctIndex":-1,"answerIndex":null,"answer":"","correct":false,"admitted":true,"correctAnswer":"<the correct option>","rationale":"<one sentence>"}
EOF
```

`correct` and `admitted` are the two fields everything downstream aggregates on:
`correct: true` for right, both `false` for a wrong guess, `admitted: true` for
"I don't know". `correctAnswer` and `rationale` are what let you debrief later;
they are optional to the parser and mandatory to you.

Do not skip the logging, and confirm the file grew after the first write. An
unlogged probe is a probe that only helps this session.
