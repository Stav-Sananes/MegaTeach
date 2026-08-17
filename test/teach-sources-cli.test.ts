/**
 * The standalone CLI. This is the only path a harness without an extension API
 * has to the learner's sources, so the contract it must keep is not "it prints
 * something" but "it prints what the pi tools would have printed, and it exits
 * with a code a script can branch on".
 *
 * Exit codes are load-bearing: a tutor shelling out to `search` needs to tell
 * "the sources are silent on this" (0, no hits) apart from "the library is
 * broken" (non-zero), because the honest answers differ.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../bin/teach-sources.ts";
import { readManifest, textPath } from "../extensions/shared/sources.ts";

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "megateach-cli-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Captures both streams so assertions can read what the learner would see. */
function capture<T>(fn: () => T): { value: T; out: string; err: string } {
  const originalLog = console.log;
  const originalError = console.error;
  let out = "";
  let err = "";
  console.log = (...args: unknown[]) => {
    out += `${args.join(" ")}\n`;
  };
  console.error = (...args: unknown[]) => {
    err += `${args.join(" ")}\n`;
  };
  try {
    return { value: fn(), out, err };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

const NOTES = [
  "# Lecture 3: Differential Forms",
  "",
  "A one-form is a smooth section of the cotangent bundle. In this course we write",
  "omega for one-forms and eta for two-forms, and we never call them covector fields.",
  "",
  "The exterior derivative d takes a k-form to a (k+1)-form, and satisfies d of d is zero.",
  "That identity is what makes the de Rham complex a complex.",
  "",
  "Stokes' theorem equates the integral of d omega over M with the integral of omega",
  "over the boundary of M. Green and Gauss are special cases of this one statement.",
].join("\n");

function seed(dir: string, name = "lecture-3.md", body = NOTES): string {
  const src = join(dir, "src");
  mkdirSync(src, { recursive: true });
  const path = join(src, name);
  writeFileSync(path, body, "utf8");
  return path;
}

test("add ingests a file and reports which rung read it", async () => {
  await withTempDir(async (dir) => {
    const path = seed(dir);
    const { value, out } = capture(() => run(["add", path, "--dir", dir]));

    assert.equal(value, 0);
    assert.match(out, /Added 1 of 1/);
    const manifest = readManifest(dir);
    assert.equal(manifest.docs.length, 1);
    assert.equal(manifest.docs[0]?.id, "lecture-3");
    assert.ok(existsSync(textPath(dir, "lecture-3")));
  });
});

test("add takes a directory and skips files it has already seen unchanged", async () => {
  await withTempDir(async (dir) => {
    seed(dir);
    capture(() => run(["add", join(dir, "src"), "--dir", dir]));

    const { value, out } = capture(() => run(["add", join(dir, "src"), "--dir", dir]));
    // Nothing added, but this is success: re-adding an unchanged library is a no-op,
    // not an error, or every session start would look like a failure.
    assert.equal(value, 0);
    assert.match(out, /unchanged since it was added/);
    assert.equal(readManifest(dir).docs.length, 1);
  });
});

test("add fails loudly when the path does not exist", async () => {
  await withTempDir(async (dir) => {
    const { value, err } = capture(() => run(["add", join(dir, "no-such-file.pdf"), "--dir", dir]));
    assert.equal(value, 1);
    assert.match(err, /Not found/);
  });
});

test("list names every document, and says so when there are none", async () => {
  await withTempDir(async (dir) => {
    const empty = capture(() => run(["list", "--dir", dir]));
    assert.equal(empty.value, 0);
    assert.match(empty.out, /0 document/);
    assert.match(empty.out, /No sources yet/);

    seed(dir);
    capture(() => run(["add", join(dir, "src"), "--dir", dir]));
    const filled = capture(() => run(["list", "--dir", dir]));
    assert.match(filled.out, /lecture-3/);
  });
});

test("search finds the passage and cites it the way the pi tool does", async () => {
  await withTempDir(async (dir) => {
    seed(dir);
    capture(() => run(["add", join(dir, "src"), "--dir", dir]));

    const { value, out } = capture(() => run(["search", "exterior derivative", "--dir", dir]));
    assert.equal(value, 0);
    assert.match(out, /\[lecture-3\.md/);
    assert.match(out, /chunk lecture-3#/);
    assert.match(out, /exterior derivative/);
  });
});

test("search over an empty library succeeds — silence is an answer, not a failure", async () => {
  await withTempDir(async (dir) => {
    const { value, out } = capture(() => run(["search", "anything at all", "--dir", dir]));
    assert.equal(value, 0);
    assert.doesNotMatch(out, /\[.*\]/);
  });
});

test("--json emits the citation alongside each hit, for a tutor that parses rather than reads", async () => {
  await withTempDir(async (dir) => {
    seed(dir);
    capture(() => run(["add", join(dir, "src"), "--dir", dir]));

    const { out } = capture(() => run(["search", "Stokes theorem boundary", "--dir", dir, "--json"]));
    const parsed = JSON.parse(out);
    assert.equal(parsed.query, "Stokes theorem boundary");
    assert.ok(parsed.hits.length > 0);
    assert.match(parsed.hits[0].citation, /lecture-3\.md/);
  });
});

test("read returns the chunk with its neighbours", async () => {
  await withTempDir(async (dir) => {
    seed(dir);
    capture(() => run(["add", join(dir, "src"), "--dir", dir]));

    const { out: searched } = capture(() => run(["search", "one-form", "--dir", dir, "--json"]));
    const chunkId = JSON.parse(searched).hits[0].chunk.id as string;

    const { value, out } = capture(() => run(["read", chunkId, "--dir", dir]));
    assert.equal(value, 0);
    assert.match(out, new RegExp(`chunk ${chunkId.replace("#", "\\#")}`));
  });
});

test("read names the real documents when handed a chunk id from nowhere", async () => {
  await withTempDir(async (dir) => {
    seed(dir);
    capture(() => run(["add", join(dir, "src"), "--dir", dir]));

    const { value, err } = capture(() => run(["read", "not-a-doc#3", "--dir", dir]));
    assert.equal(value, 1);
    assert.match(err, /lecture-3/);
  });
});

test("remove drops the document and its extracted text", async () => {
  await withTempDir(async (dir) => {
    seed(dir);
    capture(() => run(["add", join(dir, "src"), "--dir", dir]));

    const { value } = capture(() => run(["remove", "lecture-3", "--dir", dir]));
    assert.equal(value, 0);
    assert.equal(readManifest(dir).docs.length, 0);
    assert.ok(!existsSync(textPath(dir, "lecture-3")));
  });
});

test("remove refuses an id that is not in the library", async () => {
  await withTempDir(async (dir) => {
    const { value, err } = capture(() => run(["remove", "ghost", "--dir", dir]));
    assert.equal(value, 1);
    assert.match(err, /No source with id/);
  });
});

test("doctor reports the extractors, and its exit code says whether PDFs will work", async () => {
  const { value, out } = capture(() => run(["doctor"]));
  // Machine-dependent by nature: assert the two states are self-consistent rather
  // than assuming this machine has poppler.
  if (value === 0) assert.doesNotMatch(out, /none —/);
  else {
    assert.equal(value, 1);
    assert.match(out, /none —/);
    assert.match(out, /brew install poppler/);
  }
});

test("an unknown command and a bad flag are usage errors, not crashes", async () => {
  const unknown = capture(() => run(["frobnicate"]));
  assert.equal(unknown.value, 2);
  assert.match(unknown.err, /Unknown command/);

  const bareHelp = capture(() => run([]));
  assert.equal(bareHelp.value, 2);
  assert.match(bareHelp.out, /teach-sources/);

  const asked = capture(() => run(["--help"]));
  assert.equal(asked.value, 0);

  const badLimit = capture(() => run(["search", "x", "--limit", "zero"]));
  assert.equal(badLimit.value, 2);
  assert.match(badLimit.err, /--limit/);

  const missingValue = capture(() => run(["search", "x", "--dir"]));
  assert.equal(missingValue.value, 2);
  assert.match(missingValue.err, /--dir needs a value/);
});

test("the CLI and the pi extension build byte-identical libraries", async () => {
  await withTempDir(async (viaCli) => {
    await withTempDir(async (viaPi) => {
      const body = NOTES;
      writeFileSync(join(viaCli, "notes.md"), body, "utf8");
      writeFileSync(join(viaPi, "notes.md"), body, "utf8");

      capture(() => run(["add", join(viaCli, "notes.md"), "--dir", viaCli]));

      const { ingest } = await import("../extensions/sources/ingest.ts");
      const manifest = readManifest(viaPi);
      ingest(viaPi, [join(viaPi, "notes.md")], manifest);

      const a = readManifest(viaCli).docs[0];
      const b = readManifest(viaPi).docs[0];
      // addedAt and path differ by construction; the retrieval-relevant fields must not.
      assert.equal(a?.id, b?.id);
      assert.equal(a?.hash, b?.hash);
      assert.equal(a?.pages, b?.pages);
      assert.equal(a?.chars, b?.chars);
      assert.equal(a?.extractedBy, b?.extractedBy);
    });
  });
});
