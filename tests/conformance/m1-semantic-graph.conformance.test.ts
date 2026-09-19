import { describe, expect, it } from "vitest";
import type {
  SemanticId,
} from "../../packages/core-types/src/index.ts";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import {
  InMemorySemanticGraph,
  canonicalSnapshotJson,
  deserializeSnapshot,
  semanticDiff,
  serializeSnapshot,
  type ConstraintNode,
  type EntityNode,
  type EventNode,
  type GraphSnapshot,
  type PropositionNode,
  type QuantityNode,
  type RelationNode,
  type TemporalNode,
} from "../../packages/semantic-graph/src/index.ts";
import { validateSnapshot } from "../../packages/semantic-validator/src/index.ts";

const id = (value: string): SemanticId => value as SemanticId;
const provenance = [id("prov:user")] as ProvenanceRef[];

const base = {
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance,
  trust: "user-content" as const,
};

const fixtureNodes = () => {
  const system: EntityNode = {
    ...base,
    id: id("entity:system"),
    kind: "entity",
    concept: id("concept:test.system"),
    attributes: [],
    memberships: [],
  };

  const reporter: EntityNode = {
    ...base,
    id: id("entity:reporter"),
    kind: "entity",
    concept: id("concept:test.reporter"),
    attributes: [],
    memberships: [],
  };

  const time: TemporalNode = {
    ...base,
    id: id("time:deadline"),
    kind: "temporal",
    temporalKind: "instant",
    value: "2026-09-19T12:00:00+07:00",
  };

  const quantity: QuantityNode = {
    ...base,
    id: id("quantity:limit"),
    kind: "quantity",
    amount: 3,
    unit: id("concept:test.file"),
    comparator: "at-most",
    approximate: false,
  };

  const event: EventNode = {
    ...base,
    id: id("event:delete"),
    kind: "event",
    predicate: id("concept:test.delete"),
    roles: [
      {
        role: id("role:test.agent"),
        value: { kind: "ref", ref: system.id },
      },
      {
        role: id("role:test.limit"),
        value: { kind: "ref", ref: quantity.id },
      },
    ],
    temporal: time.id,
    aspect: "planned",
    modality: { kind: "forbidden", strength: 1 },
    polarity: "negative",
  };

  const proposition: PropositionNode = {
    ...base,
    id: id("proposition:policy"),
    kind: "proposition",
    predicate: id("concept:test.policy"),
    arguments: [
      {
        role: id("role:test.content"),
        value: { kind: "ref", ref: event.id },
      },
    ],
    polarity: "positive",
    modality: { kind: "required", strength: 1 },
    temporal: time.id,
    attribution: reporter.id,
    scope: { kind: "resolved", scopeId: id("scope:policy") },
  };

  const cause: RelationNode = {
    ...base,
    id: id("relation:cause"),
    kind: "relation",
    relation: id("concept:test.cause"),
    source: event.id,
    target: proposition.id,
    polarity: "positive",
  };

  const condition: ConstraintNode = {
    ...base,
    id: id("constraint:condition"),
    kind: "constraint",
    constraintKind: "condition",
    subject: proposition.id,
    predicate: id("concept:test.when"),
    parameters: [
      {
        role: id("role:test.condition"),
        value: { kind: "ref", ref: cause.id },
      },
    ],
  };

  return {
    system,
    reporter,
    time,
    quantity,
    event,
    proposition,
    cause,
    condition,
  };
};

const buildFixture = (): GraphSnapshot => {
  const graph = new InMemorySemanticGraph();
  const nodes = Object.values(fixtureNodes());
  const result = graph.commit(
    graph.beginTransaction(
      nodes.map((node) => ({ kind: "add-node" as const, node })),
    ),
    validateSnapshot,
  );
  if (!result.ok) throw result.error;
  return result.value.snapshot;
};

describe("M1 semantic graph acceptance", () => {
  it("covers the required semantic families and round-trips canonically", () => {
    const snapshot = buildFixture();
    const kinds = new Set(snapshot.nodes.map((node) => node.kind));

    expect(kinds.has("entity")).toBe(true);
    expect(kinds.has("event")).toBe(true);
    expect(kinds.has("proposition")).toBe(true);
    expect(kinds.has("quantity")).toBe(true);
    expect(kinds.has("temporal")).toBe(true);
    expect(kinds.has("relation")).toBe(true);
    expect(kinds.has("constraint")).toBe(true);

    const serialized = serializeSnapshot(snapshot);
    const recovered = deserializeSnapshot(serialized);
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;

    expect(serializeSnapshot(recovered.value)).toBe(serialized);
    expect(canonicalSnapshotJson(recovered.value)).toBe(
      canonicalSnapshotJson(snapshot),
    );
    expect(recovered.value.nodes.map((node) => node.id)).toEqual(
      snapshot.nodes.map((node) => node.id),
    );

    const recoveredProposition = recovered.value.nodes.find(
      (node) => node.id === id("proposition:policy"),
    );
    expect(recoveredProposition?.kind).toBe("proposition");
    if (recoveredProposition?.kind === "proposition") {
      expect(recoveredProposition.attribution).toBe(id("entity:reporter"));
      expect(recoveredProposition.temporal).toBe(id("time:deadline"));
      expect(recoveredProposition.modality).toEqual({
        kind: "required",
        strength: 1,
      });
      expect(recoveredProposition.scope).toEqual({
        kind: "resolved",
        scopeId: id("scope:policy"),
      });
    }

    const replayed = InMemorySemanticGraph.fromSnapshot(recovered.value);
    expect(replayed.revision).toBe(snapshot.revision);
    expect(canonicalSnapshotJson(replayed.snapshot())).toBe(
      canonicalSnapshotJson(snapshot),
    );
  });

  it("retains provenance and quantity units through replacement mutation", () => {
    const initial = buildFixture();
    const graph = InMemorySemanticGraph.fromSnapshot(initial);
    const quantity = graph.get(id("quantity:limit"));
    expect(quantity?.kind).toBe("quantity");
    if (quantity?.kind !== "quantity") return;

    const result = graph.commit(
      graph.beginTransaction([
        {
          kind: "replace-node",
          node: {
            ...quantity,
            amount: 4,
            provenance: [],
          },
        },
      ]),
      validateSnapshot,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const changed = result.value.snapshot.nodes.find(
      (node) => node.id === quantity.id,
    );
    expect(changed?.kind).toBe("quantity");
    if (changed?.kind !== "quantity") return;

    expect(changed.amount).toBe(4);
    expect(changed.unit).toBe(id("concept:test.file"));
    expect(changed.provenance).toContain(id("prov:user"));

    const diff = semanticDiff(initial, result.value.snapshot);
    expect(diff).toEqual({
      added: [],
      removed: [],
      changed: [id("quantity:limit")],
    });
    expect(semanticDiff(initial, result.value.snapshot)).toEqual(diff);
  });

  it("rolls back an uncommitted transaction without inventing a revision", () => {
    const initial = buildFixture();
    const graph = InMemorySemanticGraph.fromSnapshot(initial);
    const before = canonicalSnapshotJson(graph.snapshot());
    const revision = graph.revision;
    const quantity = graph.get(id("quantity:limit"));
    expect(quantity?.kind).toBe("quantity");
    if (quantity?.kind !== "quantity") return;

    const transaction = graph.beginTransaction([
      {
        kind: "replace-node",
        node: { ...quantity, amount: 99 },
      },
    ]);
    const rolledBack = graph.rollback(transaction);

    expect(rolledBack.ok).toBe(true);
    expect(graph.revision).toBe(revision);
    expect(canonicalSnapshotJson(graph.snapshot())).toBe(before);
    if (rolledBack.ok) {
      expect(canonicalSnapshotJson(rolledBack.value)).toBe(before);
    }
  });

  it("leaves graph state and revision unchanged after a failed transaction", () => {
    const initial = buildFixture();
    const graph = InMemorySemanticGraph.fromSnapshot(initial);
    const before = canonicalSnapshotJson(graph.snapshot());
    const revision = graph.revision;

    const invalid: RelationNode = {
      ...base,
      id: id("relation:dangling"),
      kind: "relation",
      relation: id("concept:test.cause"),
      source: id("event:missing"),
      target: id("proposition:policy"),
      polarity: "positive",
    };
    const result = graph.commit(
      graph.beginTransaction([{ kind: "add-node", node: invalid }]),
      validateSnapshot,
    );

    expect(result.ok).toBe(false);
    expect(graph.revision).toBe(revision);
    expect(canonicalSnapshotJson(graph.snapshot())).toBe(before);
    expect(graph.has(invalid.id)).toBe(false);
  });

  it("rejects dangling references and keeps polarity explicit", () => {
    const snapshot = buildFixture();
    expect(validateSnapshot(snapshot)).toEqual([]);

    for (const node of snapshot.nodes) {
      if (
        node.kind === "event" ||
        node.kind === "state" ||
        node.kind === "proposition" ||
        node.kind === "relation"
      ) {
        expect(["positive", "negative"]).toContain(node.polarity);
      }
    }
  });
});
