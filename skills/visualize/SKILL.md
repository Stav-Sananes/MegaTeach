---
name: visualize
description: Add one correct, minimal picture to a lesson — a dependency graph, a flow, a state machine, or a geometric figure — drawn by a maker subagent that renders it and looks at it before returning. Use when an idea is genuinely clearer as a picture than as prose.
license: MIT
---

# visualize

A picture earns its place only when it shows something a sentence cannot: shape,
structure, direction, relationship, geometry. This produces exactly one such
picture, verified by the agent that drew it, and puts it in the lesson.

You are the director, not the draughtsman. You decide what the picture must show
and cut it to the fewest elements that carry it. A maker subagent writes the
source, renders it, **looks at the render**, fixes what is wrong, and hands back a
path. You embed that path.

Never hand-author a diagram yourself. The whole reliability argument here is the
render-and-inspect loop, and you cannot run it in the middle of a teaching turn.

## When a picture is worth it

This skill teaches by building a dependency graph in someone's head — foundations
at the roots, derived facts hanging off them. A visual is powerful exactly when it
makes that structure visible, or when the subject is spatial to begin with.

Reach for one when the idea is:

- **Structural** — dependencies, a system with parts and arrows, a pipeline, an
  ordered exchange, a state machine, a tree, a containment, a comparison.
- **Spatial** — coordinate geometry, a number line, vectors, the shape of a
  function, a physical arrangement, anything where position means something.

Do not draw when prose or one equation already carries it. A diagram that restates
the sentence beside it adds noise and a new chance to be wrong. **When unsure, do
not draw.** A missing picture costs less than a false one, and a false one is
worse than it looks — a learner trusts a diagram more than a sentence.

## Pick the maker

| Maker | For | Because |
|---|---|---|
| `mermaid-maker` | nodes and edges: dependency graphs, flowcharts, sequence, state, trees | it lays out relationships for you, and the layout is the point |
| `svg-maker` | positions and shapes: geometry, number lines, vectors, plots, physical layout | exact coordinates, which Mermaid will not give you |

Rule of thumb: *relationships* → mermaid, *geometry* → svg. `mermaid-maker` is the
default, because the dependency graph is the thing this method is built on.

## Brief it properly

The failure mode is cramming. Every extra label makes the picture harder to read
*and* harder to lay out correctly, so prune before you brief: for each element ask
whether the idea survives deleting it. If it does, delete it. More than about six
or seven elements means brief a smaller idea.

Give the concrete elements, not a topic:

- **Weak:** "make a diagram about how TCP works" — the maker now guesses what the
  lesson is about, and will guess something plausible and wrong.
- **Strong:** "graph TD. Node 'packet' at top. Arrows down from it to 'ordering'
  and 'retransmit on loss'. Both arrow down into 'reliable stream'. No title. The
  point is that reliability is built *from* packets, not alongside them."

Say what the picture must make obvious. That sentence is what the maker checks its
own render against.

## Dispatch

Use whatever subagent mechanism the harness provides — `delegate` in pi, `Task` or
`Agent` in Claude Code — with the definitions in `agents/`. See
`skills/teach/references/harness.md` for the mapping.

The maker returns an absolute path, one sentence on what the picture shows, and an
embed line. If it reports that no renderer is installed, it did **not** verify the
image: either install one (`rsvg-convert`, ImageMagick, or `qlmanage` on macOS) or
treat the result as unverified and say so to the learner rather than presenting it
as checked.

If it cannot produce a correct picture of the brief, simplify the brief or drop
the visual. Do not accept a diagram it could not verify.

## Put it in the lesson

Embed the returned file in your teaching message, and keep it in the lesson file
so it survives the session:

```
![[viz-<slug>.svg]]
```

Obsidian resolves that by filename anywhere in the vault, so the picture renders
inline in the lesson note. Add `|500` after the name to set a display width for a
dense diagram.

Introduce it in one sentence, then let it carry the idea. Narrating every element
back in prose wastes the picture — if the diagram needs a paragraph of caption, it
was the wrong diagram.

## Why this is trustworthy

The maker never returns an image it has not looked at, so "renders fine, says
something false" is caught before the learner sees it. Overlapping labels, arrows
pointing at nothing, text off the canvas — none of that is visible in the source,
only in the render. That is the entire reason the drawing is delegated rather than
written inline.

---

*Adapted from the `visualize` skill in
[amosblomqvist/learn](https://github.com/amosblomqvist/learn), rewritten for this
repo's harness-agnostic maker agents.*
