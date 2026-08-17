/**
 * Getting text out of the learner's files.
 *
 * Plain text formats are read directly. PDFs go down a ladder of extractors,
 * because there is no one tool present on every machine and adding a heavyweight
 * dependency to a package that otherwise has none is a poor trade for a feature
 * some learners never use.
 *
 * The ladder, in order of output quality:
 *   1. pdftotext (poppler)  — best layout fidelity, emits form-feed page breaks
 *   2. mutool draw (mupdf)  — nearly as good
 *   3. python3 + pypdf      — no system package, and python3 is nearly ubiquitous
 *
 * Every rung emits `\f` between pages, so citations stay page-exact regardless of
 * which one ran. If none is available the error names all three install commands
 * rather than failing with "extraction failed".
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PYPDF_SCRIPT = `${HERE}/extract_pdf.py`;

export interface Extraction {
  text: string;
  /** Which rung produced it — surfaced to the learner so poor output is diagnosable. */
  extractedBy: string;
}

// `command -v` is a shell builtin, so this needs a shell — but spawning one via
// the `shell` option concatenates argv into the command string, which Node warns
// about (DEP0190) on every ingest. Invoking sh directly with an explicit -c keeps
// the argument vector intact and the output quiet. Callers only ever pass the
// hardcoded rung names below, never a learner-supplied path.
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

/** Extractors are tried in order; the first that produces real text wins. */
const PDF_LADDER: Array<{ name: string; probe: () => boolean; extract: (path: string) => string }> = [
  {
    name: "pdftotext",
    probe: () => available("pdftotext"),
    // -layout keeps columns and tables readable; without it, two-column papers
    // interleave their lines and every chunk becomes nonsense.
    extract: (path) => run("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"]),
  },
  {
    name: "mutool",
    probe: () => available("mutool"),
    extract: (path) => run("mutool", ["draw", "-F", "txt", path]),
  },
  {
    name: "python3+pypdf",
    probe: () => {
      if (!available("python3")) return false;
      try {
        execFileSync("python3", ["-c", "import pypdf"], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    },
    extract: (path) => run("python3", [PYPDF_SCRIPT, path]),
  },
];

export class NoExtractorError extends Error {
  constructor() {
    super(
      [
        "No PDF text extractor is available. Install any one of these:",
        "  brew install poppler          # macOS — provides pdftotext, the best output",
        "  apt install poppler-utils     # Debian/Ubuntu",
        "  brew install mupdf-tools      # or apt install mupdf-tools",
        "  python3 -m pip install pypdf  # no system package needed",
        "Non-PDF sources (.md, .txt) need none of this and work already.",
      ].join("\n"),
    );
    this.name = "NoExtractorError";
  }
}

export function extractPdf(path: string): Extraction {
  const errors: string[] = [];
  for (const rung of PDF_LADDER) {
    if (!rung.probe()) continue;
    try {
      const text = rung.extract(path);
      // A PDF of scanned images extracts to whitespace. Reporting that plainly
      // beats ingesting an empty document the learner will later wonder about.
      if (text.replace(/[\s\f]/g, "").length > 0) return { text, extractedBy: rung.name };
      errors.push(`${rung.name}: produced no text (a scan with no OCR layer?)`);
    } catch (error) {
      errors.push(`${rung.name}: ${(error as Error).message.split("\n")[0]}`);
    }
  }
  if (errors.length === 0) throw new NoExtractorError();
  throw new Error(`Could not extract text from ${path}.\n${errors.join("\n")}`);
}

export function extract(path: string): Extraction {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return extractPdf(path);
  return { text: readFileSync(path, "utf8"), extractedBy: "read" };
}

/** Which rungs this machine has, for `/source doctor`. */
export function availableExtractors(): string[] {
  return PDF_LADDER.filter((rung) => rung.probe()).map((rung) => rung.name);
}
