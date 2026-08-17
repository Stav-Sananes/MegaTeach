/**
 * ingest — turn files on disk into a searchable library.
 *
 * Kept out of index.ts so that nothing here depends on the pi harness. The pi
 * extension and the standalone `teach-sources` CLI call this same function, so a
 * library built by one is byte-identical to a library built by the other. That
 * matters: the learner's probe log is shared across harnesses, and their sources
 * have to be too, or the two halves of a session disagree about what the
 * textbook says.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import {
  type Manifest,
  type SourceDoc,
  documentId,
  hashText,
  sourcesDir,
  textPath,
  writeManifest,
} from "../shared/sources.ts";
import { extract } from "./extract.ts";

export interface IngestResult {
  added: SourceDoc[];
  skipped: Array<{ path: string; reason: string }>;
}

export function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? "unknown error";
}

export function ingest(cwd: string, paths: readonly string[], manifest: Manifest): IngestResult {
  const result: IngestResult = { added: [], skipped: [] };
  const taken = new Set(manifest.docs.map((d) => d.id));

  for (const path of paths) {
    try {
      const { text, extractedBy } = extract(path);
      const hash = hashText(text);

      const existing = manifest.docs.find((d) => d.path === path);
      if (existing && existing.hash === hash) {
        result.skipped.push({ path, reason: "unchanged since it was added" });
        continue;
      }

      const id = existing?.id ?? documentId(path, taken);
      taken.add(id);
      mkdirSync(sourcesDir(cwd), { recursive: true });
      writeFileSync(textPath(cwd, id), text, "utf8");

      const doc: SourceDoc = {
        id,
        title: basename(path),
        path,
        addedAt: new Date().toISOString(),
        pages: text.split("\f").length,
        chars: text.length,
        hash,
        extractedBy,
      };

      if (existing) manifest.docs[manifest.docs.indexOf(existing)] = doc;
      else manifest.docs.push(doc);
      result.added.push(doc);
    } catch (error) {
      result.skipped.push({ path, reason: firstLine(error) });
    }
  }

  writeManifest(cwd, manifest);
  return result;
}

export function libraryLines(manifest: Manifest): string[] {
  if (manifest.docs.length === 0) return ["No sources yet. /source add <path-to-pdf-or-notes>"];
  const width = Math.max(...manifest.docs.map((d) => d.id.length));
  return manifest.docs.map(
    (d) => `${d.id.padEnd(width)}  ${d.pages} page(s)  ${Math.round(d.chars / 1000)}k chars  via ${d.extractedBy}`,
  );
}
