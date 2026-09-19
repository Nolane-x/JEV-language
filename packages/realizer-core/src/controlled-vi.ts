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

export const realizeControlledVietnamese = (
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
        "REALIZE_VI_NO_SUPPORTED_CONSTRAINT",
        "Không tìm thấy yêu cầu giới hạn số lượng được hỗ trợ.",
      ),
    );
  }
  const action = snapshot.nodes.find(
    (node): node is ActionNode =>
      node.kind === "action" &&
      node.id === constraint.subject &&
      node.operation === "concept:core.delete",
  );
  if (action === undefined || action.actor === undefined) {
    return err(
      new StructuredError(
        "REALIZE_VI_UNSUPPORTED_ACTION",
        "Controlled Vietnamese realizer expected a delete action.",
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
  if (quantityArgument === undefined || quantityArgument.value.kind !== "ref") {
    return err(
      new StructuredError(
        "REALIZE_VI_MISSING_QUANTITY",
        "Delete-limit action is missing its quantity reference.",
      ),
    );
  }
  const quantityId = quantityArgument.value.ref;
  const quantity = snapshot.nodes.find(
    (node): node is QuantityNode =>
      node.kind === "quantity" && node.id === quantityId,
  );
  if (
    actor?.concept !== "concept:core.software-service" ||
    quantity === undefined ||
    quantity.unit !== "concept:core.file" ||
    quantity.comparator !== "at-most"
  ) {
    return err(
      new StructuredError(
        "REALIZE_VI_UNSUPPORTED_SEMANTICS",
        "Graph is outside the first controlled Vietnamese subset.",
      ),
    );
  }

  return ok(
    `Dịch vụ không được phép xóa quá ${quantity.amount} tệp.`,
  );
};
