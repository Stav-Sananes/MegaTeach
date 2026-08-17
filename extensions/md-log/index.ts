/**
 * md-log — bind the session to a markdown file and let the model write into it.
 *
 * Obsidian (or any markdown editor with LaTeX) gives you rendered mathematics,
 * embedded diagrams, and a durable artifact per session for free. That is the
 * entire reason this exists: a lesson that vanishes with the terminal scrollback
 * was only half-taught.
 *
 * Registers:
 *   /link  (command) point the session at a file
 *   note   (tool)    append lesson content to it
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readLink, resolveNotePath, shortPath, writeLink } from "../shared/link.ts";

const NoteParams = Type.Object({
  markdown: Type.String({
    description:
      "Markdown to append. Use $...$ and $$...$$ for LaTeX, ```mermaid fences for graphs, " +
      "and ![[file.svg]] to embed an image that sits beside the note.",
  }),
  heading: Type.Optional(
    Type.String({ description: "Optional H2 heading written above the content." }),
  ),
});

export default function mdLogExtension(pi: ExtensionAPI) {
  pi.registerCommand("link", {
    description: "Link this session to a markdown file: /link ~/vault/learn/topic.md",
    async handler(args, ctx) {
      const target = args.trim();

      if (!target) {
        const existing = readLink(ctx.cwd);
        ctx.ui.notify(existing ? `Linked: ${existing.path}` : "No file linked. Try /link <path>.", "info");
        if (existing) ctx.ui.setStatus("md-log", `→ ${shortPath(existing.path)}`);
        return;
      }

      const abs = resolveNotePath(ctx.cwd, target);
      try {
        mkdirSync(dirname(abs), { recursive: true });
        if (!existsSync(abs)) writeFileSync(abs, "", "utf8");
      } catch (error) {
        ctx.ui.notify(`Could not create ${abs}: ${(error as Error).message}`, "error");
        return;
      }

      writeLink(ctx.cwd, abs);
      ctx.ui.setStatus("md-log", `→ ${shortPath(abs)}`);
      ctx.ui.notify(`Linked to ${abs}`, "info");
    },
  });

  pi.registerTool({
    name: "note",
    label: "Note",
    description:
      "Append lesson content to the learner's linked markdown file. Use it for explanations worth keeping, " +
      "Mermaid graphs, derivations, and anything with LaTeX — it renders properly there and survives the " +
      "session. Terminal output does not.",
    promptSnippet: "note - append lesson content to the learner's markdown file",
    promptGuidelines: [
      "Write the plan-phase Mermaid graph and every derivation with LaTeX to the learner's file with note.",
    ],
    parameters: NoteParams,
    executionMode: "sequential",

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const link = readLink(ctx.cwd);
      if (!link) {
        throw new Error(
          "No markdown file is linked. Ask the learner to run /link <path-to-note> first, then retry.",
        );
      }

      const existing = (() => {
        try {
          return readFileSync(link.path, "utf8");
        } catch {
          return "";
        }
      })();
      const needsGap = existing.length > 0 && !existing.endsWith("\n\n");
      const block = [
        needsGap ? (existing.endsWith("\n") ? "\n" : "\n\n") : "",
        params.heading ? `## ${params.heading}\n\n` : "",
        params.markdown.trimEnd(),
        "\n",
      ].join("");

      appendFileSync(link.path, block, "utf8");
      ctx.ui.setStatus("md-log", `→ ${shortPath(link.path)} (+${params.markdown.length} chars)`);

      return {
        content: [{ type: "text", text: `Appended ${params.markdown.length} characters to ${link.path}` }],
        details: { path: link.path, chars: params.markdown.length },
      };
    },
  });
}
