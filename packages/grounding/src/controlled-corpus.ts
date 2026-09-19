import {
  createSemanticId,
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
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
  type EventNode,
  type GraphOperation,
  type GraphSnapshot,
  type PropositionNode,
  type QuantityNode,
  type RelationNode,
  type StateNode,
  type TemporalNode,
} from "../../semantic-graph/src/index.ts";
import { validateSnapshot } from "../../semantic-validator/src/index.ts";

export type ControlledCorpusPhenomenon =
  | "simple-event"
  | "negation"
  | "exact-quantity"
  | "time"
  | "condition"
  | "cause"
  | "requirement"
  | "permission"
  | "prohibition"
  | "comparison"
  | "question"
  | "attribution";

export interface ControlledCorpusParse {
  snapshot: GraphSnapshot;
  source: GroundingSource;
  roots: SemanticId[];
  phenomena: ControlledCorpusPhenomenon[];
}

type QuantityComparator = QuantityNode["comparator"];

type ControlledFrame =
  | {
      kind: "event";
      amount: number;
      comparator: QuantityComparator;
      polarity: EventNode["polarity"];
      date?: string;
      phenomena: ControlledCorpusPhenomenon[];
    }
  | {
      kind: "constraint";
      amount: number;
      comparator: QuantityComparator;
      constraintKind: ConstraintNode["constraintKind"];
      predicate:
        | "concept:core.requirement"
        | "concept:core.permission"
        | "concept:core.prohibition"
        | "concept:core.maximum-cardinality";
      phenomena: ControlledCorpusPhenomenon[];
    }
  | {
      kind: "condition";
      amount: number;
      phenomena: ControlledCorpusPhenomenon[];
    }
  | {
      kind: "cause";
      amount: number;
      phenomena: ControlledCorpusPhenomenon[];
    }
  | {
      kind: "question";
      amount: number;
      phenomena: ControlledCorpusPhenomenon[];
    }
  | {
      kind: "attributed-proposition";
      amount: number;
      phenomena: ControlledCorpusPhenomenon[];
    };

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseFrame = (text: string): ControlledFrame | undefined => {
  let match = /^The service deletes exactly (\d+) files?(?: on (\d{4}-\d{2}-\d{2}))?\.$/i.exec(
    text,
  );
  if (match !== null) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    const date = match[2];
    return {
      kind: "event",
      amount,
      comparator: "exact",
      polarity: "positive",
      ...(date === undefined ? {} : { date }),
      phenomena: [
        "simple-event",
        "exact-quantity",
        ...(date === undefined ? [] : (["time"] as const)),
      ],
    };
  }

  match = /^The service does not delete exactly (\d+) files?\.$/i.exec(text);
  if (match !== null) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "event",
      amount,
      comparator: "exact",
      polarity: "negative",
      phenomena: ["simple-event", "negation", "exact-quantity"],
    };
  }

  match = /^The service must delete exactly (\d+) files?\.$/i.exec(text);
  if (match !== null) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "constraint",
      amount,
      comparator: "exact",
      constraintKind: "requirement",
      predicate: "concept:core.requirement",
      phenomena: ["requirement", "exact-quantity"],
    };
  }

  match = /^The service may delete at most (\d+) files?\.$/i.exec(text);
  if (match !== null) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "constraint",
      amount,
      comparator: "at-most",
      constraintKind: "permission",
      predicate: "concept:core.permission",
      phenomena: ["permission", "comparison"],
    };
  }

  if (/^The service must not delete any files?\.$/i.test(text)) {
    return {
      kind: "constraint",
      amount: 0,
      comparator: "at-most",
      constraintKind: "prohibition",
      predicate: "concept:core.prohibition",
      phenomena: ["prohibition", "negation"],
    };
  }

  match = /^The service must not delete more than (\d+) files?\.$/i.exec(text);
  if (match !== null) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "constraint",
      amount,
      comparator: "at-most",
      constraintKind: "requirement",
      predicate: "concept:core.maximum-cardinality",
      phenomena: ["requirement", "negation", "comparison"],
    };
  }

  match =
    /^If deletion is prohibited, the service must not delete more than (\d+) files?\.$/i.exec(
      text,
    );
  if (match !== null) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "condition",
      amount,
      phenomena: ["condition", "requirement", "negation", "comparison"],
    };
  }

  match =
    /^The service must not delete more than (\d+) files? because deletion is prohibited\.$/i.exec(
      text,
    );
  if (match !== null) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "cause",
      amount,
      phenomena: ["cause", "requirement", "negation", "comparison"],
    };
  }

  match =
    /^According to the auditor, the service deletes exactly (\d+) files?\.$/i.exec(
      text,
    );
  if (match !== null) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "attributed-proposition",
      amount,
      phenomena: ["simple-event", "exact-quantity", "attribution"],
    };
  }

  match = /^May the service delete exactly (\d+) files?\?$/i.exec(text);
  if (match !== null) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "question",
      amount,
      phenomena: ["question", "permission", "exact-quantity"],
    };
  }

  return undefined;
};

const buildFrame = (
  text: string,
  frame: ControlledFrame,
): Result<ControlledCorpusParse> => {
  const source: GroundingSource = {
    id: "source:m4-controlled-corpus",
    version: "1",
    mediaType: "text/plain",
    languageHint: "en",
    content: text,
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
  const quantityId = createSemanticId("quantity");
  const actorStart = text.toLocaleLowerCase().indexOf("service");
  if (actorStart < 0) {
    return err(
      new StructuredError(
        "GROUNDING_CONTROLLED_ACTOR",
        "Controlled corpus frame lost its required service actor.",
      ),
    );
  }

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
        span: makeUtf16Span(source, actorStart, actorStart + "service".length),
      },
    ],
    attributes: [],
    memberships: [],
  };

  const comparator: QuantityComparator =
    frame.kind === "event"
      ? frame.comparator
      : frame.kind === "constraint"
        ? frame.comparator
        : frame.kind === "question" || frame.kind === "attributed-proposition"
          ? "exact"
          : "at-most";
  const amount =
    frame.kind === "event" || frame.kind === "constraint" || frame.kind === "question"
      ? frame.amount
      : frame.amount;
  const quantity: QuantityNode = {
    id: quantityId,
    kind: "quantity",
    schemaVersion: "0.1.0",
    ontologyVersion: "0.1.0",
    provenance: [provenance.id],
    trust: "user-content",
    amount,
    unit: "concept:core.file",
    comparator,
  };

  const operations: GraphOperation[] = [
    { kind: "add-node", node: actor },
    { kind: "add-node", node: quantity },
  ];
  const roots: SemanticId[] = [];

  if (frame.kind === "event") {
    let temporalId: SemanticId | undefined;
    if (frame.date !== undefined) {
      temporalId = createSemanticId("time");
      const temporal: TemporalNode = {
        id: temporalId,
        kind: "temporal",
        schemaVersion: "0.1.0",
        ontologyVersion: "0.1.0",
        provenance: [provenance.id],
        trust: "user-content",
        temporalKind: "instant",
        value: { iso: frame.date, precision: "date" },
      };
      operations.push({ kind: "add-node", node: temporal });
    }

    const eventId = createSemanticId("event");
    const event: EventNode = {
      id: eventId,
      kind: "event",
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      provenance: [provenance.id],
      trust: "user-content",
      predicate: "concept:core.delete",
      roles: [
        { role: "role:core.agent", value: { kind: "ref", ref: actorId } },
        {
          role: "role:core.quantity-limit",
          value: { kind: "ref", ref: quantityId },
        },
      ],
      ...(temporalId === undefined ? {} : { temporal: temporalId }),
      polarity: frame.polarity,
    };
    operations.push({ kind: "add-node", node: event });
    roots.push(eventId);
  } else if (frame.kind === "constraint") {
    const actionId = createSemanticId("action");
    const constraintId = createSemanticId("constraint");
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
      constraintKind: frame.constraintKind,
      subject: actionId,
      predicate: frame.predicate,
      parameters: [
        {
          role: "role:core.quantity-limit",
          value: { kind: "ref", ref: quantityId },
        },
      ],
    };
    operations.push(
      { kind: "add-node", node: action },
      { kind: "add-node", node: constraint },
    );
    roots.push(constraintId);
  } else if (frame.kind === "attributed-proposition") {
    const reporterStart = text.toLocaleLowerCase().indexOf("auditor");
    if (reporterStart < 0) {
      return err(
        new StructuredError(
          "GROUNDING_CONTROLLED_ATTRIBUTION",
          "Attributed controlled corpus frame lost its reporter span.",
        ),
      );
    }
    const reporterId = createSemanticId("entity");
    const propositionId = createSemanticId("proposition");
    const reporter: EntityNode = {
      id: reporterId,
      kind: "entity",
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      provenance: [provenance.id],
      trust: "user-content",
      concept: "concept:core.person",
      names: [
        {
          kind: "span-ref",
          span: makeUtf16Span(
            source,
            reporterStart,
            reporterStart + "auditor".length,
          ),
        },
      ],
      attributes: [],
      memberships: [],
    };
    const proposition: PropositionNode = {
      id: propositionId,
      kind: "proposition",
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      provenance: [provenance.id],
      trust: "user-content",
      predicate: "concept:core.delete",
      arguments: [
        { role: "role:core.agent", value: { kind: "ref", ref: actorId } },
        {
          role: "role:core.quantity-limit",
          value: { kind: "ref", ref: quantityId },
        },
      ],
      polarity: "positive",
      epistemic: { status: "reported", source: reporterId },
      attribution: reporterId,
    };
    operations.push(
      { kind: "add-node", node: reporter },
      { kind: "add-node", node: proposition },
    );
    roots.push(propositionId);
  } else if (frame.kind === "question") {
    const propositionId = createSemanticId("proposition");
    const proposition: PropositionNode = {
      id: propositionId,
      kind: "proposition",
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      provenance: [provenance.id],
      trust: "user-content",
      predicate: "concept:core.delete",
      arguments: [
        { role: "role:core.agent", value: { kind: "ref", ref: actorId } },
        {
          role: "role:core.quantity-limit",
          value: { kind: "ref", ref: quantityId },
        },
      ],
      polarity: "positive",
      modality: { kind: "permitted" },
      epistemic: { status: "questioned" },
    };
    operations.push({ kind: "add-node", node: proposition });
    roots.push(propositionId);
  } else {
    const actionId = createSemanticId("action");
    const mainConstraintId = createSemanticId("constraint");
    const reasonStateId = createSemanticId("state");

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
    const mainConstraint: ConstraintNode = {
      id: mainConstraintId,
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
    const reasonState: StateNode = {
      id: reasonStateId,
      kind: "state",
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      provenance: [provenance.id],
      trust: "user-content",
      predicate: "concept:core.prohibition",
      holder: actorId,
      arguments: [],
      polarity: "positive",
    };
    operations.push(
      { kind: "add-node", node: action },
      { kind: "add-node", node: mainConstraint },
      { kind: "add-node", node: reasonState },
    );

    if (frame.kind === "condition") {
      const conditionId = createSemanticId("constraint");
      const condition: ConstraintNode = {
        id: conditionId,
        kind: "constraint",
        schemaVersion: "0.1.0",
        ontologyVersion: "0.1.0",
        provenance: [provenance.id],
        trust: "user-content",
        constraintKind: "condition",
        subject: mainConstraintId,
        predicate: "concept:core.condition",
        parameters: [
          {
            role: "role:core.condition",
            value: { kind: "ref", ref: reasonStateId },
          },
        ],
      };
      operations.push({ kind: "add-node", node: condition });
      roots.push(conditionId, mainConstraintId);
    } else {
      const causeId = createSemanticId("relation");
      const cause: RelationNode = {
        id: causeId,
        kind: "relation",
        schemaVersion: "0.1.0",
        ontologyVersion: "0.1.0",
        provenance: [provenance.id],
        trust: "user-content",
        relation: "concept:core.cause",
        source: reasonStateId,
        target: mainConstraintId,
        polarity: "positive",
      };
      operations.push({ kind: "add-node", node: cause });
      roots.push(causeId, mainConstraintId);
    }
  }

  const committed = graph.commit(
    graph.beginTransaction(operations),
    (snapshot) => validateSnapshot(snapshot, { ontology }),
  );
  if (!committed.ok) return err(committed.error);

  return ok({
    snapshot: committed.value.snapshot,
    source,
    roots,
    phenomena: [...frame.phenomena],
  });
};

export const parseControlledEnglishCorpus = (
  input: string,
): Result<ControlledCorpusParse> => {
  const text = input.trim();
  const frame = parseFrame(text);
  if (frame === undefined) {
    return err(
      new StructuredError(
        "GROUNDING_CONTROLLED_CORPUS_UNSUPPORTED",
        "Input is outside the M4 controlled English semantic corpus.",
      ),
    );
  }
  return buildFrame(text, frame);
};
