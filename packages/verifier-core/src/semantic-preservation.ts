import type { GraphSnapshot, JsgNode, SemanticValue } from "../../semantic-graph/src/index.ts";

export type PreservationInvariant =
  | "negation"
  | "quantity"
  | "unknown"
  | "identity"
  | "attribution"
  | "condition"
  | "modality"
  | "causal-direction"
  | "temporal-order"
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
  violations: InvariantViolation[];
}

const byId = (snapshot: GraphSnapshot) =>
  new Map(snapshot.nodes.map((node) => [node.id, node] as const));

const semanticValueEqual = (a: SemanticValue, b: SemanticValue): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const comparableNodes = (source: GraphSnapshot, candidate: GraphSnapshot) => {
  const candidateMap = byId(candidate);
  return source.nodes
    .map((node) => [node, candidateMap.get(node.id)] as const)
    .filter((pair): pair is readonly [JsgNode, JsgNode] => pair[1] !== undefined);
};

export const verifySemanticPreservation = (
  source: GraphSnapshot,
  candidate: GraphSnapshot,
  requested: PreservationInvariant[] = [
    "negation",
    "quantity",
    "unknown",
    "identity",
    "attribution",
    "condition",
    "modality",
    "causal-direction",
    "temporal-order",
    "opaque-exactness",
  ],
): PreservationReport => {
  const violations: InvariantViolation[] = [];
  const enabled = new Set(requested);

  for (const [left, right] of comparableNodes(source, candidate)) {
    if (enabled.has("negation") && "polarity" in left && "polarity" in right && left.polarity !== right.polarity) {
      violations.push({
        invariant: "negation",
        code: "SEM_NEGATION_CHANGED",
        message: "Polarity changed across a strict semantic transformation.",
        sourceNodeId: left.id,
        candidateNodeId: right.id,
      });
    }

    if (enabled.has("quantity") && left.kind === "quantity" && right.kind === "quantity") {
      if (
        left.amount !== right.amount ||
        left.comparator !== right.comparator ||
        left.approximate !== right.approximate
      ) {
        violations.push({
          invariant: "quantity",
          code: "SEM_QUANTITY_CHANGED",
          message: "Quantity amount/comparator/exactness changed.",
          sourceNodeId: left.id,
          candidateNodeId: right.id,
        });
      }
    }

    if (enabled.has("attribution") && left.kind === "proposition" && right.kind === "proposition") {
      if (left.attribution !== right.attribution) {
        violations.push({
          invariant: "attribution",
          code: "SEM_ATTRIBUTION_CHANGED",
          message: "Claim attribution changed or was removed.",
          sourceNodeId: left.id,
          candidateNodeId: right.id,
        });
      }
    }

    if (enabled.has("modality") && "modality" in left && "modality" in right) {
      if (JSON.stringify(left.modality) !== JSON.stringify(right.modality)) {
        violations.push({
          invariant: "modality",
          code: "SEM_MODALITY_CHANGED",
          message: "Modal force changed across a strict transformation.",
          sourceNodeId: left.id,
          candidateNodeId: right.id,
        });
      }
    }

    if (enabled.has("identity") && left.kind === "entity" && right.kind === "entity") {
      if (left.concept !== right.concept) {
        violations.push({
          invariant: "identity",
          code: "SEM_ENTITY_IDENTITY_CHANGED",
          message: "Entity concept identity changed.",
          sourceNodeId: left.id,
          candidateNodeId: right.id,
        });
      }
    }

    if (enabled.has("unknown") && left.kind === "unknown-concept" && right.kind !== "unknown-concept") {
      violations.push({
        invariant: "unknown",
        code: "SEM_UNKNOWN_COLLAPSED",
        message: "An unresolved concept was silently converted into a known concept.",
        sourceNodeId: left.id,
        candidateNodeId: right.id,
      });
    }

    if (
      enabled.has("condition") &&
      left.kind === "constraint" &&
      left.constraintKind === "condition" &&
      !(right.kind === "constraint" && right.constraintKind === "condition")
    ) {
      violations.push({
        invariant: "condition",
        code: "SEM_CONDITION_DROPPED",
        message: "A semantic condition was dropped or changed to another constraint kind.",
        sourceNodeId: left.id,
        candidateNodeId: right.id,
      });
    }

    if (
      enabled.has("causal-direction") &&
      left.kind === "relation" &&
      right.kind === "relation" &&
      /cause|enable|prevent|motivate|reason|evidence/i.test(left.relation)
    ) {
      if (left.source !== right.source || left.target !== right.target) {
        violations.push({
          invariant: "causal-direction",
          code: "SEM_CAUSAL_DIRECTION_CHANGED",
          message: "A causal/evidential relation changed direction.",
          sourceNodeId: left.id,
          candidateNodeId: right.id,
        });
      }
    }

    if (
      enabled.has("temporal-order") &&
      left.kind === "relation" &&
      right.kind === "relation" &&
      /before|after|during|preced/i.test(left.relation)
    ) {
      if (left.source !== right.source || left.target !== right.target) {
        violations.push({
          invariant: "temporal-order",
          code: "SEM_TEMPORAL_ORDER_CHANGED",
          message: "Temporal relation direction changed.",
          sourceNodeId: left.id,
          candidateNodeId: right.id,
        });
      }
    }

    if (enabled.has("opaque-exactness") && left.kind === "definition" && right.kind === "definition") {
      if (!semanticValueEqual(left.definition, right.definition)) {
        violations.push({
          invariant: "opaque-exactness",
          code: "SEM_DEFINITION_VALUE_CHANGED",
          message: "Definition payload changed under exact-preservation checking.",
          sourceNodeId: left.id,
          candidateNodeId: right.id,
        });
      }
    }
  }

  return { ok: violations.length === 0, checked: requested, violations };
};
