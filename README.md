# MegaTeach

An AI tutor that measures what you know before it teaches you anything.

**probe → plan → teach.** It asks graded multiple-choice questions until it has
located the exact edge of your understanding, plans a dependency path from that
edge to your goal, then walks the path one reasoning step at a time — quizzing as
it goes to stay calibrated.

Built for the [pi](https://pi.dev) harness. The skill follows the
[Agent Skills](https://agentskills.io/specification) standard, so it loads in
Claude Code and other skill-aware harnesses too.

---

## Why

Two inefficiencies in how people normally learn:

1. **One outlet teaches many.** Optimal teaching depends on the learner's exact
   current understanding, so anything built for many people is optimal for nobody.
2. **One learner uses many outlets.** Every switch between video, textbook, forum,
   and chatbot costs attention and trust that should have gone into the material.

The fix is one interface fitted to one mind. Difficulty is not removed — it is
*relocated*. All struggle goes into the material; none into planning, finding
resources, or checking whether what you just read is true.

The mechanism that makes this more than a chatbot is the **commit-before-answer**
rule: the model must state the correct option when it asks, before it sees your
answer. That single constraint turns a conversation into a measurement.

---

## Install

```bash
git clone https://github.com/<you>/MegaTeach && cd MegaTeach
./install.sh            # pi (default)
./install.sh --claude   # Claude Code
./install.sh --all      # both
```

For pi, `install.sh` uses `pi install <path>`, which registers this directory as
a pi package. You can also install it straight from git:

```bash
pi install git:github.com/<you>/MegaTeach
```

Requires Node ≥ 22.6 for the tests; pi loads the TypeScript extensions directly,
with no build step.

## Write your PHILOSOPHY.md first

The probe and plan phases are mechanism. The *teaching* phase is taste — pacing,
formality, analogy versus notation, how much you want to struggle before being
told.

```bash
cp PHILOSOPHY.example.md ~/where-you-study/PHILOSOPHY.md
$EDITOR ~/where-you-study/PHILOSOPHY.md
```

Without it you get this repo's defaults, which is the same "one outlet teaches
many" problem the project exists to avoid. `/philosophy` scaffolds one for you.

## Use

```bash
cd ~/where-you-study
pi
```

```
/link ~/vault/learn/differential-forms.md
/teach differential forms, up to how Maxwell's equations collapse into two
```

Then answer questions. The first stretch is only measurement — it will not explain
anything, and that is deliberate. When it has your map it shows you a Mermaid
dependency graph, and only then starts teaching.

Open the linked file in Obsidian (or anything that renders LaTeX) to read the
lesson with mathematics and diagrams intact.

| Command | What |
|---|---|
| `/teach <topic>` | Start a session: loads your philosophy and prior map, then probes |
| `/link <path>` | Point the session at a markdown file it writes lessons into |
| `/probe` | Show your measured map — per strand, with staleness |
| `/philosophy` | Show your PHILOSOPHY.md, or scaffold one |

## What it writes

```
.teach/
├── probe-log.jsonl   every graded question, with strand, verdict, timestamp
└── link.json         which note this project writes into
```

`probe-log.jsonl` is the whole state of the system. Everything else — the `/probe`
map, the `recall` tool, cross-session memory — is a pure function of that file.
It is gitignored by default: it is a record of what you do not know, and that is
yours.

Strands go **stale**. A strand answered correctly two months ago is not evidence
about today, so `recall` reports it as unverified and the tutor re-probes it with
one question instead of building on it.

## Layout

| Path | What |
|---|---|
| `skills/teach/SKILL.md` | The pedagogy. The main thing. |
| `skills/teach/scripts/log-answer.sh` | Log an answer from a harness with no `quiz` tool |
| `extensions/quiz/` | `quiz` + `recall` tools, `/probe` command |
| `extensions/md-log/` | `/link` command and `note` tool |
| `extensions/tutor/` | `/teach`, `/philosophy`, and the `delegate` subagent runner |
| `extensions/shared/` | Probe log, philosophy loading, link state — all unit tested |
| `agents/` | Subagent definitions: `svg-maker`, `mermaid-maker`, `fact-checker` |
| `PHILOSOPHY.example.md` | Template for the fork point |
| `PLAN.md` | Build roadmap and what is still open |

## Subagents

`delegate` runs each subagent as a separate `pi` process with its own context
window. `svg-maker` draws a diagram, renders it, **looks at the rendered image**,
and fixes what is wrong — a loop that costs a lot of tokens on images that have
nothing to do with the lesson. Kept in the main window, that work would push the
teaching out of context.

Drop a markdown file in `.teach/agents/` to add or override one. Later
directories win: repo → `~/.pi/agent/agents/` → `.teach/agents/`.

## Other harnesses

The skill degrades honestly. In Claude Code there is no `quiz` tool, so it uses
`AskUserQuestion` and appends each result with `log-answer.sh` — the same JSONL,
so the two harnesses share one map. See the *Harness adaptation* table in
`skills/teach/SKILL.md`.

## Development

```bash
npm install
npm test          # node's test runner, no build step
npm run typecheck # tsc against the real pi types
```

## Credit

The approach is a reimplementation of a system demoed publicly by its author.
This repo is an independent, open-source build of the same idea.

MIT licensed.
