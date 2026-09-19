import {
  canonicalJson,
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  ActionNode,
  ConstraintNode,
  EventNode,
  GraphSnapshot,
  PropositionNode,
  QuantityNode,
  RelationNode,
  SemanticArgument,
  RoleBinding,
  StateNode,
  TemporalNode,
} from "../../semantic-graph/src/index.ts";

export interface ControlledQuantityProjection {
  amount: number;
  unit?: string;
  comparator: QuantityNode["comparator"];
}

export type ControlledCorpusProjection =
  | {
      kind: "event";
      actorConcept: string;
      operation: string;
      polarity: EventNode["polarity"];
      aspect?: EventNode["aspect"];
      quantity: ControlledQuantityProjection;
      temporal?: JsonValue;
    }
  | {
      kind: "constraint";
      actorConcept: string;
      operation: string;
      constraintKind: ConstraintNode["constraintKind"];
      predicate: string;
      quantity: ControlledQuantityProjection;
    }
  | {
      kind: "condition";
      reasonPredicate: string;
      main: Extract<ControlledCorpusProjection, { kind: "constraint" }>;
    }
  | {
      kind: "cause";
      reasonPredicate: string;
      main: Extract<ControlledCorpusProjection, { kind: "constraint" }>;
    }
  | {
      kind: "question";
      actorConcept: string;
      predicate: string;
      polarity: PropositionNode["polarity"];
      modality?: string;
      epistemic?: string;
      quantity: ControlledQuantityProjection;
    }
  | {
      kind: "attributed-proposition";
      actorConcept: string;
      predicate: string;
      polarity: PropositionNode["polarity"];
      epistemic: "reported";
      attributionConcept: string;
      quantity: ControlledQuantityProjection;
    }
  | {
      kind: "reference";
      resolvedConcept: string;
      candidateConcepts: string[];
    }
  | {
      kind: "instruction-content";
      intent: string;
      content: Extract<ControlledCorpusProjection, { kind: "constraint" }>;
    };

const refForRole = (
  values: readonly (SemanticArgument | RoleBinding)[],
  role: string,
): SemanticId | undefined => {
  const binding = values.find(
    (entry) => entry.role === role && entry.value.kind === "ref",
  );
  return binding?.value.kind === "ref" ? binding.value.ref : undefined;
};

const nodeById = <K extends GraphSnapshot["nodes"][number]["kind"]>(
  snapshot: GraphSnapshot,
  id: SemanticId | undefined,
  kind: K,
): Extract<GraphSnapshot["nodes"][number], { kind: K }> | undefined => {
  if (id === undefined) return undefined;
  return snapshot.nodes.find(
    (node): node is Extract<GraphSnapshot["nodes"][number], { kind: K }> =>
      node.id === id && node.kind === kind,
  );
};

const quantityProjection = (
  snapshot: GraphSnapshot,
  values: readonly (SemanticArgument | RoleBinding)[],
): ControlledQuantityProjection | undefined => {
  const id = refForRole(values, "role:core.quantity-limit");
  const quantity = nodeById(snapshot, id, "quantity");
  if (quantity === undefined) return undefined;
  return {
    amount: quantity.amount,
    ...(quantity.unit === undefined ? {} : { unit: quantity.unit }),
    comparator: quantity.comparator,
  };
};

const constraintProjection = (
  snapshot: GraphSnapshot,
  constraint: ConstraintNode,
): Extract<ControlledCorpusProjection, { kind: "constraint" }> | undefined => {
  const action = nodeById(snapshot, constraint.subject, "action");
  if (action === undefined || action.actor === undefined) return undefined;
  const actor = nodeById(snapshot, action.actor, "entity");
  const quantity = quantityProjection(snapshot, action.parameters);
  if (actor === undefined || quantity === undefined) return undefined;
  return {
    kind: "constraint",
    actorConcept: actor.concept,
    operation: action.operation,
    constraintKind: constraint.constraintKind,
    predicate: constraint.predicate,
    quantity,
  };
};

const reasonState = (
  snapshot: GraphSnapshot,
  id: SemanticId | undefined,
): StateNode | undefined => nodeById(snapshot, id, "state");

export const projectControlledCorpusSemantics = (
  snapshot: GraphSnapshot,
): Result<ControlledCorpusProjection> => {
  const instruction = snapshot.nodes.find(
    (node): node is IntentNode =>
      node.kind === "intent" &&
      node.intent === "concept:core.instruction" &&
      node.content !== undefined,
  );
  if (instruction?.content !== undefined) {
    const constraint = nodeById(snapshot, instruction.content, "constraint");
    const content =
      constraint === undefined
        ? undefined
        : constraintProjection(snapshot, constraint);
    if (content !== undefined) {
      return ok({
        kind: "instruction-content",
        intent: instruction.intent,
        content,
      });
    }
  }

  const reference = snapshot.nodes.find(
    (node): node is ReferenceNode =>
      node.kind === "reference" && node.resolved !== undefined,
  );
  if (reference?.resolved !== undefined) {
    const resolved = nodeById(snapshot, reference.resolved, "entity");
    const candidates = reference.candidates
      .map((id) => nodeById(snapshot, id, "entity"))
      .filter((node): node is NonNullable<typeof node> => node !== undefined);
    if (
      resolved !== undefined &&
      candidates.length === reference.candidates.length
    ) {
      return ok({
        kind: "reference",
        resolvedConcept: resolved.concept,
        candidateConcepts: candidates
          .map((candidate) => candidate.concept)
          .sort(),
      });
    }
  }
  const condition = snapshot.nodes.find(
    (node): node is ConstraintNode =>
      node.kind === "constraint" &&
      node.constraintKind === "condition" &&
      node.predicate === "concept:core.condition",
  );
  if (condition !== undefined) {
    const reasonId = refForRole(condition.parameters, "role:core.condition");
    const reason = reasonState(snapshot, reasonId);
    const mainNode = nodeById(snapshot, condition.subject, "constraint");
    const main =
      mainNode === undefined
        ? undefined
        : constraintProjection(snapshot, mainNode);
    if (reason !== undefined && main !== undefined) {
      return ok({
        kind: "condition",
        reasonPredicate: reason.predicate,
        main,
      });
    }
  }

  const cause = snapshot.nodes.find(
    (node): node is RelationNode =>
      node.kind === "relation" &&
      node.relation === "concept:core.cause" &&
      node.polarity === "positive",
  );
  if (cause !== undefined) {
    const reason = reasonState(snapshot, cause.source);
    const mainNode = nodeById(snapshot, cause.target, "constraint");
    const main =
      mainNode === undefined
        ? undefined
        : constraintProjection(snapshot, mainNode);
    if (reason !== undefined && main !== undefined) {
      return ok({
        kind: "cause",
        reasonPredicate: reason.predicate,
        main,
      });
    }
  }

  const attributed = snapshot.nodes.find(
    (node): node is PropositionNode =>
      node.kind === "proposition" &&
      node.epistemic?.status === "reported" &&
      node.attribution !== undefined,
  );
  if (attributed !== undefined) {
    const actorId = refForRole(attributed.arguments, "role:core.agent");
    const actor = nodeById(snapshot, actorId, "entity");
    const attribution = nodeById(
      snapshot,
      attributed.attribution,
      "entity",
    );
    const quantity = quantityProjection(snapshot, attributed.arguments);
    if (
      actor !== undefined &&
      attribution !== undefined &&
      quantity !== undefined
    ) {
      return ok({
        kind: "attributed-proposition",
        actorConcept: actor.concept,
        predicate: attributed.predicate,
        polarity: attributed.polarity,
        epistemic: "reported",
        attributionConcept: attribution.concept,
        quantity,
      });
    }
  }

  const question = snapshot.nodes.find(
    (node): node is PropositionNode =>
      node.kind === "proposition" &&
      node.epistemic?.status === "questioned",
  );
  if (question !== undefined) {
    const actorId = refForRole(question.arguments, "role:core.agent");
    const actor = nodeById(snapshot, actorId, "entity");
    const quantity = quantityProjection(snapshot, question.arguments);
    if (actor !== undefined && quantity !== undefined) {
      return ok({
        kind: "question",
        actorConcept: actor.concept,
        predicate: question.predicate,
        polarity: question.polarity,
        ...(question.modality === undefined
          ? {}
          : { modality: question.modality.kind }),
        ...(question.epistemic === undefined
          ? {}
          : { epistemic: question.epistemic.status }),
        quantity,
      });
    }
  }

  const constraint = snapshot.nodes.find(
    (node): node is ConstraintNode =>
      node.kind === "constraint" && node.constraintKind !== "condition",
  );
  if (constraint !== undefined) {
    const projected = constraintProjection(snapshot, constraint);
    if (projected !== undefined) return ok(projected);
  }

  const event = snapshot.nodes.find(
    (node): node is EventNode => node.kind === "event",
  );
  if (event !== undefined) {
    const actorId = refForRole(event.roles, "role:core.agent");
    const actor = nodeById(snapshot, actorId, "entity");
    const quantity = quantityProjection(snapshot, event.roles);
    const temporal = nodeById(snapshot, event.temporal, "temporal");
    if (actor !== undefined && quantity !== undefined) {
      return ok({
        kind: "event",
        actorConcept: actor.concept,
        operation: event.predicate,
        polarity: event.polarity,
        ...(event.aspect === undefined ? {} : { aspect: event.aspect }),
        quantity,
        ...(temporal === undefined
          ? {}
          : { temporal: structuredClone(temporal.value) }),
      });
    }
  }

  return err(
    new StructuredError(
      "VERIFY_CONTROLLED_CORPUS_UNSUPPORTED",
      "Graph does not contain a supported controlled-corpus semantic projection.",
    ),
  );
};

export interface ControlledCorpusEquivalence {
  equivalent: boolean;
  left?: ControlledCorpusProjection;
  right?: ControlledCorpusProjection;
}

export const verifyControlledCorpusEquivalence = (
  left: GraphSnapshot,
  right: GraphSnapshot,
): ControlledCorpusEquivalence => {
  const a = projectControlledCorpusSemantics(left);
  const b = projectControlledCorpusSemantics(right);
  if (!a.ok || !b.ok) {
    return {
      equivalent: false,
      ...(a.ok ? { left: a.value } : {}),
      ...(b.ok ? { right: b.value } : {}),
    };
  }

  return {
    equivalent:
      canonicalJson(a.value as unknown as JsonValue) ===
      canonicalJson(b.value as unknown as JsonValue),
    left: a.value,
    right: b.value,
  };
};
