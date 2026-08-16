import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ageInDays,
  appendAttempt,
  formatForModel,
  formatSummary,
  parseAttempts,
  readAttempts,
  summarize,
  verdict,
  type ProbeAttempt,
} from "../extensions/shared/probe-log.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-01-31T00:00:00.000Z");

function attempt(over: Partial<ProbeAttempt> = {}): ProbeAttempt {
  return {
    ts: new Date(NOW).toISOString(),
    strand: "calculus/limits",
    phase: "probe",
    question: "q",
    options: ["a", "b"],
    correctIndex: 0,
    answerIndex: 0,
    answer: "a",
    correct: true,
    admitted: false,
    ...over,
  };
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "megateach-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("append then read round-trips an attempt", () => {
  withTempDir((dir) => {
    assert.equal(appendAttempt(dir, attempt({ strand: "algebra/groups" })), true);
    const read = readAttempts(dir);
    assert.equal(read.length, 1);
    assert.equal(read[0]?.strand, "algebra/groups");
    assert.equal(read[0]?.correct, true);
    assert.ok(Date.parse(read[0]!.ts) > 0, "append stamps a parseable timestamp");
  });
});

test("reading a missing log yields no attempts rather than throwing", () => {
  withTempDir((dir) => {
    assert.deepEqual(readAttempts(dir), []);
  });
});

test("a truncated line does not blind the parser to the rest", () => {
  const good = JSON.stringify(attempt());
  const parsed = parseAttempts(`${good}\n{"strand":"broken`);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.strand, "calculus/limits");
});

test("lines missing the fields we aggregate on are dropped", () => {
  const parsed = parseAttempts(['{"strand":"x"}', '{"correct":true}', "  ", "{}"].join("\n"));
  assert.deepEqual(parsed, []);
});

test("summarize counts right, wrong, and admitted separately", () => {
  const rows = summarize([
    attempt({ correct: true }),
    attempt({ correct: false, admitted: false }),
    attempt({ correct: false, admitted: true }),
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { right: rows[0]!.right, wrong: rows[0]!.wrong, admitted: rows[0]!.admitted, total: rows[0]!.total },
    { right: 1, wrong: 1, admitted: 1, total: 3 },
  );
});

test("summarize orders strands most-recently-measured first", () => {
  const rows = summarize([
    attempt({ strand: "old", ts: new Date(NOW - 10 * DAY).toISOString() }),
    attempt({ strand: "new", ts: new Date(NOW - 1 * DAY).toISOString() }),
  ]);
  assert.deepEqual(rows.map((r) => r.strand), ["new", "old"]);
});

test("lastCorrect tracks the newest attempt, not the last line read", () => {
  const rows = summarize([
    attempt({ ts: new Date(NOW).toISOString(), correct: false }),
    attempt({ ts: new Date(NOW - 5 * DAY).toISOString(), correct: true }),
  ]);
  assert.equal(rows[0]?.lastCorrect, false);
});

test("verdict: recent and mostly right is solid", () => {
  const rows = summarize([attempt(), attempt(), attempt(), attempt({ correct: false })]);
  assert.equal(verdict(rows[0]!, NOW), "solid");
});

test("verdict: a boundary-finding probe that ends wrong still reads solid", () => {
  // Binary search must end in a wrong answer — that is how it locates the edge.
  const rows = summarize([attempt(), attempt(), attempt({ correct: false })]);
  assert.equal(verdict(rows[0]!, NOW), "solid");
});

test("verdict: mostly wrong is shaky regardless of age", () => {
  const rows = summarize([attempt({ correct: false }), attempt({ correct: false }), attempt()]);
  assert.equal(verdict(rows[0]!, NOW), "shaky");
  assert.equal(verdict(rows[0]!, NOW + 90 * DAY), "shaky");
});

test("verdict: never right is absent, whether admitted or guessed wrong", () => {
  assert.equal(verdict(summarize([attempt({ correct: false, admitted: true })])[0]!, NOW), "absent");
  assert.equal(verdict(summarize([attempt({ correct: false })])[0]!, NOW), "absent");
});

test("verdict: correct but old is stale, so the tutor re-probes instead of assuming", () => {
  const rows = summarize([attempt({ ts: new Date(NOW - 45 * DAY).toISOString() })]);
  assert.equal(verdict(rows[0]!, NOW), "stale");
  assert.equal(verdict(rows[0]!, NOW, 90), "solid", "the staleness horizon is configurable");
});

test("ageInDays floors to whole days and never goes negative", () => {
  assert.equal(ageInDays(new Date(NOW - 3.9 * DAY).toISOString(), NOW), 3);
  assert.equal(ageInDays(new Date(NOW + 5 * DAY).toISOString(), NOW), 0);
  assert.equal(ageInDays("not a date", NOW), Number.POSITIVE_INFINITY);
});

test("formatSummary says something useful when nothing is logged", () => {
  assert.deepEqual(formatSummary([], NOW), ["No questions logged yet."]);
});

test("formatSummary aligns strands and names the verdict", () => {
  const rows = summarize([attempt({ strand: "a/b" }), attempt({ strand: "much/longer/strand" })]);
  const lines = formatSummary(rows, NOW);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.includes("solid")));
  assert.equal(new Set(lines.map((l) => l.indexOf("1/1"))).size, 1, "columns line up");
});

test("formatForModel tells the model to re-probe stale strands", () => {
  const rows = summarize([attempt({ ts: new Date(NOW - 60 * DAY).toISOString() })]);
  const text = formatForModel(rows, NOW);
  assert.match(text, /stale/);
  assert.match(text, /re-probe/);
});

test("formatForModel is explicit when there is no history at all", () => {
  assert.match(formatForModel([], NOW), /Probe from scratch/);
});
