import { canonicalJson, type JsonValue } from "../../core-types/src/index.ts";
import type {
  GraphSnapshot,
  JsgNode,
  SemanticValue,
} from "../../semantic-graph/src/index.ts";

export type PreservationInvariant =
  | "node-presence"
  | "negation"
  | "quantity"
  | "unknown"
  | "identity"
  | "role-bindings"
  | "attribution"
  | "condition"
  | "modality"
  | "causal-direction"
  | "temporal-order"
  | "temporal-value"
  | "opaque-exactness";

export interface InvariantViolation {
  invariant: PreservationInvariant;
  code: string;
  message: string;
  sourceNodeId?: string;
  candidateNodeId?: string;
}

export interface PreservationReport {
  ok: boolean;
  checked: PreservationInvariant[];
  comparedNodes: number;
  missingSourceNodes: number;
  violations: InvariantViolation[];
}

export const STRICT_PRESERVATION_INVARIANTS: readonly PreservationInvariant[] = [
  "node-presence",
  "negation",
  "quantity",
  "unknown",
  "identity",
  "role-bindings",
  "attribution",
  "condition",
  "modality",
  "causal-direction",
  "temporal-order",
  "temporal-value",
  "opaque-exactness",
];

const asCanonical = (value: unknown): string =>
  canonicalJson(value as JsonValue);

const semanticValueEqual = (a: SemanticValue, b: SemanticValue): boolean =>
  asCanonical(a) === asCanonical(b);

const roleBearingNode = (
  node: JsgNode,
): node is Extract<JsgNode, { roles: unknown }> =>
  "roles" in node && Array.isArray(node.roles);

const argumentsBearingNode = (
  node: JsgNode,
): node is Extract<JsgNode, { arguments: unknown }> =>
  "arguments" in node && Array.isArray(node.arguments);

const modalityBearingNode = (
  node: JsgNode,
): node is Extract<JsgNode, { modality?: unknown }> =>
  "modality" in node;

const polarityBearingNode = (
  node: JsgNode,
): node is Extract<JsgNode, { polarity: unknown }> =>
  "polarity" in node;

const push = (
  violations: InvariantViolation[],
  invariant: PreservationInvariant,
  code: string,
  message: string,
  source: JsgNode,
  candidate?: JsgNode,
): void => {
  violations.push({
    invariant,
    code,
    message,
    sourceNodeId: source.id,
    ...(candidate === undefined ? {} : { candidateNodeId: candidate.id }),
  });
};

export const verifySemanticPreservation = (
  source: GraphSnapshot,
  candidate: GraphSnapshot,
  requested: readonly PreservationInvariant[] = STRICT_PRESERVATION_INVARIANTS,
): PreservationReport => {
  const violations: InvariantViolation[] = [];
  const enabled = new Set(requested);
  const candidateById = new Map(
    candidate.nodes.map((node) => [node.id, node] as const),
  );
  let comparedNodes = 0;
  let missingSourceNodes = 0;

  for (const left of source.nodes) {
    const right = candidateById.get(left.id);
    if (right === undefined) {
      missingSourceNodes += 1;
      if (enabled.has("node-presence")) {
        push(
          violations,
          "node-presence",
          "SEM_SOURCE_NODE_DROPPED",
          "A source semantic node is absent from the strict-preservation candidate.",
          left,
        );
      }
      continue;
    }

    comparedNodes += 1;

    if (left.kind !== right.kind) {
      if (enabled.has("identity")) {
        push(
          violations,
          "identity",
          "SEM_NODE_KIND_CHANGED",
          `Semantic node kind changed from ${left.kind} to ${right.kind}.`,
          left,
          right,
        );
      }
      continue;
    }

    if (
      enabled.has("negation") &&
      polarityBearingNode(left) &&
      polarityBearingNode(right) &&
      left.polarity !== right.polarity
    ) {
      push(
        violations,
        "negation",
        "SEM_NEGATION_CHANGED",
        "Polarity changed across a strict semantic transformation.",
        left,
        right,
      );
    }

    if (
      enabled.has("quantity") &&
      left.kind === "quantity" &&
      right.kind === "quantity" &&
      (
        left.amount !== right.amount ||
        left.unit !== right.unit ||
        left.comparator !== right.comparator ||
        left.approximate !== right.approximate
      )
    ) {
      push(
        violations,
        "quantity",
        "SEM_QUANTITY_CHANGED",
        "Quantity amount, unit, comparator, or exactness changed.",
        left,
        right,
      );
    }

    if (
      enabled.has("identity") &&
      left.kind === "entity" &&
      right.kind === "entity" &&
      left.concept !== right.concept
    ) {
      push(
        violations,
        "identity",
        "SEM_ENTITY_IDENTITY_CHANGED",
        "Entity concept identity changed.",
        left,
        right,
      );
    }

    if (
      enabled.has("role-bindings") &&
      roleBearingNode(left) &&
      roleBearingNode(right) &&
      asCanonical(left.roles) !== asCanonical(right.roles)
    ) {
      push(
        violations,
        "role-bindings",
        "SEM_ROLE_BINDINGS_CHANGED",
        "Semantic role bindings changed, which may swap actors, patients, themes, or other participants.",
        left,
        right,
      );
    }

    if (
      enabled.has("role-bindings") &&
      argumentsBearingNode(left) &&
      argumentsBearingNode(right) &&
      asCanonical(left.arguments) !== asCanonical(right.arguments)
    ) {
      push(
        violations,
        "role-bindings",
        "SEM_ARGUMENT_BINDINGS_CHANGED",
        "Semantic argument bindings changed.",
        left,
        right,
      );
    }

    if (
      enabled.has("attribution") &&
      left.kind === "proposition" &&
      right.kind === "proposition" &&
      left.attribution !== right.attribution
    ) {
      push(
        violations,
        "attribution",
        "SEM_ATTRIBUTION_CHANGED",
        "Claim attribution changed or was removed.",
        left,
        right,
      );
    }

    if (
      enabled.has("modality") &&
      modalityBearingNode(left) &&
      modalityBearingNode(right) &&
      asCanonical(left.modality ?? null) !== asCanonical(right.modality ?? null)
    ) {
      push(
        violations,
        "modality",
        "SEM_MODALITY_CHANGED",
        "Modal force changed across a strict semantic transformation.",
        left,
        right,
      );
    }

    if (
      enabled.has("unknown") &&
      left.kind === "unknown-concept" &&
      right.kind === "unknown-concept" &&
      (
        asCanonical(left.mention) !== asCanonical(right.mention) ||
        asCanonical(left.expectedParents) !== asCanonical(right.expectedParents) ||
        asCanonical(left.candidateConcepts) !== asCanonical(right.candidateConcepts)
      )
    ) {
      push(
        violations,
        "unknown",
        "SEM_UNKNOWN_CHANGED",
        "An unresolved concept changed instead of remaining explicitly unresolved.",
        left,
        right,
      );
    }

    if (
      enabled.has("condition") &&
      left.kind === "constraint" &&
      left.constraintKind === "condition" &&
      right.kind === "constraint" &&
      right.constraintKind !== "condition"
    ) {
      push(
        violations,
        "condition",
        "SEM_CONDITION_DROPPED",
        "A semantic condition changed to another constraint kind.",
        left,
        right,
      );
    }

    if (
      enabled.has("causal-direction") &&
      left.kind === "relation" &&
      right.kind === "relation" &&
      /cause|enable|prevent|motivate|reason|evidence/i.test(left.relation) &&
      (left.source !== right.source || left.target !== right.target)
    ) {
      push(
        violations,
        "causal-direction",
        "SEM_CAUSAL_DIRECTION_CHANGED",
        "A causal or evidential relation changed direction.",
        left,
        right,
      );
    }

    if (
      enabled.has("temporal-order") &&
      left.kind === "relation" &&
      right.kind === "relation" &&
      /before|after|during|preced|follow/i.test(left.relation) &&
      (left.source !== right.source || left.target !== right.target)
    ) {
      push(
        violations,
        "temporal-order",
        "SEM_TEMPORAL_ORDER_CHANGED",
        "Temporal relation direction changed.",
        left,
        right,
      );
    }

    if (
      enabled.has("temporal-value") &&
      left.kind === "temporal" &&
      right.kind === "temporal" &&
      (
        left.temporalKind !== right.temporalKind ||
        asCanonical(left.value) !== asCanonical(right.value)
      )
    ) {
      push(
        violations,
        "temporal-value",
        "SEM_TEMPORAL_VALUE_CHANGED",
        "Temporal kind or value changed.",
        left,
        right,
      );
    }

    if (
      enabled.has("opaque-exactness") &&
      left.kind === "definition" &&
      right.kind === "definition" &&
      !semanticValueEqual(left.definition, right.definition)
    ) {
      push(
        violations,
        "opaque-exactness",
        "SEM_DEFINITION_VALUE_CHANGED",
        "Definition payload changed under exact-preservation checking.",
        left,
        right,
      );
    }
  }

  return {
    ok: violations.length === 0,
    checked: [...requested],
    comparedNodes,
    missingSourceNodes,
    violations,
  };
};
