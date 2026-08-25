import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendDecision,
  formatForModel,
  latestByKind,
  logPath,
  parseDecisions,
  readDecisions,
  type Decision,
} from "../extensions/shared/decisions.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-01-31T00:00:00.000Z");

function decision(over: Partial<Decision> = {}): Decision {
  return {
    ts: new Date(NOW).toISOString(),
    kind: "goal",
    question: "What do you want to be able to do?",
    options: ["Read a paper", "Write the code"],
    answer: "Read a paper",
    whyUngraded: "Both are legitimate destinations; only the learner knows which.",
    ...over,
  };
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "megateach-decisions-"));
}

test("a decision round-trips through the file", () => {
  const dir = scratch();
  try {
    assert.equal(appendDecision(dir, decision()), true);
    const read = readDecisions(dir);
    assert.equal(read.length, 1);
    assert.equal(read[0]!.answer, "Read a paper");
    assert.equal(read[0]!.kind, "goal");
    assert.equal(read[0]!.whyUngraded, "Both are legitimate destinations; only the learner knows which.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("decisions land in their own file, never the probe log", () => {
  const dir = scratch();
  try {
    appendDecision(dir, decision());
    assert.match(logPath(dir), /\.teach\/decisions\.jsonl$/);
    assert.doesNotMatch(logPath(dir), /probe-log/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a half-written final line does not take the history with it", () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, ".teach"), { recursive: true });
    writeFileSync(
      logPath(dir),
      `${JSON.stringify(decision())}\n${JSON.stringify(decision({ answer: "Write the code" }))}\n{"ts":"2026-01`,
      "utf8",
    );
    const read = readDecisions(dir);
    assert.equal(read.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a line missing its timestamp or question is dropped, not guessed at", () => {
  const parsed = parseDecisions(
    [
      JSON.stringify(decision()),
      JSON.stringify({ kind: "goal", question: "no ts" }),
      JSON.stringify({ ts: new Date(NOW).toISOString(), kind: "goal" }),
    ].join("\n"),
  );
  assert.equal(parsed.length, 1);
});

test("an unrecognised kind falls back to preference rather than throwing", () => {
  const parsed = parseDecisions(JSON.stringify({ ...decision(), kind: "vibes" }));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.kind, "preference");
});

test("the latest answer of each kind wins, and unanswered ones do not count", () => {
  const latest = latestByKind([
    decision({ ts: new Date(NOW - 30 * DAY).toISOString(), answer: "Read a paper" }),
    decision({ ts: new Date(NOW - 1 * DAY).toISOString(), answer: "Write the code" }),
    decision({ ts: new Date(NOW).toISOString(), answer: null }),
    decision({ kind: "direction", answer: "Algebra first" }),
  ]);
  assert.equal(latest.get("goal")!.answer, "Write the code");
  assert.equal(latest.get("direction")!.answer, "Algebra first");
  assert.equal(latest.size, 2);
});

test("a superseded choice is not surfaced to the model", () => {
  const text = formatForModel(
    [
      decision({ ts: new Date(NOW - 60 * DAY).toISOString(), answer: "Read a paper" }),
      decision({ ts: new Date(NOW - 2 * DAY).toISOString(), answer: "Write the code" }),
    ],
    NOW,
  );
  assert.match(text, /Write the code/);
  assert.doesNotMatch(text, /Read a paper/);
});

test("nothing recorded produces no section at all", () => {
  assert.equal(formatForModel([], NOW), "");
  assert.equal(formatForModel([decision({ answer: null })], NOW), "");
});

test("the model is told how old a choice is, so it knows whether to reconfirm", () => {
  const today = formatForModel([decision({ ts: new Date(NOW).toISOString() })], NOW);
  assert.match(today, /today/);

  const yesterday = formatForModel([decision({ ts: new Date(NOW - DAY).toISOString() })], NOW);
  assert.match(yesterday, /1 day ago/);

  const old = formatForModel([decision({ ts: new Date(NOW - 45 * DAY).toISOString() })], NOW);
  assert.match(old, /45 days ago/);
});

test("the model is told these are choices, not measurements", () => {
  const text = formatForModel([decision()], NOW);
  assert.match(text, /not measurements/);
});

test("reading a directory that has never been taught in returns nothing", () => {
  const dir = scratch();
  try {
    assert.deepEqual(readDecisions(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
