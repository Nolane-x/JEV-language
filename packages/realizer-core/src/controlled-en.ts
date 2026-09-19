import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  ActionNode,
  ConstraintNode,
  EntityNode,
  GraphSnapshot,
  QuantityNode,
} from "../../semantic-graph/src/index.ts";

export const realizeControlledEnglish = (
  snapshot: GraphSnapshot,
): Result<string> => {
  const constraint = snapshot.nodes.find(
    (node): node is ConstraintNode =>
      node.kind === "constraint" &&
      node.constraintKind === "requirement" &&
      node.predicate === "concept:core.maximum-cardinality",
  );
  if (constraint === undefined) {
    return err(
      new StructuredError(
        "REALIZE_NO_SUPPORTED_CONSTRAINT",
        "No supported maximum-cardinality requirement exists in the graph.",
      ),
    );
  }

  const action = snapshot.nodes.find(
    (node): node is ActionNode =>
      node.kind === "action" && node.id === constraint.subject,
  );
  if (action === undefined || action.operation !== "concept:core.delete") {
    return err(
      new StructuredError(
        "REALIZE_UNSUPPORTED_ACTION",
        "Controlled realizer expected a delete action.",
      ),
    );
  }

  const actor = snapshot.nodes.find(
    (node): node is EntityNode =>
      node.kind === "entity" && node.id === action.actor,
  );
  const quantityArgument = action.parameters.find(
    (argument) =>
      argument.role === "role:core.quantity-limit" &&
      argument.value.kind === "ref",
  );
  const quantityId =
    quantityArgument !== undefined && quantityArgument.value.kind === "ref"
      ? quantityArgument.value.ref
      : undefined;
  const quantity =
    quantityId === undefined
      ? undefined
      : snapshot.nodes.find(
          (node): node is QuantityNode =>
            node.kind === "quantity" && node.id === quantityId,
        );

  if (
    actor === undefined ||
    actor.concept !== "concept:core.software-service" ||
    quantity === undefined ||
    quantity.unit !== "concept:core.file" ||
    quantity.comparator !== "at-most"
  ) {
    return err(
      new StructuredError(
        "REALIZE_UNSUPPORTED_SEMANTICS",
        "Graph is outside the first controlled English realization subset.",
      ),
    );
  }

  const noun = quantity.amount === 1 ? "file" : "files";
  return ok(
    `The service is not permitted to delete more than ${quantity.amount} ${noun}.`,
  );
};
