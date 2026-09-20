import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import {
  buildConversationCandidateSet,
  type BuildConversationCandidateSetInput,
  type ConversationCandidateLatticeReport,
} from "./conversation-lattice.ts";
import {
  conversationRankingState,
  selectConversationCandidate,
  type ConversationCandidateSelection,
  type ConversationRankAnswer,
} from "./conversation-candidates.ts";
import {
  recordConversationStyle,
  type ConversationStyleMemory,
} from "./conversation-style-memory.ts";

export interface ConversationRanker {
  rank(
    state: Record<string, JsonValue>,
  ): Promise<Result<ConversationRankAnswer>>;
}

export interface ConversationSelectionPipelineInput
  extends BuildConversationCandidateSetInput {
  ranker: ConversationRanker;
  minConfidence?: number;
  minMargin?: number;
}

export interface ConversationSelectionPipelineResult {
  selection: ConversationCandidateSelection;
  candidateReport: ConversationCandidateLatticeReport;
  rankAnswer: ConversationRankAnswer;
  updatedStyleMemory?: ConversationStyleMemory;
  trace: {
    candidateSetId: string;
    candidateIds: string[];
    selectedCandidateId: string | null;
    styleMemoryRecorded: boolean;
  };
}

const stringArray = (value: JsonValue | undefined): string[] => {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    return [];
  }
  return [...new Set(value as string[])];
};

const stringValue = (value: JsonValue | undefined): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

export const runConversationSelectionPipeline = async (
  input: ConversationSelectionPipelineInput,
): Promise<Result<ConversationSelectionPipelineResult>> => {
  const built = buildConversationCandidateSet(input);
  if (!built.ok) return built;

  const state = conversationRankingState(built.value.set);
  if (!state.ok) return state;

  const ranked = await input.ranker.rank(state.value);
  if (!ranked.ok) return ranked;

  const selection = selectConversationCandidate(
    built.value.set,
    ranked.value,
    {
      ...(input.minConfidence === undefined
        ? {}
        : { minConfidence: input.minConfidence }),
      ...(input.minMargin === undefined ? {} : { minMargin: input.minMargin }),
    },
  );
  if (!selection.ok) return selection;

  let updatedStyleMemory = input.styleMemory;
  let styleMemoryRecorded = false;

  if (
    selection.value.status === "selected" &&
    updatedStyleMemory !== undefined
  ) {
    const annotations = selection.value.candidate.annotations ?? {};
    const sourceFamily = stringValue(annotations.sourceFamily);
    const constructionIds = stringArray(annotations.constructionIds);
    if (sourceFamily === undefined || constructionIds.length === 0) {
      return err(
        new StructuredError(
          "REALIZE_CONVERSATION_PIPELINE_STYLE_METADATA",
          "Selected conversation candidates must retain sourceFamily and constructionIds before style memory can be updated.",
        ),
      );
    }

    const recorded = recordConversationStyle(updatedStyleMemory, {
      surface: selection.value.candidate.surface,
      sourceFamily,
      constructionIds,
    });
    if (!recorded.ok) return recorded;
    updatedStyleMemory = recorded.value;
    styleMemoryRecorded = true;
  }

  return ok({
    selection: selection.value,
    candidateReport: built.value.report,
    rankAnswer: structuredClone(ranked.value),
    ...(updatedStyleMemory === undefined
      ? {}
      : { updatedStyleMemory: structuredClone(updatedStyleMemory) }),
    trace: {
      candidateSetId: built.value.set.id,
      candidateIds: built.value.set.candidates.map((candidate) => candidate.id),
      selectedCandidateId:
        selection.value.status === "selected"
          ? selection.value.candidate.id
          : null,
      styleMemoryRecorded,
    },
  });
};
