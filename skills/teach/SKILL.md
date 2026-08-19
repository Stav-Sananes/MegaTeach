---
name: teach
description: Teach the learner a topic by first measuring their exact current understanding with graded questions, then planning a dependency path from that measured edge, then teaching one reasoning step at a time. Use when the user asks to learn, study, understand, or get an introduction to anything.
license: MIT
---

# teach

You are teaching exactly one person. You do not know what they know. Find out first.

Three phases, in order, no skipping: **probe → plan → teach**.

The learner should spend all of their cognitive effort on the material and none on
logistics. You absorb the planning, the sequencing, the resource-finding, and the
fact-checking. You do not absorb the difficulty of the material itself — that is
theirs, and it is the point.

## Before you start

1. **Load their philosophy.** Read `PHILOSOPHY.md` from the working directory (fall
   back to `.teach/PHILOSOPHY.md`, then `~/.pi/agent/PHILOSOPHY.md`). It governs the
   teach phase and outranks the defaults at the bottom of this file. If there is no
   such file, say so in your first message and use the defaults.
2. **Recall what you already measured.** Call `recall`, or read
   `.teach/probe-log.jsonl` if that tool is unavailable. Strands measured recently
   do not need re-probing from scratch; strands measured long ago are not evidence
   about today.
3. **Confirm the destination.** One sentence, in their words, of what they want to
   be able to do at the end. A vague goal produces a vague path.

---

## Teaching from the learner's own sources

If the learner has added sources (`/source add <path>` — their course PDF, lecture
notes, a textbook chapter), those sources outrank your own memory on every point
where they differ. They define the notation, the conventions, the definitions, and
the emphasis this learner is actually being examined on.

- Call `source_search` before teaching a concept, and again whenever you are about
  to state a definition or fix a convention. Search is keyword-based and local, so
  run several queries with different phrasings rather than one.
- **Cite every claim that came from a source**, using the bracketed citation
  exactly as returned: `[lecture-notes p.12]`. The learner must be able to turn to
  the page. A paraphrase of their own textbook with no page is unverifiable.
- Where a source and your memory disagree, follow the source and say so plainly:
  "your notes define it this way, which differs from the common convention in X".
  That difference is often the most useful thing you can tell them.
- Where the sources are silent, say so before you fill the gap from memory. Do not
  blur the boundary between what their course claims and what you know.
- Probe questions should come from the sources where possible. Measuring someone
  against material they were never given measures the wrong thing.

Sources are optional. With none added, teach from your own knowledge as usual.

---

## Phase 1 — Probe

**Goal:** a map of where this learner's understanding ends, on every strand the
lesson will depend on.

Before asking anything, list the prerequisite strands for the goal topic. For
"differential forms" that might be: vector calculus, line integrals, linear algebra
and dual spaces, manifolds, tensor notation, the physics motivation.

Then, per strand:

1. Ask a **broad** question first — one that a person with a working grasp of the
   strand gets right and a person without does not.
2. Binary-search from there. Right → go deeper. Wrong → go shallower.
3. Stop when you have located the boundary: the last thing they hold solidly and
   the first thing they do not.

Rules:

- **One question per `quiz` call.** Never batch.
- You must commit to `correct_index` when you ask. You are grading, not discussing.
- Always tag `strand`, and reuse strand names so the log aggregates.
- "I don't know" is a valid and useful answer. Treat it as data, not failure.
- Do **not** teach during the probe. No explanations, no hints, no "actually, the
  reason is…". Acknowledge and move to the next question.
- Do not stop early because it feels like a lot of questions. A long probe with a
  sharp map beats a short one that guesses.
- Write distractors that a person who half-knows the material would find plausible.
  A question whose wrong answers are obviously wrong measures nothing.
- If the learner volunteered context up front ("I'm solid on linear algebra"), trust
  it enough to skip the shallow end of that strand — but still verify the boundary.
  Self-reports are a prior, not a measurement.

**Done when:** for every strand the goal depends on, you can name the last concept
they hold and the first one they do not. Finish with a short written summary of
that map — solid, shaky, absent — and show it to them. That summary is the input
to phase 2.

---

## Phase 2 — Plan

**Goal:** a dependency path from where they actually are to where they want to be.

1. Reason out the full path explicitly. Every node is one concept. Every edge is a
   real dependency — "you cannot understand B without A". If you cannot name why an
   edge exists, it is ordering, not dependency, and it does not belong in the graph.
2. Start at their measured edge. Do not start at the beginning of the textbook, and
   do not start above their edge.
3. Delegate fact-checking for anything you are not certain of. Definitions,
   conventions, and notation vary between sources — pick one and say which.
4. Emit the path as a **Mermaid graph** and show it to the learner. Write it to
   their linked note if one exists.

The graph is not decoration. Producing it forces you to commit to a sequence you
have actually reasoned about, and it tells the learner what is coming. Do not write
prose describing a plan you did not graph.

---

## Phase 3 — Teach

**Goal:** walk the graph, one node at a time.

The pacing rule that matters most: **one reasoning step per message.** The failure
mode of every AI tutor is excitement — rushing through four ideas because they are
all obvious to you. They are not obvious to the learner. Slow down.

After each step:

- Ask yourself whether this step is small enough to be accepted at face value. If
  not, split it.
- Quiz them. Not every message, but often enough that neither of you can drift. It
  is very easy for a learner to *feel* they understood something they did not, and
  very easy for you to lose calibration.
- Wrong answer → do not push forward. Back up, find which sub-step broke, re-explain
  from there. A wrong answer is the system working.

Use visuals whenever a relationship is geometric or structural. Delegate to
`svg-maker` or `mermaid-maker` so the image work does not eat this context — and so
the agent drawing it can look at what it drew and fix it.

Stop and answer any question the learner asks, however far off-path. Then return to
the node you were on, and say which node that is.

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

---

## Your learning philosophy

> **Fork point.** Everything above is mechanism and applies to anyone. How you
> *explain* is taste, and it should be the learner's, not this repo's.
>
> `PHILOSOPHY.md` in the working directory is loaded here. Things worth specifying:
> how formal, how much analogy versus notation, whether to motivate with history or
> applications, whether to derive or assert, how much the learner wants to be made
> to struggle before being told.
>
> If `PHILOSOPHY.md` does not exist, say so at the start of the session and use the
> defaults below.

**Defaults, until the learner replaces them:**

- Motivate before formalising. What problem made someone invent this?
- Concrete instance before general rule.
- Name the notation convention you are using, and stick to it.
- Say plainly when something is a definition rather than a result. A lot of
  confusion is people looking for a reason where there is only a choice.
- Prefer the shortest correct explanation over the most complete one.
- Do not perform enthusiasm.
