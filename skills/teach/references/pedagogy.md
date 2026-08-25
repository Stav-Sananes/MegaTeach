# Why any of this works, and the two moves that make it work

Read this once, before the first explanation. The rest of the skill is machinery —
how to measure, how to sequence, how to log. This is what the machinery is for. If
you only remember one reference, remember this one.

---

## The thing you are actually building

Two people can answer the same questions correctly and not hold the same knowledge.

One holds a pile of separate facts. The other holds a few ideas from which those
facts follow, so to them the facts are not separate at all — they are consequences.
That second state is what "understanding" means here, and it is the only state
worth teaching toward.

The difference is not cosmetic. Disconnected facts decay: nothing holds them in
place, so they drift and are gone in a month. Connected facts are held by their
connections — forget one and you can rebuild it from its neighbours. They also
compress. Ten facts that follow from two ideas cost about as much to carry as the
two ideas.

So the goal is never "they can state it". The goal is that the thing is *derivable*
for them from ground they already stand on.

The felt version of this is worth naming, because you are aiming at it: a pile of
unrelated things collapses into a few that generate the rest. Same information,
far fewer moving parts. That collapse is what a lesson landing feels like from the
inside. If it has not happened, you have delivered information, not taught.

## The mechanism underneath both principles

**A mind will not fully commit to a fact it is not sure is safe to commit to.**

If something more fundamental might later contradict this, committing is expensive —
it means an update to everything built on top. So it hedges. The fact gets held
provisionally, at arm's length, and it never really lands. The learner can repeat
it and cannot use it.

Both principles below are ways of removing that risk. That is the entire reason
they work, and it is why neither is a presentation tip you can drop when you are
in a hurry.

---

## Principle 1 — Start from what can be accepted as-is

Find the few facts this learner can take at face value, with no conditions attached,
and build from there.

Not because bottom-up is logically tidy. Because a caveat-free fact is the cheapest
thing a mind can accept: there is no hedge to hold open, so it commits immediately
and gives you solid ground to stand the next thing on. That matters most exactly
when the topic is new and there is nothing else to connect to yet.

**Keep two words apart, and do not reach for the grander one.** An *unconditional
truth* is something that can be accepted as-is, without caveats — that is a fact
about how it is held. An *axiom* follows from nothing else — that is a fact about
where it sits in the graph. They overlap and they are not the same. Plenty of
unconditional truths do derive from something deeper; they just do not need the
derivation to be safely accepted. Say "unconditional truth" by default. Reserve
"axiom" for things that genuinely bottom out, not for things that merely sound
foundational.

Working rules:

- If it needs a "well, usually" to be true, it is not one yet. Dig down until you
  find the version that does not.
- Few and solid beats many and shaky. Some topics have two.
- **Check the foundation before building on it.** Confirm each one actually reads
  as obviously true *to this learner* before you hang anything off it. That is what
  the quiz-check on a foundation node is for — an unconfirmed foundation is more
  dangerous than an unconfirmed derived step, because everything above it inherits
  the error.

Two shapes worth reaching for when the topic has one:

- **Universal statements** — "all X are Y", "no X is Y". Easy to lock in precisely
  because they admit no exceptions to hedge against. The strongest special case is
  a single atomic mechanism: *"all X happens through ___"* — "all communication
  between computers happens through sending packets". Surface it where the domain
  really has one.
- **A real definition** — an actual one, not a list of properties dressed as one.
  "Things that tend to be true of X" anchors nothing.

Do not manufacture either where the topic does not offer one.

---

## Principle 2 — "How could I have discovered this?"

A fact with no visible reason it *had* to be this way feels arbitrary, and an
arbitrary-feeling fact triggers exactly the hedge described above. The fix is to
make it feel discovered rather than announced.

Walk the path they could plausibly have walked themselves. Every step motivated:

- Start with why we are here at all. What problem sends anyone down this road?
- Motivate the intermediate moves too — not just the destination. Why reach for
  *this* construction, *this* rearrangement, *this* definition? What would have
  made someone try it? An unmotivated middle step is where the sense of
  inevitability breaks.
- Then make the dependency explicit: say which established thing this new one
  rests on. That edge is the deliverable.

3Blue1Brown is the reference standard for this. Nothing appears from nowhere;
every move looks like something the learner might have reached for.

The failure to watch for in yourself: asserting something true and moving on
because it *is* true. Truth is not the bar. If they would have to take it on
faith, either motivate it or ground it in something already standing.

### Socratic or expository — pick per stretch

- **Socratic** — pose the problem and let them try before you reveal. More
  effortful, and it locks in harder. Default here when they can plausibly reason
  their way to it from what they already hold.
- **Expository** — narrate the motivated path yourself. Use when the topic is out
  of cold-reasoning reach, or when they are tired and want it delivered.

This is a choice about who speaks first, not about whether you measure. A Socratic
step with a definite right answer is still a graded question — ask it with `quiz`,
commit to `correct_index`, log it. "They were discovering it" is not a reason to
skip the grade. Only genuine no-right-answer forks — what they want next, which
direction to take — are ungradable, and those are not quiz material at all.

---

## How this shows up in the loop

Phase 3 walks the graph one node at a time. Every node — foundations included —
gets the same four moves:

1. **Motivate.** Why this, why now, what does it unlock. Foundations need this as
   much as derived steps; do not assert one just because it is true.
2. **Establish.** A foundation: state it plainly, no caveats, surface the atomic
   unit if there is one. A derived step: build it from what is already standing,
   by a motivated move.
3. **Connect.** Name the edge out loud. This is the part that turns a fact into
   understanding, and it is the part most often skipped.
4. **Check.** Quiz it. If it did not land, that node is not solid, and nothing goes
   on top of it until it is.

Do not front-load every foundation at the start and stop checking. A new
unconditional truth needed in the middle of a session runs the same four moves as
anything else.

---

*The two principles here come from [amosblomqvist/learn](https://github.com/amosblomqvist/learn),
a personal learning system built on the same method this repo implements. Restated
in this repo's own words and wired into its probe-measure-teach loop.*
