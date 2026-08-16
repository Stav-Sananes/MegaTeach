import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadPhilosophy, philosophyBlock, philosophyCandidates } from "../extensions/shared/philosophy.ts";
import { readLink, resolveNotePath, shortPath, writeLink } from "../extensions/shared/link.ts";

/** Await the body before cleaning up — an async body outliving its own directory is a silent test.  */
async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "megateach-phil-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a project PHILOSOPHY.md is found and returned", async () => {
  await withTempDir((dir) => {
    writeFileSync(join(dir, "PHILOSOPHY.md"), "Derive, never assert.\n");
    const result = loadPhilosophy(dir, join(dir, "fake-home"));
    assert.equal(result.found, true);
    assert.equal(result.content, "Derive, never assert.");
    assert.match(philosophyBlock(result), /Derive, never assert/);
  });
});

test("an empty PHILOSOPHY.md counts as absent — a blank file is not a philosophy", async () => {
  await withTempDir((dir) => {
    writeFileSync(join(dir, "PHILOSOPHY.md"), "   \n\n");
    assert.equal(loadPhilosophy(dir, join(dir, "fake-home")).found, false);
  });
});

test("the project root wins over .teach/", async () => {
  await withTempDir((dir) => {
    mkdirSync(join(dir, ".teach"), { recursive: true });
    writeFileSync(join(dir, ".teach", "PHILOSOPHY.md"), "fallback");
    writeFileSync(join(dir, "PHILOSOPHY.md"), "project");
    assert.equal(loadPhilosophy(dir, join(dir, "fake-home")).content, "project");
  });
});

test("the missing-philosophy block tells the model to say so out loud", async () => {
  await withTempDir((dir) => {
    const block = philosophyBlock(loadPhilosophy(dir, join(dir, "fake-home")));
    assert.match(block, /Say so in your first message/);
    assert.match(block, /\/philosophy/);
  });
});

test("the missing-philosophy block names the session's own directory", async () => {
  await withTempDir((dir) => {
    // Not process.cwd(): pointing the learner at the directory pi happens to
    // have been launched from would contradict where /philosophy actually writes.
    const block = philosophyBlock(loadPhilosophy(dir, join(dir, "fake-home")));
    assert.match(block, new RegExp(join(dir, "PHILOSOPHY.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

test("a global philosophy is found when the project has none", async () => {
  await withTempDir((dir) => {
    const home = join(dir, "fake-home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "PHILOSOPHY.md"), "global taste");
    assert.equal(loadPhilosophy(dir, home).content, "global taste");
  });
});

test("the search is scoped to the home it is given, not the machine's", async () => {
  // Guards the reason this parameter exists: the README tells every user to
  // create a global PHILOSOPHY.md, so an unscoped search makes these tests pass
  // or fail depending on whose laptop they run on.
  await withTempDir((dir) => {
    assert.deepEqual(
      philosophyCandidates(dir, "/nowhere").filter((p) => p.includes("/nowhere")),
      ["/nowhere/.pi/agent/PHILOSOPHY.md", "/nowhere/.claude/PHILOSOPHY.md"],
    );
    assert.equal(loadPhilosophy(dir, "/nowhere").found, false);
  });
});

test("link state round-trips and survives a new session", async () => {
  await withTempDir((dir) => {
    const note = join(dir, "note.md");
    writeFileSync(note, "");
    writeLink(dir, note);
    assert.equal(readLink(dir)?.path, note);
  });
});

test("a link to a file that no longer exists reads as no link", async () => {
  await withTempDir((dir) => {
    const note = join(dir, "note.md");
    writeFileSync(note, "");
    writeLink(dir, note);
    rmSync(note);
    assert.equal(readLink(dir), null);
  });
});

test("resolveNotePath expands ~ and strips a stray @ prefix", () => {
  const home = process.env.HOME ?? "";
  assert.equal(resolveNotePath("/tmp", "~/vault/a.md"), join(home, "vault/a.md"));
  assert.equal(resolveNotePath("/tmp", "@notes/a.md"), "/tmp/notes/a.md");
  assert.equal(resolveNotePath("/tmp", "/abs/a.md"), "/abs/a.md");
});

test("an @-prefixed ~ path still expands, instead of creating a directory named ~", () => {
  // Models emit the @ prefix and ~ is the documented /link form, so the two meet.
  // Stripping in the wrong order silently writes the lesson to ./~/vault/a.md.
  const home = process.env.HOME ?? "";
  assert.equal(resolveNotePath("/work", "@~/vault/a.md"), join(home, "vault/a.md"));
});

test("shortPath keeps the note identifiable without eating the footer", () => {
  assert.equal(shortPath("/Users/x/vault/learn/forms.md"), "learn/forms.md");
});
