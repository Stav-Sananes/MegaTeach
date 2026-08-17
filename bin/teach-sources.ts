#!/usr/bin/env node
/**
 * teach-sources — the source library, without a harness.
 *
 * `/source` and `source_search` are pi extensions, so in Claude Code (or any
 * harness with no extension API) the learner's own material would be
 * unreachable. This CLI exposes the identical code path — same extraction
 * ladder, same chunking, same BM25, same citations — over argv.
 *
 * Two consequences worth the file:
 *   - The tutor cites `[lecture-3.pdf p.12]` the same way in every harness, so a
 *     lesson begun in one and continued in another does not change its mind
 *     about what the textbook says.
 *   - The library can be built and searched with no model and no credentials,
 *     which makes retrieval quality checkable on its own, before spending a
 *     session on it.
 *
 * Usage:
 *   teach-sources add <path>...      add files or directories (.pdf, .docx, .md, .txt)
 *   teach-sources list               what is in the library
 *   teach-sources remove <id>        drop one document
 *   teach-sources doctor             which extractors this machine has, per format
 *   teach-sources search <query>     ranked passages, with citations
 *   teach-sources read <chunk-id>    one passage and its neighbours, in full
 *
 * Every command takes `--dir <path>` to point at a project other than the
 * working directory, and `--json` for machine-readable output.
 */

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  type Manifest,
  buildIndex,
  chunkDocument,
  citation,
  collectFiles,
  formatHits,
  loadChunks,
  readManifest,
  search,
  textPath,
  writeManifest,
} from "../extensions/shared/sources.ts";
import { extractorReport } from "../extensions/sources/extract.ts";
import { ingest, libraryLines } from "./../extensions/sources/ingest.ts";

const USAGE = `teach-sources — the learner's own material, searchable with no model and no key.

  teach-sources add <path>...     add files or directories (.pdf .docx .md .txt .org .rst)
  teach-sources list              what is in the library
  teach-sources remove <id>       drop one document
  teach-sources doctor            which extractors this machine has, per format
  teach-sources search <query>    ranked passages, each with a turnable citation
  teach-sources read <chunk-id>   one passage and its neighbours, in full

Options:
  --dir <path>    project directory holding .teach/ (default: cwd)
  --limit <n>     search: how many passages (default 5)
  --doc <id>      search: restrict to one document
  --context <n>   read: neighbouring chunks each side (default 1)
  --json          machine-readable output
`;

interface Options {
  dir: string;
  limit: number;
  doc?: string;
  context: number;
  json: boolean;
  rest: string[];
}

/** `~` is the shell's job, not ours — but argv arrives unexpanded when quoted. */
function expandPath(cwd: string, input: string): string {
  const unprefixed = input.replace(/^@/, "");
  const expanded = unprefixed.startsWith("~") ? join(homedir(), unprefixed.slice(1)) : unprefixed;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { dir: process.cwd(), limit: 5, context: 1, json: false, rest: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const takeValue = (name: string): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${name} needs a value`);
      return value;
    };

    if (arg === "--dir") options.dir = expandPath(process.cwd(), takeValue("--dir"));
    else if (arg === "--limit") options.limit = Number(takeValue("--limit"));
    else if (arg === "--doc") options.doc = takeValue("--doc");
    else if (arg === "--context") options.context = Number(takeValue("--context"));
    else if (arg === "--json") options.json = true;
    else options.rest.push(arg);
  }

  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("--limit must be a positive integer");
  if (!Number.isInteger(options.context) || options.context < 0) {
    throw new Error("--context must be zero or a positive integer");
  }
  return options;
}

function emit(options: Options, lines: readonly string[], data: unknown): void {
  console.log(options.json ? JSON.stringify(data, null, 2) : lines.join("\n"));
}

function cmdAdd(options: Options): number {
  if (options.rest.length === 0) {
    console.error("Give me something to add: teach-sources add ~/course/notes.pdf");
    return 2;
  }

  const manifest = readManifest(options.dir);
  const files: string[] = [];
  for (const target of options.rest) {
    const path = expandPath(options.dir, target);
    if (!existsSync(path)) {
      console.error(`Not found: ${path}`);
      return 1;
    }
    files.push(...collectFiles(path, statSync(path).isDirectory()));
  }

  if (files.length === 0) {
    console.error(`No supported files under ${options.rest.join(", ")}.`);
    return 1;
  }

  const { added, skipped } = ingest(options.dir, files, manifest);
  emit(
    options,
    [
      `Added ${added.length} of ${files.length} file(s).`,
      ...added.map(
        (d) => `  ${d.id} — ${d.pages} page(s), ${Math.round(d.chars / 1000)}k chars, via ${d.extractedBy}`,
      ),
      ...skipped.map((s) => `  skipped ${basename(s.path)} — ${s.reason}`),
    ],
    { added, skipped },
  );
  // Nothing added and nothing merely unchanged means every file failed to extract.
  return added.length === 0 && skipped.every((s) => !s.reason.includes("unchanged")) ? 1 : 0;
}

function cmdList(options: Options): number {
  const manifest = readManifest(options.dir);
  emit(options, [`sources — ${manifest.docs.length} document(s)`, ...libraryLines(manifest)], manifest);
  return 0;
}

function cmdRemove(options: Options): number {
  const id = options.rest[0];
  if (!id) {
    console.error("Which one? teach-sources remove <id> (see teach-sources list)");
    return 2;
  }

  const manifest: Manifest = readManifest(options.dir);
  const doc = manifest.docs.find((d) => d.id === id);
  if (!doc) {
    console.error(`No source with id "${id}". Run teach-sources list.`);
    return 1;
  }

  manifest.docs = manifest.docs.filter((d) => d.id !== doc.id);
  writeManifest(options.dir, manifest);
  rmSync(textPath(options.dir, doc.id), { force: true });
  emit(options, [`Removed ${doc.id}.`], { removed: doc.id });
  return 0;
}

const DOCTOR_HINTS: Record<string, string[]> = {
  pdf: [
    "    brew install poppler          # macOS, best output",
    "    apt install poppler-utils     # Debian/Ubuntu",
    "    python3 -m pip install pypdf  # no system package needed",
  ],
  docx: [
    "    brew install pandoc           # macOS, best structure",
    "    apt install pandoc            # Debian/Ubuntu",
    "    (any python3 reads .docx unaided — check that python3 is on PATH)",
  ],
};

function cmdDoctor(options: Options): number {
  const report = extractorReport();
  const lines = ["Extractors on this machine:"];
  for (const { format, rungs } of report) {
    if (rungs.length > 0) lines.push(`  ${format}:  ${rungs.join(", ")}`);
    else lines.push(`  ${format}:  none — install one of:`, ...(DOCTOR_HINTS[format] ?? []));
  }
  lines.push("  .md and .txt need no extractor and work regardless");
  emit(options, lines, { extractors: report });

  // Non-zero only when *nothing* works, so a machine that reads PDFs but not
  // Word is not reported as broken.
  return report.some(({ rungs }) => rungs.length > 0) ? 0 : 1;
}

function cmdSearch(options: Options): number {
  const query = options.rest.join(" ");
  if (!query) {
    console.error('What am I searching for? teach-sources search "exterior derivative"');
    return 2;
  }

  const manifest = readManifest(options.dir);
  const all = loadChunks(options.dir, manifest);
  const scoped = options.doc ? all.filter((c) => c.docId === options.doc) : all;
  const hits = search(buildIndex(scoped), query, options.limit);
  emit(
    options,
    [formatHits(hits, manifest)],
    { query, hits: hits.map((h) => ({ ...h, citation: citation(h.chunk, manifest) })) },
  );
  // No hits is a real answer — the sources are silent on this — not a failure.
  return 0;
}

function cmdRead(options: Options): number {
  const chunkId = options.rest[0];
  if (!chunkId) {
    console.error("Which passage? teach-sources read <chunk-id> (ids come from search)");
    return 2;
  }

  const manifest = readManifest(options.dir);
  const [docId] = chunkId.split("#");
  const doc = manifest.docs.find((d) => d.id === docId);
  if (!doc) {
    console.error(
      `No source "${docId}". Available: ${manifest.docs.map((d) => d.id).join(", ") || "(none added yet)"}.`,
    );
    return 1;
  }

  const path = textPath(options.dir, doc.id);
  const chunks = chunkDocument(doc.id, existsSync(path) ? readFileSync(path, "utf8") : "");
  const index = chunks.findIndex((c) => c.id === chunkId);
  if (index < 0) {
    console.error(`No chunk "${chunkId}" in ${doc.id} (it has ${chunks.length} chunks).`);
    return 1;
  }

  const selected = chunks.slice(Math.max(0, index - options.context), index + options.context + 1);
  emit(
    options,
    [selected.map((c) => `[${citation(c, manifest)}] (chunk ${c.id})\n${c.text}`).join("\n\n---\n\n")],
    { chunks: selected.map((c) => ({ ...c, citation: citation(c, manifest) })) },
  );
  return 0;
}

export function run(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return command ? 0 : 2;
  }

  let options: Options;
  try {
    options = parseArgs(rest);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  switch (command) {
    case "add":
      return cmdAdd(options);
    case "list":
      return cmdList(options);
    case "remove":
      return cmdRemove(options);
    case "doctor":
      return cmdDoctor(options);
    case "search":
      return cmdSearch(options);
    case "read":
      return cmdRead(options);
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      return 2;
  }
}

// Only take over the process when run as a program; the tests import `run`.
if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  process.exitCode = run(process.argv.slice(2));
}
