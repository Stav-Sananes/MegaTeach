# Phase 2 — Plan

Read this when the probe has located a boundary and before you write a path.

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
4. Emit the path as a **Mermaid graph**, show it to the learner, and write it to
   `.teach/maps/<topic>.md`. That file is the map's home, not the transcript —
   a graph shown once and left in the scrollback is gone by the next session.

The map file is alive. Mark each node as it moves: pending, current, taught, plus
one line of what the learner actually got out of it. Re-read it at the start of
every session on this topic and continue from the first node not marked taught,
rather than re-deriving the path from scratch and quietly producing a different
one. Where a lesson note exists, link the two.

The graph is not decoration. Producing it forces you to commit to a sequence you
have actually reasoned about, and it tells the learner what is coming. Do not write
prose describing a plan you did not graph.

Walk them through it once, in a paragraph: why this node comes before that one,
which edges are hard dependencies and which are merely convenient, and where
their measured boundary sits on it. This is usually the first moment the topic
stops being a list of terms and becomes a structure — for many learners it is the
single most useful artefact of the whole session, and it costs one message.

Then start teaching, in the same session. A plan delivered and not begun is a
session the learner leaves with nothing they did not walk in with.
