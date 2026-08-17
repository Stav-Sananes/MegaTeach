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
import { fileURLToPath } from "node:url";
import { availableExtractors, extract, extractDocx, extractPdf, extractorReport } from "../extensions/sources/extract.ts";
import { chunkDocument } from "../extensions/shared/sources.ts";

/** Where the extraction helper scripts live, for the test that drives one directly. */
const HERE_SOURCES = fileURLToPath(new URL("../extensions/sources", import.meta.url));

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
  const known = ["pdftotext", "mutool", "python3+pypdf", "pandoc", "textutil", "python3+zipfile"];
  for (const name of availableExtractors()) {
    assert.ok(known.includes(name), `unknown rung: ${name}`);
  }

  // doctor reports per format, and must not claim a format works when no rung does.
  const report = extractorReport();
  assert.deepEqual(
    report.map((r) => r.format),
    ["pdf", "docx"],
  );
  for (const { rungs } of report) {
    for (const name of rungs) assert.ok(availableExtractors().includes(name));
  }
});

/**
 * A .docx is a zip of XML, so this builds a genuine one rather than mocking the
 * extractor. Two pages via an explicit page break, and a table — both are things
 * a course handout actually contains, and both have failed silently before:
 * a lost page break makes every citation point to page 1, and a table flattened
 * without separators becomes one unsearchable blob.
 */
function makeDocx(dir: string, name = "handout.docx"): string {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>PAGEONEMARKER the exterior derivative takes a k-form to a k+1 form</w:t></w:r></w:p>
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
<w:p><w:r><w:t>PAGETWOMARKER Stokes theorem equates two integrals</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>TABLEHEADCELL</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>TABLETAILCELL</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
</w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const path = join(dir, name);
  const script = join(dir, "make-docx.py");
  writeFileSync(
    script,
    [
      "import sys, zipfile",
      "path, doc, ct, rels = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]",
      "z = zipfile.ZipFile(path, 'w')",
      "z.writestr('[Content_Types].xml', ct)",
      "z.writestr('_rels/.rels', rels)",
      "z.writestr('word/document.xml', doc)",
      "z.close()",
    ].join("\n"),
    "utf8",
  );
  execFileSync("python3", [script, path, document, contentTypes, rels], { stdio: "ignore" });
  return path;
}

test("a .docx round-trips to text with its page breaks intact", async (t) => {
  if (!have("python3")) {
    t.skip("no python3 to build a .docx with");
    return;
  }
  await withTempDir((dir) => {
    const path = makeDocx(dir);
    const { text, extractedBy } = extractDocx(path);
    assert.ok(
      ["python3+zipfile", "textutil", "pandoc"].includes(extractedBy),
      `unexpected extractor: ${extractedBy}`,
    );
    // The ladder must prefer a rung that keeps page numbers. If python3 is on the
    // box, nothing lossier should have been reached for.
    if (have("python3")) assert.equal(extractedBy, "python3+zipfile");
    assert.match(text, /PAGEONEMARKER/);
    assert.match(text, /PAGETWOMARKER/);

    const chunks = chunkDocument("doc", text);
    const first = chunks.find((c) => c.text.includes("PAGEONEMARKER"));
    const second = chunks.find((c) => c.text.includes("PAGETWOMARKER"));
    assert.ok(first && second, "both markers survived chunking");

    // pandoc discards page breaks, which is exactly why it sits last in the
    // ladder. Assert the contract rather than the rung: whichever one ran must
    // either report true distinct pages or report one page — never invent a
    // second page, and never claim page 1 for content that is on page 2.
    if (extractedBy === "pandoc") {
      assert.equal(first.page, second.page, "pandoc collapses to a single page, and must say so");
    } else {
      assert.ok(second.page > first.page, `expected distinct pages, got ${first.page} and ${second.page}`);
    }
  });
});

test("the stdlib rung needs no install, and keeps table cells separable", async (t) => {
  if (!have("python3")) {
    t.skip("no python3 on this machine");
    return;
  }
  await withTempDir((dir) => {
    const path = makeDocx(dir);
    // Bypass the ladder and drive the bottom rung directly: it is the one that
    // has to work on a machine with neither pandoc nor textutil, which is most
    // Linux boxes and every CI runner.
    const script = join(HERE_SOURCES, "extract_docx.py");
    const text = execFileSync("python3", [script, path], { encoding: "utf8" });

    assert.match(text, /PAGEONEMARKER/);
    assert.equal(text.split("\f").length, 2, "the explicit page break became a form feed");
    // Cells separated, not concatenated — otherwise a query for one column's term
    // matches a chunk whose other columns are noise.
    assert.match(text, /TABLEHEADCELL\tTABLETAILCELL/);
  });
});

test("extract dispatches by extension, and says what to do about legacy .doc", async () => {
  await withTempDir((dir) => {
    const doc = join(dir, "old.doc");
    writeFileSync(doc, "\xd0\xcf\x11\xe0 legacy binary");
    // Silently producing mojibake would poison the library with plausible noise.
    assert.throws(() => extract(doc), /legacy \.doc format/);
    assert.throws(() => extract(doc), /convert-to docx|textutil -convert/);
  });
});

test("a .docx that is not really a zip is reported, not ingested empty", async (t) => {
  if (extractorReport().find((r) => r.format === "docx")?.rungs.length === 0) {
    t.skip("no docx extractor on this machine");
    return;
  }
  await withTempDir((dir) => {
    const fake = join(dir, "broken.docx");
    writeFileSync(fake, "this is not a zip archive");
    assert.throws(() => extractDocx(fake), /not a valid \.docx/);
    // Named the fix, not just the failure.
    assert.throws(() => extractDocx(fake), /convert-to docx|textutil -convert/);
  });
});
