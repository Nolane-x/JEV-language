import {
  canonicalJson,
  type JsonValue,
} from "../../core-types/src/index.ts";
import type { GraphSnapshot } from "../../semantic-graph/src/index.ts";
import {
  projectControlledCorpusSemantics,
  type ControlledCorpusProjection,
} from "./controlled-corpus-equivalence.ts";

export type MultilingualSemanticDimension =
  | "semantic-kind"
  | "predicate"
  | "roles"
  | "polarity"
  | "modality"
  | "quantity"
  | "time"
  | "condition"
  | "causality"
  | "attribution"
  | "reference"
  | "instruction-content";

export interface SemanticDimensionCheck {
  dimension: MultilingualSemanticDimension;
  status: "pass" | "fail" | "not-applicable";
  left?: JsonValue;
  right?: JsonValue;
}

export interface MultilingualSemanticEquivalenceReport {
  equivalent: boolean;
  checks: SemanticDimensionCheck[];
  leftProjection?: ControlledCorpusProjection;
  rightProjection?: ControlledCorpusProjection;
  diagnostics: string[];
}

type DimensionMap = Partial<
  Record<MultilingualSemanticDimension, JsonValue>
>;

const asJson = (value: unknown): JsonValue =>
  structuredClone(value) as JsonValue;

const constraintDimensions = (
  projection: Extract<ControlledCorpusProjection, { kind: "constraint" }>,
): DimensionMap => ({
  predicate: asJson({
    operation: projection.operation,
    predicate: projection.predicate,
  }),
  roles: asJson({ actorConcept: projection.actorConcept }),
  modality: projection.constraintKind,
  quantity: asJson(projection.quantity),
});

export const controlledProjectionDimensions = (
  projection: ControlledCorpusProjection,
): DimensionMap => {
  const base: DimensionMap = {
    "semantic-kind": projection.kind,
  };

  switch (projection.kind) {
    case "event":
      return {
        ...base,
        predicate: projection.operation,
        roles: asJson({ actorConcept: projection.actorConcept }),
        polarity: projection.polarity,
        quantity: asJson(projection.quantity),
        ...(projection.temporal === undefined
          ? {}
          : { time: asJson(projection.temporal) }),
      };
    case "constraint":
      return {
        ...base,
        ...constraintDimensions(projection),
      };
    case "condition":
      return {
        ...base,
        ...constraintDimensions(projection.main),
        condition: asJson({
          reasonPredicate: projection.reasonPredicate,
          relation: "condition",
        }),
      };
    case "cause":
      return {
        ...base,
        ...constraintDimensions(projection.main),
        causality: asJson({
          causePredicate: projection.reasonPredicate,
          direction: "reason-to-main",
        }),
      };
    case "question":
      return {
        ...base,
        predicate: projection.predicate,
        roles: asJson({ actorConcept: projection.actorConcept }),
        polarity: projection.polarity,
        ...(projection.modality === undefined
          ? {}
          : { modality: projection.modality }),
        quantity: asJson(projection.quantity),
      };
    case "attributed-proposition":
      return {
        ...base,
        predicate: projection.predicate,
        roles: asJson({ actorConcept: projection.actorConcept }),
        polarity: projection.polarity,
        quantity: asJson(projection.quantity),
        attribution: asJson({
          epistemic: projection.epistemic,
          attributionConcept: projection.attributionConcept,
        }),
      };
    case "reference":
      return {
        ...base,
        reference: asJson({
          resolvedConcept: projection.resolvedConcept,
          candidateConcepts: projection.candidateConcepts,
        }),
      };
    case "instruction-content":
      return {
        ...base,
        ...constraintDimensions(projection.content),
        "instruction-content": asJson({
          intent: projection.intent,
          contentKind: projection.content.kind,
        }),
      };
  }
};

const dimensions: readonly MultilingualSemanticDimension[] = [
  "semantic-kind",
  "predicate",
  "roles",
  "polarity",
  "modality",
  "quantity",
  "time",
  "condition",
  "causality",
  "attribution",
  "reference",
  "instruction-content",
];

export const compareControlledSemanticDimensions = (
  left: GraphSnapshot,
  right: GraphSnapshot,
): MultilingualSemanticEquivalenceReport => {
  const leftProjection = projectControlledCorpusSemantics(left);
  const rightProjection = projectControlledCorpusSemantics(right);

  if (!leftProjection.ok || !rightProjection.ok) {
    return {
      equivalent: false,
      checks: [],
      ...(leftProjection.ok ? { leftProjection: leftProjection.value } : {}),
      ...(rightProjection.ok
        ? { rightProjection: rightProjection.value }
        : {}),
      diagnostics: [
        ...(!leftProjection.ok
          ? [
              `left projection failed: ${leftProjection.error.code} — ${leftProjection.error.message}`,
            ]
          : []),
        ...(!rightProjection.ok
          ? [
              `right projection failed: ${rightProjection.error.code} — ${rightProjection.error.message}`,
            ]
          : []),
      ],
    };
  }

  const leftMap = controlledProjectionDimensions(leftProjection.value);
  const rightMap = controlledProjectionDimensions(rightProjection.value);
  const checks = dimensions.map((dimension): SemanticDimensionCheck => {
    const leftValue = leftMap[dimension];
    const rightValue = rightMap[dimension];
    if (leftValue === undefined && rightValue === undefined) {
      return { dimension, status: "not-applicable" };
    }
    if (leftValue === undefined || rightValue === undefined) {
      return {
        dimension,
        status: "fail",
        ...(leftValue === undefined ? {} : { left: leftValue }),
        ...(rightValue === undefined ? {} : { right: rightValue }),
      };
    }
    const equal = canonicalJson(leftValue) === canonicalJson(rightValue);
    return {
      dimension,
      status: equal ? "pass" : "fail",
      left: leftValue,
      right: rightValue,
    };
  });

  return {
    equivalent: checks.every((check) => check.status !== "fail"),
    checks,
    leftProjection: leftProjection.value,
    rightProjection: rightProjection.value,
    diagnostics: checks
      .filter((check) => check.status === "fail")
      .map((check) => `semantic dimension mismatch: ${check.dimension}`),
  };
};
