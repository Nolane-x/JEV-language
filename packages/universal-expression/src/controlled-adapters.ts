import type {
  ActionIR,
  CapabilityDefinition,
} from "../../action-ir/src/index.ts";
import { buildAction } from "../../action-ir/src/index.ts";
import type { DataIr } from "../../formal-ir/src/index.ts";
import {
  realizeControlledEnglish,
  realizeControlledVietnamese,
} from "../../realizer-core/src/index.ts";
import type {
  ActionNode,
  ConstraintNode,
  EntityNode,
  GraphSnapshot,
  QuantityNode,
  SemanticRef,
} from "../../semantic-graph/src/index.ts";
import type {
  ExpressionArtifact,
  ExpressionRequest,
  ExpressionResult,
} from "./index.ts";
import type { RealizerAdapter } from "./runtime.ts";

interface ControlledDeleteLimitSemantics {
  snapshot: GraphSnapshot;
  actor: EntityNode;
  action: ActionNode;
  quantity: QuantityNode;
  constraint: ConstraintNode;
}

const failure = (
  code: string,
  message: string,
): ExpressionResult => ({
  status: "unsupported",
  diagnostics: [{ code, message, severity: "error" }],
  evidence: [],
  provenance: [],
});

const requestSnapshot = (
  request: ExpressionRequest,
): GraphSnapshot | undefined => {
  if (request.semanticState !== undefined) return request.semanticState;
  if (request.input?.kind === "semantic-graph") return request.input.graph;
  return undefined;
};

const resolveControlledDeleteLimit = (
  request: ExpressionRequest,
): ControlledDeleteLimitSemantics | undefined => {
  const snapshot = requestSnapshot(request);
  if (snapshot === undefined) return undefined;

  const requestedRoots = new Set(request.goal.semanticRoots ?? []);
  const constraint = snapshot.nodes.find(
    (node): node is ConstraintNode =>
      node.kind === "constraint" &&
      node.constraintKind === "requirement" &&
      node.predicate === "concept:core.maximum-cardinality" &&
      (requestedRoots.size === 0 || requestedRoots.has(node.id)),
  );
  if (constraint === undefined) return undefined;

  const action = snapshot.nodes.find(
    (node): node is ActionNode =>
      node.kind === "action" &&
      node.id === constraint.subject &&
      node.operation === "concept:core.delete",
  );
  if (action === undefined || action.actor === undefined) return undefined;

  const actor = snapshot.nodes.find(
    (node): node is EntityNode =>
      node.kind === "entity" &&
      node.id === action.actor &&
      node.concept === "concept:core.software-service",
  );
  const quantityArgument = action.parameters.find(
    (argument) =>
      argument.role === "role:core.quantity-limit" &&
      argument.value.kind === "ref",
  );
  const quantityRef =
    quantityArgument?.value.kind === "ref"
      ? quantityArgument.value.ref
      : undefined;
  if (actor === undefined || quantityRef === undefined) {
    return undefined;
  }

  const quantity = snapshot.nodes.find(
    (node): node is QuantityNode =>
      node.kind === "quantity" &&
      node.id === quantityRef &&
      node.unit === "concept:core.file" &&
      node.comparator === "at-most",
  );
  if (quantity === undefined) return undefined;

  return { snapshot, actor, action, quantity, constraint };
};

const semanticRefs = (
  semantics: ControlledDeleteLimitSemantics,
): SemanticRef[] => [
  semantics.constraint.id,
  semantics.action.id,
  semantics.actor.id,
  semantics.quantity.id,
];

const textAdapter = (
  language: "en" | "vi",
): RealizerAdapter => ({
  id: `realizer.controlled.${language}.semantic.v1`,
  targets: ["natural-language"],
  languages: [language],
  async realize(request) {
    const semantics = resolveControlledDeleteLimit(request);
    if (semantics === undefined) {
      return failure(
        "EXPRESSION_CONTROLLED_SEMANTICS_UNSUPPORTED",
        "The semantic graph is outside the controlled delete-limit realization subset.",
      );
    }
    const realized =
      language === "en"
        ? realizeControlledEnglish(semantics.snapshot)
        : realizeControlledVietnamese(semantics.snapshot);
    if (!realized.ok) {
      return failure(realized.error.code, realized.error.message);
    }

    const artifact: ExpressionArtifact = {
      artifactType: "text",
      text: realized.value,
      language,
      semanticRefs: semanticRefs(semantics),
    };
    return {
      status: "ok",
      value: [artifact],
      diagnostics: [],
      evidence: [],
      provenance: [...semantics.constraint.provenance],
    };
  },
});

export const controlledEnglishSemanticRealizer = textAdapter("en");
export const controlledVietnameseSemanticRealizer = textAdapter("vi");

export const controlledDeleteLimitDataRealizer: RealizerAdapter = {
  id: "realizer.controlled.delete-limit.data.v1",
  targets: ["structured-data"],
  async realize(request) {
    const semantics = resolveControlledDeleteLimit(request);
    if (semantics === undefined) {
      return failure(
        "EXPRESSION_CONTROLLED_DATA_UNSUPPORTED",
        "No supported delete-limit semantic requirement was found.",
      );
    }

    const data: DataIr = {
      kind: "object",
      semanticRef: semantics.constraint.id,
      fields: [
        {
          key: "maximumDeleteFiles",
          required: true,
          value: {
            kind: "number",
            value: semantics.quantity.amount,
            semanticRef: semantics.quantity.id,
          },
        },
        {
          key: "deleteOperation",
          required: true,
          value: {
            kind: "boolean",
            value: true,
            semanticRef: semantics.action.id,
          },
        },
        {
          key: "requirementActive",
          required: true,
          value: {
            kind: "boolean",
            value: true,
            semanticRef: semantics.constraint.id,
          },
        },
      ],
    };

    return {
      status: "ok",
      value: [
        {
          artifactType: "structured-data",
          data,
          semanticRefs: semanticRefs(semantics),
        },
      ],
      diagnostics: [],
      evidence: [],
      provenance: [...semantics.constraint.provenance],
    };
  },
};

export const createControlledDeleteLimitActionRealizer = (
  capabilityId: string,
): RealizerAdapter => ({
  id: `realizer.controlled.delete-limit.action.${capabilityId}.v1`,
  targets: ["action"],
  async realize(request) {
    const semantics = resolveControlledDeleteLimit(request);
    if (semantics === undefined) {
      return failure(
        "EXPRESSION_CONTROLLED_ACTION_UNSUPPORTED",
        "No supported delete-limit semantic requirement was found.",
      );
    }
    if (capabilityId.trim() === "") {
      return failure(
        "EXPRESSION_ACTION_CAPABILITY_EMPTY",
        "The configured capability id is empty.",
      );
    }

    const capabilities: CapabilityDefinition[] =
      request.availableCapabilities ?? [];
    const actionIr: ActionIR = {
      actionType: capabilityId,
      parameters: {
        kind: "structured",
        fields: {
          constrainedAction: { kind: "ref", ref: semantics.action.id },
          maximumDeleteFiles: {
            kind: "number",
            value: semantics.quantity.amount,
          },
        },
      },
      preconditions: [semantics.constraint.id],
      provenance: [...semantics.constraint.provenance],
      semanticPurpose: semantics.constraint.id,
    };

    const built = buildAction(actionIr, {
      capabilities,
      knownReferences: new Set(
        semantics.snapshot.nodes.map((node) => node.id),
      ),
    });
    if (!built.ok) return failure(built.error.code, built.error.message);

    return {
      status: "ok",
      value: [
        {
          artifactType: "action",
          action: built.value,
          semanticRefs: semanticRefs(semantics),
        },
      ],
      diagnostics: [],
      evidence: [],
      provenance: [...semantics.constraint.provenance],
    };
  },
});
