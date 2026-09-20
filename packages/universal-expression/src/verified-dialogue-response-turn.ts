import {
  err,
  ok,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import {
  buildResponseSemanticPlanFromDialogueState,
  type DialogueResponsePlanInput,
  type DialogueState,
} from "../../dialogue-state/src/index.ts";
import type {
  ResponseSemanticPlan,
} from "../../discourse-ir/src/index.ts";
import type {
  ConversationRanker,
  ConversationStyleMemory,
} from "../../realizer-core/src/index.ts";
import type {
  GraphSnapshot,
} from "../../semantic-graph/src/index.ts";
import type {
  ConversationLanguageRoutingOptions,
} from "./conversation-language-router.ts";
import type {
  ConversationSurfaceParser,
  ConversationSurfaceParserIdentity,
} from "./conversation-verification.ts";
import {
  runVerifiedConversationTurn,
  type VerifiedConversationTurnResult,
} from "./verified-conversation-turn.ts";

export interface VerifiedDialogueResponseTurnInput {
  state: DialogueState;
  responsePlan: Omit<DialogueResponsePlanInput, "state">;
  candidateSetId: string;
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

export interface VerifiedDialogueResponseTurnResult {
  plan: ResponseSemanticPlan;
  turn: VerifiedConversationTurnResult;
}

export const runVerifiedDialogueResponseTurn = async (
  input: VerifiedDialogueResponseTurnInput,
): Promise<Result<VerifiedDialogueResponseTurnResult>> => {
  const plan = buildResponseSemanticPlanFromDialogueState({
    state: input.state,
    ...input.responsePlan,
  });
  if (!plan.ok) return err(plan.error);

  const turn = await runVerifiedConversationTurn({
    candidateSetId: input.candidateSetId,
    plan: plan.value,
    baseSurface: input.baseSurface,
    sourceSemantics: input.sourceSemantics,
    parser: input.parser,
    parserIdentity: input.parserIdentity,
    ranker: input.ranker,
    dialogueContext: input.dialogueContext,
    ...(input.routingOptions === undefined
      ? {}
      : { routingOptions: input.routingOptions }),
    ...(input.additionalEvidenceRefs === undefined
      ? {}
      : { additionalEvidenceRefs: input.additionalEvidenceRefs }),
    ...(input.styleMemory === undefined
      ? {}
      : { styleMemory: input.styleMemory }),
    ...(input.maxCandidates === undefined
      ? {}
      : { maxCandidates: input.maxCandidates }),
    ...(input.minConfidence === undefined
      ? {}
      : { minConfidence: input.minConfidence }),
    ...(input.minMargin === undefined
      ? {}
      : { minMargin: input.minMargin }),
  });
  if (!turn.ok) return err(turn.error);

  return ok({
    plan: plan.value,
    turn: turn.value,
  });
};
