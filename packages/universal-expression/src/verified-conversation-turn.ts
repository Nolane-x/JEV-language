import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  ResponseSemanticPlan,
} from "../../discourse-ir/src/index.ts";
import type {
  ConversationRanker,
  ConversationSelectionPipelineResult,
  ConversationStyleMemory,
} from "../../realizer-core/src/index.ts";
import {
  runConversationSelectionPipeline,
} from "../../realizer-core/src/index.ts";
import type {
  GraphSnapshot,
} from "../../semantic-graph/src/index.ts";
import {
  certifyConversationSurfaceDraftFromParser,
  type ConversationSurfaceParser,
  type ConversationSurfaceParserIdentity,
} from "./conversation-verification.ts";
import {
  routeConversationSurfaceProposals,
  type ConversationLanguageRoutingOptions,
} from "./conversation-language-router.ts";

export interface VerifiedConversationTurnInput {
  candidateSetId: string;
  plan: ResponseSemanticPlan;
  baseSurface: string;
  sourceSemantics: GraphSnapshot;
  parser: ConversationSurfaceParser;
  parserIdentity: ConversationSurfaceParserIdentity;
  ranker: ConversationRanker;
  dialogueContext: JsonValue;
  routingOptions?: ConversationLanguageRoutingOptions;
  additionalEvidenceRefs?: string[];
  styleMemory?: ConversationStyleMemory;
  maxCandidates?: number;
  minConfidence?: number;
  minMargin?: number;
}

export interface ConversationCertificationRejection {
  draftId: string;
  errorCode: string;
}

export interface VerifiedConversationTurnResult {
  languageFamily: "en" | "vi";
  proposalCount: number;
  certifiedCount: number;
  certificationRejections: ConversationCertificationRejection[];
  selection: ConversationSelectionPipelineResult;
}

const nonEmpty = (value: string): boolean => value.trim() !== "";

export const runVerifiedConversationTurn = async (
  input: VerifiedConversationTurnInput,
): Promise<Result<VerifiedConversationTurnResult>> => {
  if (!nonEmpty(input.candidateSetId)) {
    return err(
      new StructuredError(
        "EXPRESSION_CONVERSATION_TURN_ID",
        "Verified conversation turn requires a non-empty candidate-set id.",
      ),
    );
  }

  const routed = routeConversationSurfaceProposals(
    input.plan,
    input.baseSurface,
    input.routingOptions,
  );
  if (!routed.ok) return err(routed.error);

  const certifiedDrafts = [];
  const certificationRejections: ConversationCertificationRejection[] = [];

  for (const draft of routed.value.drafts) {
    const certified = await certifyConversationSurfaceDraftFromParser({
      draft,
      sourceSemantics: input.sourceSemantics,
      parser: input.parser,
      parserIdentity: input.parserIdentity,
      ...(input.additionalEvidenceRefs === undefined
        ? {}
        : { additionalEvidenceRefs: input.additionalEvidenceRefs }),
    });
    if (!certified.ok) {
      certificationRejections.push({
        draftId: draft.id,
        errorCode: certified.error.code,
      });
      continue;
    }
    certifiedDrafts.push(certified.value.draft);
  }

  if (certifiedDrafts.length < 2) {
    return err(
      new StructuredError(
        "EXPRESSION_CONVERSATION_TURN_CERTIFIED_RECALL",
        "Fewer than two conversational candidates survived exact-surface semantic certification.",
        {
          proposalCount: routed.value.drafts.length,
          certifiedCount: certifiedDrafts.length,
          rejections: certificationRejections.map((entry) => ({
            draftId: entry.draftId,
            errorCode: entry.errorCode,
          })),
        },
      ),
    );
  }

  const selected = await runConversationSelectionPipeline({
    id: input.candidateSetId,
    plan: input.plan,
    dialogueContext: input.dialogueContext,
    drafts: certifiedDrafts,
    ...(input.routingOptions?.opaqueTerms === undefined
      ? {}
      : { opaqueTerms: input.routingOptions.opaqueTerms }),
    ...(input.styleMemory === undefined
      ? {}
      : { styleMemory: input.styleMemory }),
    ...(input.maxCandidates === undefined
      ? {}
      : { maxCandidates: input.maxCandidates }),
    ranker: input.ranker,
    ...(input.minConfidence === undefined
      ? {}
      : { minConfidence: input.minConfidence }),
    ...(input.minMargin === undefined
      ? {}
      : { minMargin: input.minMargin }),
  });
  if (!selected.ok) return err(selected.error);

  return ok({
    languageFamily: routed.value.languageFamily,
    proposalCount: routed.value.drafts.length,
    certifiedCount: certifiedDrafts.length,
    certificationRejections,
    selection: selected.value,
  });
};
