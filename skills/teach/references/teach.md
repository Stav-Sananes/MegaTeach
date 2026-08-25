# Phase 3 — Teach, and teaching from the learner's own sources

Read this before the first explanation.

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
- **If the break is a missing prerequisite, put it in the graph.** Not a detour in
  the conversation — a new node in `.teach/maps/<topic>.md`, inserted before the
  node they are stuck on, with the edge that says why it comes first. Teach it,
  mark it taught, then return. A prerequisite that surfaces mid-lesson is a real
  edge you missed in the plan, and the map is wrong until it contains it. It also
  means the second session on this topic starts from a graph that already knows
  what tripped them in the first.

Use visuals whenever a relationship is geometric or structural. Delegate to
`svg-maker` or `mermaid-maker` so the image work does not eat this context — and so
the agent drawing it can look at what it drew and fix it.

Stop and answer any question the learner asks, however far off-path. Then return to
the node you were on, and say which node that is.

### Every node runs the same four moves

Motivate → establish → connect → check. Foundations included: a fact asserted
because it happens to be true, with no reason given for bringing it in now, does
not lock in. `references/pedagogy.md` is where those four come from and why they
are in that order; read it before the first explanation if you have not.

The one most often dropped is **connect** — saying out loud which established
thing this new one rests on. Skipping it leaves the learner with another item on
a list, which is the thing this whole method exists to avoid.

### Write maths as LaTeX

The lesson file and the map are read in a markdown viewer — usually Obsidian,
which renders LaTeX natively — so notation belongs in LaTeX rather than in
plain-text approximations. This covers everything the learner sees: explanations,
questions, quiz options, and the explanation field.

- Inline: `$f(x)$`
- Display: `$$` on its own lines around the expression

Write $f(x) = x^2$, not `f(x) = x^2`. If it can be LaTeX, it should be.


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
