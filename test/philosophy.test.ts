import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadPhilosophy, philosophyBlock } from "../extensions/shared/philosophy.ts";
import { readLink, resolveNotePath, shortPath, writeLink } from "../extensions/shared/link.ts";

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "megateach-phil-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a project PHILOSOPHY.md is found and returned", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "PHILOSOPHY.md"), "Derive, never assert.\n");
    const result = loadPhilosophy(dir);
    assert.equal(result.found, true);
    assert.equal(result.content, "Derive, never assert.");
    assert.match(philosophyBlock(result), /Derive, never assert/);
  });
});

test("an empty PHILOSOPHY.md counts as absent — a blank file is not a philosophy", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "PHILOSOPHY.md"), "   \n\n");
    assert.equal(loadPhilosophy(dir).found, false);
  });
});

test("the project root wins over .teach/", () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, ".teach"), { recursive: true });
    writeFileSync(join(dir, ".teach", "PHILOSOPHY.md"), "fallback");
    writeFileSync(join(dir, "PHILOSOPHY.md"), "project");
    assert.equal(loadPhilosophy(dir).content, "project");
  });
});

test("the missing-philosophy block tells the model to say so out loud", () => {
  withTempDir((dir) => {
    const block = philosophyBlock(loadPhilosophy(dir));
    assert.match(block, /Say so in your first message/);
    assert.match(block, /\/philosophy/);
  });
});

test("link state round-trips and survives a new session", () => {
  withTempDir((dir) => {
    const note = join(dir, "note.md");
    writeFileSync(note, "");
    writeLink(dir, note);
    assert.equal(readLink(dir)?.path, note);
  });
});

test("a link to a file that no longer exists reads as no link", () => {
  withTempDir((dir) => {
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

test("shortPath keeps the note identifiable without eating the footer", () => {
  assert.equal(shortPath("/Users/x/vault/learn/forms.md"), "learn/forms.md");
});
