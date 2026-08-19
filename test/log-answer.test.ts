/**
 * The shell fallback and the quiz tool must write the same shape, or a learner
 * who probes in Claude Code and teaches in pi has two half-maps instead of one.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readAttempts, summarize, verdict } from "../extensions/shared/probe-log.ts";

const SKILL_DIR = fileURLToPath(new URL("../skills/teach/", import.meta.url));

/**
 * The skill is SKILL.md plus its references, and which file a rule lives in is an
 * editorial decision that should not break a test. What must hold is that the
 * rule is somewhere the model will read.
 */
function wholeSkill(): string {
  const refs = readdirSync(join(SKILL_DIR, "references"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(join(SKILL_DIR, "references", f), "utf8"));
  return [readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8"), ...refs].join("\n");
}

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
  const skill = wholeSkill();
  assert.match(skill, /<this-skill-dir>\/scripts\/log-answer\.sh/);
  assert.doesNotMatch(skill, /^\s*skills\/teach\/scripts\/log-answer\.sh /m);
  assert.match(skill, /probe-log\.jsonl/, "the raw JSONL fallback is documented too");
});

test("log-answer.sh records the correct answer and the reason, so a debrief outlives the session", async () => {
  await withTempDir((dir) => {
    log(dir, [
      "db/isolation",
      "wrong",
      "What does write skew need?",
      "probe",
      "--answer",
      "Two transactions reading the same set and writing disjoint rows",
      "--why",
      'Snapshot isolation checks write-write conflicts only, so a constraint over rows neither transaction wrote survives.',
    ]);

    const [attempt] = readAttempts(dir);
    assert.equal(attempt?.correctAnswer, "Two transactions reading the same set and writing disjoint rows");
    assert.match(attempt?.rationale ?? "", /write-write conflicts only/);
    assert.equal(attempt?.phase, "probe");
    assert.equal(attempt?.correct, false);
  });
});

test("the flags are optional, and an empty one reads back as absent rather than an empty string", async () => {
  await withTempDir((dir) => {
    log(dir, ["algebra/groups", "correct", "What is a coset?"]);
    const [attempt] = readAttempts(dir);
    assert.equal(attempt?.correctAnswer, undefined);
    assert.equal(attempt?.rationale, undefined);
  });
});

test("a flag missing its value is an error, not a line logged with the next flag as its text", async () => {
  await withTempDir((dir) => {
    assert.throws(() => log(dir, ["strand", "correct", "q", "--answer"]));
    assert.throws(() => log(dir, ["strand", "correct", "q", "--nonsense", "x"]));
    assert.deepEqual(readAttempts(dir), []);
  });
});

test("the skill requires the reason on every logged question", async () => {
  const skill = wholeSkill();
  assert.match(skill, /--answer/);
  assert.match(skill, /--why/);
  assert.match(skill, /--reason/, "grading the reason rather than the letter is part of the contract");
});

test("every reference the skill points at exists, and every reference is pointed at", async () => {
  // Progressive disclosure only works if the map is accurate. A link to a file
  // that is not there reads as a rule the model may skip; a file nothing links to
  // is a rule the model never sees.
  const index = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  const linked = new Set([...index.matchAll(/references\/([a-z-]+\.md)/g)].map((m) => m[1]!));
  const present = new Set(readdirSync(join(SKILL_DIR, "references")).filter((f) => f.endsWith(".md")));

  assert.deepEqual([...linked].sort(), [...present].sort());
  assert.ok(present.size > 0, "the references directory is not optional");
});

test("the load-bearing rules stay in SKILL.md, not only in a reference", async () => {
  // These are the ones that stop being a measurement if they are missed, so they
  // are stated in the file that is always read, whatever else gets skipped.
  const index = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  assert.match(index, /[Cc]ommit before/);
  assert.match(index, /Log every graded question/);
  assert.match(index, /One question at a time/);
  assert.match(index, /Grade the reason, not the letter/);
});

test("log-answer.sh rejects an unknown result rather than logging a wrong measurement", async () => {
  await withTempDir((dir) => {
    assert.throws(() => log(dir, ["strand", "maybe", "q"]));
    assert.deepEqual(readAttempts(dir), []);
  });
});
