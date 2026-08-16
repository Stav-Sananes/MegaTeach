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
  assert.deepEqual([...registered.tools.keys()].sort(), ["quiz", "recall"]);
  assert.ok(registered.commands.has("probe"));
  assert.equal(registered.tools.get("quiz").executionMode, "sequential");
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

test("the rationale reaches the learner only after they answer", async () => {
  await withTempDir(async (dir) => {
    const { pi, registered } = harness();
    quizExtension(pi);
    await registered.tools
      .get("quiz")
      .execute("id", QUESTION, undefined, undefined, context(dir, registered, "A vector"));
    assert.match(registered.notifications.at(-1)!.message, /linear map from vectors to scalars/);
  });
});

test("the rationale is shown on every outcome, because the result claims it was", async () => {
  // The tool tells the model "Rationale shown to them". A wrong answer is where
  // the reason matters most; suppressing it there makes that line a lie, and the
  // model then re-explains a step the learner never had explained.
  for (const answer of ["A matrix", "I don't know", undefined]) {
    await withTempDir(async (dir) => {
      const { pi, registered } = harness();
      quizExtension(pi);
      const result = await registered.tools
        .get("quiz")
        .execute("id", QUESTION, undefined, undefined, context(dir, registered, answer));

      assert.match(result.content[0].text, /Rationale shown to them/);
      assert.match(
        registered.notifications.at(-1)!.message,
        /linear map from vectors to scalars/,
        `answer: ${answer ?? "(dismissed)"}`,
      );
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
