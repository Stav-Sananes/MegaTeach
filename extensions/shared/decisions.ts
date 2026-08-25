/**
 * The decisions log — what the learner chose, as opposed to what they knew.
 *
 * Deliberately a separate file from the probe log, and the separation is the
 * point. A graded question measures the learner; an ungraded one records a
 * preference. Mixing them is not untidy, it is corrupting: a "which of these do
 * you want to learn" answer written into `probe-log.jsonl` needs a
 * `correctIndex`, and whatever integer gets invented for it then feeds the
 * level ratchet, the strand verdicts, and the map. One arbitrary number and the
 * tutor is teaching above the learner's real edge while the log insists they
 * are fine.
 *
 * So: two files, one rule. If there is a correct answer it goes in the probe
 * log. If there is not, it goes here and is never counted.
 *
 * Same dependency-free shape as probe-log.ts — `node:fs` and nothing else — so
 * every pure function here is unit-testable with no build step.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LOG_DIR = ".teach";
export const LOG_FILE = "decisions.jsonl";

/** What kind of fork this was. Kept coarse: enough to sort by, not a taxonomy. */
export type DecisionKind = "goal" | "direction" | "preference";

export interface Decision {
  ts: string;
  kind: DecisionKind;
  question: string;
  options: string[];
  /** What they picked, in words. `null` when they dismissed or chose to type instead. */
  answer: string | null;
  /**
   * The model's own statement of why this had no correct answer, required at
   * call time. It is the counterpart of `correctIndex` on a graded question:
   * one forces commitment to an answer, the other forces an admission that
   * there is not one. A question whose justification reads like a rationale is
   * a graded question in the wrong file, and this field is what makes that
   * visible later.
   */
  whyUngraded: string;
  topic?: string;
}

export function logPath(cwd: string): string {
  return join(cwd, LOG_DIR, LOG_FILE);
}

export function appendDecision(cwd: string, decision: Omit<Decision, "ts"> & { ts?: string }): boolean {
  const path = logPath(cwd);
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), ...decision })}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function readDecisions(cwd: string): Decision[] {
  const path = logPath(cwd);
  if (!existsSync(path)) return [];
  try {
    return parseDecisions(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

/**
 * Tolerant by design: a half-written final line from an interrupted session
 * must not take the whole history with it. Unparseable lines are dropped, not
 * thrown on.
 */
export function parseDecisions(raw: string): Decision[] {
  const out: Decision[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<Decision>;
      if (typeof parsed.ts !== "string" || typeof parsed.question !== "string") continue;
      out.push({
        ts: parsed.ts,
        kind: parsed.kind === "goal" || parsed.kind === "direction" ? parsed.kind : "preference",
        question: parsed.question,
        options: Array.isArray(parsed.options) ? parsed.options : [],
        answer: typeof parsed.answer === "string" ? parsed.answer : null,
        whyUngraded: typeof parsed.whyUngraded === "string" ? parsed.whyUngraded : "",
        topic: typeof parsed.topic === "string" ? parsed.topic : undefined,
      });
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * The most recent answered decision of each kind.
 *
 * Only the latest matters: a learner who said "start with the physics" in
 * March and "no, the algebra first" in April wants the algebra. Older entries
 * stay in the file as history and are not surfaced, because a tutor reciting
 * a superseded preference is worse than one that never knew it.
 */
export function latestByKind(decisions: readonly Decision[]): Map<DecisionKind, Decision> {
  const out = new Map<DecisionKind, Decision>();
  for (const d of decisions) {
    if (d.answer === null) continue;
    const seen = out.get(d.kind);
    if (!seen || Date.parse(d.ts) >= Date.parse(seen.ts)) out.set(d.kind, d);
  }
  return out;
}

const KIND_LABEL: Record<DecisionKind, string> = {
  goal: "Goal",
  direction: "Direction",
  preference: "Preference",
};

/**
 * What a session should be told about choices already made, before it asks
 * again. Empty string when there is nothing — the caller appends this to the
 * measured map, and an empty section is noise.
 */
export function formatForModel(decisions: readonly Decision[], nowMs: number): string {
  const latest = latestByKind(decisions);
  if (latest.size === 0) return "";

  const lines = ["Choices this learner has already made (not measurements — never re-ask as a graded question):"];
  for (const kind of ["goal", "direction", "preference"] as const) {
    const d = latest.get(kind);
    if (!d) continue;
    const days = Math.floor((nowMs - Date.parse(d.ts)) / 86_400_000);
    const age = Number.isFinite(days) ? (days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`) : "unknown";
    lines.push(`- ${KIND_LABEL[kind]}: ${d.answer} (${age})`);
  }
  lines.push(
    "A choice older than a few weeks is worth confirming in one sentence, not re-asking from scratch.",
  );
  return lines.join("\n");
}
