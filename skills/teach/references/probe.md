# Phase 1 — Probe, and the calibration checkpoint

Read this before asking the first question. It is the measurement half of the
skill; `references/teach.md` is the other half.

---

## Phase 1 — Probe

**Goal:** a map of where this learner's understanding ends, on every strand the
lesson will depend on.

Before asking anything, list the prerequisite strands for the goal topic. For
"differential forms" that might be: vector calculus, line integrals, linear algebra
and dual spaces, manifolds, tensor notation, the physics motivation.

**Then probe only the strands the first part of the path depends on.** Not all of
them. A goal like "databases" or "differential geometry" has a dozen strands, and
measuring all twelve before teaching anything spends the whole session on
measurement — the learner answers questions for forty minutes, learns nothing,
and is right to conclude the thing does not work. Measure two or three strands,
plan, teach. Probe the later strands when the path reaches them, by which point
you will also know more about how this person answers.

The probe is a prelude, not the product. If the learner has been answering
questions for twenty minutes and has not been taught anything, the session has
failed no matter how sharp the map is.

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
- **"I don't know" means go shallower.** It is the same move as a wrong answer,
  not a reason to leave. A learner who cannot answer at this depth has a
  boundary somewhere below it, and you have not found it yet. Never end a strand
  on an admitted blank — that records a gap without locating it, which is the
  one outcome worse than not asking.
- **Finish the strand you are on.** Two questions on each of eight strands is a
  survey, not a measurement: it tells you they are shaky everywhere and where
  nothing begins. Move on only when you can name the last thing they hold and
  the first thing they do not, or when three straight misses have put the
  boundary below the strand's fundamentals — that is `absent`, and it is a
  finding, so say it and move on.
- **Do not re-ask a question they already missed** at the same depth later in the
  same session. They have not learned anything since; you are measuring memory
  of the question. Go shallower instead.
- **Say whether they got it right, immediately — and nothing else.** One word,
  every question, no exceptions. Answering a dozen questions into silence is
  indistinguishable from guessing into a void, and a learner who cannot tell
  guessing from knowing stops being able to report either.
- Do **not** teach during the probe. The verdict is not content: "not quite"
  tells them their model of this is off, which they are entitled to know. The
  correct answer tells them the thing you are still measuring, which would
  contaminate every question after it. So no answers, no explanations, no hints,
  no "actually, the reason is…" — the verdict, then the next question.
- **Close each strand with the reveal.** When you leave a strand, before you
  start the next one: every question on it, the correct answer, one sentence of
  why, and what the two of you now know about where their boundary sits. The
  measurement on that strand is finished, so explaining is free — and it lands
  while they still remember what they were thinking when they answered. Write it
  to the lesson file as you go, not only to the terminal.
- Do not stop early on a strand because it feels like a lot of questions — but do
  stop *somewhere*. Two to four questions locate a boundary if you are actually
  binary-searching. If four have not, the strand is shaky and unresolved: record
  that, say so, and move on. A fifth question is usually evidence that the
  questions are drifting sideways rather than up and down.
- **A right answer with nothing behind it is not knowledge.** At depth 3 and
  above, and any time a pick could have been a coin toss, ask for the reason in
  one line before you move: *"say why, in a sentence"*. Then grade the reason,
  not the letter. A sound reason is held. A right letter with a reason that does
  not survive the question is a guess, and it is logged as one — `--reason thin`,
  or `grounded: false` on the `quiz` call.

  This is not pedantry. A guess that lands looks identical to knowledge in the
  log, and every number downstream inherits the error: the level ratchet turns
  up, the map goes green, and the learner is taught above their real edge while
  the log insists they are fine. One extra line of typing prevents all of it.
  Do not ask on every question — that turns a probe into an interrogation. Ask
  when the stakes are a level move, or when they answered fast on something hard.
- Write distractors that a person who half-knows the material would find plausible.
  A question whose wrong answers are obviously wrong measures nothing.
- If the learner volunteered context up front ("I'm solid on linear algebra"), trust
  it enough to skip the shallow end of that strand — but still verify the boundary.
  Self-reports are a prior, not a measurement.

**Done when:** you can name the last concept they hold and the first one they do
not, on the strands the opening of the path depends on. Finish with a short
written summary of that map — solid, shaky, absent — and show it to them. That
summary is the input to phase 2.

Then go to phase 2, in the same message if you can. Do not ask whether they are
ready. The learner came to be taught, and every extra question spends the
attention that was supposed to go into the material.


---

## Calibration — every ten questions

Both phases ask questions, and both drift. The learner cannot see the drift: from
inside, a probe stuck at one depth and a probe converging feel identical, and
answering into either is exhausting in the same way. So the check is yours to run,
on a fixed cadence, out loud.

**Tag every question with a depth, 1 to 5:**

| Depth | What it asks for | Example |
|---|---|---|
| 1 | recall | what a term means |
| 2 | mechanism | how the thing works internally |
| 3 | tradeoff | why you would choose it over the alternative |
| 4 | design | applying it under a stated constraint |
| 5 | edge | where it breaks, and what it costs to fix |

Untagged questions cannot count toward a level. A guessed depth is worse than
none, because it moves the reading on evidence nobody supplied.

**Every ten logged questions, stop and read the level back to them.** Not a
feeling — the log:

```bash
<this-skill-dir>/scripts/level.sh --dir <project>      # add --json to parse
```

It reports the hardest depth they hold at two-thirds or better over the recent
window, how they are doing at the depth currently being worked, and the move: up,
hold, or down. Say all three to the learner in two lines. Being told "you are
solid at mechanism, shaky at tradeoff, and I am staying at tradeoff until that
changes" is the single clearest signal a learner gets that they are being
measured rather than quizzed at random.

**Then take the move.**

- **up** — they hold this depth. Next question is one depth harder. Do not ask a
  fourth question at a depth already cleared; that is comfort, not measurement.
- **hold** — undecided. Stay at this depth, change the angle, not the difficulty.
- **down** — the floor is lower than here. Drop a depth on this strand
  immediately, and do not climb back until they clear the lower one.

The ratchet only turns up when the evidence turns it. If they answer three at
depth 3 correctly, depth 4 is where the next question belongs, and if they then
miss two at depth 4 the reading says so and you go back. That is the whole
mechanism: teach at the depth they are succeeding at, and raise it exactly when
they earn it.

If the script will not run, count it by hand off `.teach/probe-log.jsonl` — the
cadence matters more than the tooling.
