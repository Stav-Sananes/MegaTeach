/**
 * Sources — the learner's own material, made searchable.
 *
 * A tutor that teaches from its own memory teaches the average of everything it
 * read. A tutor pointed at the learner's lecture notes, their course PDF, their
 * professor's conventions, teaches *their* course — right notation, right
 * definitions, right emphasis. That is the difference this file exists to make.
 *
 * Retrieval is BM25 over chunks, computed here in plain TypeScript. No embedding
 * API, no vector database, no key, no network: a learner with a laptop and a PDF
 * gets grounded teaching offline. BM25 is weaker than embeddings at matching
 * paraphrase, and the mitigation is that the model issues several keyword
 * queries rather than one — cheap, because searching is local.
 *
 * Kept free of harness imports so it can be unit tested directly.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { LOG_DIR } from "./probe-log.ts";

export const SOURCES_DIR = "sources";
export const MANIFEST_FILE = "manifest.json";

/** One ingested document. The extracted text lives beside the manifest as `<id>.txt`. */
export interface SourceDoc {
  /** Short stable id derived from the path — also the text filename and the citation key. */
  id: string;
  /** Human title: the filename unless the learner gave one. */
  title: string;
  /** Absolute path it came from, so the learner can find the original. */
  path: string;
  addedAt: string;
  pages: number;
  chars: number;
  /** Of the extracted text, so re-adding an unchanged file is a no-op. */
  hash: string;
  /** Which rung of the extraction ladder produced the text. Useful when quality is poor. */
  extractedBy: string;
}

export interface Manifest {
  version: 1;
  docs: SourceDoc[];
}

/** One retrievable unit. Chunks never span a page, so a citation is always exact. */
export interface Chunk {
  id: string;
  docId: string;
  page: number;
  text: string;
}

export function sourcesDir(cwd: string): string {
  return join(cwd, LOG_DIR, SOURCES_DIR);
}

export function manifestPath(cwd: string): string {
  return join(sourcesDir(cwd), MANIFEST_FILE);
}

export function textPath(cwd: string, docId: string): string {
  return join(sourcesDir(cwd), `${docId}.txt`);
}

export function readManifest(cwd: string): Manifest {
  const path = manifestPath(cwd);
  if (!existsSync(path)) return { version: 1, docs: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Manifest>;
    return { version: 1, docs: Array.isArray(parsed.docs) ? parsed.docs : [] };
  } catch {
    // A corrupt manifest must not make the tutor forget how to teach. The text
    // files are still on disk and can be re-added.
    return { version: 1, docs: [] };
  }
}

export function writeManifest(cwd: string, manifest: Manifest): void {
  mkdirSync(sourcesDir(cwd), { recursive: true });
  writeFileSync(manifestPath(cwd), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/** A filesystem-safe, human-recognisable id: `linear-algebra-notes`, `linear-algebra-notes-2`. */
export function documentId(path: string, taken: ReadonlySet<string>): string {
  const base = basename(path)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const stem = base || "source";
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

const TARGET_CHARS = 1200;
const MIN_CHARS = 200;

/**
 * Split extracted text into retrievable chunks.
 *
 * Page breaks are form feeds, which is what every PDF extractor emits. Chunks are
 * packed from whole paragraphs and never cross a page boundary: a citation the
 * learner cannot turn to in the original is worse than no citation, because it
 * looks checkable and is not.
 */
export function chunkDocument(docId: string, text: string, targetChars = TARGET_CHARS): Chunk[] {
  const chunks: Chunk[] = [];
  const pages = text.split("\f");

  pages.forEach((pageText, pageIndex) => {
    const page = pageIndex + 1;
    const paragraphs = pageText
      .split(/\n\s*\n/)
      .map((p) => p.replace(/[ \t]+\n/g, "\n").trim())
      .filter(Boolean);

    let buffer = "";
    const flush = () => {
      const body = buffer.trim();
      buffer = "";
      if (!body) return;
      chunks.push({ id: `${docId}#${chunks.length + 1}`, docId, page, text: body });
    };

    for (const paragraph of paragraphs) {
      // A single paragraph longer than the target is hard-split rather than
      // emitted whole: one 40-page-long "paragraph" of OCR soup would otherwise
      // become one chunk and swamp every ranking it appears in.
      if (paragraph.length > targetChars * 2) {
        flush();
        for (let i = 0; i < paragraph.length; i += targetChars) {
          buffer = paragraph.slice(i, i + targetChars);
          flush();
        }
        continue;
      }
      if (buffer.length + paragraph.length + 2 > targetChars && buffer.length >= MIN_CHARS) flush();
      buffer += (buffer ? "\n\n" : "") + paragraph;
    }
    flush();
  });

  return chunks;
}

const STOPWORDS = new Set(
  ("a an the and or but if then than that this these those is are was were be been being of in on at to " +
    "for with by from as it its into about over under we you they he she i do does did not no so such can " +
    "will would should could may might must have has had").split(" "),
);

/**
 * Tokenise for retrieval. Lowercase, split on non-alphanumerics, drop stopwords.
 *
 * Single characters are dropped, which means bare notation (`x`, `L²`, `f'`) is
 * not indexed — only prose is. That is the right trade here: notation varies
 * between sources and renders unreliably through PDF extraction, while the words
 * around it do not. Search "dual space", not "V*".
 *
 * A trailing `s` is stripped so "vectors" finds "vector" — cruder than a stemmer
 * and enough for keyword recall.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue;
    const token = raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw;
    if (STOPWORDS.has(token)) continue;
    out.push(token);
  }
  return out;
}

export interface SearchIndex {
  chunks: Chunk[];
  /** token → chunk index → term frequency */
  postings: Map<string, Map<number, number>>;
  lengths: number[];
  avgLength: number;
}

export function buildIndex(chunks: readonly Chunk[]): SearchIndex {
  const postings = new Map<string, Map<number, number>>();
  const lengths: number[] = [];

  chunks.forEach((chunk, i) => {
    const tokens = tokenize(chunk.text);
    lengths.push(tokens.length);
    for (const token of tokens) {
      let byChunk = postings.get(token);
      if (!byChunk) {
        byChunk = new Map();
        postings.set(token, byChunk);
      }
      byChunk.set(i, (byChunk.get(i) ?? 0) + 1);
    }
  });

  const total = lengths.reduce((a, b) => a + b, 0);
  return {
    chunks: [...chunks],
    postings,
    lengths,
    avgLength: lengths.length ? total / lengths.length : 0,
  };
}

export interface SearchHit {
  chunk: Chunk;
  score: number;
}

const K1 = 1.5;
const B = 0.75;

/** Okapi BM25. */
export function search(index: SearchIndex, query: string, limit = 5): SearchHit[] {
  const terms = tokenize(query);
  if (terms.length === 0 || index.chunks.length === 0) return [];

  const n = index.chunks.length;
  const scores = new Map<number, number>();

  for (const term of new Set(terms)) {
    const byChunk = index.postings.get(term);
    if (!byChunk) continue;
    const df = byChunk.size;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    for (const [chunkIndex, tf] of byChunk) {
      const dl = index.lengths[chunkIndex] ?? 0;
      const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + (B * dl) / (index.avgLength || 1)));
      scores.set(chunkIndex, (scores.get(chunkIndex) ?? 0) + idf * norm);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([chunkIndex, score]) => ({ chunk: index.chunks[chunkIndex]!, score }));
}

/** Load every ingested document's chunks. Rebuilt on demand — indexing is cheap next to a lesson. */
export function loadChunks(cwd: string, manifest = readManifest(cwd)): Chunk[] {
  const chunks: Chunk[] = [];
  for (const doc of manifest.docs) {
    const path = textPath(cwd, doc.id);
    if (!existsSync(path)) continue;
    try {
      chunks.push(...chunkDocument(doc.id, readFileSync(path, "utf8")));
    } catch {
      // Skip an unreadable document rather than losing the rest of the library.
    }
  }
  return chunks;
}

/** `linear-algebra-notes p.12` — what the learner needs to find the passage themselves. */
export function citation(chunk: Chunk, manifest: Manifest): string {
  const doc = manifest.docs.find((d) => d.id === chunk.docId);
  const title = doc?.title ?? chunk.docId;
  return doc && doc.pages > 1 ? `${title} p.${chunk.page}` : title;
}

/** Search results, phrased for the model: citation, chunk id to re-read, then the passage. */
export function formatHits(hits: readonly SearchHit[], manifest: Manifest): string {
  if (hits.length === 0) {
    return manifest.docs.length === 0
      ? "No sources have been added. Ask the learner to run /source add <path> if they have material to teach from."
      : "No passage matched. Try different keywords — the search is literal, not semantic, so use the terms the source itself would use.";
  }
  return hits
    .map(
      (hit) =>
        `[${citation(hit.chunk, manifest)}] (chunk ${hit.chunk.id}, score ${hit.score.toFixed(2)})\n${hit.chunk.text}`,
    )
    .join("\n\n---\n\n");
}

/** Files worth trying to ingest when the learner points at a directory. */
export const SUPPORTED_EXTENSIONS = [".pdf", ".md", ".markdown", ".txt", ".text", ".org", ".rst"];

export function collectFiles(path: string, isDirectory: boolean): string[] {
  if (!isDirectory) return [path];
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (SUPPORTED_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))) out.push(full);
    }
  };
  walk(path, 0);
  return out.sort();
}
