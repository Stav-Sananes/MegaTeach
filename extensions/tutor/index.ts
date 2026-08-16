/**
 * tutor — session orchestration and delegation.
 *
 * Registers:
 *   /teach       (command) start a probe → plan → teach session on a topic
 *   /philosophy  (command) show, or scaffold, the learner's PHILOSOPHY.md
 *   delegate     (tool)    hand visual or fact-checking work to a subagent
 *
 * `delegate` runs each subagent as a separate `pi` process. The point is
 * isolated context: an svg-maker that draws, looks at what it drew, and redraws
 * burns a lot of tokens on images that have nothing to do with the lesson. Kept
 * in the main window, that work would push the actual teaching out of context.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assetDir, readLink } from "../shared/link.ts";
import { PHILOSOPHY_FILE, loadPhilosophy, philosophyBlock } from "../shared/philosophy.ts";
import { formatForModel, readAttempts, summarize } from "../shared/probe-log.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

interface AgentDef {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  path: string;
}

/**
 * Later directories win, so a learner can drop `.teach/agents/svg-maker.md` in a
 * project and override the shipped one without forking the repo.
 */
function agentDirs(cwd: string): string[] {
  return [
    join(REPO_ROOT, "agents"),
    join(homedir(), ".pi", "agent", "agents"),
    join(cwd, ".teach", "agents"),
  ];
}

function discoverAgents(cwd: string): Map<string, AgentDef> {
  const found = new Map<string, AgentDef>();
  for (const dir of agentDirs(cwd)) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const path = join(dir, entry);
      try {
        const { frontmatter, body } = parseFrontmatter<{
          name?: unknown;
          description?: unknown;
          tools?: unknown;
          model?: unknown;
        }>(readFileSync(path, "utf8"));
        const name = typeof frontmatter.name === "string" ? frontmatter.name : entry.replace(/\.md$/, "");
        const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
        const rawTools = frontmatter.tools;
        const tools = (Array.isArray(rawTools) ? rawTools : typeof rawTools === "string" ? rawTools.split(",") : [])
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean);
        found.set(name, {
          name,
          description,
          tools: tools.length > 0 ? tools : undefined,
          model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
          systemPrompt: body.trim(),
          path,
        });
      } catch {
        // One malformed agent file must not hide the others.
      }
    }
  }
  return found;
}

/**
 * How to re-invoke pi. When pi runs under a JS runtime, `process.argv[1]` is the
 * CLI entry point; when it is a compiled binary, `process.execPath` is pi itself.
 */
function piInvocation(args: string[]): { command: string; args: string[] } {
  const execName = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun|deno)(\.exe)?$/.test(execName);
  const script = process.argv[1];
  if (isGenericRuntime) {
    return script
      ? { command: process.execPath, args: [script, ...args] }
      : { command: "pi", args };
  }
  return { command: process.execPath, args };
}

interface RunResult {
  ok: boolean;
  output: string;
}

function runAgent(agent: AgentDef, task: string, cwd: string, signal?: AbortSignal): Promise<RunResult> {
  const args = ["-p", "--no-session", "--append-system-prompt", agent.systemPrompt];
  if (agent.model) args.push("--model", agent.model);
  if (agent.tools) args.push("--tools", agent.tools.join(","));
  args.push(task);

  const { command, args: argv } = piInvocation(args);

  return new Promise((resolvePromise) => {
    const child = spawn(command, argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      resolvePromise({
        ok: false,
        output: `Could not start a subagent (${command}): ${error.message}. Is pi on your PATH?`,
      });
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      const text = stdout.trim() || stderr.trim();
      resolvePromise(
        code === 0
          ? { ok: true, output: text || "(the subagent returned nothing)" }
          : { ok: false, output: `Subagent exited with code ${code}.\n${stderr.trim() || text}` },
      );
    });
  });
}

/** Everything the model should know before the first question of a session. */
function kickoff(topic: string, ctx: ExtensionContext): string {
  const philosophy = loadPhilosophy(ctx.cwd);
  const rows = summarize(readAttempts(ctx.cwd));
  const link = readLink(ctx.cwd);

  return [
    `Teach me: ${topic}`,
    "",
    "Follow probe → plan → teach in order. Do not skip the probe, and do not teach during it.",
    "",
    philosophyBlock(philosophy),
    "",
    formatForModel(rows, Date.now()),
    "",
    link
      ? `Write lesson content, the plan graph, and every derivation to ${link.path} with the note tool.`
      : "No markdown file is linked. Ask the learner to run /link <path> if they want a durable artifact.",
  ].join("\n");
}

export default function tutorExtension(pi: ExtensionAPI) {
  pi.registerCommand("teach", {
    description: "Start a teaching session: /teach differential forms",
    async handler(args, ctx) {
      const topic = args.trim();
      if (!topic) {
        ctx.ui.notify("Give me a topic: /teach <topic>", "info");
        return;
      }

      const hasSkillCommand = pi.getCommands().some((c) => c.name === "skill:teach");
      const body = kickoff(topic, ctx);

      if (hasSkillCommand) {
        pi.sendUserMessage(`/skill:teach ${body}`, { expandPromptTemplates: true });
      } else {
        // Skill commands are disabled; name the skill and let the model read it.
        pi.sendUserMessage(
          [`Load the "teach" skill (read its SKILL.md) and follow it exactly.`, "", body].join("\n"),
        );
      }
    },
  });

  pi.registerCommand("philosophy", {
    description: "Show your PHILOSOPHY.md, or scaffold one from the template",
    async handler(_args, ctx) {
      const current = loadPhilosophy(ctx.cwd);
      if (current.found) {
        ctx.ui.setWidget("teach-philosophy", [
          `philosophy — ${current.path}`,
          ...current.content.split("\n").slice(0, 20),
        ]);
        return;
      }

      const template = join(REPO_ROOT, "PHILOSOPHY.example.md");
      const target = join(ctx.cwd, PHILOSOPHY_FILE);
      const create = await ctx.ui.confirm(
        "No PHILOSOPHY.md found",
        `Write a starter ${PHILOSOPHY_FILE} to ${target}? Edit it before your next session — until you do, you get the repo author's defaults.`,
      );
      if (!create) return;

      try {
        const body = existsSync(template)
          ? readFileSync(template, "utf8")
          : `# How I want to be taught\n\n- Pace:\n- Formality:\n- Analogy vs. notation:\n- Motivate with history or applications:\n- Derive or assert:\n- How much I want to struggle before being told:\n`;
        writeFileSync(target, body, "utf8");
        ctx.ui.notify(`Wrote ${target}. Edit it, then run /teach.`, "info");
      } catch (error) {
        ctx.ui.notify(`Could not write ${target}: ${(error as Error).message}`, "error");
      }
    },
  });

  const agents = discoverAgents(process.cwd());
  const agentList = [...agents.values()];

  pi.registerTool({
    name: "delegate",
    label: "Delegate",
    description:
      "Hand a self-contained job to a subagent running in its own context window. Available agents:\n" +
      (agentList.length > 0
        ? agentList.map((a) => `- ${a.name}: ${a.description}`).join("\n")
        : "(none found — add markdown agent definitions under agents/)") +
      "\nThe subagent cannot see this conversation, so the task must carry everything it needs.",
    promptSnippet: "delegate - run a subagent (diagrams, SVG, fact-checking) in an isolated context",
    promptGuidelines: [
      "Use delegate for diagram and SVG work instead of writing image markup inline — it keeps the lesson in context.",
      "Use delegate with fact-checker during the plan phase for definitions or conventions you are not certain of.",
      "When calling delegate, write a self-contained task: the subagent cannot see the lesson so far.",
    ],
    parameters: Type.Object({
      agent: Type.String({
        description: `Which subagent to run. One of: ${agentList.map((a) => a.name).join(", ") || "(none)"}.`,
      }),
      task: Type.String({
        description:
          "The complete job. State the goal, the constraints, and where to write any output file. " +
          "Assume the subagent knows nothing about this session.",
      }),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const available = discoverAgents(ctx.cwd);
      const agent = available.get(params.agent);
      if (!agent) {
        throw new Error(
          `Unknown agent "${params.agent}". Available: ${[...available.keys()].join(", ") || "(none)"}.`,
        );
      }

      // Run where the lesson lives, so relative paths in the task resolve next to
      // the learner's note and Obsidian's ![[embeds]] find the file.
      const link = readLink(ctx.cwd);
      const workingDir = link ? assetDir(link.path) : ctx.cwd;

      onUpdate?.({ content: [{ type: "text", text: `Running ${agent.name}…` }], details: {} });
      ctx.ui.setStatus("teach-delegate", `${agent.name} working…`);

      const result = await runAgent(agent, params.task, workingDir, signal);
      ctx.ui.setStatus("teach-delegate", undefined);

      if (!result.ok) throw new Error(result.output);

      return {
        content: [{ type: "text", text: result.output }],
        details: { agent: agent.name, cwd: workingDir },
      };
    },
  });
}
