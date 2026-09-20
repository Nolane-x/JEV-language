import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";

export type ConversationRegister =
  | "intimate"
  | "casual"
  | "neutral"
  | "professional"
  | "formal"
  | "unknown";

export interface ConversationalCandidate {
  id: string;
  surface: string;
  language: string;
  register: ConversationRegister;
  semanticEvidenceRefs: string[];
  semanticPreservationVerified: true;
  annotations?: Record<string, JsonValue>;
}

export interface ConversationCandidateSet {
  id: string;
  targetLanguage: string;
  dialogueContext: JsonValue;
  responseSemantics: JsonValue;
  candidates: ConversationalCandidate[];
}

export interface ConversationRankAnswer {
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export type ConversationCandidateSelection =
  | {
      status: "selected";
      candidate: ConversationalCandidate;
      confidence: number;
      margin: number;
    }
  | {
      status: "ambiguous";
      candidates: ConversationalCandidate[];
      confidence: number;
      margin: number;
      reason: "low-confidence" | "low-margin";
    };

const nonEmpty = (value: string): boolean => value.trim().length > 0;

const normalizedSurface = (surface: string): string =>
  surface.normalize("NFC").trim().replace(/\s+/gu, " ");

export const validateConversationCandidateSet = (
  input: ConversationCandidateSet,
): Result<ConversationCandidateSet> => {
  if (
    !nonEmpty(input.id) ||
    !nonEmpty(input.targetLanguage) ||
    input.candidates.length < 2 ||
    input.candidates.length > 32
  ) {
    return err(
      new StructuredError(
        "REALIZE_CONVERSATION_CANDIDATE_SET",
        "Conversation candidate sets require an id, target language, and between 2 and 32 candidates.",
      ),
    );
  }

  const ids = new Set<string>();
  const surfaces = new Set<string>();
  for (const candidate of input.candidates) {
    const surface = normalizedSurface(candidate.surface);
    if (
      !nonEmpty(candidate.id) ||
      ids.has(candidate.id) ||
      !nonEmpty(surface) ||
      surfaces.has(surface) ||
      !nonEmpty(candidate.language) ||
      candidate.semanticPreservationVerified !== true ||
      candidate.semanticEvidenceRefs.length === 0 ||
      candidate.semanticEvidenceRefs.some((ref) => !nonEmpty(ref))
    ) {
      return err(
        new StructuredError(
          "REALIZE_CONVERSATION_CANDIDATE",
          "Conversational candidates require unique ids/surfaces, a language, verified semantic preservation, and evidence references.",
        ),
      );
    }
    ids.add(candidate.id);
    surfaces.add(surface);
  }

  return ok(structuredClone(input));
};

export const conversationRankingState = (
  input: ConversationCandidateSet,
): Result<Record<string, JsonValue>> => {
  const validated = validateConversationCandidateSet(input);
  if (!validated.ok) return validated;

  return ok({
    targetLanguage: validated.value.targetLanguage,
    dialogueContext: structuredClone(validated.value.dialogueContext),
    responseSemantics: structuredClone(validated.value.responseSemantics),
    candidates: Object.fromEntries(
      validated.value.candidates.map((candidate) => [
        candidate.id,
        {
          surface: candidate.surface,
          language: candidate.language,
          register: candidate.register,
        },
      ]),
    ),
  });
};

const probabilitySummary = (
  answer: ConversationRankAnswer,
): { confidence: number; margin: number } => {
  const probabilities = Object.values(answer.probabilities ?? {})
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    .sort((a, b) => b - a);
  const confidence =
    typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
      ? Math.max(0, Math.min(1, answer.confidence))
      : (probabilities[0] ?? 0);
  const margin = Math.max(0, (probabilities[0] ?? confidence) - (probabilities[1] ?? 0));
  return { confidence, margin };
};

export const selectConversationCandidate = (
  set: ConversationCandidateSet,
  answer: ConversationRankAnswer,
  thresholds: { minConfidence?: number; minMargin?: number } = {},
): Result<ConversationCandidateSelection> => {
  const validated = validateConversationCandidateSet(set);
  if (!validated.ok) return validated;

  const candidate = validated.value.candidates.find(
    (entry) => entry.id === answer.choice,
  );
  if (candidate === undefined) {
    return err(
      new StructuredError(
        "REALIZE_CONVERSATION_CHOICE_UNKNOWN",
        "Jev selected a conversational candidate that was not present in the bounded candidate set.",
      ),
    );
  }

  const minConfidence = thresholds.minConfidence ?? 0.62;
  const minMargin = thresholds.minMargin ?? 0.08;
  if (
    !Number.isFinite(minConfidence) ||
    minConfidence < 0 ||
    minConfidence > 1 ||
    !Number.isFinite(minMargin) ||
    minMargin < 0 ||
    minMargin > 1
  ) {
    return err(
      new StructuredError(
        "REALIZE_CONVERSATION_THRESHOLD",
        "Conversation ranking thresholds must be probabilities in [0, 1].",
      ),
    );
  }

  const { confidence, margin } = probabilitySummary(answer);
  if (confidence < minConfidence || margin < minMargin) {
    return ok({
      status: "ambiguous",
      candidates: structuredClone(validated.value.candidates),
      confidence,
      margin,
      reason: confidence < minConfidence ? "low-confidence" : "low-margin",
    });
  }

  return ok({
    status: "selected",
    candidate: structuredClone(candidate),
    confidence,
    margin,
  });
};
