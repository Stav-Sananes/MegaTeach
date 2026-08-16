/**
 * Retrieval is the half of grounded teaching that fails silently. A chunk
 * attributed to the wrong page, or a ranking that buries the definition the
 * learner asked about, produces a lesson that looks cited and is not.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type Manifest,
  buildIndex,
  chunkDocument,
  citation,
  collectFiles,
  documentId,
  formatHits,
  loadChunks,
  readManifest,
  search,
  textPath,
  tokenize,
  writeManifest,
} from "../extensions/shared/sources.ts";

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "megateach-src-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PAGE_ONE = "A vector space is a set closed under addition and scalar multiplication.";
const PAGE_TWO = "A one-form is a linear map from vectors to scalars. Its kernel is a hyperplane.";
const PAGE_THREE = "The exterior derivative generalises grad, curl, and divergence.";
const DOC = [PAGE_ONE, PAGE_TWO, PAGE_THREE].join("\f");

function manifestFor(id: string, pages: number): Manifest {
  return {
    version: 1,
    docs: [
      {
        id,
        title: `${id}.pdf`,
        path: `/somewhere/${id}.pdf`,
        addedAt: new Date().toISOString(),
        pages,
        chars: 100,
        hash: "abc",
        extractedBy: "test",
      },
    ],
  };
}

test("chunks carry the page the learner would turn to", () => {
  const chunks = chunkDocument("notes", DOC);
  assert.deepEqual(chunks.map((c) => c.page), [1, 2, 3]);
  assert.match(chunks[1]!.text, /one-form/);
});

test("a chunk never spans a page boundary", () => {
  // A citation the learner cannot check is worse than none: it looks verifiable.
  const dense = ["short page one", "short page two", "short page three"].join("\f");
  for (const chunk of chunkDocument("notes", dense)) {
    assert.equal(chunk.text.includes("\f"), false);
    assert.equal(chunk.text.split("page").length - 1, 1, `chunk mixed pages: ${chunk.text}`);
  }
});

test("long pages split into several chunks, each still on that page", () => {
  const paragraphs = Array.from(
    { length: 20 },
    (_, i) => `Paragraph ${i} about tensors and differential forms, written at roughly the length of real prose.`,
  );
  const chunks = chunkDocument("notes", `${paragraphs.join("\n\n")}\fsecond page`);
  const onPageOne = chunks.filter((c) => c.page === 1);
  assert.ok(onPageOne.length > 1, `expected several chunks, got ${onPageOne.length}`);
  assert.deepEqual([...new Set(chunks.map((c) => c.page))], [1, 2]);
});

test("a single runaway paragraph is hard-split instead of swamping the ranking", () => {
  const runaway = "tensor ".repeat(2000);
  const chunks = chunkDocument("ocr-soup", runaway);
  assert.ok(chunks.length > 3, `expected a split, got ${chunks.length}`);
  assert.ok(Math.max(...chunks.map((c) => c.text.length)) <= 1200);
});

test("chunk ids are stable and scoped to their document", () => {
  const chunks = chunkDocument("notes", DOC);
  assert.deepEqual(chunks.map((c) => c.id), ["notes#1", "notes#2", "notes#3"]);
  assert.deepEqual(chunkDocument("notes", DOC).map((c) => c.id), chunks.map((c) => c.id));
});

test("tokenize drops stopwords and normalises plurals", () => {
  assert.deepEqual(tokenize("The vectors and the SCALARS"), ["vector", "scalar"]);
  assert.ok(!tokenize("class").includes("clas"), "a trailing ss is not a plural");
});

test("bare notation is not indexed, so search targets prose", () => {
  // Documented behaviour, not an accident: single symbols survive PDF extraction
  // unreliably and differ between sources, while the words around them do not.
  assert.deepEqual(tokenize("x_1 + L^2 = f'"), []);
  assert.deepEqual(tokenize("the dual space V*"), ["dual", "space"]);
});

test("search ranks the passage that actually answers the query first", () => {
  const hits = search(buildIndex(chunkDocument("notes", DOC)), "one-form linear map", 3);
  assert.ok(hits.length > 0);
  assert.match(hits[0]!.chunk.text, /one-form/);
  assert.equal(hits[0]!.chunk.page, 2);
});

test("search finds a plural query against a singular source", () => {
  const hits = search(buildIndex(chunkDocument("notes", DOC)), "vectors", 3);
  assert.ok(hits.length > 0);
});

test("search returns nothing for a query the sources do not cover", () => {
  assert.deepEqual(search(buildIndex(chunkDocument("notes", DOC)), "photosynthesis chlorophyll"), []);
});

test("rare terms outrank common ones", () => {
  // Without IDF, a query's most frequent word dominates and the specific term —
  // the one the learner actually asked about — gets buried.
  const doc = ["the map is a map of maps", "the exterior derivative is unique"].join("\f");
  const hits = search(buildIndex(chunkDocument("notes", doc)), "map exterior derivative", 2);
  assert.match(hits[0]!.chunk.text, /exterior derivative/);
});

test("citations name the page for multi-page documents and omit it for single-page ones", () => {
  const chunks = chunkDocument("notes", DOC);
  assert.equal(citation(chunks[1]!, manifestFor("notes", 3)), "notes.pdf p.2");
  assert.equal(citation(chunks[0]!, manifestFor("notes", 1)), "notes.pdf");
});

test("formatted hits give the model a citation and a re-readable chunk id", () => {
  const hits = search(buildIndex(chunkDocument("notes", DOC)), "one-form", 1);
  const text = formatHits(hits, manifestFor("notes", 3));
  assert.match(text, /\[notes\.pdf p\.2\]/);
  assert.match(text, /chunk notes#2/);
});

test("an empty library tells the model how the learner adds one", () => {
  assert.match(formatHits([], { version: 1, docs: [] }), /\/source add/);
});

test("a library that matched nothing says so without pretending it is empty", () => {
  const text = formatHits([], manifestFor("notes", 3));
  assert.match(text, /No passage matched/);
  assert.doesNotMatch(text, /\/source add/);
});

test("document ids are readable and never collide", () => {
  const taken = new Set<string>();
  const first = documentId("/x/Linear Algebra Notes.pdf", taken);
  taken.add(first);
  const second = documentId("/y/linear-algebra-notes.pdf", taken);
  assert.equal(first, "linear-algebra-notes");
  assert.equal(second, "linear-algebra-notes-2");
  assert.equal(documentId("/x/....pdf", new Set()), "source");
});

test("the manifest round-trips, and a corrupt one does not take the library down", async () => {
  await withTempDir((dir) => {
    writeManifest(dir, manifestFor("notes", 3));
    assert.equal(readManifest(dir).docs[0]?.id, "notes");

    writeFileSync(join(dir, ".teach", "sources", "manifest.json"), "{ this is not json");
    assert.deepEqual(readManifest(dir).docs, [], "a corrupt manifest reads as empty, not as a crash");
  });
});

test("loadChunks reads every ingested document and skips missing text files", async () => {
  await withTempDir((dir) => {
    const manifest = manifestFor("notes", 3);
    manifest.docs.push({ ...manifest.docs[0]!, id: "ghost", title: "ghost.pdf" });
    writeManifest(dir, manifest);
    writeFileSync(textPath(dir, "notes"), DOC, "utf8");

    const chunks = loadChunks(dir);
    assert.equal(chunks.length, 3);
    assert.deepEqual([...new Set(chunks.map((c) => c.docId))], ["notes"]);
  });
});

test("collectFiles walks a directory for supported formats and ignores the rest", async () => {
  await withTempDir((dir) => {
    writeFileSync(join(dir, "notes.md"), "x");
    writeFileSync(join(dir, "paper.pdf"), "x");
    writeFileSync(join(dir, "photo.png"), "x");
    writeFileSync(join(dir, ".hidden.md"), "x");

    const found = collectFiles(dir, true).map((p) => p.split("/").pop());
    assert.deepEqual(found, ["notes.md", "paper.pdf"]);
    assert.deepEqual(collectFiles(join(dir, "notes.md"), false).length, 1);
  });
});
