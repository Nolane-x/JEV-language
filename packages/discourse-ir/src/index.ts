import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  ModalitySpec,
  Polarity,
  SemanticRef,
  SemanticValue,
} from "../../semantic-graph/src/index.ts";

export type DiscourseUnitKind =
  | "answer"
  | "claim"
  | "explanation"
  | "evidence"
  | "example"
  | "definition"
  | "contrast"
  | "comparison"
  | "qualification"
  | "exception"
  | "correction"
  | "condition"
  | "warning"
  | "question"
  | "acknowledgement"
  | "instruction"
  | "summary"
  | "transition"
  | "conclusion";

export type DiscourseRelationKind =
  | "cause"
  | "evidence"
  | "contrast"
  | "elaboration"
  | "condition"
  | "example"
  | "sequence"
  | "restatement"
  | "supports"
  | "explains"
  | "qualifies"
  | "precondition-for"
  | "result-of";

export type DiscourseGoalKind =
  | "answer"
  | "explain"
  | "define"
  | "compare"
  | "instruct"
  | "warn"
  | "summarize"
  | "correct"
  | "ask"
  | "acknowledge"
  | "other";

export interface DiscourseGoal {
  kind: DiscourseGoalKind;
  semanticRoots: SemanticRef[];
  targetLength?: "minimal" | "concise" | "normal" | "detailed" | "exhaustive";
  annotations?: Record<string, JsonValue>;
}

export interface DiscourseUnit {
  id: string;
  kind: DiscourseUnitKind;
  semanticRefs: SemanticRef[];
  children?: string[];
  required?: boolean;
  importance?: number;
  annotations?: Record<string, JsonValue>;
}

export interface DiscourseRelation {
  id: string;
  kind: DiscourseRelationKind;
  nucleus: string;
  satellite: string;
  annotations?: Record<string, JsonValue>;
}

export type OrderingConstraintKind =
  | "logical-prerequisite"
  | "chronology"
  | "question-answer-adjacency"
  | "contrast-pairing"
  | "reference-availability"
  | "configured";

export interface OrderingConstraint {
  id: string;
  before: string;
  after: string;
  kind: OrderingConstraintKind;
  hard: boolean;
  rationale?: string;
}

export interface DiscoursePlan {
  id: string;
  goal: DiscourseGoal;
  units: DiscourseUnit[];
  relations: DiscourseRelation[];
  orderingConstraints: OrderingConstraint[];
  annotations?: Record<string, JsonValue>;
}

export type ClauseType =
  | "declarative"
  | "yes-no-question"
  | "wh-question"
  | "imperative"
  | "fragment"
  | "other";

export interface PlannedRole {
  role: SemanticId;
  value: SemanticValue;
  syntacticHint?: string;
  discourseStatus?: "given" | "new" | "contrastive";
}

export interface TenseAspectPlan {
  tense?: "past" | "present" | "future" | "none" | "language-default";
  aspect?: "simple" | "progressive" | "perfect" | "habitual" | "completed" | "ongoing";
  temporalAnchor?: SemanticRef;
}

export interface InformationStructure {
  topicRefs?: SemanticRef[];
  focusRefs?: SemanticRef[];
  givenRefs?: SemanticRef[];
  newRefs?: SemanticRef[];
  contrastiveFocusRefs?: SemanticRef[];
}

export interface ClausePlan {
  id: string;
  sourceUnitId: string;
  predicate: SemanticId;
  roles: PlannedRole[];
  clauseType: ClauseType;
  polarity: Polarity;
  tenseAspect?: TenseAspectPlan;
  modality?: ModalitySpec;
  informationStructure?: InformationStructure;
  aggregationGroup?: string;
  annotations?: Record<string, JsonValue>;
}

export interface ContentCandidate {
  semanticRef: SemanticRef;
  unitKind: DiscourseUnitKind;
  relevance: number;
  novelty: number;
  evidenceStrength: number;
  uncertainty: number;
  prerequisiteRefs?: SemanticRef[];
  required?: boolean;
  annotations?: Record<string, JsonValue>;
}

export interface ContentSelectionPolicy {
  maxUnits: number;
  minEvidenceStrength?: number;
  maxUncertainty?: number;
  weights?: {
    relevance: number;
    novelty: number;
    evidenceStrength: number;
    uncertaintyPenalty: number;
  };
}

export interface ContentSelectionResult {
  selected: ContentCandidate[];
  rejected: Array<{
    candidate: ContentCandidate;
    reason:
      | "budget"
      | "missing-prerequisite"
      | "weak-evidence"
      | "too-uncertain";
  }>;
}

export interface DiscourseOrderingResult {
  orderedUnitIds: string[];
  ignoredSoftConstraints: string[];
}

const isUnitScore = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

const validateCandidate = (candidate: ContentCandidate): Result<void> => {
  for (const [name, value] of Object.entries({
    relevance: candidate.relevance,
    novelty: candidate.novelty,
    evidenceStrength: candidate.evidenceStrength,
    uncertainty: candidate.uncertainty,
  })) {
    if (!isUnitScore(value)) {
      return err(
        new StructuredError(
          "DIR_CONTENT_SCORE",
          `Content candidate ${candidate.semanticRef} has invalid ${name}; expected [0,1].`,
        ),
      );
    }
  }
  return ok(undefined);
};

export const validateDiscoursePlan = (
  plan: DiscoursePlan,
): Result<DiscoursePlan> => {
  if (plan.id.trim() === "") {
    return err(
      new StructuredError("DIR_PLAN_ID", "Discourse plan id is required."),
    );
  }

  const unitIds = new Set<string>();
  for (const unit of plan.units) {
    if (unit.id.trim() === "" || unitIds.has(unit.id)) {
      return err(
        new StructuredError(
          "DIR_UNIT_ID",
          `Discourse plan contains an empty or duplicate unit id: ${unit.id}.`,
        ),
      );
    }
    unitIds.add(unit.id);
    if (
      unit.importance !== undefined &&
      (!Number.isFinite(unit.importance) ||
        unit.importance < 0 ||
        unit.importance > 1)
    ) {
      return err(
        new StructuredError(
          "DIR_UNIT_IMPORTANCE",
          `Discourse unit ${unit.id} importance must be in [0,1].`,
        ),
      );
    }
  }

  for (const unit of plan.units) {
    for (const child of unit.children ?? []) {
      if (!unitIds.has(child)) {
        return err(
          new StructuredError(
            "DIR_CHILD_MISSING",
            `Discourse unit ${unit.id} references missing child ${child}.`,
          ),
        );
      }
    }
  }

  const relationIds = new Set<string>();
  for (const relation of plan.relations) {
    if (relation.id.trim() === "" || relationIds.has(relation.id)) {
      return err(
        new StructuredError(
          "DIR_RELATION_ID",
          `Discourse relation id is empty or duplicated: ${relation.id}.`,
        ),
      );
    }
    relationIds.add(relation.id);
    if (!unitIds.has(relation.nucleus) || !unitIds.has(relation.satellite)) {
      return err(
        new StructuredError(
          "DIR_RELATION_ENDPOINT",
          `Discourse relation ${relation.id} references a missing unit.`,
        ),
      );
    }
    if (relation.nucleus === relation.satellite) {
      return err(
        new StructuredError(
          "DIR_RELATION_SELF",
          `Discourse relation ${relation.id} cannot relate a unit to itself.`,
        ),
      );
    }
  }

  const orderingIds = new Set<string>();
  for (const constraint of plan.orderingConstraints) {
    if (constraint.id.trim() === "" || orderingIds.has(constraint.id)) {
      return err(
        new StructuredError(
          "DIR_ORDER_ID",
          `Ordering constraint id is empty or duplicated: ${constraint.id}.`,
        ),
      );
    }
    orderingIds.add(constraint.id);
    if (!unitIds.has(constraint.before) || !unitIds.has(constraint.after)) {
      return err(
        new StructuredError(
          "DIR_ORDER_ENDPOINT",
          `Ordering constraint ${constraint.id} references a missing unit.`,
        ),
      );
    }
    if (constraint.before === constraint.after) {
      return err(
        new StructuredError(
          "DIR_ORDER_SELF",
          `Ordering constraint ${constraint.id} cannot order a unit before itself.`,
        ),
      );
    }
  }

  const ordered = orderDiscourse(plan);
  if (!ordered.ok) return ordered as Result<DiscoursePlan>;

  return ok(structuredClone(plan));
};

const scoreCandidate = (
  candidate: ContentCandidate,
  policy: ContentSelectionPolicy,
): number => {
  const weights = policy.weights ?? {
    relevance: 0.45,
    novelty: 0.2,
    evidenceStrength: 0.35,
    uncertaintyPenalty: 0.35,
  };
  return (
    candidate.relevance * weights.relevance +
    candidate.novelty * weights.novelty +
    candidate.evidenceStrength * weights.evidenceStrength -
    candidate.uncertainty * weights.uncertaintyPenalty
  );
};

export const selectContent = (
  candidates: readonly ContentCandidate[],
  policy: ContentSelectionPolicy,
  alreadyKnown: ReadonlySet<SemanticRef> = new Set(),
): Result<ContentSelectionResult> => {
  if (!Number.isInteger(policy.maxUnits) || policy.maxUnits < 1) {
    return err(
      new StructuredError(
        "DIR_CONTENT_BUDGET",
        "Content selection maxUnits must be a positive integer.",
      ),
    );
  }

  for (const candidate of candidates) {
    const valid = validateCandidate(candidate);
    if (!valid.ok) return valid;
  }

  const selected: ContentCandidate[] = [];
  const rejected: ContentSelectionResult["rejected"] = [];
  const available = new Set<SemanticRef>(alreadyKnown);
  const pending = [...candidates].sort(
    (left, right) =>
      Number(right.required === true) - Number(left.required === true) ||
      scoreCandidate(right, policy) - scoreCandidate(left, policy) ||
      String(left.semanticRef).localeCompare(String(right.semanticRef)),
  );

  while (pending.length > 0 && selected.length < policy.maxUnits) {
    let madeProgress = false;

    for (let index = 0; index < pending.length; index += 1) {
      const candidate = pending[index];
      if (candidate === undefined) continue;

      if (
        policy.minEvidenceStrength !== undefined &&
        candidate.evidenceStrength < policy.minEvidenceStrength &&
        candidate.required !== true
      ) {
        rejected.push({ candidate, reason: "weak-evidence" });
        pending.splice(index, 1);
        index -= 1;
        continue;
      }
      if (
        policy.maxUncertainty !== undefined &&
        candidate.uncertainty > policy.maxUncertainty &&
        candidate.required !== true
      ) {
        rejected.push({ candidate, reason: "too-uncertain" });
        pending.splice(index, 1);
        index -= 1;
        continue;
      }

      const prerequisites = candidate.prerequisiteRefs ?? [];
      if (prerequisites.every((ref) => available.has(ref))) {
        selected.push(candidate);
        available.add(candidate.semanticRef);
        pending.splice(index, 1);
        madeProgress = true;
        break;
      }
    }

    if (!madeProgress) break;
  }

  for (const candidate of pending) {
    const missing = (candidate.prerequisiteRefs ?? []).some(
      (ref) => !available.has(ref),
    );
    rejected.push({
      candidate,
      reason: missing ? "missing-prerequisite" : "budget",
    });
  }

  return ok({
    selected: selected.map((candidate) => structuredClone(candidate)),
    rejected: rejected.map((entry) => structuredClone(entry)),
  });
};

export const orderDiscourse = (
  plan: Pick<DiscoursePlan, "units" | "orderingConstraints">,
): Result<DiscourseOrderingResult> => {
  const unitIds = plan.units.map((unit) => unit.id);
  const unitSet = new Set(unitIds);
  const hard = plan.orderingConstraints.filter((constraint) => constraint.hard);
  const soft = plan.orderingConstraints.filter((constraint) => !constraint.hard);

  for (const constraint of plan.orderingConstraints) {
    if (!unitSet.has(constraint.before) || !unitSet.has(constraint.after)) {
      return err(
        new StructuredError(
          "DIR_ORDER_ENDPOINT",
          `Ordering constraint ${constraint.id} references a missing unit.`,
        ),
      );
    }
  }

  const indegree = new Map(unitIds.map((id) => [id, 0] as const));
  const edges = new Map(unitIds.map((id) => [id, new Set<string>()] as const));
  for (const constraint of hard) {
    const targets = edges.get(constraint.before);
    if (targets === undefined || targets.has(constraint.after)) continue;
    targets.add(constraint.after);
    indegree.set(
      constraint.after,
      (indegree.get(constraint.after) ?? 0) + 1,
    );
  }

  const softPreference = new Map<string, number>();
  for (const constraint of soft) {
    softPreference.set(
      constraint.before,
      (softPreference.get(constraint.before) ?? 0) + 1,
    );
  }

  const ready = unitIds
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort(
      (left, right) =>
        (softPreference.get(right) ?? 0) -
          (softPreference.get(left) ?? 0) ||
        unitIds.indexOf(left) - unitIds.indexOf(right),
    );

  const ordered: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift();
    if (current === undefined) break;
    ordered.push(current);

    for (const target of edges.get(current) ?? []) {
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) {
        ready.push(target);
        ready.sort(
          (left, right) =>
            (softPreference.get(right) ?? 0) -
              (softPreference.get(left) ?? 0) ||
            unitIds.indexOf(left) - unitIds.indexOf(right),
        );
      }
    }
  }

  if (ordered.length !== unitIds.length) {
    return err(
      new StructuredError(
        "DIR_ORDER_CYCLE",
        "Hard discourse ordering constraints contain a cycle.",
      ),
    );
  }

  const positions = new Map(ordered.map((id, index) => [id, index] as const));
  const ignoredSoftConstraints = soft
    .filter(
      (constraint) =>
        (positions.get(constraint.before) ?? -1) >=
        (positions.get(constraint.after) ?? -1),
    )
    .map((constraint) => constraint.id);

  return ok({ orderedUnitIds: ordered, ignoredSoftConstraints });
};

export const discourseRelationDefinition = (
  kind: DiscourseRelationKind,
): string => {
  switch (kind) {
    case "cause":
      return "The satellite gives a cause or reason for the nucleus.";
    case "evidence":
    case "supports":
      return "The satellite supplies support for the nucleus.";
    case "contrast":
      return "The units are semantically contrasted.";
    case "elaboration":
      return "The satellite adds detail to the nucleus.";
    case "condition":
    case "precondition-for":
      return "The satellite states a condition required for the nucleus.";
    case "example":
      return "The satellite instantiates or exemplifies the nucleus.";
    case "sequence":
      return "The nucleus precedes the satellite in an intended sequence.";
    case "restatement":
      return "The satellite restates the nucleus with preserved core meaning.";
    case "explains":
      return "The satellite explains how or why the nucleus holds.";
    case "qualifies":
      return "The satellite limits or qualifies the nucleus.";
    case "result-of":
      return "The nucleus is a result of the satellite.";
  }
};
