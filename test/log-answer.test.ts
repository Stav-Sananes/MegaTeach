/**
 * The shell fallback and the quiz tool must write the same shape, or a learner
 * who probes in Claude Code and teaches in pi has two half-maps instead of one.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readAttempts, summarize, verdict } from "../extensions/shared/probe-log.ts";

const SCRIPT = fileURLToPath(new URL("../skills/teach/scripts/log-answer.sh", import.meta.url));

/** Await the body before cleaning up — an async body outliving its own directory is a silent test.  */
async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "megateach-sh-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function log(dir: string, args: string[]): void {
  execFileSync("bash", [SCRIPT, ...args], { cwd: dir, encoding: "utf8" });
}

test("log-answer.sh writes lines the TypeScript parser accepts", async () => {
  await withTempDir((dir) => {
    log(dir, ["calculus/limits", "correct", "What is a limit?"]);
    log(dir, ["calculus/limits", "wrong", "Epsilon-delta?", "teach"]);
    log(dir, ["algebra/groups", "unknown", "What is a coset?"]);

    const attempts = readAttempts(dir);
    assert.equal(attempts.length, 3);
    assert.deepEqual(
      attempts.map((a) => [a.strand, a.correct, a.admitted, a.phase]),
      [
        ["calculus/limits", true, false, "probe"],
        ["calculus/limits", false, false, "teach"],
        ["algebra/groups", false, true, "probe"],
      ],
    );

    const rows = summarize(attempts);
    assert.equal(rows.length, 2);
    assert.equal(verdict(rows.find((r) => r.strand === "algebra/groups")!, Date.now()), "absent");
  });
});

test("log-answer.sh escapes quotes, backslashes, and newlines in the question", async () => {
  await withTempDir((dir) => {
    log(dir, ["notation", "correct", 'Does \\alpha mean "first"?\nSecond line.']);
    const attempts = readAttempts(dir);
    assert.equal(attempts.length, 1, "an unescaped quote would have produced an unparseable line");
    assert.equal(attempts[0]?.question, 'Does \\alpha mean "first"?\nSecond line.');
  });
});

test("the skill tells the model to invoke the script by its own directory", async () => {
  // The skill is installed outside the learner's project (~/.claude/skills/teach),
  // and Claude Code runs with cwd = the learner's project. A repo-relative command
  // resolves to nothing there, and every probe answer is silently lost.
  const skill = readFileSync(fileURLToPath(new URL("../skills/teach/SKILL.md", import.meta.url)), "utf8");
  assert.match(skill, /<this-skill-dir>\/scripts\/log-answer\.sh/);
  assert.doesNotMatch(skill, /^\s*skills\/teach\/scripts\/log-answer\.sh /m);
  assert.match(skill, /probe-log\.jsonl/, "the raw JSONL fallback is documented too");
});

test("log-answer.sh rejects an unknown result rather than logging a wrong measurement", async () => {
  await withTempDir((dir) => {
    assert.throws(() => log(dir, ["strand", "maybe", "q"]));
    assert.deepEqual(readAttempts(dir), []);
  });
});
