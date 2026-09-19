import {
  createSemanticId,
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  makeUtf16Span,
  type GroundingSource,
} from "../../open-world-values/src/index.ts";
import { createCoreOntology } from "../../ontology/src/index.ts";
import { createProvenance } from "../../provenance/src/index.ts";
import {
  InMemorySemanticGraph,
  type ActionNode,
  type ConstraintNode,
  type EntityNode,
  type GraphSnapshot,
  type QuantityNode,
} from "../../semantic-graph/src/index.ts";
import { validateSnapshot } from "../../semantic-validator/src/index.ts";

export interface ControlledRequirementParse {
  snapshot: GraphSnapshot;
  source: GroundingSource;
  ids: {
    actor: string;
    action: string;
    quantity: string;
    constraint: string;
  };
}

interface ControlledCapture {
  text: string;
  language: "en" | "vi";
  actorStart: number;
  actorEnd: number;
  amount: number;
}

const buildControlledDeleteLimit = (
  capture: ControlledCapture,
): Result<ControlledRequirementParse> => {
  const source: GroundingSource = {
    id: `source:controlled-${capture.language}`,
    version: "1",
    mediaType: "text/plain",
    languageHint: capture.language,
    content: capture.text,
    trust: "user-content",
  };
  const provenance = createProvenance({
    originType: "user-input",
    sourceRefs: [],
    trust: "user-content",
  });
  const ontology = createCoreOntology();
  const graph = new InMemorySemanticGraph("0.1.0", "0.1.0");

  const actorId = createSemanticId("entity");
  const actionId = createSemanticId("action");
  const quantityId = createSemanticId("quantity");
  const constraintId = createSemanticId("constraint");

  const actor: EntityNode = {
    id: actorId,
    kind: "entity",
    schemaVersion: "0.1.0",
    ontologyVersion: "0.1.0",
    provenance: [provenance.id],
    trust: "user-content",
    concept: "concept:core.software-service",
    names: [
      {
        kind: "span-ref",
        span: makeUtf16Span(source, capture.actorStart, capture.actorEnd),
      },
    ],
    attributes: [],
    memberships: [],
  };

  const quantity: QuantityNode = {
    id: quantityId,
    kind: "quantity",
    schemaVersion: "0.1.0",
    ontologyVersion: "0.1.0",
    provenance: [provenance.id],
    trust: "user-content",
    amount: capture.amount,
    unit: "concept:core.file",
    comparator: "at-most",
  };

  const action: ActionNode = {
    id: actionId,
    kind: "action",
    schemaVersion: "0.1.0",
    ontologyVersion: "0.1.0",
    provenance: [provenance.id],
    trust: "user-content",
    operation: "concept:core.delete",
    actor: actorId,
    parameters: [
      {
        role: "role:core.quantity-limit",
        value: { kind: "ref", ref: quantityId },
      },
    ],
    preconditions: [],
    intendedEffects: [],
  };

  const constraint: ConstraintNode = {
    id: constraintId,
    kind: "constraint",
    schemaVersion: "0.1.0",
    ontologyVersion: "0.1.0",
    provenance: [provenance.id],
    trust: "user-content",
    constraintKind: "requirement",
    subject: actionId,
    predicate: "concept:core.maximum-cardinality",
    parameters: [
      {
        role: "role:core.quantity-limit",
        value: { kind: "ref", ref: quantityId },
      },
    ],
  };

  const result = graph.commit(
    graph.beginTransaction([
      { kind: "add-node", node: actor },
      { kind: "add-node", node: quantity },
      { kind: "add-node", node: action },
      { kind: "add-node", node: constraint },
    ]),
    (snapshot) => validateSnapshot(snapshot, { ontology }),
  );
  if (!result.ok) return err(result.error);

  return ok({
    snapshot: result.value.snapshot,
    source,
    ids: {
      actor: actorId,
      action: actionId,
      quantity: quantityId,
      constraint: constraintId,
    },
  });
};

const englishRules: RegExp[] = [
  /^The\s+(service)\s+must\s+not\s+delete\s+more\s+than\s+(\d+)\s+(files?)\.?$/i,
  /^The\s+(service)\s+is\s+not\s+permitted\s+to\s+delete\s+more\s+than\s+(\d+)\s+(files?)\.?$/i,
];

export const parseControlledRequirement = (
  input: string,
): Result<ControlledRequirementParse> => {
  const text = input.trim();
  for (const rule of englishRules) {
    const match = rule.exec(text);
    if (match === null) continue;
    const actorText = match[1];
    const amountText = match[2];
    if (actorText === undefined || amountText === undefined) continue;
    const actorStart = text.indexOf(actorText);
    return buildControlledDeleteLimit({
      text,
      language: "en",
      actorStart,
      actorEnd: actorStart + actorText.length,
      amount: Number(amountText),
    });
  }
  return err(
    new StructuredError(
      "GROUNDING_UNSUPPORTED_CONSTRUCTION",
      "Input is outside the first controlled English requirement grammar.",
    ),
  );
};

const vietnameseRules: RegExp[] = [
  /^(Dịch vụ)\s+không\s+được\s+xóa\s+quá\s+(\d+)\s+(?:tệp|tệp tin|file)\.?$/iu,
  /^(Dịch vụ)\s+không\s+được\s+phép\s+xóa\s+quá\s+(\d+)\s+(?:tệp|tệp tin|file)\.?$/iu,
];

export const parseControlledVietnameseRequirement = (
  input: string,
): Result<ControlledRequirementParse> => {
  const text = input.trim();
  for (const rule of vietnameseRules) {
    const match = rule.exec(text);
    if (match === null) continue;
    const actorText = match[1];
    const amountText = match[2];
    if (actorText === undefined || amountText === undefined) continue;
    const actorStart = text.indexOf(actorText);
    return buildControlledDeleteLimit({
      text,
      language: "vi",
      actorStart,
      actorEnd: actorStart + actorText.length,
      amount: Number(amountText),
    });
  }
  return err(
    new StructuredError(
      "GROUNDING_UNSUPPORTED_VI_CONSTRUCTION",
      "Input is outside the first controlled Vietnamese requirement grammar.",
    ),
  );
};
