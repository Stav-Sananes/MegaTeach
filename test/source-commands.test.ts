/**
 * The /source command and the two retrieval tools, through the same surface the
 * harness drives. Ingestion is where a learner's library silently ends up wrong:
 * a re-added file duplicated, a failed extraction recorded as an empty document,
 * a removed source still answering queries.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sourcesExtension from "../extensions/sources/index.ts";
import { readManifest, textPath } from "../extensions/shared/sources.ts";

function harness() {
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const pi = {
    registerCommand: (name: string, def: any) => commands.set(name, def),
    registerTool: (def: any) => tools.set(def.name, def),
  } as any;
  sourcesExtension(pi);
  return { commands, tools };
}

function context(cwd: string) {
  const notifications: Array<{ message: string; type?: string }> = [];
  const widgets = new Map<string, string[] | undefined>();
  const ctx = {
    cwd,
    ui: {
      notify: (message: string, type?: string) => notifications.push({ message, type }),
      setWidget: (key: string, content: string[] | undefined) => widgets.set(key, content),
      setStatus: () => {},
    },
  } as any;
  return { ctx, notifications, widgets };
}

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "megateach-srccmd-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const NOTES = [
  "# Lecture 3",
  "",
  "A one-form is a linear map from vectors to scalars.",
  "",
  "The exterior derivative generalises grad, curl, and divergence.",
].join("\n");

function writeNotes(dir: string, name = "lecture-3.md", body = NOTES): string {
  const path = join(dir, name);
  writeFileSync(path, body, "utf8");
  return path;
}

test("the extension registers the command and both retrieval tools", () => {
  const { commands, tools } = harness();
  assert.ok(commands.has("source"));
  assert.deepEqual([...tools.keys()].sort(), ["source_read", "source_search"]);
});

test("/source add ingests a file and records how it was extracted", async () => {
  await withTempDir(async (dir) => {
    const { commands } = harness();
    const { ctx, notifications } = context(dir);
    await commands.get("source").handler(`add ${writeNotes(dir)}`, ctx);

    const [doc] = readManifest(dir).docs;
    assert.equal(doc?.id, "lecture-3");
    assert.equal(doc?.extractedBy, "read");
    assert.ok(existsSync(textPath(dir, "lecture-3")));
    assert.match(notifications.at(-1)!.message, /1 source/);
  });
});

test("re-adding an unchanged file is a no-op, not a duplicate", async () => {
  await withTempDir(async (dir) => {
    const { commands } = harness();
    const { ctx, widgets } = context(dir);
    const path = writeNotes(dir);
    await commands.get("source").handler(`add ${path}`, ctx);
    await commands.get("source").handler(`add ${path}`, ctx);

    assert.equal(readManifest(dir).docs.length, 1);
    assert.ok(widgets.get("teach-sources")!.some((l) => /unchanged/.test(l)));
  });
});

test("re-adding an edited file replaces it in place, keeping its id", async () => {
  await withTempDir(async (dir) => {
    const { commands } = harness();
    const { ctx } = context(dir);
    const path = writeNotes(dir);
    await commands.get("source").handler(`add ${path}`, ctx);
    writeNotes(dir, "lecture-3.md", `${NOTES}\n\nA two-form eats two vectors.`);
    await commands.get("source").handler(`add ${path}`, ctx);

    const docs = readManifest(dir).docs;
    assert.equal(docs.length, 1);
    assert.equal(docs[0]?.id, "lecture-3");
    assert.ok(docs[0]!.chars > NOTES.length);
  });
});

test("/source add on a directory ingests every supported file under it", async () => {
  await withTempDir(async (dir) => {
    const library = join(dir, "course");
    mkdirSync(join(library, "week-2"), { recursive: true });
    writeFileSync(join(library, "week-1.md"), NOTES);
    writeFileSync(join(library, "week-2", "notes.txt"), "Stokes theorem relates a form to its boundary.");
    writeFileSync(join(library, "slides.key"), "not a supported format");

    const { commands } = harness();
    const { ctx } = context(dir);
    await commands.get("source").handler(`add ${library}`, ctx);

    assert.deepEqual(readManifest(dir).docs.map((d) => d.id).sort(), ["notes", "week-1"]);
  });
});

test("/source add reports a path that does not exist instead of recording nothing", async () => {
  await withTempDir(async (dir) => {
    const { commands } = harness();
    const { ctx, notifications } = context(dir);
    await commands.get("source").handler(`add ${join(dir, "nope.pdf")}`, ctx);
    assert.equal(notifications.at(-1)!.type, "error");
    assert.deepEqual(readManifest(dir).docs, []);
  });
});

test("/source remove takes the document out of retrieval, not just out of the list", async () => {
  await withTempDir(async (dir) => {
    const { commands, tools } = harness();
    const { ctx } = context(dir);
    await commands.get("source").handler(`add ${writeNotes(dir)}`, ctx);
    await commands.get("source").handler("remove lecture-3", ctx);

    assert.deepEqual(readManifest(dir).docs, []);
    assert.equal(existsSync(textPath(dir, "lecture-3")), false);
    const found = await tools.get("source_search").execute("id", { query: "one-form" }, undefined, undefined, ctx);
    assert.match(found.content[0].text, /No sources have been added/);
  });
});

test("/source doctor names the extractors this machine actually has", async () => {
  await withTempDir(async (dir) => {
    const { commands } = harness();
    const { ctx, widgets } = context(dir);
    await commands.get("source").handler("doctor", ctx);
    assert.match(widgets.get("teach-sources")![0]!, /PDF extractors/);
  });
});

test("source_search returns a citation the learner can turn to", async () => {
  await withTempDir(async (dir) => {
    const { commands, tools } = harness();
    const { ctx } = context(dir);
    await commands.get("source").handler(`add ${writeNotes(dir)}`, ctx);

    const result = await tools
      .get("source_search")
      .execute("id", { query: "exterior derivative" }, undefined, undefined, ctx);
    assert.match(result.content[0].text, /\[lecture-3\.md\]/);
    assert.match(result.content[0].text, /generalises grad, curl/);
    assert.equal(result.details.documents, 1);
  });
});

test("source_search can be scoped to one document", async () => {
  await withTempDir(async (dir) => {
    const { commands, tools } = harness();
    const { ctx } = context(dir);
    await commands.get("source").handler(`add ${writeNotes(dir)}`, ctx);
    await commands
      .get("source")
      .handler(`add ${writeNotes(dir, "other.md", "The exterior derivative is discussed here too.")}`, ctx);

    const scoped = await tools
      .get("source_search")
      .execute("id", { query: "exterior derivative", doc_id: "other" }, undefined, undefined, ctx);
    assert.match(scoped.content[0].text, /\[other\.md\]/);
    assert.doesNotMatch(scoped.content[0].text, /lecture-3/);
  });
});

test("source_read returns the passage with its neighbours", async () => {
  await withTempDir(async (dir) => {
    const { commands, tools } = harness();
    const { ctx } = context(dir);
    const long = Array.from(
      { length: 40 },
      (_, i) => `Paragraph ${i} about differential forms, wedge products, and the algebra they generate.`,
    ).join("\n\n");
    await commands.get("source").handler(`add ${writeNotes(dir, "long.md", long)}`, ctx);

    const result = await tools
      .get("source_read")
      .execute("id", { chunk_id: "long#2", context: 1 }, undefined, undefined, ctx);
    assert.match(result.content[0].text, /chunk long#2/);
    assert.ok(result.details.chunks > 1, "neighbours were included");
  });
});

test("source_read names the real ids when handed one that does not exist", async () => {
  await withTempDir(async (dir) => {
    const { commands, tools } = harness();
    const { ctx } = context(dir);
    await commands.get("source").handler(`add ${writeNotes(dir)}`, ctx);

    await assert.rejects(
      () => tools.get("source_read").execute("id", { chunk_id: "ghost#1" }, undefined, undefined, ctx),
      /No source "ghost".*lecture-3/s,
    );
    await assert.rejects(
      () => tools.get("source_read").execute("id", { chunk_id: "lecture-3#99" }, undefined, undefined, ctx),
      /No chunk "lecture-3#99"/,
    );
  });
});
