import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  ConditionalSemantics,
  Diagnostic,
  EventNode,
  GraphSnapshot,
  JsgNode,
  ModalitySpec,
  TemporalNode,
  TemporalRelation,
} from "./nodes.ts";

export interface TemporalConstraint {
  id: string;
  left: SemanticId;
  relation: TemporalRelation;
  right: SemanticId;
  status: "asserted" | "derived" | "candidate";
}

const inverseRelation: Readonly<Record<TemporalRelation, TemporalRelation>> = {
  before: "after",
  after: "before",
  meets: "met-by",
  "met-by": "meets",
  overlaps: "overlapped-by",
  "overlapped-by": "overlaps",
  starts: "started-by",
  "started-by": "starts",
  during: "contains",
  contains: "during",
  finishes: "finished-by",
  "finished-by": "finishes",
  equals: "equals",
  unknown: "unknown",
};

const validIsoBoundary = (value: string | undefined): boolean =>
  value === undefined || !Number.isNaN(Date.parse(value));

const validateTemporalNode = (node: TemporalNode): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  if (!validIsoBoundary(node.start) || !validIsoBoundary(node.end)) {
    diagnostics.push({
      code: "JSG070_TEMPORAL_BOUNDARY_INVALID",
      severity: "error",
      message: `Temporal node ${node.id} has a non-parseable start/end boundary.`,
      nodeRefs: [node.id],
    });
  }

  if (
    node.start !== undefined &&
    node.end !== undefined &&
    !Number.isNaN(Date.parse(node.start)) &&
    !Number.isNaN(Date.parse(node.end)) &&
    Date.parse(node.start) > Date.parse(node.end)
  ) {
    diagnostics.push({
      code: "JSG071_TEMPORAL_INTERVAL_REVERSED",
      severity: "error",
      message: `Temporal interval ${node.id} ends before it starts.`,
      nodeRefs: [node.id],
    });
  }

  if (
    node.temporalKind === "interval" &&
    ((node.start === undefined) !== (node.end === undefined))
  ) {
    diagnostics.push({
      code: "JSG072_TEMPORAL_INTERVAL_INCOMPLETE",
      severity: "error",
      message: `Temporal interval ${node.id} must declare both start and end when normalized boundaries are present.`,
      nodeRefs: [node.id],
    });
  }

  return diagnostics;
};

const validateModality = (
  owner: JsgNode,
  modality: ModalitySpec | undefined,
  nodes: ReadonlyMap<SemanticId, JsgNode>,
): Diagnostic[] => {
  if (modality === undefined) return [];
  const diagnostics: Diagnostic[] = [];

  if (
    modality.calibratedProbability !== undefined &&
    (!Number.isFinite(modality.calibratedProbability) ||
      modality.calibratedProbability < 0 ||
      modality.calibratedProbability > 1)
  ) {
    diagnostics.push({
      code: "JSG073_MODAL_PROBABILITY_INVALID",
      severity: "error",
      message: `Node ${owner.id} has calibrated modal probability outside [0, 1].`,
      nodeRefs: [owner.id],
    });
  }

  if (
    modality.strength !== undefined &&
    (!Number.isFinite(modality.strength) ||
      modality.strength < 0 ||
      modality.strength > 1)
  ) {
    diagnostics.push({
      code: "JSG074_MODAL_LEGACY_STRENGTH_INVALID",
      severity: "error",
      message: `Node ${owner.id} has invalid legacy modal strength.`,
      nodeRefs: [owner.id],
    });
  }

  for (const ref of [
    modality.source,
    modality.scope,
    modality.contextAnchor,
  ]) {
    if (ref !== undefined && !nodes.has(ref)) {
      diagnostics.push({
        code: "JSG075_MODAL_REFERENCE_INVALID",
        severity: "error",
        message: `Node ${owner.id} modality references missing semantic object ${ref}.`,
        nodeRefs: [owner.id, ref],
      });
    }
  }

  return diagnostics;
};

const validateConditional = (
  node: Extract<JsgNode, { kind: "constraint" }>,
  conditional: ConditionalSemantics,
  nodes: ReadonlyMap<SemanticId, JsgNode>,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  for (const ref of [
    conditional.antecedent,
    conditional.consequent,
    conditional.contextAnchor,
    conditional.counterfactual?.referenceWorld,
  ]) {
    if (ref !== undefined && !nodes.has(ref)) {
      diagnostics.push({
        code: "JSG076_CONDITIONAL_REFERENCE_INVALID",
        severity: "error",
        message: `Conditional constraint ${node.id} references missing semantic object ${ref}.`,
        nodeRefs: [node.id, ref],
      });
    }
  }

  if (
    conditional.kind === "counterfactual" &&
    conditional.counterfactual === undefined
  ) {
    diagnostics.push({
      code: "JSG077_COUNTERFACTUAL_METADATA_REQUIRED",
      severity: "error",
      message: `Counterfactual constraint ${node.id} must preserve counterfactuality metadata.`,
      nodeRefs: [node.id],
    });
  }

  if (
    conditional.kind !== "counterfactual" &&
    conditional.counterfactual?.antecedentStatus === "contrary-to-fact"
  ) {
    diagnostics.push({
      code: "JSG078_COUNTERFACTUAL_KIND_MISMATCH",
      severity: "error",
      message: `Constraint ${node.id} marks an antecedent contrary-to-fact without counterfactual conditional kind.`,
      nodeRefs: [node.id],
    });
  }

  diagnostics.push(...validateModality(node, conditional.modality, nodes));
  return diagnostics;
};

export const validateTemporalModalGraph = (
  snapshot: GraphSnapshot,
): Diagnostic[] => {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node] as const));
  const diagnostics: Diagnostic[] = [];

  for (const node of snapshot.nodes) {
    if (node.kind === "temporal") {
      diagnostics.push(...validateTemporalNode(node));
      if (node.anchor !== undefined && !nodes.has(node.anchor)) {
        diagnostics.push({
          code: "JSG079_TEMPORAL_ANCHOR_INVALID",
          severity: "error",
          message: `Temporal node ${node.id} references missing anchor ${node.anchor}.`,
          nodeRefs: [node.id, node.anchor],
        });
      }
    }

    if (node.kind === "event") {
      if (node.eventClass !== undefined && node.eventClass === node.id) {
        diagnostics.push({
          code: "JSG080_EVENT_TYPE_TOKEN_COLLAPSED",
          severity: "error",
          message: `Event token ${node.id} cannot use its occurrence id as its event class.`,
          nodeRefs: [node.id],
        });
      }
      if (node.temporal !== undefined && nodes.get(node.temporal)?.kind !== "temporal") {
        diagnostics.push({
          code: "JSG081_EVENT_TEMPORAL_REF_INVALID",
          severity: "error",
          message: `Event ${node.id} temporal reference must target a TemporalNode.`,
          nodeRefs: [node.id, node.temporal],
        });
      }
      diagnostics.push(...validateModality(node, node.modality, nodes));
    }

    if (node.kind === "state" || node.kind === "proposition") {
      if (
        node.temporal !== undefined &&
        nodes.get(node.temporal)?.kind !== "temporal"
      ) {
        diagnostics.push({
          code: "JSG082_CLAIM_TEMPORAL_REF_INVALID",
          severity: "error",
          message: `${node.kind} ${node.id} temporal reference must target a TemporalNode.`,
          nodeRefs: [node.id, node.temporal],
        });
      }
    }

    if (node.kind === "proposition") {
      diagnostics.push(...validateModality(node, node.modality, nodes));
    }

    if (node.kind === "constraint" && node.conditional !== undefined) {
      if (node.constraintKind !== "condition") {
        diagnostics.push({
          code: "JSG083_CONDITIONAL_CONSTRAINT_KIND_INVALID",
          severity: "error",
          message: `Constraint ${node.id} carries conditional semantics but is not a condition constraint.`,
          nodeRefs: [node.id],
        });
      }
      diagnostics.push(...validateConditional(node, node.conditional, nodes));
    }
  }

  return diagnostics;
};

export class TemporalObjectRegistry {
  readonly #objects = new Map<SemanticId, TemporalNode>();
  readonly #constraints = new Map<string, TemporalConstraint>();

  register(node: TemporalNode): Result<void> {
    if (this.#objects.has(node.id)) {
      return err(
        new StructuredError(
          "TEMPORAL_OBJECT_EXISTS",
          `Temporal object already registered: ${node.id}`,
        ),
      );
    }
    const diagnostics = validateTemporalNode(node);
    if (diagnostics.some((item) => item.severity === "error" || item.severity === "fatal")) {
      return err(
        new StructuredError(
          "TEMPORAL_OBJECT_INVALID",
          diagnostics.map((item) => item.message).join(" "),
        ),
      );
    }
    this.#objects.set(node.id, structuredClone(node));
    return ok(undefined);
  }

  get(id: SemanticId): TemporalNode | undefined {
    const value = this.#objects.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  list(): TemporalNode[] {
    return [...this.#objects.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((value) => structuredClone(value));
  }

  addConstraint(constraint: TemporalConstraint): Result<void> {
    if (this.#constraints.has(constraint.id)) {
      return err(
        new StructuredError(
          "TEMPORAL_CONSTRAINT_EXISTS",
          `Temporal constraint already exists: ${constraint.id}`,
        ),
      );
    }
    if (
      !this.#objects.has(constraint.left) ||
      !this.#objects.has(constraint.right)
    ) {
      return err(
        new StructuredError(
          "TEMPORAL_CONSTRAINT_TARGET_INVALID",
          "Temporal constraint endpoints must already exist in the registry.",
        ),
      );
    }
    if (
      constraint.left === constraint.right &&
      constraint.relation !== "equals" &&
      constraint.relation !== "unknown"
    ) {
      return err(
        new StructuredError(
          "TEMPORAL_CONSTRAINT_SELF_RELATION",
          "A temporal object may only relate to itself as equals/unknown.",
        ),
      );
    }

    for (const existing of this.#constraints.values()) {
      if (
        existing.status === "candidate" ||
        constraint.status === "candidate"
      ) {
        continue;
      }
      const sameDirection =
        existing.left === constraint.left &&
        existing.right === constraint.right;
      const reverseDirection =
        existing.left === constraint.right &&
        existing.right === constraint.left;
      if (
        sameDirection &&
        existing.relation !== constraint.relation &&
        existing.relation !== "unknown" &&
        constraint.relation !== "unknown"
      ) {
        return err(
          new StructuredError(
            "TEMPORAL_CONSTRAINT_CONFLICT",
            "Hard temporal constraints disagree for the same endpoints.",
          ),
        );
      }
      if (
        reverseDirection &&
        existing.relation !== inverseRelation[constraint.relation] &&
        existing.relation !== "unknown" &&
        constraint.relation !== "unknown"
      ) {
        return err(
          new StructuredError(
            "TEMPORAL_CONSTRAINT_CONFLICT",
            "Hard temporal constraints disagree with inverse interval semantics.",
          ),
        );
      }
    }

    this.#constraints.set(constraint.id, structuredClone(constraint));
    return ok(undefined);
  }

  constraints(): TemporalConstraint[] {
    return [...this.#constraints.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((value) => structuredClone(value));
  }
}

export const eventOccurrenceIdentity = (
  event: EventNode,
): { token: SemanticId; eventClass: string } => ({
  token: event.id,
  eventClass: event.eventClass ?? event.predicate,
});
