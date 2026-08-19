/**
 * The ratchet: a level goes up only when the log says it earned it, and comes
 * down the moment it did not. Reading it off the model's impression of how the
 * session felt is what this replaces.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { type ProbeAttempt, readLevel } from "../extensions/shared/probe-log.ts";

const SCRIPT = fileURLToPath(new URL("../skills/teach/scripts/log-answer.sh", import.meta.url));

function at(depth: number, correct: boolean): ProbeAttempt {
  return {
    ts: "2026-08-19T12:00:00.000Z",
    strand: "db/isolation",
    phase: "probe",
    question: "q",
    options: [],
    correctIndex: -1,
    answerIndex: null,
    answer: "",
    correct,
    admitted: false,
    depth,
  };
}

test("holding a depth moves the next question up", () => {
  const reading = readLevel([at(2, true), at(2, true), at(2, true)]);
  assert.equal(reading.move, "up");
  assert.equal(reading.level, 2);
});

test("missing at a depth moves it down, and the level stays where it was held", () => {
  const reading = readLevel([at(2, true), at(2, true), at(4, false), at(4, false)]);
  assert.equal(reading.move, "down");
  assert.equal(reading.level, 2, "depth 4 was never held, so it is not the level");
});

test("a split result at the working depth holds rather than guessing", () => {
  const reading = readLevel([at(3, true), at(3, false)]);
  assert.equal(reading.move, "hold");
});

test("only the recent window counts, so an hour-old run does not prop up the level", () => {
  const stale = Array.from({ length: 10 }, () => at(4, true));
  const now = Array.from({ length: 10 }, () => at(2, false));
  const reading = readLevel([...stale, ...now], 10);
  assert.equal(reading.level, 0, "nothing in the window is held");
  assert.equal(reading.move, "down");
});

test("untagged questions are ignored rather than counted at a guessed depth", async () => {
  const dir = mkdtempSync(join(tmpdir(), "megateach-level-"));
  try {
    execFileSync("bash", [SCRIPT, "db/isolation", "correct", "tagged", "probe", "--depth", "3"], { cwd: dir });
    execFileSync("bash", [SCRIPT, "db/isolation", "wrong", "untagged"], { cwd: dir });
    const { readAttempts } = await import("../extensions/shared/probe-log.ts");
    const attempts = readAttempts(dir);
    assert.deepEqual(attempts.map((a) => a.depth), [3, undefined]);
    assert.equal(readLevel(attempts).atLevel.total, 1, "the untagged miss must not drag the reading");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
