/**
 * Extraction is where a source library quietly goes wrong: a PDF that yields
 * nothing, or text with no page breaks, produces citations that point nowhere.
 *
 * The PDF cases build a real PDF at runtime and skip when the machine has no way
 * to make or read one, so the suite stays honest on a bare CI box.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { availableExtractors, extract, extractPdf } from "../extensions/sources/extract.ts";
import { chunkDocument } from "../extensions/shared/sources.ts";

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "megateach-extract-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function have(command: string): boolean {
  try {
    execFileSync("command", ["-v", command], { shell: "/bin/sh", stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Build a two-page PDF from text. Returns null when this machine cannot make one. */
function makePdf(dir: string, pages: readonly string[]): string | null {
  const txt = join(dir, "source.txt");
  const pdf = join(dir, "source.pdf");
  // A form feed is a page break for every text-to-PDF converter here.
  writeFileSync(txt, pages.join("\f"), "utf8");

  if (have("cupsfilter")) {
    try {
      execFileSync("/bin/sh", ["-c", `cupsfilter ${JSON.stringify(txt)} > ${JSON.stringify(pdf)} 2>/dev/null`]);
      return pdf;
    } catch {
      /* fall through */
    }
  }
  if (have("enscript") && have("ps2pdf")) {
    try {
      execFileSync("/bin/sh", [
        "-c",
        `enscript -p - ${JSON.stringify(txt)} 2>/dev/null | ps2pdf - ${JSON.stringify(pdf)}`,
      ]);
      return pdf;
    } catch {
      /* fall through */
    }
  }
  return null;
}

test("markdown and text files are read directly, with no extractor needed", async () => {
  await withTempDir((dir) => {
    const path = join(dir, "notes.md");
    writeFileSync(path, "# Notes\n\nA one-form eats a vector.\n");
    const { text, extractedBy } = extract(path);
    assert.match(text, /one-form eats a vector/);
    assert.equal(extractedBy, "read");
  });
});

test("a PDF round-trips to text with its page breaks intact", async (t) => {
  if (availableExtractors().length === 0) {
    t.skip("no PDF extractor on this machine (install poppler, mupdf-tools, or pypdf)");
    return;
  }
  await withTempDir((dir) => {
    const pdf = makePdf(dir, [
      "PAGEONEMARKER a vector space is closed under addition",
      "PAGETWOMARKER a one-form is a linear map to scalars",
    ]);
    if (!pdf) {
      t.skip("no way to build a PDF on this machine");
      return;
    }

    const { text, extractedBy } = extractPdf(pdf);
    assert.ok(availableExtractors().includes(extractedBy), `unexpected extractor: ${extractedBy}`);
    assert.match(text, /PAGEONEMARKER/);
    assert.match(text, /PAGETWOMARKER/);

    // The reason page breaks matter: chunk pages become citations, and a
    // citation to the wrong page is worse than none because it looks checkable.
    const chunks = chunkDocument("doc", text);
    const first = chunks.find((c) => c.text.includes("PAGEONEMARKER"));
    const second = chunks.find((c) => c.text.includes("PAGETWOMARKER"));
    assert.ok(first && second, "both markers survived chunking");
    assert.ok(second.page > first.page, `expected distinct pages, got ${first.page} and ${second.page}`);
  });
});

test("a PDF with no text layer is reported, not ingested as an empty document", async (t) => {
  if (availableExtractors().length === 0) {
    t.skip("no PDF extractor on this machine");
    return;
  }
  await withTempDir((dir) => {
    // Not a PDF at all — every rung fails, which is the same path a scan takes.
    const fake = join(dir, "scan.pdf");
    writeFileSync(fake, "%PDF-1.4\nnot really a pdf\n");
    assert.throws(() => extractPdf(fake), /Could not extract text|produced no text/);
  });
});

test("the extractor list is honest about what this machine can do", () => {
  // Drives /source doctor. Names must match the ladder's rung names so the
  // learner can act on them.
  for (const name of availableExtractors()) {
    assert.ok(["pdftotext", "mutool", "python3+pypdf"].includes(name), `unknown rung: ${name}`);
  }
});
