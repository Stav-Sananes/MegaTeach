/**
 * Asking the learner things. Two tools, and the difference between them is the
 * whole design.
 *
 * `quiz` is a measurement. The model must supply `correct_index` at call time,
 * before it ever sees the answer. That single constraint is what separates it
 * from a conversation: the model is committed, so the answer measures the
 * learner instead of the model's willingness to agree.
 *
 * `ask` is not a measurement. "What do you want to learn", "shall we go deeper
 * or move on" — real questions with no correct answer. They must never reach
 * the probe log, because a logged question needs a `correctIndex` and any
 * integer invented for one of these feeds the level ratchet with noise. So
 * `ask` writes to a different file and is never counted.
 *
 * The two are in one file on purpose: the boundary between them is the thing
 * most easily got wrong, and it is easier to hold when both are in view.
 *
 * Registers:
 *   quiz    (tool)    ask one graded question, return only right/wrong + what they picked
 *   ask     (tool)    ask one ungraded question, record the choice, measure nothing
 *   recall  (tool)    what the logs already know about this learner
 *   /probe  (command) the same map, for the human
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  appendDecision,
  formatForModel as formatDecisionsForModel,
  logPath as decisionsPath,
  readDecisions,
} from "../shared/decisions.ts";
import {
  appendAttempt,
  formatForModel,
  formatSummary,
  logPath,
  readAttempts,
  summarize,
} from "../shared/probe-log.ts";

const DONT_KNOW = "I don't know";

/**
 * The escape hatch on every ungraded question. A learner who cannot articulate
 * a goal yet is the normal case, not an edge case — "I want to understand
 * LLMs" means ten different things — and four options written by someone who
 * has not met them will often contain none of the right one. Forcing a pick
 * from a wrong list produces a confident record of something they do not want.
 */
const SOMETHING_ELSE = "Something else — let me type it";

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

const AskParams = Type.Object({
  question: Type.String({
    description:
      "The question. Self-contained — a reader who cannot see the conversation must be able to answer it.",
  }),
  options: Type.Array(Type.String(), {
    minItems: 2,
    maxItems: 5,
    description:
      "The choices. Make them genuinely different directions, not shades of one — the learner is steering, " +
      "not guessing. Do not add an 'other' option; one is added for you.",
  }),
  why_ungraded: Type.String({
    description:
      "One sentence: why this question has no correct answer. This is the counterpart of quiz's correct_index — " +
      "that field forces you to commit to an answer, this one forces you to state that there is not one. " +
      "If what you write here reads like a rationale for one option being right, you wanted quiz.",
  }),
  kind: StringEnum(["goal", "direction", "preference"] as const, {
    description:
      "goal: what they want to be able to do. direction: which way to go next. preference: how they want to be taught.",
  }),
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
    name: "ask",
    label: "Ask",
    description:
      "Ask the learner one question that has no correct answer — what they want to learn, which direction to " +
      "take next, how they want to be taught — and record what they chose. This measures nothing and never " +
      "reaches the probe log. If the question has a right answer, even one you are letting them reason toward, " +
      "use quiz instead.",
    promptSnippet: "ask - ask the learner one ungraded question (goal, direction, preference)",
    promptGuidelines: [
      "Use ask for goals and direction; use quiz for anything with a correct answer, including Socratic steps.",
      "Call ask once at the start of a session to pin down what the learner actually wants to be able to do.",
      "Never invent a correct_index for a question that has no correct answer — that poisons the level reading.",
    ],
    parameters: AskParams,
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const { question, options, why_ungraded, kind } = params;

      const labelled = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`);
      const choices = [...labelled, SOMETHING_ELSE];
      const picked = await ctx.ui.select(question, choices, { signal });

      const pickedIndex = picked === undefined ? -1 : choices.indexOf(picked);
      const opted = pickedIndex >= 0 && pickedIndex < options.length;
      const answer = opted ? options[pickedIndex]! : null;

      const logged = appendDecision(ctx.cwd, {
        kind,
        question,
        options,
        answer,
        whyUngraded: why_ungraded,
        topic: params.topic,
      });

      const outcome = opted
        ? `The learner chose: ${answer}`
        : pickedIndex === choices.length - 1
          ? "The learner picked none of the options and wants to say it in their own words. Ask them in prose, " +
            "in your next message, and do not offer the same list again."
          : "The learner dismissed the question without answering. Do not re-ask it; carry on with your best " +
            "reading of what they want and say which reading you took.";

      return {
        content: [
          {
            type: "text",
            text: [
              outcome,
              `Kind: ${kind}`,
              "This was not a measurement. Nothing was written to the probe log, no strand was touched, and " +
                "this must not be counted toward their level.",
              logged
                ? "Recorded in .teach/decisions.jsonl, so a later session knows what they chose without asking again."
                : `(Warning: could not write to ${decisionsPath(ctx.cwd)} — this choice will not survive the session.)`,
            ].join("\n"),
          },
        ],
        details: { kind, answered: opted, answer },
      };
    },
  });

  pi.registerTool({
    name: "recall",
    label: "Recall",
    description:
      "Read what this learner's logs already know: which strands are solid, shaky, absent, or stale, how long " +
      "ago each was measured, and what they have already told you they want. Call this once at the start of a " +
      "session before probing, so you re-verify rather than re-ask everything.",
    promptSnippet: "recall - read the learner's measured map and prior choices",
    promptGuidelines: [
      "Call recall once at the start of a teaching session, before asking the first quiz question.",
      "Treat strands recall reports as stale as unverified: re-probe them with one question rather than assuming.",
      "If recall reports a goal, confirm it in one sentence instead of asking for it again from scratch.",
    ],
    parameters: RecallParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const attempts = readAttempts(ctx.cwd);
      const filtered = params.strand_prefix
        ? attempts.filter((a) => a.strand.startsWith(params.strand_prefix!))
        : attempts;
      const rows = summarize(filtered);
      const now = Date.now();

      // Decisions are appended, never filtered by strand: a goal is not a strand,
      // and a prefix query for one is not a reason to forget what they asked for.
      const decisions = readDecisions(ctx.cwd);
      const choices = formatDecisionsForModel(decisions, now);

      return {
        content: [
          { type: "text", text: [formatForModel(rows, now), choices].filter(Boolean).join("\n\n") },
        ],
        details: { strands: rows.length, attempts: filtered.length, decisions: decisions.length },
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
