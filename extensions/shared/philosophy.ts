/**
 * PHILOSOPHY.md loading — the fork point.
 *
 * Probe and plan are mechanism and ship as defaults. *How to explain* is taste,
 * and shipping the author's taste as everyone's default rebuilds the exact
 * "one outlet teaches many" problem this project exists to remove. So the teach
 * phase reads its style from a file the learner owns, and the tutor says so out
 * loud when that file is missing.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PHILOSOPHY_FILE = "PHILOSOPHY.md";

export interface PhilosophyResult {
  found: boolean;
  /** Absolute path that was used, or the preferred path to create when not found. */
  path: string;
  content: string;
}

/**
 * Search order: project first, then the user's global pi config. Project wins so
 * that "how I want to be taught category theory" can differ from "how I want to
 * be taught Rust" without editing one global file back and forth.
 */
export function philosophyCandidates(cwd: string): string[] {
  return [
    join(cwd, PHILOSOPHY_FILE),
    join(cwd, ".teach", PHILOSOPHY_FILE),
    join(homedir(), ".pi", "agent", PHILOSOPHY_FILE),
    join(homedir(), ".claude", PHILOSOPHY_FILE),
  ];
}

export function loadPhilosophy(cwd: string): PhilosophyResult {
  const candidates = philosophyCandidates(cwd);
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, "utf8").trim();
      if (content) return { found: true, path, content };
    } catch {
      // Unreadable file behaves as absent — the session should still start.
    }
  }
  return { found: false, path: candidates[0]!, content: "" };
}

/** What gets handed to the model at the start of a teach session. */
export function philosophyBlock(result: PhilosophyResult): string {
  if (result.found) {
    return [
      `The learner's teaching philosophy (from ${result.path}). It governs the teach phase.`,
      "Where it conflicts with the skill's defaults, it wins.",
      "",
      result.content,
    ].join("\n");
  }
  return [
    `No ${PHILOSOPHY_FILE} was found (looked in: ${philosophyCandidates(process.cwd()).join(", ")}).`,
    "Say so in your first message, use the skill's default teaching style, and suggest",
    "the learner run /philosophy to write their own.",
  ].join("\n");
}
