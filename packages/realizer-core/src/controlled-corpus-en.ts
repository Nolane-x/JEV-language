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
  SemanticArgument,
  RoleBinding,
  StateNode,
  TemporalNode,
} from "../../semantic-graph/src/index.ts";

export interface SemanticSourceMapEntry {
  start: number;
  end: number;
  semanticRefs: SemanticId[];
  kind: "clause" | "quantity" | "temporal";
}

export interface ControlledEnglishRealization {
  text: string;
  sourceMap: SemanticSourceMapEntry[];
  semanticRoots: SemanticId[];
}

interface DeleteSemantics {
  actor: EntityNode;
  quantity: QuantityNode;
}

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

const deleteSemantics = (
  snapshot: GraphSnapshot,
  actorId: SemanticId | undefined,
  args: readonly (SemanticArgument | RoleBinding)[],
): DeleteSemantics | undefined => {
  const actor = nodeById(snapshot, actorId, "entity");
  const quantityId = refForRole(args, "role:core.quantity-limit");
  const quantity = nodeById(snapshot, quantityId, "quantity");
  if (
    actor === undefined ||
    actor.concept !== "concept:core.software-service" ||
    quantity === undefined ||
    quantity.unit !== "concept:core.file"
  ) {
    return undefined;
  }
  return { actor, quantity };
};

const fileNoun = (amount: number): string => (amount === 1 ? "file" : "files");

const quantitySurface = (quantity: QuantityNode): string => {
  const noun = fileNoun(quantity.amount);
  switch (quantity.comparator) {
    case "exact":
      return `exactly ${quantity.amount} ${noun}`;
    case "at-most":
      return `at most ${quantity.amount} ${noun}`;
    case "at-least":
      return `at least ${quantity.amount} ${noun}`;
    case "more-than":
      return `more than ${quantity.amount} ${noun}`;
    case "less-than":
      return `less than ${quantity.amount} ${noun}`;
  }
};

const resultWithMap = (
  text: string,
  roots: SemanticId[],
  quantity?: QuantityNode,
  temporal?: TemporalNode,
): ControlledEnglishRealization => {
  const sourceMap: SemanticSourceMapEntry[] = [
    {
      start: 0,
      end: text.length,
      semanticRefs: [...roots],
      kind: "clause",
    },
  ];
  if (quantity !== undefined) {
    const surface = String(quantity.amount);
    const start = text.indexOf(surface);
    if (start >= 0) {
      sourceMap.push({
        start,
        end: start + surface.length,
        semanticRefs: [quantity.id],
        kind: "quantity",
      });
    }
  }
  if (temporal !== undefined) {
    const value =
      typeof temporal.value === "object" &&
      temporal.value !== null &&
      !Array.isArray(temporal.value) &&
      typeof temporal.value.iso === "string"
        ? temporal.value.iso
        : undefined;
    if (value !== undefined) {
      const start = text.indexOf(value);
      if (start >= 0) {
        sourceMap.push({
          start,
          end: start + value.length,
          semanticRefs: [temporal.id],
          kind: "temporal",
        });
      }
    }
  }
  return { text, sourceMap, semanticRoots: [...roots] };
};

const renderEvent = (
  snapshot: GraphSnapshot,
  event: EventNode,
): ControlledEnglishRealization | undefined => {
  if (event.predicate !== "concept:core.delete") return undefined;
  const semantics = deleteSemantics(snapshot, refForRole(event.roles, "role:core.agent"), event.roles);
  if (semantics === undefined || semantics.quantity.comparator !== "exact") {
    return undefined;
  }

  const temporal = nodeById(snapshot, event.temporal, "temporal");
  const temporalSurface =
    temporal !== undefined &&
    typeof temporal.value === "object" &&
    temporal.value !== null &&
    !Array.isArray(temporal.value) &&
    typeof temporal.value.iso === "string"
      ? ` on ${temporal.value.iso}`
      : "";

  const quantity = quantitySurface(semantics.quantity);
  const text =
    event.polarity === "negative"
      ? `The service does not delete ${quantity}.`
      : `The service deletes ${quantity}${temporalSurface}.`;
  return resultWithMap(text, [event.id], semantics.quantity, temporal);
};

const actionForConstraint = (
  snapshot: GraphSnapshot,
  constraint: ConstraintNode,
): ActionNode | undefined => {
  const action = nodeById(snapshot, constraint.subject, "action");
  return action?.operation === "concept:core.delete" ? action : undefined;
};

const renderConstraint = (
  snapshot: GraphSnapshot,
  constraint: ConstraintNode,
): ControlledEnglishRealization | undefined => {
  const action = actionForConstraint(snapshot, constraint);
  if (action === undefined) return undefined;
  const semantics = deleteSemantics(snapshot, action.actor, action.parameters);
  if (semantics === undefined) return undefined;
  const q = semantics.quantity;
  const noun = fileNoun(q.amount);

  if (
    constraint.constraintKind === "requirement" &&
    constraint.predicate === "concept:core.requirement" &&
    q.comparator === "exact"
  ) {
    return resultWithMap(
      `The service must delete exactly ${q.amount} ${noun}.`,
      [constraint.id],
      q,
    );
  }
  if (
    constraint.constraintKind === "permission" &&
    constraint.predicate === "concept:core.permission" &&
    q.comparator === "at-most"
  ) {
    return resultWithMap(
      `The service may delete at most ${q.amount} ${noun}.`,
      [constraint.id],
      q,
    );
  }
  if (
    constraint.constraintKind === "prohibition" &&
    constraint.predicate === "concept:core.prohibition" &&
    q.comparator === "at-most" &&
    q.amount === 0
  ) {
    return resultWithMap(
      "The service must not delete any files.",
      [constraint.id],
      q,
    );
  }
  if (
    constraint.constraintKind === "requirement" &&
    constraint.predicate === "concept:core.maximum-cardinality" &&
    q.comparator === "at-most"
  ) {
    return resultWithMap(
      `The service must not delete more than ${q.amount} ${noun}.`,
      [constraint.id],
      q,
    );
  }
  return undefined;
};

const renderQuestion = (
  snapshot: GraphSnapshot,
  proposition: PropositionNode,
): ControlledEnglishRealization | undefined => {
  if (
    proposition.predicate !== "concept:core.delete" ||
    proposition.epistemic?.status !== "questioned" ||
    proposition.modality?.kind !== "permitted" ||
    proposition.polarity !== "positive"
  ) {
    return undefined;
  }
  const actorId = refForRole(proposition.arguments, "role:core.agent");
  const semantics = deleteSemantics(snapshot, actorId, proposition.arguments);
  if (semantics === undefined || semantics.quantity.comparator !== "exact") {
    return undefined;
  }
  const q = semantics.quantity;
  return resultWithMap(
    `May the service delete exactly ${q.amount} ${fileNoun(q.amount)}?`,
    [proposition.id],
    q,
  );
};

const prohibitedState = (
  snapshot: GraphSnapshot,
  id: SemanticId | undefined,
): StateNode | undefined => {
  const state = nodeById(snapshot, id, "state");
  return state?.predicate === "concept:core.prohibition" &&
      state.polarity === "positive"
    ? state
    : undefined;
};

const renderCondition = (
  snapshot: GraphSnapshot,
  condition: ConstraintNode,
): ControlledEnglishRealization | undefined => {
  if (
    condition.constraintKind !== "condition" ||
    condition.predicate !== "concept:core.condition"
  ) {
    return undefined;
  }
  const reasonId = refForRole(condition.parameters, "role:core.condition");
  const reason = prohibitedState(snapshot, reasonId);
  const main = nodeById(snapshot, condition.subject, "constraint");
  if (reason === undefined || main === undefined) return undefined;

  const rendered = renderConstraint(snapshot, main);
  if (rendered === undefined) return undefined;
  const lower = rendered.text.charAt(0).toLocaleLowerCase() + rendered.text.slice(1);
  const text = `If deletion is prohibited, ${lower}`;
  const q = snapshot.nodes.find(
    (node): node is QuantityNode =>
      node.kind === "quantity" &&
      rendered.sourceMap.some(
        (entry) =>
          entry.kind === "quantity" && entry.semanticRefs.includes(node.id),
      ),
  );
  return resultWithMap(text, [condition.id, main.id], q);
};

const renderCause = (
  snapshot: GraphSnapshot,
  relation: RelationNode,
): ControlledEnglishRealization | undefined => {
  if (
    relation.relation !== "concept:core.cause" ||
    relation.polarity !== "positive"
  ) {
    return undefined;
  }
  const reason = prohibitedState(snapshot, relation.source);
  const main = nodeById(snapshot, relation.target, "constraint");
  if (reason === undefined || main === undefined) return undefined;
  const rendered = renderConstraint(snapshot, main);
  if (rendered === undefined) return undefined;
  const base = rendered.text.endsWith(".")
    ? rendered.text.slice(0, -1)
    : rendered.text;
  const text = `${base} because deletion is prohibited.`;
  const q = snapshot.nodes.find(
    (node): node is QuantityNode =>
      node.kind === "quantity" &&
      rendered.sourceMap.some(
        (entry) =>
          entry.kind === "quantity" && entry.semanticRefs.includes(node.id),
      ),
  );
  return resultWithMap(text, [relation.id, main.id], q);
};

export const realizeControlledEnglishCorpusArtifact = (
  snapshot: GraphSnapshot,
): Result<ControlledEnglishRealization> => {
  for (const node of snapshot.nodes) {
    if (node.kind === "constraint" && node.constraintKind === "condition") {
      const rendered = renderCondition(snapshot, node);
      if (rendered !== undefined) return ok(rendered);
    }
  }
  for (const node of snapshot.nodes) {
    if (node.kind === "relation" && node.relation === "concept:core.cause") {
      const rendered = renderCause(snapshot, node);
      if (rendered !== undefined) return ok(rendered);
    }
  }
  for (const node of snapshot.nodes) {
    if (node.kind === "proposition") {
      const rendered = renderQuestion(snapshot, node);
      if (rendered !== undefined) return ok(rendered);
    }
  }
  for (const node of snapshot.nodes) {
    if (node.kind === "constraint" && node.constraintKind !== "condition") {
      const rendered = renderConstraint(snapshot, node);
      if (rendered !== undefined) return ok(rendered);
    }
  }
  for (const node of snapshot.nodes) {
    if (node.kind === "event") {
      const rendered = renderEvent(snapshot, node);
      if (rendered !== undefined) return ok(rendered);
    }
  }

  return err(
    new StructuredError(
      "REALIZE_CONTROLLED_CORPUS_UNSUPPORTED",
      "Graph is outside the M5 controlled English realization corpus.",
    ),
  );
};

export const realizeControlledEnglishCorpus = (
  snapshot: GraphSnapshot,
): Result<string> => {
  const artifact = realizeControlledEnglishCorpusArtifact(snapshot);
  return artifact.ok ? ok(artifact.value.text) : err(artifact.error);
};
