# Contributing

## The one rule

**Do not send a pull request that changes how the tutor explains things.**

`PHILOSOPHY.md` exists so that pacing, formality, analogy, and struggle are the
learner's choice. A PR that makes the default style more like yours makes it less
like everybody else's. That is the exact problem this project exists to solve.

Improvements to *mechanism* are very welcome:

- The probe converges badly on some topic — show the log and say what it should
  have asked.
- The staleness horizon, the solid/shaky/absent thresholds, or the strand naming
  scheme are wrong. These are empirical claims and can be argued with evidence.
- A harness other than pi and Claude Code needs an adaptation row.
- Bugs, obviously.

## Setup

```bash
npm install
npm test           # node --test, no build step
npm run typecheck  # tsc --noEmit against the real pi types
npm run smoke      # a real pi session driven by a scripted provider
```

`npm run smoke` needs pi installed (`npm install -g --ignore-scripts
@earendil-works/pi-coding-agent`) and skips cleanly without it. It registers a
faux provider whose responses are scripted in `dev/smoke-faux.ts`, so a full
session runs with no model and no API key. Add a step there whenever you add a
tool: unit tests cannot catch a schema the harness rejects or a result that never
makes it back to the model.

Node ≥ 22.6 (the tests import `.ts` directly and rely on native type stripping).
pi loads the extensions through jiti, so there is nothing to compile at runtime.

## Working on the extensions

Point pi at your checkout and reload:

```bash
pi install /path/to/your/checkout
# in a session, after editing:
/reload
```

Pure logic belongs in `extensions/shared/`. That directory is dependency-free
except for `node:*`, which is what makes it testable without a harness — keep it
that way. Anything touching `ExtensionAPI` goes in the extension that uses it.

## Working on SKILL.md

The skill is the product. Changes there need evidence, not argument: run a real
session on a topic you do not know, keep the `.teach/probe-log.jsonl`, and say
what the old prompt did versus the new one. "This wording seems better" is not
reviewable.

## Style

- Comments explain *why*, never *what*. If a comment restates the code, delete it.
- Errors surface with enough context to act on. A tool that throws
  `Unknown agent "x". Available: a, b.` is worth three of one that throws `failed`.
- Logging is best-effort: a failed write must never take down a lesson in progress.
- Tests describe the behaviour they protect, not the function they call.

## Tests

Every change to `extensions/shared/` needs a test. The probe log is the only state
this system has; if it is wrong, the tutor is confidently wrong about a person.
