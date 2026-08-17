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

export interface ProbeAttempt {
  ts: string;
  strand: string;
  phase: "probe" | "teach";
  question: string;
  options: string[];
  correctIndex: number;
  answerIndex: number | null;
  answer: string;
  correct: boolean;
  admitted: boolean;
  topic?: string;
}

export interface StrandSummary {
  strand: string;
  right: number;
  wrong: number;
  admitted: number;
  total: number;
  lastSeen: string;
  lastCorrect: boolean;
}

export function logPath(cwd: string): string {
  return join(cwd, LOG_DIR, LOG_FILE);
}

export function appendAttempt(cwd: string, attempt: Omit<ProbeAttempt, "ts"> & { ts?: string }): boolean {
  const path = logPath(cwd);
  const line = JSON.stringify({ ...attempt, ts: attempt.ts ?? new Date().toISOString() });
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${line}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

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
    } catch {}
  }
  return out;
}

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

export function ageInDays(ts: string, nowMs: number): number {
  const then = Date.parse(ts);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((nowMs - then) / 86_400_000));
}

export const SOLID_RATIO = 2 / 3;

export function verdict(row: StrandSummary, nowMs: number, staleAfterDays = 30): "solid" | "shaky" | "absent" | "stale" {
  if (row.total === 0) return "absent";
  const ratio = row.right / row.total;
  if (ratio === 0) return "absent";
  if (ratio < SOLID_RATIO) return "shaky";
  if (ageInDays(row.lastSeen, nowMs) >= staleAfterDays) return "stale";
  return "solid";
}

export function formatSummary(rows: readonly StrandSummary[], nowMs: number): string[] {
  if (rows.length === 0) return ["No questions logged yet."];
  const width = Math.max(...rows.map((r) => r.strand.length));
  return rows.map((r) => {
    const age = ageInDays(r.lastSeen, nowMs);
    const when = age === 0 ? "today" : age === 1 ? "1d ago" : `${age}d ago`;
    return `${r.strand.padEnd(width)}  ${r.right}/${r.total}  ${verdict(r, nowMs).padEnd(6)}  ${when}`;
  });
}

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
