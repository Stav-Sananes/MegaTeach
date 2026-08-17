/**
 * Getting text out of the learner's files.
 *
 * Plain text formats are read directly. Binary formats go down a ladder of
 * extractors, because there is no one tool present on every machine and adding a
 * heavyweight dependency to a package that otherwise has none is a poor trade for
 * a feature some learners never use.
 *
 * PDF, in order of output quality:
 *   1. pdftotext (poppler)  — best layout fidelity, emits form-feed page breaks
 *   2. mutool draw (mupdf)  — nearly as good
 *   3. python3 + pypdf      — no system package, and python3 is nearly ubiquitous
 *
 * DOCX, ordered by fidelity to the citation contract rather than by how nicely
 * the text reads:
 *   1. python3 (stdlib)     — a .docx is a zip of XML, so this needs no install
 *                             at all; written against this contract, so it emits
 *                             form feeds for page breaks and keeps table cells apart
 *   2. textutil             — on every macOS install, and preserves page breaks
 *   3. pandoc               — nicest prose, but discards page breaks, so it runs
 *                             only when nothing else can and its citations carry
 *                             no page number
 *
 * Rungs emit `\f` between pages so citations stay page-exact regardless of which
 * one ran. Word is the exception worth knowing about: a .docx has no inherent
 * pages — they appear when it is rendered — so only explicit and last-rendered
 * breaks produce one. A document with neither is a single page and gets cited
 * without a page number rather than with a fabricated one.
 *
 * If no rung is available the error names every install command for that format
 * rather than failing with "extraction failed".
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PYPDF_SCRIPT = `${HERE}/extract_pdf.py`;
const PYDOCX_SCRIPT = `${HERE}/extract_docx.py`;

export interface Extraction {
  text: string;
  extractedBy: string;
}

function available(command: string): boolean {
  try {
    execFileSync("/bin/sh", ["-c", `command -v "$1"`, "sh", command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

interface Rung {
  name: string;
  probe: () => boolean;
  extract: (path: string) => string;
}

function pythonWith(module?: string): boolean {
  if (!available("python3")) return false;
  if (!module) return true;
  try {
    execFileSync("python3", ["-c", `import ${module}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const PDF_LADDER: Rung[] = [
  {
    name: "pdftotext",
    probe: () => available("pdftotext"),
    extract: (path) => run("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"]),
  },
  {
    name: "mutool",
    probe: () => available("mutool"),
    extract: (path) => run("mutool", ["draw", "-F", "txt", path]),
  },
  {
    name: "python3+pypdf",
    probe: () => pythonWith("pypdf"),
    extract: (path) => run("python3", [PYPDF_SCRIPT, path]),
  },
];

const DOCX_LADDER: Rung[] = [
  {
    name: "python3+zipfile",
    probe: () => pythonWith(),
    extract: (path) => run("python3", [PYDOCX_SCRIPT, path]),
  },
  {
    name: "textutil",
    probe: () => available("textutil"),
    extract: (path) => run("textutil", ["-convert", "txt", "-stdout", path]),
  },
  {
    name: "pandoc",
    probe: () => available("pandoc"),
    extract: (path) => run("pandoc", ["--from=docx", "--to=plain", "--wrap=none", path]),
  },
];

const INSTALL_HINTS: Record<string, string[]> = {
  pdf: [
    "  brew install poppler          # macOS — provides pdftotext, the best output",
    "  apt install poppler-utils     # Debian/Ubuntu",
    "  brew install mupdf-tools      # or apt install mupdf-tools",
    "  python3 -m pip install pypdf  # no system package needed",
  ],
  docx: [
    "  (any python3 reads .docx unaided — check that python3 is on PATH)",
    "  brew install pandoc           # macOS — last-resort rung, loses page numbers",
    "  apt install pandoc            # Debian/Ubuntu",
  ],
};

export class NoExtractorError extends Error {
  constructor(format = "pdf") {
    super(
      [
        `No ${format.toUpperCase()} text extractor is available. Install any one of these:`,
        ...(INSTALL_HINTS[format] ?? []),
        "Plain-text sources (.md, .txt) need none of this and work already.",
      ].join("\n"),
    );
    this.name = "NoExtractorError";
  }
}

function down(ladder: readonly Rung[], path: string, format: string): Extraction {
  const errors: string[] = [];
  for (const rung of ladder) {
    if (!rung.probe()) continue;
    try {
      const text = rung.extract(path);
      if (text.replace(/[\s\f]/g, "").length > 0) return { text, extractedBy: rung.name };
      errors.push(`${rung.name}: produced no text (a scan or an image-only document?)`);
    } catch (error) {
      errors.push(`${rung.name}: ${(error as Error).message.split("\n")[0]}`);
    }
  }
  if (errors.length === 0) throw new NoExtractorError(format);
  throw new Error(`Could not extract text from ${path}.\n${errors.join("\n")}`);
}

export function extractPdf(path: string): Extraction {
  return down(PDF_LADDER, path, "pdf");
}

export function extractDocx(path: string): Extraction {
  const header = readFileSync(path).subarray(0, 4);
  if (!header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new Error(
      `${path} is not a valid .docx — a Word document is a zip archive, and this file is not one.\n` +
        "It may be a legacy .doc renamed, or an incomplete download. Convert it:\n" +
        "  textutil -convert docx file.doc     # macOS\n" +
        "  libreoffice --headless --convert-to docx file.doc",
    );
  }
  return down(DOCX_LADDER, path, "docx");
}

export function extract(path: string): Extraction {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return extractPdf(path);
  if (ext === ".docx") return extractDocx(path);
  if (ext === ".doc") {
    throw new Error(
      `${path} is the legacy .doc format, which none of these extractors read.\n` +
        "Convert it first:\n" +
        "  textutil -convert docx file.doc     # macOS\n" +
        "  libreoffice --headless --convert-to docx file.doc",
    );
  }
  return { text: readFileSync(path, "utf8"), extractedBy: "read" };
}

export function availableExtractors(): string[] {
  return [...PDF_LADDER, ...DOCX_LADDER].filter((rung) => rung.probe()).map((rung) => rung.name);
}

export function extractorReport(): Array<{ format: string; rungs: string[] }> {
  return [
    { format: "pdf", rungs: PDF_LADDER.filter((r) => r.probe()).map((r) => r.name) },
    { format: "docx", rungs: DOCX_LADDER.filter((r) => r.probe()).map((r) => r.name) },
  ];
}
