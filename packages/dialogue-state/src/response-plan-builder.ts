import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import {
  validateResponseSemanticPlan,
  type ResponseDialogueAct,
  type ResponseEpistemicStance,
  type ResponseLength,
  type ResponseSemanticPlan,
  type ResponseSocialContext,
} from "../../discourse-ir/src/index.ts";
import {
  validateDialogueState,
  type DialogueActKind,
  type DialogueState,
  type DialogueTurn,
} from "./state.ts";

export interface DialogueResponsePlanInput {
  state: DialogueState;
  responseId: string;
  respondingToParticipantId: string;
  targetLanguage: string;
  requiredSemanticRefs: SemanticId[];
  optionalSemanticRefs?: SemanticId[];
  requestedActionRef?: SemanticId;
  epistemic: ResponseEpistemicStance;
  social: ResponseSocialContext;
  desiredLength: ResponseLength;
  allowCodeSwitch: boolean;
  preserveOpaqueTerms: boolean;
  dialogueActOverride?: ResponseDialogueAct;
  annotations?: Record<string, JsonValue>;
}

const nonEmpty = (value: string): boolean => value.trim() !== "";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const responseActFromTurn = (
  turn: DialogueTurn,
  hasCorrection: boolean,
): ResponseDialogueAct => {
  if (hasCorrection) return "acknowledge";

  const kinds = new Set<DialogueActKind>(
    turn.dialogueActs.map((act) => act.kind),
  );

  if (
    kinds.has("ASK") ||
    kinds.has("CONFIRM") ||
    kinds.has("DEFINE") ||
    kinds.has("EXPLAIN") ||
    kinds.has("COMPARE") ||
    kinds.has("CLARIFY")
  ) {
    return "answer";
  }
  if (kinds.has("SUMMARIZE")) return "summarize";
  if (kinds.has("CONTINUE")) return "continue";
  if (kinds.has("REQUEST")) return "answer";
  if (
    kinds.has("ACKNOWLEDGE") ||
    kinds.has("ACCEPT") ||
    kinds.has("DECLINE") ||
    kinds.has("OFFER")
  ) {
    return "social";
  }
  if (
    kinds.has("CORRECT") ||
    kinds.has("RETRACT") ||
    kinds.has("DENY")
  ) {
    return "acknowledge";
  }
  if (kinds.has("ASSERT")) return "acknowledge";
  return "other";
};

const latestTurnByParticipant = (
  state: DialogueState,
  participantId: string,
): DialogueTurn | undefined =>
  [...state.turns]
    .reverse()
    .find((turn) => turn.participant === participantId);

const activeTopicRefs = (state: DialogueState): SemanticId[] => {
  if (state.activeTopic === undefined) return [];
  const topic = state.topics.find(
    (candidate) => candidate.id === state.activeTopic,
  );
  return topic === undefined
    ? []
    : unique(topic.relatedEntities);
};

export const buildResponseSemanticPlanFromDialogueState = (
  input: DialogueResponsePlanInput,
): Result<ResponseSemanticPlan> => {
  const state = validateDialogueState(input.state);
  if (!state.ok) return err(state.error);

  if (
    !nonEmpty(input.responseId) ||
    !nonEmpty(input.respondingToParticipantId) ||
    !nonEmpty(input.targetLanguage) ||
    !state.value.participants.some(
      (participant) => participant.id === input.respondingToParticipantId,
    )
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_RESPONSE_PLAN_INPUT",
        "Dialogue response planning requires response id, target language, and a known source participant.",
      ),
    );
  }

  const sourceTurn = latestTurnByParticipant(
    state.value,
    input.respondingToParticipantId,
  );
  if (sourceTurn === undefined) {
    return err(
      new StructuredError(
        "DIALOGUE_RESPONSE_PLAN_SOURCE_TURN",
        "No retained dialogue turn exists for the participant being answered.",
      ),
    );
  }

  const corrections = state.value.corrections.filter(
    (record) => record.turnId === sourceTurn.id,
  );
  const correctionOfRefs = unique(
    corrections.flatMap((record) => record.targetRefs),
  );

  const dialogueAct =
    input.dialogueActOverride ??
    responseActFromTurn(sourceTurn, corrections.length > 0);

  const referenceBindings = unique(sourceTurn.referencedEntities).map(
    (semanticRef, index) => ({
      mentionId: `${sourceTurn.id}:reference:${index + 1}`,
      semanticRef,
      confidence: 1,
      source: corrections.some((record) =>
        record.replacementRefs.includes(semanticRef),
      )
        ? ("user-correction" as const)
        : ("dialogue-state" as const),
    }),
  );

  const plan: ResponseSemanticPlan = {
    schemaVersion: "jl-response-semantic-plan-1",
    id: input.responseId,
    dialogueAct,
    targetLanguage: input.targetLanguage,
    requiredSemanticRefs: unique(input.requiredSemanticRefs),
    optionalSemanticRefs: unique(input.optionalSemanticRefs ?? []),
    activeTopicRefs: activeTopicRefs(state.value),
    ...(input.requestedActionRef === undefined
      ? {}
      : { requestedActionRef: input.requestedActionRef }),
    ...(correctionOfRefs.length === 0
      ? {}
      : { correctionOfRefs }),
    referenceBindings,
    epistemic: structuredClone(input.epistemic),
    social: structuredClone(input.social),
    desiredLength: input.desiredLength,
    allowCodeSwitch: input.allowCodeSwitch,
    preserveOpaqueTerms: input.preserveOpaqueTerms,
    annotations: {
      dialogueRevision: state.value.revision,
      sourceTurnId: sourceTurn.id,
      sourceTurnNumber: sourceTurn.turnNumber,
      sourceDialogueActs: sourceTurn.dialogueActs.map((act) => act.kind),
      activeTopicId: state.value.activeTopic ?? null,
      correctionCount: corrections.length,
      unresolvedReferenceCount: state.value.unresolvedReferences.length,
      ...(input.annotations ?? {}),
    },
  };

  const valid = validateResponseSemanticPlan(plan);
  if (!valid.ok) return err(valid.error);
  return ok(valid.value);
};
