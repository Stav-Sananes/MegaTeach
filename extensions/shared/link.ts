/**
 * The link — which markdown file this session writes into.
 *
 * Stored on disk rather than in module state so that everything else can find
 * it: a new session can resume the last note without being told again, and the
 * subagent runner can drop generated SVGs next to the note instead of in some
 * unrelated directory.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { LOG_DIR } from "./probe-log.ts";

export interface LinkState {
  /** Absolute path to the markdown file the session writes into. */
  path: string;
  /** ISO timestamp of when it was linked. */
  ts: string;
}

function statePath(cwd: string): string {
  return join(cwd, LOG_DIR, "link.json");
}

/**
 * Expand `~`, resolve against cwd.
 *
 * The `@` comes off first: some models prefix paths with it, and `@~/vault/a.md`
 * is a likely combination given that `~` paths are the documented `/link` form.
 * Stripping in the other order leaves the `~` unexpanded and quietly creates a
 * directory literally named `~` inside the project.
 */
export function resolveNotePath(cwd: string, input: string): string {
  const unprefixed = input.replace(/^@/, "");
  const expanded = unprefixed.startsWith("~") ? join(homedir(), unprefixed.slice(1)) : unprefixed;
  return resolve(cwd, expanded);
}

export function readLink(cwd: string): LinkState | null {
  const path = statePath(cwd);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LinkState>;
    if (typeof parsed.path !== "string" || !existsSync(parsed.path)) return null;
    return { path: parsed.path, ts: parsed.ts ?? new Date(0).toISOString() };
  } catch {
    return null;
  }
}

export function writeLink(cwd: string, notePath: string): LinkState {
  const state: LinkState = { path: notePath, ts: new Date().toISOString() };
  try {
    mkdirSync(dirname(statePath(cwd)), { recursive: true });
    writeFileSync(statePath(cwd), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // A lost link file is a lost convenience, not a lost session.
  }
  return state;
}

/** Where generated images belong: beside the note, so Obsidian's `![[file.svg]]` resolves. */
export function assetDir(notePath: string): string {
  return dirname(notePath);
}

/** Last two path segments — enough to identify the note in a footer without eating the width. */
export function shortPath(path: string): string {
  return path.split("/").slice(-2).join("/");
}
