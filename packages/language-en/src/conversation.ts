import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  ConversationSurfaceDraft,
} from "../../realizer-core/src/index.ts";

export type EnglishConversationAct =
  | "answer"
  | "acknowledge"
  | "correct"
  | "clarify"
  | "ask"
  | "instruct"
  | "social"
  | "other";

export interface EnglishConversationFrame {
  id: string;
  content: string;
  relation: "peer" | "senior" | "junior" | "customer" | "service" | "close" | "stranger" | "unknown";
  register: "intimate" | "casual" | "neutral" | "professional" | "formal" | "unknown";
  politeness: number;
  dialogueAct: EnglishConversationAct;
  allowContractions?: boolean;
  allowDiscourseMarker?: boolean;
  allowCompactFollowup?: boolean;
  preserveTerms?: string[];
  annotations?: Record<string, JsonValue>;
}

export interface EnglishConversationProposal {
  id: string;
  surface: string;
  language: "en";
  register: EnglishConversationFrame["register"];
  sourceFamily:
    | "direct"
    | "contracted"
    | "correction-ack"
    | "casual-ack"
    | "compact-followup";
  constructionIds: string[];
  sourceFrameId: string;
  preserveTerms: string[];
  annotations?: Record<string, JsonValue>;
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;
const probability = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

const normalize = (surface: string): string =>
  surface
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\s+([.,!?;:])/gu, "$1");

const preserveExactTerms = (
  surface: string,
  terms: readonly string[],
): boolean => terms.every((term) => surface.includes(term));

const proposal = (
  frame: EnglishConversationFrame,
  id: string,
  surface: string,
  sourceFamily: EnglishConversationProposal["sourceFamily"],
  constructionIds: string[],
): EnglishConversationProposal => ({
  id,
  surface: normalize(surface),
  language: "en",
  register: frame.register,
  sourceFamily,
  constructionIds,
  sourceFrameId: frame.id,
  preserveTerms: [...new Set(frame.preserveTerms ?? [])],
  ...(frame.annotations === undefined
    ? {}
    : { annotations: structuredClone(frame.annotations) }),
});

const contractionRules: Array<[RegExp, string]> = [
  [/\bI am\b/gu, "I'm"],
  [/\bI have\b/gu, "I've"],
  [/\bI will\b/gu, "I'll"],
  [/\bI would\b/gu, "I'd"],
  [/\bwe are\b/giu, "we're"],
  [/\bwe have\b/giu, "we've"],
  [/\bwe will\b/giu, "we'll"],
  [/\bit is\b/giu, "it's"],
  [/\bthat is\b/giu, "that's"],
  [/\bdo not\b/giu, "don't"],
  [/\bdoes not\b/giu, "doesn't"],
  [/\bdid not\b/giu, "didn't"],
  [/\bcannot\b/giu, "can't"],
  [/\bcan not\b/giu, "can't"],
  [/\bwill not\b/giu, "won't"],
  [/\bis not\b/giu, "isn't"],
  [/\bare not\b/giu, "aren't"],
  [/\bhave not\b/giu, "haven't"],
  [/\bhas not\b/giu, "hasn't"],
];

const contractEnglish = (surface: string): string => {
  let output = surface;
  for (const [pattern, replacement] of contractionRules) {
    output = output.replace(pattern, replacement);
  }
  return normalize(output);
};

const lowerInitial = (surface: string): string =>
  surface.length === 0
    ? surface
    : surface.charAt(0).toLocaleLowerCase("en") + surface.slice(1);

const correctionPrefix = (surface: string): string =>
  normalize(`Right — ${lowerInitial(surface)}`);

const casualPrefix = (surface: string): string =>
  normalize(`Got it — ${lowerInitial(surface)}`);

const compactFollowup = (surface: string): string | undefined => {
  const patterns: Array<[RegExp, string]> = [
    [/^You can use (.+)$/u, "Use $1"],
    [/^You should use (.+)$/u, "Use $1"],
    [/^For Windows, you can use (.+)$/u, "On Windows, use $1"],
    [/^For macOS, you can use (.+)$/u, "On macOS, use $1"],
  ];
  for (const [pattern, replacement] of patterns) {
    if (pattern.test(surface)) return normalize(surface.replace(pattern, replacement));
  }
  return undefined;
};

export const generateEnglishConversationProposals = (
  frame: EnglishConversationFrame,
): Result<EnglishConversationProposal[]> => {
  if (
    !nonEmpty(frame.id) ||
    !nonEmpty(frame.content) ||
    !probability(frame.politeness) ||
    (frame.preserveTerms ?? []).some((term) => !nonEmpty(term))
  ) {
    return err(
      new StructuredError(
        "LANG_EN_CONVERSATION_FRAME",
        "English conversation frames require id/content, politeness in [0,1], and valid preserved terms.",
      ),
    );
  }

  const base = normalize(frame.content);
  const terms = [...new Set(frame.preserveTerms ?? [])];
  if (!preserveExactTerms(base, terms)) {
    return err(
      new StructuredError(
        "LANG_EN_CONVERSATION_OPAQUE_TERM",
        "The base English conversation surface already corrupts a required preserved term.",
      ),
    );
  }

  const output: EnglishConversationProposal[] = [
    proposal(
      frame,
      `${frame.id}:direct`,
      base,
      "direct",
      ["construction:en:conversation:direct"],
    ),
  ];

  if (
    frame.allowContractions === true &&
    (frame.register === "casual" ||
      frame.register === "neutral" ||
      frame.register === "professional")
  ) {
    const contracted = contractEnglish(base);
    if (contracted !== base && preserveExactTerms(contracted, terms)) {
      output.push(
        proposal(
          frame,
          `${frame.id}:contracted`,
          contracted,
          "contracted",
          ["construction:en:conversation:contraction"],
        ),
      );
    }
  }

  if (
    frame.allowDiscourseMarker === true &&
    frame.dialogueAct === "correct" &&
    !/^right\b/iu.test(base)
  ) {
    output.push(
      proposal(
        frame,
        `${frame.id}:correction-ack`,
        correctionPrefix(base),
        "correction-ack",
        ["construction:en:conversation:correction-ack"],
      ),
    );
  }

  if (
    frame.allowDiscourseMarker === true &&
    (frame.relation === "peer" || frame.relation === "close") &&
    (frame.register === "casual" || frame.register === "neutral") &&
    frame.dialogueAct === "acknowledge" &&
    !/^got it\b/iu.test(base)
  ) {
    output.push(
      proposal(
        frame,
        `${frame.id}:casual-ack`,
        casualPrefix(base),
        "casual-ack",
        ["construction:en:conversation:got-it"],
      ),
    );
  }

  if (
    frame.allowCompactFollowup === true &&
    ["answer", "instruct"].includes(frame.dialogueAct)
  ) {
    const compact = compactFollowup(base);
    if (
      compact !== undefined &&
      compact !== base &&
      preserveExactTerms(compact, terms)
    ) {
      output.push(
        proposal(
          frame,
          `${frame.id}:compact-followup`,
          compact,
          "compact-followup",
          ["construction:en:conversation:compact-followup"],
        ),
      );
    }
  }

  return ok([
    ...new Map(
      output
        .filter((item) => preserveExactTerms(item.surface, terms))
        .map((item) => [item.surface, item] as const),
    ).values(),
  ]);
};

export const promoteEnglishConversationProposal = (
  proposalValue: EnglishConversationProposal,
  semanticEvidenceRefs: readonly string[],
): Result<ConversationSurfaceDraft> => {
  if (
    semanticEvidenceRefs.length === 0 ||
    semanticEvidenceRefs.some((ref) => !nonEmpty(ref)) ||
    !preserveExactTerms(proposalValue.surface, proposalValue.preserveTerms)
  ) {
    return err(
      new StructuredError(
        "LANG_EN_CONVERSATION_PROMOTION",
        "An English conversation proposal can enter the ranking lattice only after independent semantic verification evidence exists.",
      ),
    );
  }

  return ok({
    id: proposalValue.id,
    surface: proposalValue.surface,
    language: proposalValue.language,
    register: proposalValue.register,
    semanticPreservationVerified: true,
    semanticEvidenceRefs: [...new Set(semanticEvidenceRefs)],
    sourceFamily: proposalValue.sourceFamily,
    constructionIds: [...proposalValue.constructionIds],
    annotations: {
      sourceFrameId: proposalValue.sourceFrameId,
      ...(proposalValue.annotations ?? {}),
    },
  });
};
