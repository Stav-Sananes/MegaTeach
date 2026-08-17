# MegaTeach

An AI tutor that measures what you know before it teaches you anything.

**probe → plan → teach.** It asks graded multiple-choice questions until it has
located the exact edge of your understanding, plans a dependency path from that
edge to your goal, then walks the path one reasoning step at a time — quizzing as
it goes to stay calibrated.

Built for the [pi](https://pi.dev) harness. The skill follows the
[Agent Skills](https://agentskills.io/specification) standard, so it loads in
Claude Code and other skill-aware harnesses too.

📖 **[Read the usage guide](GUIDE.md)** — how to get real teaching out of this
rather than a chatbot with extra steps.

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
| `/teach <topic>` | Start a session: loads your philosophy, prior map, and sources, then probes |
| `/link <path>` | Point the session at a markdown file it writes lessons into |
| `/source add <path>` | Add your own material — PDFs, Word files, notes, a whole course directory |
| `/probe` | Show your measured map — per strand, with staleness |
| `/philosophy` | Show your PHILOSOPHY.md, or scaffold one |

## Teach from your own material

Point it at your course PDF, your lecturer's Word handouts, your problem sets:

```
/source add ~/course/lectures/          # a file, or a whole directory
/source list                            # what's in the library
/source doctor                          # which extractors this machine has, per format
/teach stokes' theorem
```

Your sources then **outrank the model's memory** on notation, conventions, and
definitions — the things that differ between courses and quietly make a correct
generic explanation useless to you. Every claim drawn from them is cited as
`[lecture-3.pdf p.12]`, so you can turn to the page and check. Where your sources
are silent, it says so instead of blurring the boundary.

Retrieval is BM25 over page-attributed chunks, computed locally: **no embedding
API, no vector database, no key, no network.** The trade is that matching is
keyword-based rather than semantic, so the tutor issues several queries with
different phrasings — cheap, because searching costs nothing.

PDFs and Word files each go down a ladder of extractors. `/source doctor` reports
both, per format:

```bash
brew install poppler          # macOS — pdftotext, the best PDF output
apt install poppler-utils     # Debian/Ubuntu
python3 -m pip install pypdf  # no system package needed

brew install pandoc           # best .docx output — keeps tables and headings
```

**Word needs no install at all** in practice: a `.docx` is a zip of XML, so the
bottom rung reads it with nothing but stock `python3`. macOS also ships
`textutil`. Pages come from explicit and last-rendered page breaks, so
`[handout.docx p.2]` means page 2 — and a document with no breaks is cited
without a page rather than with an invented one. Legacy `.doc` is not a zip and
is rejected with the command to convert it.

`.md` and `.txt` sources need none of this. Scanned PDFs with no text layer are
reported as such rather than ingested empty.

The library is also reachable with no session, no model, and no key — the same
extraction ladder, the same BM25 index, the same citations, over `argv`:

```bash
bin/teach-sources.ts add ~/course/lectures/
bin/teach-sources.ts search "exterior derivative" --limit 5
```

That is how harnesses without an extension API reach your sources, and it is the
cheapest way to find out whether keyword retrieval is good enough for your
material — search your own PDF with the words *you* would use, before you spend
a session finding out that they are not the words it uses.

## What it writes

```
.teach/
├── probe-log.jsonl   every graded question, with strand, verdict, timestamp
├── link.json         which note this project writes into
└── sources/          extracted text of your material, plus manifest.json
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
| `extensions/sources/` | `/source`, `source_search`, `source_read`, and the PDF/DOCX extraction ladders |
| `extensions/shared/` | Probe log, philosophy, link state, retrieval — all unit tested |
| `bin/teach-sources.ts` | The source library over `argv` — no harness, no model, no key |
| `agents/` | Subagent definitions: `svg-maker`, `mermaid-maker`, `fact-checker` |
| `PHILOSOPHY.example.md` | Template for the fork point |
| `GUIDE.md` | How to actually use it well |
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

The skill degrades honestly, and **needs no API key of its own** — in Claude Code
it runs on the subscription you already have:

```bash
./install.sh --claude
cd ~/where-you-study && claude     # then: "teach me <topic>"
```

There is no `quiz` tool there, so it uses `AskUserQuestion` and appends each
result with `log-answer.sh` — the same JSONL, so the two harnesses share one map.
Sources go through `skills/teach/scripts/sources.sh`, which runs the identical
index and returns the identical `[lecture-3.pdf p.12]` citations. A topic probed
in one harness is already measured in the other. See the *Harness adaptation*
table in `skills/teach/SKILL.md`.

> Logging into pi with a Claude Pro/Max account is not the free route: pi's docs
> note that third-party harness usage is billed per token as extra usage rather
> than against plan limits.

## Development

```bash
npm install
npm test          # node's test runner, no build step
npm run typecheck # tsc against the real pi types
npm run smoke     # drives a real pi session with a scripted provider — no model, no API key
```

`npm test` proves the tools behave when called directly. `npm run smoke` proves
pi actually loads the package, registers the tools, validates arguments against
the schemas, and routes results back — including spawning a real subagent
process. It needs pi on your PATH and skips cleanly if it is missing.

## Credit

The approach is a reimplementation of a system demoed publicly by its author.
This repo is an independent, open-source build of the same idea.

MIT licensed.
