/**
 * A scripted provider that drives the teaching tools through a real pi session,
 * with no model and no API key.
 *
 * Unit tests call the tools with a stand-in harness; this proves the other half —
 * that pi actually loads the package, registers the tools, validates the
 * arguments against the TypeBox schemas, and routes the results back. Those are
 * exactly the failures that unit tests cannot see.
 *
 * Driven by dev/smoke.sh. Pick a script with SMOKE_STEP.
 */

import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Script = Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0];

const scripts: Record<string, Script> = {
  /** The core loop: ask a graded question, then read back what it recorded. */
  quiz: [
    fauxAssistantMessage(
      fauxToolCall("quiz", {
        question: "What does a 1-form take as input?",
        options: ["A vector", "A scalar", "A matrix"],
        correct_index: 0,
        strand: "differential-forms/one-forms",
        rationale: "A 1-form is a linear map from vectors to scalars.",
        phase: "probe",
        topic: "differential forms",
      }),
    ),
    fauxAssistantMessage(fauxToolCall("recall", {})),
    fauxAssistantMessage("SMOKE-OK quiz"),
  ],

  /** A question the tool must refuse: the index cannot be graded. */
  "quiz-invalid": [
    fauxAssistantMessage(
      fauxToolCall("quiz", {
        question: "Out of range?",
        options: ["a", "b"],
        correct_index: 9,
        strand: "smoke",
        rationale: "n/a",
      }),
    ),
    fauxAssistantMessage("SMOKE-OK quiz-invalid"),
  ],

  /** LaTeX and Mermaid must survive the round trip into the learner's file. */
  note: [
    fauxAssistantMessage(
      fauxToolCall("note", {
        heading: "Plan",
        markdown: "```mermaid\ngraph TD\n  A[vectors] --> B[1-forms]\n```\n\nWhere $\\alpha(v) \\in \\mathbb{R}$.",
      }),
    ),
    fauxAssistantMessage("SMOKE-OK note"),
  ],

  /** With nothing linked, the tool must say what to do rather than swallow the lesson. */
  "note-unlinked": [
    fauxAssistantMessage(fauxToolCall("note", { markdown: "should not be written anywhere" })),
    fauxAssistantMessage("SMOKE-OK note-unlinked"),
  ],

  /** Spawns a real pi subprocess. Without credentials it must fail loudly, not hang. */
  delegate: [
    fauxAssistantMessage(
      fauxToolCall("delegate", { agent: "svg-maker", task: "Return immediately; draw nothing." }),
    ),
    fauxAssistantMessage("SMOKE-OK delegate"),
  ],

  "delegate-unknown": [
    fauxAssistantMessage(fauxToolCall("delegate", { agent: "no-such-agent", task: "x" })),
    fauxAssistantMessage("SMOKE-OK delegate-unknown"),
  ],

  /** No tool calls: just report what pi discovered. */
  inventory: [fauxAssistantMessage("SMOKE-OK inventory")],
};

export default function smokeProvider(pi: ExtensionAPI) {
  const step = process.env.SMOKE_STEP ?? "quiz";
  const script = scripts[step];
  if (!script) throw new Error(`Unknown SMOKE_STEP "${step}". Known: ${Object.keys(scripts).join(", ")}`);

  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1", name: "Faux 1" }] });
  faux.setResponses(script);
  pi.registerProvider(faux.provider);

  // stderr, so the assertions in smoke.sh can read it without competing with the
  // session transcript on stdout.
  pi.on("session_start", async (_event, ctx) => {
    const commands = pi
      .getCommands()
      .filter((c) => c.source === "extension")
      .map((c) => c.name);
    const tools = pi.getAllTools().map((t: { name?: string }) => t.name ?? String(t));
    console.error(`SMOKE commands: ${commands.join(", ")}`);
    console.error(`SMOKE tools: ${tools.join(", ")}`);
    console.error(`SMOKE skill: ${/\bteach\b/.test(await ctx.getSystemPrompt()) ? "loaded" : "MISSING"}`);
  });
}
