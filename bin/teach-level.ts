#!/usr/bin/env node
/**
 * Where is this learner working, and should the next question be harder?
 *
 * The skill calls this every ten questions. It exists as a script so the answer
 * is computed from the log rather than from the model's memory of the session —
 * a model that has just asked ten questions is the last thing that should be
 * asked to grade its own calibration.
 *
 * Usage: teach-level.ts [--dir <project>] [--window 10] [--json]
 */

import { parseArgs } from "node:util";
import { DEPTH_NAMES, formatSummary, readAttempts, readLevel, summarize, verdict } from "../extensions/shared/probe-log.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: process.cwd() },
    window: { type: "string", default: "10" },
    json: { type: "boolean", default: false },
  },
});

const window = Number.parseInt(values.window!, 10);
if (!Number.isFinite(window) || window < 1) {
  console.error(`--window must be a positive integer (got: ${values.window})`);
  process.exit(64);
}

const attempts = readAttempts(values.dir!);
if (attempts.length === 0) {
  console.error(`No probe log under ${values.dir}. Nothing measured yet.`);
  process.exit(69);
}

const now = Date.now();
const rows = summarize(attempts);
const reading = readLevel(attempts, window);

if (values.json) {
  console.log(JSON.stringify({ total: attempts.length, reading, strands: rows.map((r) => ({ ...r, verdict: verdict(r, now) })) }, null, 2));
} else {
  const untagged = attempts.filter((a) => a.depth === undefined).length;
  console.log(`${attempts.length} questions logged, last ${Math.min(window, attempts.length)} counted.`);
  console.log(
    reading.level === 0
      ? "Level: not yet established."
      : `Level: ${reading.level} (${DEPTH_NAMES[reading.level]}) — held at ${Math.round((2 / 3) * 100)}% or better.`,
  );
  console.log(`Next question: ${reading.move.toUpperCase()} — ${reading.reason}`);
  if (untagged > 0) console.log(`(${untagged} questions carry no depth and cannot count toward the level.)`);
  console.log("");
  for (const line of formatSummary(rows, now)) console.log(`  ${line}`);
}
