/**
 * End-to-end on the quiz tool with a stand-in for the harness.
 *
 * The contract being protected: the model learns only whether the learner was
 * right and what they picked, and every question reaches the log. If either half
 * breaks, the system stops being a measurement and nobody notices.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import quizExtension from "../extensions/quiz/index.ts";
import { readDecisions } from "../extensions/shared/decisions.ts";
import { readAttempts } from "../extensions/shared/probe-log.ts";

interface Registered {
  tools: Map<string, any>;
  commands: Map<string, any>;
  widgets: Map<string, string[] | undefined>;
  notifications: Array<{ message: string; type?: string }>;
}

function harness(): { pi: any; registered: Registered } {
  const registered: Registered = {
    tools: new Map(),
    commands: new Map(),
    widgets: new Map(),
    notifications: [],
  };
  const pi = {
    registerTool: (def: any) => registered.tools.set(def.name, def),
    registerCommand: (name: string, def: any) => registered.commands.set(name, def),
  };
  return { pi, registered };
}

function context(cwd: string, registered: Registered, answer: string | undefined) {
  return {
    cwd,
    ui: {
      select: async (_title: string, options: string[]) => {
        if (answer === undefined) return undefined;
        const match = options.find((o) => o === answer || o.endsWith(`. ${answer}`));
        assert.ok(match, `the harness offered no option matching "${answer}": ${options.join(" | ")}`);
        return match;
      },
      notify: (message: string, type?: string) => registered.notifications.push({ message, type }),
      setWidget: (key: string, content: string[] | undefined) => registered.widgets.set(key, content),
      setStatus: () => {},
    },
  } as any;
}

const QUESTION = {
  question: "What does a 1-form take as input?",
  options: ["A vector", "A scalar", "A matrix"],
  correct_index: 0,
  strand: "differential-forms/one-forms",
  rationale: "A 1-form is a linear map from vectors to scalars.",
};

/** Await the body before cleaning up — an async body outliving its own directory is a silent test.  */
async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "megateach-quiz-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("quiz registers the tools and command the skill depends on", () => {
  const { pi, registered } = harness();
  quizExtension(pi);
  assert.deepEqual([...registered.tools.keys()].sort(), ["ask", "quiz", "recall"]);
  assert.ok(registered.commands.has("probe"));
  assert.equal(registered.tools.get("quiz").executionMode, "sequential");
  // Both put a dialog in front of the learner, so neither may run concurrently
  // with anything else that might do the same.
  assert.equal(registered.tools.get("ask").executionMode, "sequential");
});

test("ask is not a measurement: it takes no correct answer and demands a reason it has none", () => {
  const { pi, registered } = harness();
  quizExtension(pi);
  const props = registered.tools.get("ask").parameters.properties;
  assert.ok(!("correct_index" in props), "ask must not accept a correct answer");
  assert.ok(!("strand" in props), "ask must not touch a strand — strands are measured");
  assert.ok("why_ungraded" in props, "ask must force a statement that there is no correct answer");
});

const CHOICE = {
  question: "What do you want to be able to do at the end?",
  options: ["Read a paper that uses this", "Implement it yourself"],
  why_ungraded: "Both are legitimate destinations; only the learner knows which one they want.",
  kind: "goal" as const,
};

test("a choice is recorded where it cannot be counted as knowledge", async () => {
  await withTempDir(async (dir) => {
    const { pi, registered } = harness();
    quizExtension(pi);
    const ctx = context(dir, registered, "Implement it yourself");

    const result = await registered.tools.get("ask").execute("id", CHOICE, undefined, undefined, ctx);

    assert.match(result.content[0].text, /Implement it yourself/);
    assert.match(result.content[0].text, /not a measurement/);
    assert.equal(result.details.answered, true);

    // The point of the whole separation: nothing reached the measurement log.
    assert.deepEqual(readAttempts(dir), []);
    assert.equal(readDecisions(dir).length, 1);
    assert.equal(readDecisions(dir)[0]!.answer, "Implement it yourself");
  });
});

test("a learner who wants none of the options is not forced into one", async () => {
  await withTempDir(async (dir) => {
    const { pi, registered } = harness();
    quizExtension(pi);
    const ctx = context(dir, registered, "Something else — let me type it");

    const result = await registered.tools.get("ask").execute("id", CHOICE, undefined, undefined, ctx);

    assert.equal(result.details.answered, false);
    assert.match(result.content[0].text, /their own words/);
    assert.equal(readDecisions(dir)[0]!.answer, null);
  });
});

test("dismissing an ungraded question is not re-asked and not recorded as a choice", async () => {
  await withTempDir(async (dir) => {
    const { pi, registered } = harness();
    quizExtension(pi);
    const ctx = context(dir, registered, undefined);

    const result = await registered.tools.get("ask").execute("id", CHOICE, undefined, undefined, ctx);

    assert.equal(result.details.answered, false);
    assert.match(result.content[0].text, /Do not re-ask/);
    assert.equal(readDecisions(dir)[0]!.answer, null);
  });
});

test("recall hands back the goal alongside the map, so it is not asked for twice", async () => {
  await withTempDir(async (dir) => {
    const { pi, registered } = harness();
    quizExtension(pi);
    const ctx = context(dir, registered, "Read a paper that uses this");

    await registered.tools.get("ask").execute("id", CHOICE, undefined, undefined, ctx);
    const recalled = await registered.tools
      .get("recall")
      .execute("id", {}, undefined, undefined, ctx);

    assert.match(recalled.content[0].text, /Read a paper that uses this/);
    assert.equal(recalled.details.decisions, 1);
  });
});

test("a correct answer grades right and reaches the log", async () => {
  await withTempDir(async (dir) => {
    const { pi, registered } = harness();
    quizExtension(pi);
    const result = await registered.tools
      .get("quiz")
      .execute("id", QUESTION, undefined, undefined, context(dir, registered, "A vector"));

    assert.match(result.content[0].text, /answered CORRECTLY/);
    assert.match(result.content[0].text, /Probe deeper|reaches at least this far/);
    assert.equal(result.details.correct, true);

    const [logged] = readAttempts(dir);
    assert.equal(logged?.strand, "differential-forms/one-forms");
    assert.equal(logged?.correct, true);
    assert.equal(logged?.answerIndex, 0);
    assert.equal(logged?.phase, "probe");
  });
});

test("a wrong answer tells the model to probe shallower and records what they picked", async () => {
  await withTempDir(async (dir) => {
    const { pi, registered } = harness();
    quizExtension(pi);
    const result = await registered.tools
      .get("quiz")
      .execute("id", QUESTION, undefined, undefined, context(dir, registered, "A matrix"));

    assert.match(result.content[0].text, /INCORRECTLY/);
    assert.match(result.content[0].text, /A matrix/);
    assert.match(result.content[0].text, /Probe shallower/);

    const [logged] = readAttempts(dir);
    assert.equal(logged?.correct, false);
    assert.equal(logged?.admitted, false);
    assert.equal(logged?.answer, "A matrix");
  });
});

test('"I don\'t know" is recorded as admitted, not as a wrong guess', async () => {
  await withTempDir(async (dir) => {
    const { pi, registered } = harness();
    quizExtension(pi);
    const result = await registered.tools
      .get("quiz")
      .execute("id", QUESTION, undefined, undefined, context(dir, registered, "I don't know"));

    assert.match(result.content[0].text, /did not answer/);
    const [logged] = readAttempts(dir);
    assert.equal(logged?.admitted, true);
    assert.equal(logged?.answerIndex, null);
  });
});

test("dismissing the dialog is treated as not knowing, not as a crash", async () => {
  await withTempDir(async (dir) => {
    const { pi, registered } = harness();
    quizExtension(pi);
    const result = await registered.tools
      .get("quiz")
      .execute("id", QUESTION, undefined, undefined, context(dir, registered, undefined));
    assert.equal(result.details.admitted, true);
    assert.equal(readAttempts(dir).length, 1);
  });
});

test("an out-of-range correct_index throws instead of silently mis-grading", async () => {
  await withTempDir(async (dir) => {
    const { pi, registered } = harness();
    quizExtension(pi);
    await assert.rejects(
      () =>
        registered.tools
          .get("quiz")
          .execute(
            "id",
            { ...QUESTION, correct_index: 7 },
            undefined,
            undefined,
            context(dir, registered, "A vector"),
          ),
      /out of range/,
    );
    assert.deepEqual(readAttempts(dir), [], "a question that could not be graded is not logged");
  });
});

test("the probe reveals nothing — not the answer, not the reason", async () => {
  // Phase 1 forbids teaching, and revealing mid-probe also contaminates every
  // later question on the strand: the learner now knows something they did not
  // walk in with, so the measurement stops measuring what they brought.
  for (const answer of ["A vector", "A matrix", "I don't know", undefined]) {
    await withTempDir(async (dir) => {
      const { pi, registered } = harness();
      quizExtension(pi);
      const result = await registered.tools
        .get("quiz")
        .execute("id", QUESTION, undefined, undefined, context(dir, registered, answer));

      const seen = registered.notifications.at(-1)!.message;
      const label = `answer: ${answer ?? "(dismissed)"}`;
      assert.doesNotMatch(seen, /linear map from vectors to scalars/, label);
      assert.doesNotMatch(seen, /A vector/, label);
      assert.match(seen, /^Correct\.|^Not correct\.|^No answer recorded\./, label);
      assert.match(result.content[0].text, /shown neither the correct answer nor the rationale/, label);
    });
  }
});

test("the teach phase does reveal both, and says so accurately", async () => {
  // Here the point is the opposite: a wrong answer during teaching is where the
  // reason matters most, and the model is told the learner has heard it.
  for (const answer of ["A matrix", "I don't know", "A vector"]) {
    await withTempDir(async (dir) => {
      const { pi, registered } = harness();
      quizExtension(pi);
      const result = await registered.tools
        .get("quiz")
        .execute(
          "id",
          { ...QUESTION, phase: "teach" },
          undefined,
          undefined,
          context(dir, registered, answer),
        );

      const label = `answer: ${answer}`;
      assert.match(registered.notifications.at(-1)!.message, /linear map from vectors to scalars/, label);
      assert.match(result.content[0].text, /was shown the correct answer and this rationale/, label);
    });
  }
});

test("a negative correct_index throws instead of grading everyone wrong", async () => {
  // TypeBox's minimum: 0 only guards the model-driven path. A replayed session or
  // a direct call slips through, and then every learner is marked incorrect
  // against an option that does not exist.
  await withTempDir(async (dir) => {
    const { pi, registered } = harness();
    quizExtension(pi);
    await assert.rejects(
      () =>
        registered.tools
          .get("quiz")
          .execute(
            "id",
            { ...QUESTION, correct_index: -3 },
            undefined,
            undefined,
            context(dir, registered, "A vector"),
          ),
      /out of range/,
    );
    assert.deepEqual(readAttempts(dir), []);
  });
});

test("the probe says right or wrong, and still says nothing about what the answer was", async () => {
  // Answering into silence is indistinguishable from guessing into a void. The
  // verdict is not content — the answer is — so the learner gets one and not the
  // other until the strand closes.
  for (const [answer, expected] of [
    ["A vector", /^Correct\./],
    ["A matrix", /^Not correct\./],
    ["I don't know", /^No answer recorded\./],
  ] as const) {
    await withTempDir(async (dir) => {
      const { pi, registered } = harness();
      quizExtension(pi);
      await registered.tools
        .get("quiz")
        .execute("id", QUESTION, undefined, undefined, context(dir, registered, answer));

      const seen = registered.notifications.at(-1)!.message;
      const label = `answer: ${answer}`;
      assert.match(seen, expected, label);
      assert.doesNotMatch(seen, /linear map from vectors to scalars/, label);
      assert.doesNotMatch(seen, /A vector/, label);
    });
  }
});

test("recall reports the map back to the model, and /probe renders it for the human", async () => {
  await withTempDir(async (dir) => {
    const { pi, registered } = harness();
    quizExtension(pi);
    const ctx = context(dir, registered, "A vector");
    await registered.tools.get("quiz").execute("id", QUESTION, undefined, undefined, ctx);

    const recalled = await registered.tools.get("recall").execute("id", {}, undefined, undefined, ctx);
    assert.match(recalled.content[0].text, /differential-forms\/one-forms/);

    const filtered = await registered.tools
      .get("recall")
      .execute("id", { strand_prefix: "algebra" }, undefined, undefined, ctx);
    assert.match(filtered.content[0].text, /No prior measurements/);

    await registered.commands.get("probe").handler("", ctx);
    const widget = registered.widgets.get("teach-probe")!;
    assert.match(widget[0]!, /1 question/);
    assert.ok(widget.some((line) => line.includes("differential-forms/one-forms")));

    await registered.commands.get("probe").handler("clear", ctx);
    assert.equal(registered.widgets.get("teach-probe"), undefined);
  });
});
