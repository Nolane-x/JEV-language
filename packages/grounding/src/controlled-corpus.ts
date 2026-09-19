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
  type IntentNode,
  type ReferenceNode,
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
  | "attribution"
  | "dialogue-reference"
  | "instruction-as-content";

export interface ControlledCorpusParse {
  snapshot: GraphSnapshot;
  source: GroundingSource;
  roots: SemanticId[];
  phenomena: ControlledCorpusPhenomenon[];
}

type QuantityComparator = QuantityNode["comparator"];

export type ControlledFrame =
  | {
      kind: "event";
      amount: number;
      comparator: QuantityComparator;
      polarity: EventNode["polarity"];
      aspect?: EventNode["aspect"];
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
    }
  | {
      kind: "resolved-reference";
      mention: string;
      phenomena: ControlledCorpusPhenomenon[];
    }
  | {
      kind: "instruction-content";
      amount: number;
      phenomena: ControlledCorpusPhenomenon[];
    };

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const firstMatch = (
  text: string,
  patterns: readonly RegExp[],
): RegExpExecArray | undefined => {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null) return match;
  }
  return undefined;
};

const parseFrame = (text: string): ControlledFrame | undefined => {
  let match = firstMatch(text, [
    /^The service (?:deletes|removes) exactly (\d+) files?(?: on (\d{4}-\d{2}-\d{2}))?\.$/i,
    /^Exactly (\d+) files? (?:are|is) deleted by the service(?: on (\d{4}-\d{2}-\d{2}))?\.$/i,
  ]);
  if (match !== undefined) {
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

  match = /^On (\d{4}-\d{2}-\d{2}), the service (?:deletes|removes) exactly (\d+) files?\.$/i.exec(
    text,
  ) ?? undefined;
  if (match !== undefined) {
    const amount = parsePositiveInteger(match[2]);
    const date = match[1];
    if (amount === undefined || date === undefined) return undefined;
    return {
      kind: "event",
      amount,
      comparator: "exact",
      polarity: "positive",
      date,
      phenomena: ["simple-event", "exact-quantity", "time"],
    };
  }

  match = firstMatch(text, [
    /^The service does not (?:delete|remove) exactly (\d+) files?\.$/i,
    /^Exactly (\d+) files? (?:are|is) not deleted by the service\.$/i,
  ]);
  if (match !== undefined) {
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

  match = firstMatch(text, [
    /^The service must (?:delete|remove) exactly (\d+) files?\.$/i,
    /^Exactly (\d+) files? must be deleted by the service\.$/i,
  ]);
  if (match !== undefined) {
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

  match = firstMatch(text, [
    /^The service may (?:delete|remove) at most (\d+) files?\.$/i,
    /^At most (\d+) files? may be deleted by the service\.$/i,
  ]);
  if (match !== undefined) {
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

  if (
    /^The service must not (?:delete|remove) any files?\.$/i.test(text) ||
    /^No files? may be deleted by the service\.$/i.test(text)
  ) {
    return {
      kind: "constraint",
      amount: 0,
      comparator: "at-most",
      constraintKind: "prohibition",
      predicate: "concept:core.prohibition",
      phenomena: ["prohibition", "negation"],
    };
  }

  match = firstMatch(text, [
    /^The service must not (?:delete|remove) more than (\d+) files?\.$/i,
    /^The service is required to (?:delete|remove) no more than (\d+) files?\.$/i,
  ]);
  if (match !== undefined) {
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

  match = firstMatch(text, [
    /^If deletion is prohibited, the service must not (?:delete|remove) more than (\d+) files?\.$/i,
    /^The service must not (?:delete|remove) more than (\d+) files? if deletion is prohibited\.$/i,
  ]);
  if (match !== undefined) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "condition",
      amount,
      phenomena: ["condition", "requirement", "negation", "comparison"],
    };
  }

  match = firstMatch(text, [
    /^The service must not (?:delete|remove) more than (\d+) files? because deletion is prohibited\.$/i,
    /^Because deletion is prohibited, the service must not (?:delete|remove) more than (\d+) files?\.$/i,
  ]);
  if (match !== undefined) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "cause",
      amount,
      phenomena: ["cause", "requirement", "negation", "comparison"],
    };
  }

  match = firstMatch(text, [
    /^According to the service, the service (?:deletes|removes) exactly (\d+) files?\.$/i,
    /^The service reports that it (?:deletes|removes) exactly (\d+) files?\.$/i,
  ]);
  if (match !== undefined) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "attributed-proposition",
      amount,
      phenomena: ["simple-event", "exact-quantity", "attribution"],
    };
  }

  match = firstMatch(text, [
    /^May the service (?:delete|remove) exactly (\d+) files?\?$/i,
    /^Is the service permitted to (?:delete|remove) exactly (\d+) files?\?$/i,
  ]);
  if (match !== undefined) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "question",
      amount,
      phenomena: ["question", "permission", "exact-quantity"],
    };
  }

  if (/^Here,\s*["“]it["”]\s+refers to the service\.$/i.test(text)) {
    return {
      kind: "resolved-reference",
      mention: "it",
      phenomena: ["dialogue-reference"],
    };
  }

  match = /^The instruction says the service must (?:delete|remove) exactly (\d+) files?\.$/i.exec(
    text,
  ) ?? undefined;
  if (match !== undefined) {
    const amount = parsePositiveInteger(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "instruction-content",
      amount,
      phenomena: ["instruction-as-content", "requirement", "exact-quantity"],
    };
  }

  return undefined;
};

export interface ControlledFrameBuildInput {
  text: string;
  frame: ControlledFrame;
  languageHint: string;
  actorSurface: string;
  sourceId: string;
}

export const buildControlledFrame = (
  input: ControlledFrameBuildInput,
): Result<ControlledCorpusParse> => {
  const { text, frame } = input;
  const source: GroundingSource = {
    id: input.sourceId,
    version: "1",
    mediaType: "text/plain",
    languageHint: input.languageHint,
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
  const actorStart = text
    .toLocaleLowerCase()
    .indexOf(input.actorSurface.toLocaleLowerCase());
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
        span: makeUtf16Span(
          source,
          actorStart,
          actorStart + input.actorSurface.length,
        ),
      },
    ],
    attributes: [],
    memberships: [],
  };

  if (frame.kind === "resolved-reference") {
    const referenceId = createSemanticId("reference");
    const reference: ReferenceNode = {
      id: referenceId,
      kind: "reference",
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      provenance: [provenance.id],
      trust: "user-content",
      candidates: [actorId],
      resolved: actorId,
      annotations: {
        mention: frame.mention,
        language: input.languageHint,
      },
    };
    const committed = graph.commit(
      graph.beginTransaction([
        { kind: "add-node", node: actor },
        { kind: "add-node", node: reference },
      ]),
      (snapshot) => validateSnapshot(snapshot, { ontology }),
    );
    if (!committed.ok) return err(committed.error);
    return ok({
      snapshot: committed.value.snapshot,
      source,
      roots: [referenceId],
      phenomena: [...frame.phenomena],
    });
  }

  const comparator: QuantityComparator =
    frame.kind === "event"
      ? frame.comparator
      : frame.kind === "constraint"
        ? frame.comparator
        : frame.kind === "question" ||
            frame.kind === "attributed-proposition" ||
            frame.kind === "instruction-content"
          ? "exact"
          : "at-most";
  const amount = frame.amount;
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
      ...(frame.aspect === undefined ? {} : { aspect: frame.aspect }),
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
  } else if (frame.kind === "instruction-content") {
    const actionId = createSemanticId("action");
    const constraintId = createSemanticId("constraint");
    const intentId = createSemanticId("intent");
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
      predicate: "concept:core.requirement",
      parameters: [
        {
          role: "role:core.quantity-limit",
          value: { kind: "ref", ref: quantityId },
        },
      ],
    };
    const intent: IntentNode = {
      id: intentId,
      kind: "intent",
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      provenance: [provenance.id],
      trust: "user-content",
      intent: "concept:core.instruction",
      content: constraintId,
    };
    operations.push(
      { kind: "add-node", node: action },
      { kind: "add-node", node: constraint },
      { kind: "add-node", node: intent },
    );
    roots.push(intentId);
  } else if (frame.kind === "attributed-proposition") {
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
      epistemic: { status: "reported", source: actorId },
      attribution: actorId,
    };
    operations.push({ kind: "add-node", node: proposition });
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
  return buildControlledFrame({
    text,
    frame,
    languageHint: "en",
    actorSurface: "service",
    sourceId: "source:m4-controlled-corpus",
  });
};
