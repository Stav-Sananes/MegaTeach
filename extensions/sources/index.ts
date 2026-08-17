/**
 * sources — teach from the learner's own material.
 *
 * Registers:
 *   /source add|list|remove|doctor  (command) manage the library
 *   source_search                   (tool)    find passages by keyword
 *   source_read                     (tool)    read a chunk and its neighbours in full
 *
 * The retrieval contract the skill depends on: every passage the model quotes
 * carries a citation the learner can turn to in the original. A tutor that
 * paraphrases the learner's own textbook without saying which page is worse than
 * one with no sources at all, because it cannot be checked.
 */

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveNotePath } from "../shared/link.ts";
import {
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
} from "../shared/sources.ts";
import { NoExtractorError, availableExtractors } from "./extract.ts";
import { ingest, libraryLines } from "./ingest.ts";

export default function sourcesExtension(pi: ExtensionAPI) {
  pi.registerCommand("source", {
    description: "Manage teaching sources: /source add <path> | list | remove <id> | doctor",
    getArgumentCompletions: (prefix: string) => {
      const items = ["add", "list", "remove", "doctor"]
        .filter((v) => v.startsWith(prefix))
        .map((v) => ({ value: v, label: v }));
      return items.length > 0 ? items : null;
    },
    async handler(args, ctx) {
      const [action = "list", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const target = rest.join(" ");
      const manifest = readManifest(ctx.cwd);

      if (action === "list") {
        ctx.ui.setWidget("teach-sources", [`sources — ${manifest.docs.length} document(s)`, ...libraryLines(manifest)]);
        return;
      }

      if (action === "doctor") {
        const found = availableExtractors();
        ctx.ui.setWidget("teach-sources", [
          "PDF extractors on this machine:",
          ...(found.length > 0
            ? found.map((f) => `  ${f}`)
            : ["  none — install poppler, mupdf-tools, or pypdf to add PDFs", "  .md and .txt sources work regardless"]),
        ]);
        return;
      }

      if (action === "remove") {
        const doc = manifest.docs.find((d) => d.id === target);
        if (!doc) {
          ctx.ui.notify(`No source with id "${target}". Run /source list.`, "warning");
          return;
        }
        manifest.docs = manifest.docs.filter((d) => d.id !== doc.id);
        writeManifest(ctx.cwd, manifest);
        rmSync(textPath(ctx.cwd, doc.id), { force: true });
        ctx.ui.notify(`Removed ${doc.id}.`, "info");
        return;
      }

      if (action !== "add") {
        ctx.ui.notify(`Unknown action "${action}". Use: add, list, remove, doctor.`, "warning");
        return;
      }

      if (!target) {
        ctx.ui.notify("Give me something to add: /source add ~/course/notes.pdf", "info");
        return;
      }

      const path = resolveNotePath(ctx.cwd, target);
      if (!existsSync(path)) {
        ctx.ui.notify(`Not found: ${path}`, "error");
        return;
      }

      const files = collectFiles(path, statSync(path).isDirectory());
      if (files.length === 0) {
        ctx.ui.notify(`No supported files under ${path}.`, "warning");
        return;
      }

      ctx.ui.setStatus("teach-sources", `reading ${files.length} file(s)…`);
      const { added, skipped } = ingest(ctx.cwd, files, manifest);
      ctx.ui.setStatus("teach-sources", undefined);

      const lines = [
        `Added ${added.length} of ${files.length} file(s).`,
        ...added.map((d) => `  ${d.id} — ${d.pages} page(s), ${Math.round(d.chars / 1000)}k chars, via ${d.extractedBy}`),
        ...skipped.map((s) => `  skipped ${basename(s.path)} — ${s.reason}`),
      ];
      ctx.ui.setWidget("teach-sources", lines);
      ctx.ui.notify(
        added.length > 0
          ? `${added.length} source(s) ready. The tutor will teach from them and cite them.`
          : skipped[0]?.reason ?? "Nothing was added.",
        added.length > 0 ? "info" : "warning",
      );
    },
  });

  pi.registerTool({
    name: "source_search",
    label: "Search sources",
    description:
      "Search the learner's own material — their PDFs, lecture notes, and textbooks — for passages relevant " +
      "to a query. Returns ranked passages, each with a citation and a chunk id. Matching is keyword-based, " +
      "not semantic: use the words the source itself would use, and issue several queries with different " +
      "phrasings rather than one. Searching is local and free.",
    promptSnippet: "source_search - find passages in the learner's own PDFs and notes",
    promptGuidelines: [
      "Call source_search before teaching any concept the learner has sources for, so the lesson matches their material's notation and conventions.",
      "Cite what source_search returns using the bracketed citation exactly as given; never paraphrase the learner's own source without saying where it came from.",
      "When source_search returns nothing useful, say the sources do not cover it rather than filling the gap silently from memory.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Keywords to search for. Use the source's own terminology." }),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 20, description: "How many passages to return. Default 5." }),
      ),
      doc_id: Type.Optional(
        Type.String({ description: "Restrict the search to one document id, as shown by /source list." }),
      ),
    }),

    async execute(_id, params, _signal, _onUpdate, ctx) {
      const manifest = readManifest(ctx.cwd);
      const all = loadChunks(ctx.cwd, manifest);
      const scoped = params.doc_id ? all.filter((c) => c.docId === params.doc_id) : all;
      const hits = search(buildIndex(scoped), params.query, params.limit ?? 5);
      return {
        content: [{ type: "text", text: formatHits(hits, manifest) }],
        details: { query: params.query, hits: hits.length, documents: manifest.docs.length },
      };
    },
  });

  pi.registerTool({
    name: "source_read",
    label: "Read source",
    description:
      "Read a specific chunk of a source in full, with the chunks on either side for context. Use after " +
      "source_search when a passage is cut off mid-argument, or to read a definition's surroundings before " +
      "teaching it.",
    promptSnippet: "source_read - read a source passage and its neighbours in full",
    parameters: Type.Object({
      chunk_id: Type.String({ description: "A chunk id from source_search, e.g. 'lecture-notes#12'." }),
      context: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 5, description: "Neighbouring chunks on each side. Default 1." }),
      ),
    }),

    async execute(_id, params, _signal, _onUpdate, ctx) {
      const manifest = readManifest(ctx.cwd);
      const [docId] = params.chunk_id.split("#");
      const doc = manifest.docs.find((d) => d.id === docId);
      if (!doc) {
        throw new Error(
          `No source "${docId}". Available: ${manifest.docs.map((d) => d.id).join(", ") || "(none added yet)"}.`,
        );
      }

      const path = textPath(ctx.cwd, doc.id);
      const chunks = chunkDocument(doc.id, existsSync(path) ? readFileSync(path, "utf8") : "");
      const index = chunks.findIndex((c) => c.id === params.chunk_id);
      if (index < 0) {
        throw new Error(`No chunk "${params.chunk_id}" in ${doc.id} (it has ${chunks.length} chunks).`);
      }

      const span = params.context ?? 1;
      const selected = chunks.slice(Math.max(0, index - span), index + span + 1);
      return {
        content: [
          {
            type: "text",
            text: selected
              .map((c) => `[${citation(c, manifest)}] (chunk ${c.id})\n${c.text}`)
              .join("\n\n---\n\n"),
          },
        ],
        details: { docId: doc.id, chunks: selected.length },
      };
    },
  });
}

export { NoExtractorError };
