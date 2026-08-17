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
  path: string;
  ts: string;
}

function statePath(cwd: string): string {
  return join(cwd, LOG_DIR, "link.json");
}

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
  } catch {}
  return state;
}

export function assetDir(notePath: string): string {
  return dirname(notePath);
}

export function shortPath(path: string): string {
  return path.split("/").slice(-2).join("/");
}
