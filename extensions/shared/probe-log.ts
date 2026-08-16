/**
 * The probe log — the measurement substrate.
 *
 * Every graded question the tutor asks lands here as one JSONL line. Nothing
 * else in this project keeps state: the log is the learner map, and everything
 * downstream (the /probe widget, the `recall` tool, cross-session memory) is a
 * pure function of it.
 *
 * Kept dependency-free on purpose — `node:fs` and nothing else — so the pure
 * parts can be unit tested with the built-in test runner and no build step.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LOG_DIR = ".teach";
export const LOG_FILE = "probe-log.jsonl";

/** One graded question, as it was asked and as it was answered. */
export interface ProbeAttempt {
  /** ISO 8601. Set by `appendAttempt` if absent. */
  ts: string;
  /** Prerequisite strand, e.g. `linear-algebra/dual-spaces`. Free-form but hierarchical by convention. */
  strand: string;
  /** Which phase asked it. Probe questions map the learner; teach questions confirm a step landed. */
  phase: "probe" | "teach";
  question: string;
  options: string[];
  /** Committed before the learner answered. That commitment is what makes this a measurement. */
  correctIndex: number;
  /** null when the learner said "I don't know" or dismissed the dialog. */
  answerIndex: number | null;
  answer: string;
  correct: boolean;
  /** True when the learner explicitly admitted not knowing, as opposed to guessing wrong. */
  admitted: boolean;
  /** Optional topic the session is about, so one log can serve many subjects. */
  topic?: string;
}

/** What the log says about one strand. */
export interface StrandSummary {
  strand: string;
  right: number;
  wrong: number;
  admitted: number;
  total: number;
  /** ISO timestamp of the most recent attempt on this strand. */
  lastSeen: string;
  /** Result of the most recent attempt. */
  lastCorrect: boolean;
}

export function logPath(cwd: string): string {
  return join(cwd, LOG_DIR, LOG_FILE);
}

/**
 * Append one attempt. Best-effort: a question must never fail because the disk
 * is unhappy, so this swallows write errors and reports failure via its return
 * value instead of throwing into the middle of a lesson.
 */
export function appendAttempt(cwd: string, attempt: Omit<ProbeAttempt, "ts"> & { ts?: string }): boolean {
  const path = logPath(cwd);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...attempt });
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${line}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Read every attempt. Malformed lines are skipped, not fatal — a truncated write must not blind the tutor. */
export function readAttempts(cwd: string): ProbeAttempt[] {
  const path = logPath(cwd);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return parseAttempts(raw);
}

export function parseAttempts(raw: string): ProbeAttempt[] {
  const out: ProbeAttempt[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<ProbeAttempt>;
      if (typeof parsed.strand !== "string" || typeof parsed.correct !== "boolean") continue;
      out.push({
        ts: typeof parsed.ts === "string" ? parsed.ts : new Date(0).toISOString(),
        strand: parsed.strand,
        phase: parsed.phase === "teach" ? "teach" : "probe",
        question: parsed.question ?? "",
        options: Array.isArray(parsed.options) ? parsed.options : [],
        correctIndex: typeof parsed.correctIndex === "number" ? parsed.correctIndex : -1,
        answerIndex: typeof parsed.answerIndex === "number" ? parsed.answerIndex : null,
        answer: parsed.answer ?? "",
        correct: parsed.correct,
        admitted: parsed.admitted === true,
        topic: typeof parsed.topic === "string" ? parsed.topic : undefined,
      });
    } catch {
      // Skip the bad line, keep the rest.
    }
  }
  return out;
}

/** Collapse attempts into one row per strand, most-recently-touched first. */
export function summarize(attempts: readonly ProbeAttempt[]): StrandSummary[] {
  const byStrand = new Map<string, StrandSummary>();
  for (const a of attempts) {
    const row = byStrand.get(a.strand) ?? {
      strand: a.strand,
      right: 0,
      wrong: 0,
      admitted: 0,
      total: 0,
      lastSeen: a.ts,
      lastCorrect: a.correct,
    };
    row.total += 1;
    if (a.correct) row.right += 1;
    else if (a.admitted) row.admitted += 1;
    else row.wrong += 1;
    if (a.ts >= row.lastSeen) {
      row.lastSeen = a.ts;
      row.lastCorrect = a.correct;
    }
    byStrand.set(a.strand, row);
  }
  return [...byStrand.values()].sort((x, y) => y.lastSeen.localeCompare(x.lastSeen));
}

/** Whole days between an attempt and now. Negative clock skew reads as 0. */
export function ageInDays(ts: string, nowMs: number): number {
  const then = Date.parse(ts);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((nowMs - then) / 86_400_000));
}

/**
 * A one-word verdict per strand.
 *
 * The thresholds are deliberately forgiving. A probe that binary-searches for a
 * boundary *must* end in a wrong answer — that is how it knows it found the
 * edge — so demanding a near-perfect ratio would mark every properly probed
 * strand as shaky and destroy the signal.
 *
 * `stale` outranks `solid`: a strand answered correctly two months ago is not
 * evidence about today, and the tutor should re-probe rather than build on it.
 * A measured gap (`shaky`, `absent`) outranks staleness, because a known gap is
 * worth acting on whenever it was found.
 */
export const SOLID_RATIO = 2 / 3;

export function verdict(row: StrandSummary, nowMs: number, staleAfterDays = 30): "solid" | "shaky" | "absent" | "stale" {
  if (row.total === 0) return "absent";
  const ratio = row.right / row.total;
  if (ratio === 0) return "absent";
  if (ratio < SOLID_RATIO) return "shaky";
  if (ageInDays(row.lastSeen, nowMs) >= staleAfterDays) return "stale";
  return "solid";
}

/** Human-readable lines for the /probe widget. */
export function formatSummary(rows: readonly StrandSummary[], nowMs: number): string[] {
  if (rows.length === 0) return ["No questions logged yet."];
  const width = Math.max(...rows.map((r) => r.strand.length));
  return rows.map((r) => {
    const age = ageInDays(r.lastSeen, nowMs);
    const when = age === 0 ? "today" : age === 1 ? "1d ago" : `${age}d ago`;
    return `${r.strand.padEnd(width)}  ${r.right}/${r.total}  ${verdict(r, nowMs).padEnd(6)}  ${when}`;
  });
}

/** The same map, phrased for the model rather than for the terminal. */
export function formatForModel(rows: readonly StrandSummary[], nowMs: number): string {
  if (rows.length === 0) return "No prior measurements. Probe from scratch.";
  const lines = rows.map((r) => {
    const v = verdict(r, nowMs);
    const age = ageInDays(r.lastSeen, nowMs);
    return `- ${r.strand}: ${v} (${r.right}/${r.total} correct, last measured ${age}d ago)`;
  });
  return [
    "Prior measurements from this learner's probe log:",
    ...lines,
    "",
    "Treat `solid` as verified, `shaky` and `absent` as gaps to start from, and",
    "`stale` as unverified — re-probe stale strands with one question before building on them.",
  ].join("\n");
}
