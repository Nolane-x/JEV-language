import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  runtimeSchema,
} from "../../packages/core-types/src/index.ts";
import {
  InMemorySemanticGraph,
  deserializeSnapshot,
  semanticDiff,
  serializeSnapshot,
  type ConstraintNode,
  type EntityNode,
  type EventNode,
  type PropositionNode,
  type QuantityNode,
  type RelationNode,
  type TemporalNode,
} from "../../packages/semantic-graph/src/index.ts";
import { validateSnapshot } from "../../packages/semantic-validator/src/index.ts";

const base = {
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  trust: "user-content" as const,
  provenance: ["prov:test-source"] as const,
};

const fixtureNodes = () => {
  const entity: EntityNode = {
    ...base,
    provenance: [...base.provenance],
    id: "entity:test-service",
    kind: "entity",
    concept: "concept:test.service",
    attributes: [],
    memberships: [],
  };
  const quantity: QuantityNode = {
    ...base,
    provenance: [...base.provenance],
    id: "quantity:test-limit",
    kind: "quantity",
    amount: 3,
    unit: "concept:test.file",
    comparator: "at-most",
  };
  const time: TemporalNode = {
    ...base,
    provenance: [...base.provenance],
    id: "temporal:test-window",
    kind: "temporal",
    temporalKind: "interval",
    value: { start: "2026-09-19", end: "2026-09-20" },
  };
  const event: EventNode = {
    ...base,
    provenance: [...base.provenance],
    id: "event:test-delete",
    kind: "event",
    predicate: "concept:test.delete",
    roles: [
      { role: "role:test.agent", value: { kind: "ref", ref: entity.id } },
      { role: "role:test.limit", value: { kind: "ref", ref: quantity.id } },
    ],
    temporal: time.id,
    polarity: "negative",
    modality: { kind: "forbidden" },
  };
  const proposition: PropositionNode = {
    ...base,
    provenance: [...base.provenance],
    id: "proposition:test-requirement",
    kind: "proposition",
    predicate: "concept:test.requirement",
    arguments: [
      { role: "role:test.content", value: { kind: "ref", ref: event.id } },
    ],
    polarity: "positive",
    attribution: entity.id,
  };
  const cause: RelationNode = {
    ...base,
    provenance: [...base.provenance],
    id: "relation:test-cause",
    kind: "relation",
    relation: "concept:test.cause",
    source: proposition.id,
    target: event.id,
    polarity: "positive",
  };
  const condition: ConstraintNode = {
    ...base,
    provenance: [...base.provenance],
    id: "constraint:test-condition",
    kind: "constraint",
    constraintKind: "condition",
    subject: event.id,
    predicate: "concept:test.within-limit",
    parameters: [
      { role: "role:test.limit", value: { kind: "ref", ref: quantity.id } },
    ],
  };
  return { entity, quantity, time, event, proposition, cause, condition };
};

describe("M0/M1 conformance foundation", () => {
  it("runtime schema wrapper rejects invalid boundary values", () => {
    const schema = runtimeSchema<{ id: string }>(
      "HasId",
      (input): input is { id: string } =>
        typeof input === "object" &&
        input !== null &&
        "id" in input &&
        typeof (input as { id?: unknown }).id === "string",
    );
    expect(schema.parse({ id: "x" }).ok).toBe(true);
    expect(schema.parse({ id: 3 }).ok).toBe(false);
  });

  it("serializes, deserializes, restores, mutates, diffs, and replays deterministically", () => {
    const nodes = fixtureNodes();
    const graph = new InMemorySemanticGraph();
    const committed = graph.commit(
      graph.beginTransaction(
        Object.values(nodes).map((node) => ({ kind: "add-node" as const, node })),
      ),
      validateSnapshot,
    );
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;

    const serialized = serializeSnapshot(committed.value.snapshot);
    const decoded = deserializeSnapshot(serialized);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(serializeSnapshot(decoded.value)).toBe(serialized);
    expect(decoded.value.nodes.map((node) => node.id)).toEqual(
      committed.value.snapshot.nodes.map((node) => node.id),
    );

    const a = InMemorySemanticGraph.fromSnapshot(decoded.value);
    const b = InMemorySemanticGraph.fromSnapshot(decoded.value);
    const op = {
      kind: "attach-annotation" as const,
      id: nodes.proposition.id,
      key: "verified",
      value: true,
    };
    const left = a.commit(a.beginTransaction([op]), validateSnapshot);
    const right = b.commit(b.beginTransaction([op]), validateSnapshot);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    expect(left.value.revision).toBe(right.value.revision);

    const diff = semanticDiff(decoded.value, left.value.snapshot);
    expect(diff.changed).toEqual([nodes.proposition.id]);
    const mutated = left.value.snapshot.nodes.find(
      (node) => node.id === nodes.proposition.id,
    );
    expect(mutated?.provenance).toEqual(["prov:test-source"]);
    const retainedQuantity = left.value.snapshot.nodes.find(
      (node) => node.id === nodes.quantity.id && node.kind === "quantity",
    );
    expect(retainedQuantity?.kind).toBe("quantity");
    if (retainedQuantity?.kind === "quantity") {
      expect(retainedQuantity.unit).toBe("concept:test.file");
    }
  });

  it("rejects malformed serialized snapshots", () => {
    const result = deserializeSnapshot(
      canonicalJson({
        schemaVersion: "0.1.0",
        ontologyVersion: "0.1.0",
        revision: "rev:x",
        nodes: [{ id: "entity:x" }],
      }),
    );
    expect(result.ok).toBe(false);
  });
});
