# MegaTeach — build plan

An AI tutor that measures what you know before it teaches you anything.
Three phases: **probe → plan → teach**.

Runs on the [pi](https://pi.dev) harness. The skill follows the Agent Skills
standard, so it also loads in Claude Code unchanged.

---

## The thesis

Two inefficiencies in normal learning:

1. **One outlet teaches many.** Optimal teaching depends on the learner's exact
   current understanding, so anything built for many people is optimal for nobody.
2. **One learner uses many outlets.** Every switch costs mental effort and trust
   that should have gone into the material.

The fix is one interface fitted to one mind, aggregating all sources. Difficulty is
not removed — it's *relocated*. All struggle goes into the material; none into
planning, finding resources, or verifying facts.

---

## Milestones

### M0 — Harness up
- [x] Install pi: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
- [x] Confirm a session runs and a tool call works — `npm run smoke` does this with
      a scripted provider, so it needs no key
- [ ] Configure your model provider (`/login`, or any OpenAI-SDK-compatible endpoint)
- [ ] Record the actual per-token cost of one throwaway session — this sets the
      budget for everything below

**Done when:** you can `pi` into a session and it answers.

*Status: the harness half is verified and covered by CI. The provider half is
yours — it depends on your account and your keys.*

### M1 — The quiz tool  ← *highest leverage, built first*
- [x] `extensions/quiz/index.ts` registers a `quiz` tool
- [x] Model supplies question + options + **the correct index, before seeing your answer**
- [x] TUI renders the choices; you pick; tool returns correct/incorrect to the model
- [x] Every question appends to `.teach/probe-log.jsonl` with its strand
- [x] `executionMode: "sequential"` so two questions cannot race for the terminal
- [x] Out-of-range `correct_index` throws instead of silently mis-grading

**Why first:** until the model can *measure*, everything else is just a chatbot.
The commit-before-seeing rule is what makes this a measurement instead of a
conversation.

**Done when:** you can hand-prompt "quiz me on X" with no skill loaded and get a
real graded question.

### M2 — Probe phase
- [x] `skills/teach/SKILL.md` with all three phases written
- [x] Explicit termination criterion for the probe (name the last held concept and
      the first unheld one, per strand)
- [ ] Run it on a topic you genuinely don't know
- [ ] Read `probe-log.jsonl` afterwards — did it actually find your edge, or did it
      ask ten questions at the same level?

**Expect the prompt to be wrong here.** That's the point of running it this early.
Iterate on SKILL.md until the probe reliably converges on the boundary. This is
the milestone that never really closes.

### M3 — Markdown log
- [x] `extensions/md-log/index.ts` — `/link <path>` + a `note` tool
- [x] Link persists to `.teach/link.json`, so a new session resumes the same note
- [ ] Point it at an Obsidian vault, confirm LaTeX renders

### M4 — Plan phase
- [x] Model emits a Mermaid DAG of the teaching path before teaching anything
- [x] Graph is written to the linked markdown file via `note`

The graph is not decoration. It's a forcing function — the model cannot wing the
sequencing if it has to commit to a dependency graph first.

### M5 — Teach phase
- [x] One reasoning step per message, no rushing ahead
- [x] Periodic `quiz` calls to confirm understanding before advancing
- [x] Wrong answer → back up and re-explain, don't push forward

### M6 — Subagents
- [x] `delegate` tool spawns each agent as its own `pi -p --no-session` process
- [x] `svg-maker` — writes SVG, *views the rendered image*, fixes, views again
- [x] `mermaid-maker` — diagram generation
- [x] `fact-checker` — verification during the plan phase
- [x] Agents overridable from `.teach/agents/` without forking the repo

Isolated context is the real benefit — the visual work never pollutes the lesson.
The SVG loop depends on the model having vision.

### M7 — Ship it
- [x] `install.sh` — `pi install` with a symlink fallback, plus a Claude Code path
- [x] README with a quickstart
- [x] `PHILOSOPHY.example.md` — the fork point
- [x] Unit tests on the probe log, philosophy loading, and link state
- [x] CI on push

---

## The open-source design decision

Ship the skeleton, not your pedagogy.

The probe and plan phases are mechanism — they belong to everyone. The teach phase
is *taste*: how slow, how formal, how much analogy, how much notation. If you ship
your taste as the default, you've rebuilt the exact "one outlet teaches many"
problem the project exists to solve.

So `SKILL.md` has a clearly marked block that reads from `PHILOSOPHY.md`, and the
README's first instruction is: write yours before your first session.

---

## Cost notes

The probe phase is turn-heavy by design. If cost becomes the binding constraint,
the fix is a smaller model for probing and a stronger one for teaching, not fewer
questions. `delegate` already helps here: subagents can run cheaper models via the
`model:` field in their frontmatter without touching the main session.

Open weights do not automatically make a frontier model cheap to run yourself — at
trillion-parameter scale, self-hosting is data-center hardware. What makes it cheap
is somebody else's API pricing. Check current rates before committing.

---

## Open questions

- **Cross-session state.** Now answered in one direction: the probe log persists and
  `recall` reads it, with a 30-day staleness horizon after which a strand counts as
  unverified. Whether 30 days is right for *your* material is untested.
- **"I forgot."** Currently the learner has to say so, and the tutor re-probes. A
  strand could instead decay automatically with time since last *correct* answer.
- **Spaced repetition.** The log has everything needed to schedule review — question,
  strand, verdict, timestamp. Nothing schedules anything yet. Deliberately out of
  scope until the probe itself is reliably good.
- **Strand naming.** Strands are free-form paths chosen by the model. Two sessions on
  the same topic can invent different names and fail to aggregate. A canonical
  vocabulary per topic would fix it, at the cost of flexibility.
