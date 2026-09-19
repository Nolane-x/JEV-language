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
  type EntityNode,
  type EventNode,
  type GraphOperation,
  type GraphSnapshot,
  type QuantityNode,
} from "../../semantic-graph/src/index.ts";
import { validateSnapshot } from "../../semantic-validator/src/index.ts";

export type ExpandedEnglishDocumentKind =
  | "dual-event-relative"
  | "dual-event-multisentence"
  | "unknown-named-event";

export interface ExpandedEnglishDocumentParse {
  kind: ExpandedEnglishDocumentKind;
  snapshot: GraphSnapshot;
  source: GroundingSource;
  roots: SemanticId[];
  actor: SemanticId;
}

const sourceFor = (text: string): GroundingSource => ({
  id: "source:m6-expanded-english",
  version: "1",
  mediaType: "text/plain",
  languageHint: "en",
  content: text,
  trust: "user-content",
});

const exactQuantity = (
  amount: number,
  provenanceId: SemanticId,
): QuantityNode => ({
  id: createSemanticId("quantity"),
  kind: "quantity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [provenanceId],
  trust: "user-content",
  amount,
  unit: "concept:core.file",
  comparator: "exact",
});

const deleteEvent = (
  actor: SemanticId,
  quantity: QuantityNode,
  provenanceId: SemanticId,
): EventNode => ({
  id: createSemanticId("event"),
  kind: "event",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [provenanceId],
  trust: "user-content",
  predicate: "concept:core.delete",
  roles: [
    { role: "role:core.agent", value: { kind: "ref", ref: actor } },
    {
      role: "role:core.quantity-limit",
      value: { kind: "ref", ref: quantity.id },
    },
  ],
  polarity: "positive",
});

const commitDocument = (
  kind: ExpandedEnglishDocumentKind,
  source: GroundingSource,
  actor: EntityNode,
  quantities: QuantityNode[],
  events: EventNode[],
): Result<ExpandedEnglishDocumentParse> => {
  const ontology = createCoreOntology();
  const graph = new InMemorySemanticGraph("0.1.0", "0.1.0");
  const operations: GraphOperation[] = [
    { kind: "add-node", node: actor },
    ...quantities.map(
      (node): GraphOperation => ({ kind: "add-node", node }),
    ),
    ...events.map(
      (node): GraphOperation => ({ kind: "add-node", node }),
    ),
  ];
  const committed = graph.commit(
    graph.beginTransaction(operations),
    (snapshot) => validateSnapshot(snapshot, { ontology }),
  );
  if (!committed.ok) return err(committed.error);
  return ok({
    kind,
    snapshot: committed.value.snapshot,
    source,
    roots: events.map((event) => event.id),
    actor: actor.id,
  });
};

const buildDualEvent = (
  text: string,
  kind: "dual-event-relative" | "dual-event-multisentence",
  firstAmount: number,
  secondAmount: number,
): Result<ExpandedEnglishDocumentParse> => {
  const source = sourceFor(text);
  const provenance = createProvenance({
    originType: "user-input",
    sourceRefs: [],
    trust: "user-content",
  });
  const actorStart = text.toLocaleLowerCase().indexOf("service");
  if (actorStart < 0) {
    return err(
      new StructuredError(
        "GROUNDING_M6_ACTOR",
        "Expanded English document lost its shared service actor.",
      ),
    );
  }
  const actor: EntityNode = {
    id: createSemanticId("entity"),
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
          actorStart + "service".length,
        ),
      },
    ],
    attributes: [],
    memberships: [],
  };
  const first = exactQuantity(firstAmount, provenance.id);
  const second = exactQuantity(secondAmount, provenance.id);
  const firstEvent = deleteEvent(actor.id, first, provenance.id);
  const secondEvent = deleteEvent(actor.id, second, provenance.id);
  return commitDocument(
    kind,
    source,
    actor,
    [first, second],
    [firstEvent, secondEvent],
  );
};

const buildUnknownNamedEvent = (
  text: string,
  name: string,
  amount: number,
): Result<ExpandedEnglishDocumentParse> => {
  const source = sourceFor(text);
  const provenance = createProvenance({
    originType: "user-input",
    sourceRefs: [],
    trust: "user-content",
  });
  const nameStart = text.indexOf(name);
  if (nameStart < 0) {
    return err(
      new StructuredError(
        "GROUNDING_M6_UNKNOWN_NAME",
        "Unknown actor name no longer occurs in the source text.",
      ),
    );
  }
  const actor: EntityNode = {
    id: createSemanticId("entity"),
    kind: "entity",
    schemaVersion: "0.1.0",
    ontologyVersion: "0.1.0",
    provenance: [provenance.id],
    trust: "user-content",
    concept: "concept:core.software-service",
    names: [
      {
        kind: "span-ref",
        span: makeUtf16Span(source, nameStart, nameStart + name.length),
      },
    ],
    attributes: [],
    memberships: [],
  };
  const quantity = exactQuantity(amount, provenance.id);
  const event = deleteEvent(actor.id, quantity, provenance.id);
  return commitDocument(
    "unknown-named-event",
    source,
    actor,
    [quantity],
    [event],
  );
};

export const parseExpandedEnglishDocument = (
  input: string,
): Result<ExpandedEnglishDocumentParse> => {
  const text = input.trim();

  let match =
    /^The service, which (?:deletes|removes) exactly (\d+) files?, (?:deletes|removes) exactly (\d+) files?\.$/i.exec(
      text,
    );
  if (match !== null) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (Number.isSafeInteger(first) && Number.isSafeInteger(second)) {
      return buildDualEvent(
        text,
        "dual-event-relative",
        first,
        second,
      );
    }
  }

  match =
    /^The service (?:deletes|removes) exactly (\d+) files?\. It (?:deletes|removes) exactly (\d+) files?\.$/i.exec(
      text,
    );
  if (match !== null) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (Number.isSafeInteger(first) && Number.isSafeInteger(second)) {
      return buildDualEvent(
        text,
        "dual-event-multisentence",
        first,
        second,
      );
    }
  }

  match =
    /^([A-Z][A-Za-z0-9_-]{2,}) (?:deletes|removes) exactly (\d+) files?\.$/.exec(
      text,
    );
  if (match !== null) {
    const name = match[1];
    const amount = Number(match[2]);
    if (
      name !== undefined &&
      Number.isSafeInteger(amount) &&
      name.toLocaleLowerCase() !== "the"
    ) {
      return buildUnknownNamedEvent(text, name, amount);
    }
  }

  return err(
    new StructuredError(
      "GROUNDING_M6_EXPANDED_UNSUPPORTED",
      "Input is outside the M6 expanded English document subset.",
    ),
  );
};
