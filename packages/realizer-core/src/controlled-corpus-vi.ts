import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  ActionNode,
  ConstraintNode,
  EntityNode,
  EventNode,
  GraphSnapshot,
  PropositionNode,
  QuantityNode,
  RelationNode,
  RoleBinding,
  SemanticArgument,
  StateNode,
  TemporalNode,
} from "../../semantic-graph/src/index.ts";

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

const quantityFor = (
  snapshot: GraphSnapshot,
  values: readonly (SemanticArgument | RoleBinding)[],
): QuantityNode | undefined =>
  nodeById(
    snapshot,
    refForRole(values, "role:core.quantity-limit"),
    "quantity",
  );

const serviceActor = (
  snapshot: GraphSnapshot,
  id: SemanticId | undefined,
): EntityNode | undefined => {
  const actor = nodeById(snapshot, id, "entity");
  return actor?.concept === "concept:core.software-service"
    ? actor
    : undefined;
};

const supportedDeleteAction = (
  snapshot: GraphSnapshot,
  constraint: ConstraintNode,
): {
  action: ActionNode;
  quantity: QuantityNode;
} | undefined => {
  const action = nodeById(snapshot, constraint.subject, "action");
  if (
    action === undefined ||
    action.operation !== "concept:core.delete" ||
    serviceActor(snapshot, action.actor) === undefined
  ) {
    return undefined;
  }
  const quantity = quantityFor(snapshot, action.parameters);
  if (quantity?.unit !== "concept:core.file") return undefined;
  return { action, quantity };
};

const temporalIso = (
  temporal: TemporalNode | undefined,
): string | undefined => {
  if (
    temporal === undefined ||
    typeof temporal.value !== "object" ||
    temporal.value === null ||
    Array.isArray(temporal.value)
  ) {
    return undefined;
  }
  const value = temporal.value as { iso?: unknown };
  return typeof value.iso === "string" ? value.iso : undefined;
};

const realizeEvent = (
  snapshot: GraphSnapshot,
  event: EventNode,
): string | undefined => {
  if (
    event.predicate !== "concept:core.delete" ||
    serviceActor(
      snapshot,
      refForRole(event.roles, "role:core.agent"),
    ) === undefined
  ) {
    return undefined;
  }
  const quantity = quantityFor(snapshot, event.roles);
  if (
    quantity?.unit !== "concept:core.file" ||
    quantity.comparator !== "exact"
  ) {
    return undefined;
  }

  if (event.polarity === "negative") {
    return `Dịch vụ không xóa đúng ${quantity.amount} tệp.`;
  }

  const aspect =
    event.aspect === "completed"
      ? "đã "
      : event.aspect === "ongoing"
        ? "đang "
        : event.aspect === "planned"
          ? "sẽ "
          : "";
  const date = temporalIso(
    nodeById(snapshot, event.temporal, "temporal"),
  );
  return `Dịch vụ ${aspect}xóa đúng ${quantity.amount} tệp${date === undefined ? "" : ` vào ${date}`}.`;
};

const realizeConstraint = (
  snapshot: GraphSnapshot,
  constraint: ConstraintNode,
): string | undefined => {
  const semantics = supportedDeleteAction(snapshot, constraint);
  if (semantics === undefined) return undefined;
  const quantity = semantics.quantity;

  if (
    constraint.constraintKind === "requirement" &&
    constraint.predicate === "concept:core.requirement" &&
    quantity.comparator === "exact"
  ) {
    return `Dịch vụ phải xóa đúng ${quantity.amount} tệp.`;
  }

  if (
    constraint.constraintKind === "permission" &&
    constraint.predicate === "concept:core.permission" &&
    quantity.comparator === "at-most"
  ) {
    return `Dịch vụ được phép xóa tối đa ${quantity.amount} tệp.`;
  }

  if (
    constraint.constraintKind === "prohibition" &&
    constraint.predicate === "concept:core.prohibition" &&
    quantity.comparator === "at-most" &&
    quantity.amount === 0
  ) {
    return "Dịch vụ không được phép xóa bất kỳ tệp nào.";
  }

  if (
    constraint.constraintKind === "requirement" &&
    constraint.predicate === "concept:core.maximum-cardinality" &&
    quantity.comparator === "at-most"
  ) {
    return `Dịch vụ không được xóa quá ${quantity.amount} tệp.`;
  }

  return undefined;
};

const prohibitionState = (
  snapshot: GraphSnapshot,
  id: SemanticId | undefined,
): StateNode | undefined => {
  const state = nodeById(snapshot, id, "state");
  return state?.predicate === "concept:core.prohibition" &&
      state.polarity === "positive"
    ? state
    : undefined;
};

const realizeCondition = (
  snapshot: GraphSnapshot,
  condition: ConstraintNode,
): string | undefined => {
  if (
    condition.constraintKind !== "condition" ||
    condition.predicate !== "concept:core.condition"
  ) {
    return undefined;
  }
  const reason = prohibitionState(
    snapshot,
    refForRole(condition.parameters, "role:core.condition"),
  );
  const main = nodeById(snapshot, condition.subject, "constraint");
  if (reason === undefined || main === undefined) return undefined;
  const mainSurface = realizeConstraint(snapshot, main);
  if (mainSurface === undefined) return undefined;
  const lower =
    mainSurface.charAt(0).toLocaleLowerCase("vi") +
    mainSurface.slice(1);
  return `Nếu việc xóa bị cấm, ${lower}`;
};

const realizeCause = (
  snapshot: GraphSnapshot,
  relation: RelationNode,
): string | undefined => {
  if (
    relation.relation !== "concept:core.cause" ||
    relation.polarity !== "positive"
  ) {
    return undefined;
  }
  const reason = prohibitionState(snapshot, relation.source);
  const main = nodeById(snapshot, relation.target, "constraint");
  if (reason === undefined || main === undefined) return undefined;
  const mainSurface = realizeConstraint(snapshot, main);
  if (mainSurface === undefined) return undefined;
  const withoutPeriod = mainSurface.endsWith(".")
    ? mainSurface.slice(0, -1)
    : mainSurface;
  return `${withoutPeriod} vì việc xóa bị cấm.`;
};

const realizeProposition = (
  snapshot: GraphSnapshot,
  proposition: PropositionNode,
): string | undefined => {
  if (
    proposition.predicate !== "concept:core.delete" ||
    serviceActor(
      snapshot,
      refForRole(proposition.arguments, "role:core.agent"),
    ) === undefined
  ) {
    return undefined;
  }
  const quantity = quantityFor(snapshot, proposition.arguments);
  if (
    quantity?.unit !== "concept:core.file" ||
    quantity.comparator !== "exact"
  ) {
    return undefined;
  }

  if (
    proposition.epistemic?.status === "questioned" &&
    proposition.modality?.kind === "permitted"
  ) {
    return `Dịch vụ có được phép xóa đúng ${quantity.amount} tệp không?`;
  }

  if (
    proposition.epistemic?.status === "reported" &&
    proposition.attribution !== undefined
  ) {
    return `Theo dịch vụ, dịch vụ xóa đúng ${quantity.amount} tệp.`;
  }

  return undefined;
};

export const realizeControlledVietnameseCorpus = (
  snapshot: GraphSnapshot,
): Result<string> => {
  for (const node of snapshot.nodes) {
    if (node.kind === "constraint" && node.constraintKind === "condition") {
      const value = realizeCondition(snapshot, node);
      if (value !== undefined) return ok(value);
    }
  }

  for (const node of snapshot.nodes) {
    if (node.kind === "relation") {
      const value = realizeCause(snapshot, node);
      if (value !== undefined) return ok(value);
    }
  }

  for (const node of snapshot.nodes) {
    if (node.kind === "proposition") {
      const value = realizeProposition(snapshot, node);
      if (value !== undefined) return ok(value);
    }
  }

  for (const node of snapshot.nodes) {
    if (node.kind === "constraint" && node.constraintKind !== "condition") {
      const value = realizeConstraint(snapshot, node);
      if (value !== undefined) return ok(value);
    }
  }

  for (const node of snapshot.nodes) {
    if (node.kind === "event") {
      const value = realizeEvent(snapshot, node);
      if (value !== undefined) return ok(value);
    }
  }

  return err(
    new StructuredError(
      "REALIZE_VI_CONTROLLED_CORPUS_UNSUPPORTED",
      "JSG nằm ngoài tập hiện thực hóa tiếng Việt có kiểm soát của M8.",
    ),
  );
};
