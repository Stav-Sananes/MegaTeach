/**
 * The /teach kickoff is the only place the learner's philosophy and prior map are
 * guaranteed to reach the model. If it silently drops either, the session looks
 * fine and teaches the wrong person.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendAttempt } from "../extensions/shared/probe-log.ts";
import tutorExtension from "../extensions/tutor/index.ts";

interface Sent {
  content: string;
  options?: { expandPromptTemplates?: boolean };
}

function harness(commandNames: string[] = []) {
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const sent: Sent[] = [];
  const pi = {
    registerCommand: (name: string, def: any) => commands.set(name, def),
    registerTool: (def: any) => tools.set(def.name, def),
    getCommands: () => commandNames.map((name) => ({ name, source: "skill" })),
    sendUserMessage: (content: string, options?: Sent["options"]) => sent.push({ content, options }),
  } as any;
  return { pi, commands, tools, sent };
}

function context(cwd: string, confirmAnswer = true) {
  const notifications: string[] = [];
  const widgets = new Map<string, string[] | undefined>();
  const ctx = {
    cwd,
    ui: {
      notify: (message: string) => notifications.push(message),
      confirm: async () => confirmAnswer,
      setWidget: (key: string, content: string[] | undefined) => widgets.set(key, content),
      setStatus: () => {},
    },
  } as any;
  return { ctx, notifications, widgets };
}

/**
 * Await the body before cleaning up — an async body outliving its own directory
 * is a silent test.
 *
 * HOME is repointed at the temp directory for the duration: /teach and
 * /philosophy fall back to `~/.pi/agent/PHILOSOPHY.md` and `~/.claude/PHILOSOPHY.md`,
 * and the README tells every user to create one. Without this, whether these
 * tests pass depends on whose machine they run on.
 */
async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "megateach-tutor-"));
  const realHome = process.env.HOME;
  process.env.HOME = join(dir, "fake-home");
  try {
    return await fn(dir);
  } finally {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the extension registers every command and tool the README promises", () => {
  const { pi, commands, tools } = harness();
  tutorExtension(pi);
  assert.deepEqual([...commands.keys()].sort(), ["philosophy", "teach"]);
  assert.ok(tools.has("delegate"));
  assert.match(tools.get("delegate").description, /svg-maker/, "the shipped agents are advertised to the model");
});

test("/teach with no topic asks for one instead of starting a blind session", async () => {
  await withTempDir(async (dir) => {
    const { pi, commands, sent } = harness();
    tutorExtension(pi);
    const { ctx, notifications } = context(dir);
    await commands.get("teach").handler("   ", ctx);
    assert.equal(sent.length, 0);
    assert.match(notifications[0]!, /Give me a topic/);
  });
});

test("/teach carries the philosophy, the prior map, and the phase order to the model", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, "PHILOSOPHY.md"), "Derive, never assert.\n");
    appendAttempt(dir, {
      strand: "calculus/limits",
      phase: "probe",
      question: "q",
      options: ["a"],
      correctIndex: 0,
      answerIndex: 0,
      answer: "a",
      correct: true,
      admitted: false,
    });

    const { pi, commands, sent } = harness(["skill:teach"]);
    tutorExtension(pi);
    const { ctx } = context(dir);
    await commands.get("teach").handler("differential forms", ctx);

    assert.equal(sent.length, 1);
    const message = sent[0]!.content;
    assert.ok(message.startsWith("/skill:teach "), "the skill is loaded deterministically, not hopefully");
    assert.equal(sent[0]!.options?.expandPromptTemplates, true);
    assert.match(message, /Teach me: differential forms/);
    assert.match(message, /Derive, never assert/);
    assert.match(message, /calculus\/limits: solid/);
    assert.match(message, /probe → plan → teach/);
    assert.match(message, /No markdown file is linked/);
  });
});

test("/teach still works when skill commands are disabled", async () => {
  await withTempDir(async (dir) => {
    const { pi, commands, sent } = harness([]);
    tutorExtension(pi);
    const { ctx } = context(dir);
    await commands.get("teach").handler("topology", ctx);

    const message = sent[0]!.content;
    assert.ok(!message.startsWith("/skill:teach"));
    assert.match(message, /read its SKILL\.md/);
    assert.match(message, /Teach me: topology/);
  });
});

test("/teach announces a missing philosophy rather than quietly using the repo's taste", async () => {
  await withTempDir(async (dir) => {
    const { pi, commands, sent } = harness(["skill:teach"]);
    tutorExtension(pi);
    const { ctx } = context(dir);
    await commands.get("teach").handler("sheaves", ctx);
    assert.match(sent[0]!.content, /Say so in your first message/);
  });
});

test("/philosophy shows the file when there is one", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, "PHILOSOPHY.md"), "Pace: slow.\n");
    const { pi, commands } = harness();
    tutorExtension(pi);
    const { ctx, widgets } = context(dir);
    await commands.get("philosophy").handler("", ctx);
    assert.ok(widgets.get("teach-philosophy")!.some((line) => line.includes("Pace: slow.")));
  });
});

test("/philosophy scaffolds from the shipped template when the learner agrees", async () => {
  await withTempDir(async (dir) => {
    const { pi, commands } = harness();
    tutorExtension(pi);
    const { ctx, notifications } = context(dir, true);
    await commands.get("philosophy").handler("", ctx);

    const written = join(dir, "PHILOSOPHY.md");
    assert.ok(existsSync(written));
    assert.match(readFileSync(written, "utf8"), /How I want to be taught/);
    assert.match(notifications[0]!, /Edit it/);
  });
});

test("/philosophy writes nothing when the learner declines", async () => {
  await withTempDir(async (dir) => {
    const { pi, commands } = harness();
    tutorExtension(pi);
    const { ctx } = context(dir, false);
    await commands.get("philosophy").handler("", ctx);
    assert.equal(existsSync(join(dir, "PHILOSOPHY.md")), false);
  });
});

test("delegate names the agents that exist when handed one that does not", async () => {
  await withTempDir(async (dir) => {
    const { pi, tools } = harness();
    tutorExtension(pi);
    const { ctx } = context(dir);
    await assert.rejects(
      () => tools.get("delegate").execute("id", { agent: "nope", task: "x" }, undefined, undefined, ctx),
      /Unknown agent "nope".*svg-maker/s,
    );
  });
});

test("the delegate schema advertises the shipped agents without depending on the launch directory", async () => {
  await withTempDir(async (dir) => {
    // The schema is built once at registration, when the session cwd is unknown.
    // Deriving it from process.cwd() would advertise an empty list whenever pi
    // was launched elsewhere, and the model would never call delegate at all.
    const original = process.cwd();
    process.chdir(dir);
    try {
      const { pi, tools } = harness();
      tutorExtension(pi);
      const delegate = tools.get("delegate");
      for (const agent of ["svg-maker", "mermaid-maker", "fact-checker"]) {
        assert.match(delegate.description, new RegExp(agent));
        assert.match(delegate.parameters.properties.agent.description, new RegExp(agent));
      }
      assert.match(delegate.description, /\.teach\/agents/, "project-local overrides are advertised too");
    } finally {
      process.chdir(original);
    }
  });
});

test("delegate does not spawn a subagent for an already-cancelled turn", async () => {
  await withTempDir(async (dir) => {
    const { pi, tools } = harness();
    tutorExtension(pi);
    const { ctx } = context(dir);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        tools
          .get("delegate")
          .execute("id", { agent: "svg-maker", task: "x" }, controller.signal, undefined, ctx),
      /Cancelled before the subagent started/,
    );
  });
});
