import type {
  ActionNode,
  ConstraintNode,
  EntityNode,
  GraphSnapshot,
  QuantityNode,
} from "../../semantic-graph/src/index.ts";

interface ControlledSignature {
  actorConcept: string;
  actionOperation: string;
  constraintKind: string;
  predicate: string;
  amount: number;
  unit?: string;
  comparator: string;
}

const signature = (snapshot: GraphSnapshot): ControlledSignature | undefined => {
  const constraint = snapshot.nodes.find(
    (node): node is ConstraintNode => node.kind === "constraint",
  );
  if (constraint === undefined) return undefined;
  const action = snapshot.nodes.find(
    (node): node is ActionNode =>
      node.kind === "action" && node.id === constraint.subject,
  );
  if (action === undefined || action.actor === undefined) return undefined;
  const actor = snapshot.nodes.find(
    (node): node is EntityNode =>
      node.kind === "entity" && node.id === action.actor,
  );
  if (actor === undefined) return undefined;
  const quantityArgument = action.parameters.find(
    (argument) =>
      argument.role === "role:core.quantity-limit" &&
      argument.value.kind === "ref",
  );
  if (quantityArgument === undefined || quantityArgument.value.kind !== "ref") {
    return undefined;
  }
  const quantityId = quantityArgument.value.ref;
  const quantity = snapshot.nodes.find(
    (node): node is QuantityNode =>
      node.kind === "quantity" && node.id === quantityId,
  );
  if (quantity === undefined) return undefined;

  return {
    actorConcept: actor.concept,
    actionOperation: action.operation,
    constraintKind: constraint.constraintKind,
    predicate: constraint.predicate,
    amount: quantity.amount,
    ...(quantity.unit === undefined ? {} : { unit: quantity.unit }),
    comparator: quantity.comparator,
  };
};

export interface EquivalenceReport {
  equivalent: boolean;
  left?: ControlledSignature;
  right?: ControlledSignature;
}

export const verifyControlledEquivalence = (
  left: GraphSnapshot,
  right: GraphSnapshot,
): EquivalenceReport => {
  const a = signature(left);
  const b = signature(right);
  if (a === undefined || b === undefined) {
    return {
      equivalent: false,
      ...(a === undefined ? {} : { left: a }),
      ...(b === undefined ? {} : { right: b }),
    };
  }
  return {
    equivalent:
      a.actorConcept === b.actorConcept &&
      a.actionOperation === b.actionOperation &&
      a.constraintKind === b.constraintKind &&
      a.predicate === b.predicate &&
      a.amount === b.amount &&
      a.unit === b.unit &&
      a.comparator === b.comparator,
    left: a,
    right: b,
  };
};
