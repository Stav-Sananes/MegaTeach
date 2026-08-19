/**
 * quiz — a graded multiple-choice question, and the tools that read what it wrote.
 *
 * The model must supply `correct_index` at call time, before it ever sees the
 * learner's answer. That single constraint is what separates this from a
 * conversation: the model is committed, so the answer measures the learner
 * instead of the model's willingness to agree.
 *
 * Registers:
 *   quiz    (tool)    ask one graded question, return only right/wrong + what they picked
 *   recall  (tool)    what the probe log already knows about this learner
 *   /probe  (command) the same map, for the human
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  appendAttempt,
  formatForModel,
  formatSummary,
  logPath,
  readAttempts,
  summarize,
} from "../shared/probe-log.ts";

const DONT_KNOW = "I don't know";

const QuizParams = Type.Object({
  question: Type.String({
    description:
      "The question. Self-contained — a reader who cannot see the conversation must be able to answer it.",
  }),
  options: Type.Array(Type.String(), {
    minItems: 2,
    maxItems: 6,
    description:
      "Answer options. Distractors must be plausible to someone who half-knows the material; " +
      "obviously-wrong options measure nothing. Do not include an 'I don't know' option — one is added for you.",
  }),
  correct_index: Type.Integer({
    minimum: 0,
    description: "0-based index into options. You are committing to this before the learner answers.",
  }),
  strand: Type.String({
    description:
      "The prerequisite strand this probes, as a path, e.g. 'linear-algebra/dual-spaces'. " +
      "Reuse strand names across questions so the log aggregates.",
  }),
  rationale: Type.String({
    description: "One sentence: why the correct option is correct. Shown to the learner after they answer.",
  }),
  depth: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 5,
      description:
        "How hard this question is: 1 recall, 2 mechanism, 3 tradeoff, 4 design under constraint, 5 edge case. " +
        "Tag every question — without it the log cannot tell whether the learner's level is rising.",
    }),
  ),
  grounded: Type.Optional(
    Type.Boolean({
      description:
        "Set only when you asked them to explain their thinking. true if the reason held up, false if the right " +
        "letter came with a reason that did not. A correct pick with grounded:false counts as a miss everywhere " +
        "downstream, because it was a guess.",
    }),
  ),
  phase: Type.Optional(
    StringEnum(["probe", "teach"] as const, {
      description: "Which phase asked this. Defaults to probe.",
    }),
  ),
  topic: Type.Optional(
    Type.String({ description: "The session's overall topic, so one log can serve many subjects." }),
  ),
});

const RecallParams = Type.Object({
  strand_prefix: Type.Optional(
    Type.String({
      description:
        "Only return strands starting with this prefix, e.g. 'linear-algebra'. Omit for the whole map.",
    }),
  ),
});

export default function quizExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "quiz",
    label: "Quiz",
    description:
      "Ask the learner exactly one graded multiple-choice question and return whether they got it right. " +
      "Use it during the probe phase to binary-search for the edge of their understanding, and during " +
      "teaching to confirm a step actually landed before moving on.",
    promptSnippet: "quiz - ask the learner one graded multiple-choice question",
    promptGuidelines: [
      "Call quiz with exactly one question per call; never batch several questions into one call.",
      "When calling quiz, commit to correct_index before the learner answers — quiz is a measurement, not a discussion.",
      "Do not explain, hint, or teach in the message accompanying a quiz call during the probe phase.",
      "Always set a reusable strand on quiz calls so the probe log aggregates across a session.",
    ],
    parameters: QuizParams,
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const { question, options, correct_index, strand, rationale } = params;
      const phase = params.phase ?? "probe";

      if (correct_index < 0 || correct_index >= options.length) {
        throw new Error(
          `correct_index ${correct_index} is out of range for ${options.length} options (valid: 0..${options.length - 1}).`,
        );
      }

      const labelled = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`);
      const choices = [...labelled, DONT_KNOW];
      const picked = await ctx.ui.select(question, choices, { signal });

      const pickedIndex = picked === undefined ? -1 : choices.indexOf(picked);
      const admitted = pickedIndex < 0 || pickedIndex === choices.length - 1;
      const answerIndex = admitted ? null : pickedIndex;
      const correct = !admitted && pickedIndex === correct_index;
      const answer = admitted ? DONT_KNOW : options[pickedIndex]!;

      const logged = appendAttempt(ctx.cwd, {
        strand,
        phase,
        question,
        options,
        correctIndex: correct_index,
        answerIndex,
        answer,
        correct,
        admitted,
        correctAnswer: options[correct_index]!,
        rationale,
        depth: params.depth,
        grounded: params.grounded,
        topic: params.topic,
      });

      const revealed = phase === "teach";
      const shown = revealed
        ? correct
          ? `Correct — ${rationale}`
          : admitted
            ? `The answer is ${options[correct_index]} — ${rationale}`
            : `Not quite — ${options[correct_index]}. ${rationale}`
        : correct
          ? "Correct. (Probe — the reason comes when this strand closes.)"
          : admitted
            ? "No answer recorded. (Probe — the reason comes when this strand closes.)"
            : "Not correct. (Probe — the answer and the reason come when this strand closes.)";
      ctx.ui.notify(shown, revealed && !correct && !admitted ? "warning" : "info");

      const verdict = admitted
        ? "The learner did not answer (chose \"I don't know\" or dismissed the question)."
        : correct
          ? "The learner answered CORRECTLY."
          : `The learner answered INCORRECTLY. They picked: ${answer}`;

      const direction = correct
        ? "Their understanding reaches at least this far on this strand. Probe deeper, or move on if the boundary is already located."
        : "This is at or past the edge of their understanding on this strand. Probe shallower here.";

      return {
        content: [
          {
            type: "text",
            text: [
              verdict,
              `Correct answer: ${options[correct_index]}`,
              `Strand: ${strand}`,
              revealed
                ? `The learner was shown the correct answer and this rationale: ${rationale}`
                : "The learner was shown neither the correct answer nor the rationale — this is the probe phase. Do not refer to a reason they have not heard.",
              direction,
              logged ? "" : `(Warning: could not write to ${logPath(ctx.cwd)} — the probe log is not recording.)`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        details: { strand, phase, correct, admitted, answer },
      };
    },
  });

  pi.registerTool({
    name: "recall",
    label: "Recall",
    description:
      "Read what the probe log already knows about this learner: which strands are solid, shaky, absent, " +
      "or stale, and how long ago each was measured. Call this once at the start of a session before " +
      "probing, so you re-verify rather than re-ask everything.",
    promptSnippet: "recall - read the learner's measured map from previous sessions",
    promptGuidelines: [
      "Call recall once at the start of a teaching session, before asking the first quiz question.",
      "Treat strands recall reports as stale as unverified: re-probe them with one question rather than assuming.",
    ],
    parameters: RecallParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const attempts = readAttempts(ctx.cwd);
      const filtered = params.strand_prefix
        ? attempts.filter((a) => a.strand.startsWith(params.strand_prefix!))
        : attempts;
      const rows = summarize(filtered);
      return {
        content: [{ type: "text", text: formatForModel(rows, Date.now()) }],
        details: { strands: rows.length, attempts: filtered.length },
      };
    },
  });

  pi.registerCommand("probe", {
    description: "Show what the probe log says about your current understanding map",
    async handler(args, ctx) {
      const attempts = readAttempts(ctx.cwd);
      if (args.trim() === "clear") {
        ctx.ui.setWidget("teach-probe", undefined);
        return;
      }
      const rows = summarize(attempts);
      const lines = formatSummary(rows, Date.now());
      ctx.ui.setWidget("teach-probe", [
        `probe map — ${attempts.length} question(s), ${rows.length} strand(s)   (/probe clear to hide)`,
        ...lines,
      ]);
    },
  });
}
