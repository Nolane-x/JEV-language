import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  SemanticRef,
} from "../../semantic-graph/src/index.ts";
import type {
  DiscourseGoal,
  DiscourseGoalKind,
} from "./index.ts";

export type ResponseDialogueAct =
  | "answer"
  | "acknowledge"
  | "clarify"
  | "correct"
  | "ask"
  | "instruct"
  | "warn"
  | "summarize"
  | "continue"
  | "refuse"
  | "social"
  | "other";

export type ResponseRegister =
  | "intimate"
  | "casual"
  | "neutral"
  | "professional"
  | "formal"
  | "unknown";

export type ResponseLength =
  | "minimal"
  | "concise"
  | "normal"
  | "detailed"
  | "exhaustive";

export interface ResponseEpistemicStance {
  status: "certain" | "probable" | "uncertain" | "unknown";
  confidence: number;
  evidenceRefs?: string[];
}

export interface ResponseSocialContext {
  relation:
    | "self"
    | "peer"
    | "senior"
    | "junior"
    | "teacher"
    | "student"
    | "customer"
    | "service"
    | "stranger"
    | "close"
    | "unknown";
  register: ResponseRegister;
  politeness: number;
  speakerFormHint?: string;
  addresseeFormHint?: string;
}

export interface ResponseReferenceBinding {
  mentionId: string;
  semanticRef: SemanticRef;
  confidence: number;
  source: "explicit" | "dialogue-state" | "resolved" | "user-correction";
}

export interface ResponseSemanticPlan {
  schemaVersion: "jl-response-semantic-plan-1";
  id: string;
  dialogueAct: ResponseDialogueAct;
  targetLanguage: string;
  requiredSemanticRefs: SemanticRef[];
  optionalSemanticRefs: SemanticRef[];
  activeTopicRefs: SemanticRef[];
  requestedActionRef?: SemanticRef;
  correctionOfRefs?: SemanticRef[];
  referenceBindings: ResponseReferenceBinding[];
  epistemic: ResponseEpistemicStance;
  social: ResponseSocialContext;
  desiredLength: ResponseLength;
  allowCodeSwitch: boolean;
  preserveOpaqueTerms: boolean;
  annotations?: Record<string, JsonValue>;
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;

const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.every(nonEmpty) && new Set(values).size === values.length;

const probability = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

const discourseGoalForAct = (
  act: ResponseDialogueAct,
): DiscourseGoalKind => {
  switch (act) {
    case "answer":
      return "answer";
    case "acknowledge":
      return "acknowledge";
    case "clarify":
    case "ask":
      return "ask";
    case "correct":
      return "correct";
    case "instruct":
      return "instruct";
    case "warn":
    case "refuse":
      return "warn";
    case "summarize":
      return "summarize";
    case "continue":
    case "social":
    case "other":
      return "other";
  }
};

export const validateResponseSemanticPlan = (
  plan: ResponseSemanticPlan,
): Result<ResponseSemanticPlan> => {
  if (
    plan.schemaVersion !== "jl-response-semantic-plan-1" ||
    !nonEmpty(plan.id) ||
    !nonEmpty(plan.targetLanguage)
  ) {
    return err(
      new StructuredError(
        "DIR_RESPONSE_PLAN_IDENTITY",
        "Response semantic plans require the expected schema version, a stable id, and a target language.",
      ),
    );
  }

  const refFields = {
    requiredSemanticRefs: plan.requiredSemanticRefs,
    optionalSemanticRefs: plan.optionalSemanticRefs,
    activeTopicRefs: plan.activeTopicRefs,
    correctionOfRefs: plan.correctionOfRefs ?? [],
  };
  for (const [name, refs] of Object.entries(refFields)) {
    if (!uniqueNonEmpty(refs)) {
      return err(
        new StructuredError(
          "DIR_RESPONSE_PLAN_REFS",
          `Response semantic plan field ${name} must contain unique non-empty semantic references.`,
        ),
      );
    }
  }

  const required = new Set(plan.requiredSemanticRefs);
  if (plan.optionalSemanticRefs.some((ref) => required.has(ref))) {
    return err(
      new StructuredError(
        "DIR_RESPONSE_PLAN_REQUIRED_OPTIONAL_CONFLICT",
        "A semantic reference cannot be both required and optional in one response plan.",
      ),
    );
  }

  if (
    plan.requestedActionRef !== undefined &&
    !nonEmpty(plan.requestedActionRef)
  ) {
    return err(
      new StructuredError(
        "DIR_RESPONSE_PLAN_ACTION_REF",
        "requestedActionRef must be non-empty when present.",
      ),
    );
  }

  if (!probability(plan.epistemic.confidence)) {
    return err(
      new StructuredError(
        "DIR_RESPONSE_PLAN_EPISTEMIC",
        "Response epistemic confidence must be in [0,1].",
      ),
    );
  }
  if (
    plan.epistemic.evidenceRefs !== undefined &&
    !uniqueNonEmpty(plan.epistemic.evidenceRefs)
  ) {
    return err(
      new StructuredError(
        "DIR_RESPONSE_PLAN_EVIDENCE",
        "Response epistemic evidence references must be unique and non-empty.",
      ),
    );
  }
  if (
    plan.epistemic.status === "certain" &&
    plan.epistemic.confidence < 0.9
  ) {
    return err(
      new StructuredError(
        "DIR_RESPONSE_PLAN_CERTAINTY_CONFLICT",
        "A response marked certain must carry confidence >= 0.9.",
      ),
    );
  }
  if (
    plan.epistemic.status === "unknown" &&
    plan.epistemic.confidence > 0.5
  ) {
    return err(
      new StructuredError(
        "DIR_RESPONSE_PLAN_UNKNOWN_CONFLICT",
        "A response marked unknown must not carry confidence > 0.5.",
      ),
    );
  }

  if (!probability(plan.social.politeness)) {
    return err(
      new StructuredError(
        "DIR_RESPONSE_PLAN_POLITENESS",
        "Response politeness must be in [0,1].",
      ),
    );
  }

  const mentionIds = new Set<string>();
  for (const binding of plan.referenceBindings) {
    if (
      !nonEmpty(binding.mentionId) ||
      !nonEmpty(binding.semanticRef) ||
      mentionIds.has(binding.mentionId) ||
      !probability(binding.confidence)
    ) {
      return err(
        new StructuredError(
          "DIR_RESPONSE_PLAN_REFERENCE_BINDING",
          "Response reference bindings require unique mention ids, semantic refs, and confidence in [0,1].",
        ),
      );
    }
    mentionIds.add(binding.mentionId);
  }

  if (
    plan.dialogueAct === "correct" &&
    (plan.correctionOfRefs?.length ?? 0) === 0
  ) {
    return err(
      new StructuredError(
        "DIR_RESPONSE_PLAN_CORRECTION_TARGET",
        "Correction responses must identify at least one semantic reference being corrected.",
      ),
    );
  }

  if (
    plan.dialogueAct === "ask" &&
    plan.requiredSemanticRefs.length === 0 &&
    plan.requestedActionRef === undefined
  ) {
    return err(
      new StructuredError(
        "DIR_RESPONSE_PLAN_QUESTION_CONTENT",
        "Question responses must identify semantic content or a requested action.",
      ),
    );
  }

  return ok(structuredClone(plan));
};

export const responsePlanToDiscourseGoal = (
  plan: ResponseSemanticPlan,
): Result<DiscourseGoal> => {
  const valid = validateResponseSemanticPlan(plan);
  if (!valid.ok) return valid;

  const semanticRoots = [
    ...valid.value.requiredSemanticRefs,
    ...(valid.value.requestedActionRef === undefined
      ? []
      : [valid.value.requestedActionRef]),
  ];

  return ok({
    kind: discourseGoalForAct(valid.value.dialogueAct),
    semanticRoots: [...new Set(semanticRoots)],
    targetLength: valid.value.desiredLength,
    annotations: {
      responsePlanId: valid.value.id,
      targetLanguage: valid.value.targetLanguage,
      responseDialogueAct: valid.value.dialogueAct,
      responseRegister: valid.value.social.register,
      responseSocialRelation: valid.value.social.relation,
      responsePoliteness: valid.value.social.politeness,
      responseEpistemicStatus: valid.value.epistemic.status,
      responseEpistemicConfidence: valid.value.epistemic.confidence,
      allowCodeSwitch: valid.value.allowCodeSwitch,
      preserveOpaqueTerms: valid.value.preserveOpaqueTerms,
    },
  });
};

export const projectResponsePlanForSurfaceRanking = (
  plan: ResponseSemanticPlan,
): Result<Record<string, JsonValue>> => {
  const valid = validateResponseSemanticPlan(plan);
  if (!valid.ok) return valid;

  return ok({
    id: valid.value.id,
    dialogueAct: valid.value.dialogueAct,
    targetLanguage: valid.value.targetLanguage,
    requiredSemanticRefs: [...valid.value.requiredSemanticRefs],
    optionalSemanticRefs: [...valid.value.optionalSemanticRefs],
    activeTopicRefs: [...valid.value.activeTopicRefs],
    requestedActionRef: valid.value.requestedActionRef ?? null,
    correctionOfRefs: [...(valid.value.correctionOfRefs ?? [])],
    referenceBindings: valid.value.referenceBindings.map((binding) => ({
      mentionId: binding.mentionId,
      semanticRef: binding.semanticRef,
      confidence: binding.confidence,
      source: binding.source,
    })),
    epistemic: {
      status: valid.value.epistemic.status,
      confidence: valid.value.epistemic.confidence,
    },
    social: {
      relation: valid.value.social.relation,
      register: valid.value.social.register,
      politeness: valid.value.social.politeness,
      speakerFormHint: valid.value.social.speakerFormHint ?? null,
      addresseeFormHint: valid.value.social.addresseeFormHint ?? null,
    },
    desiredLength: valid.value.desiredLength,
    allowCodeSwitch: valid.value.allowCodeSwitch,
    preserveOpaqueTerms: valid.value.preserveOpaqueTerms,
  });
};
