import { describe, expect, it } from "vitest";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import {
  InMemorySemanticGraph,
  canonicalSnapshotJson,
  deserializeSnapshot,
  serializeSnapshot,
  type EntityNode,
  type GraphSnapshot,
  type QuantityNode,
} from "../../packages/semantic-graph/src/index.ts";

const provenance = ["prov:hardening"] as ProvenanceRef[];

const entity = (id: SemanticId, concept: SemanticId = "concept:test.entity"): EntityNode => ({
  id,
  kind: "entity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  concept,
  attributes: [],
  memberships: [],
});

const quantity = (id: SemanticId, amount: number): QuantityNode => ({
  id,
  kind: "quantity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  amount,
  unit: "concept:test.item",
  comparator: "exact",
  approximate: false,
});

const sid = (value: string): SemanticId => value as SemanticId;\n\nconst snapshot = (nodes: GraphSnapshot["nodes"]): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision: "rev:hardening",
  nodes,
});

describe("T293-T294 semantic property hardening", () => {
  it("T293 canonical serialization is invariant to node order and stable across round trips", () => {
    for (let size = 1; size <= 32; size += 1) {
      const nodes = Array.from({ length: size }, (_, index) =>
        index % 2 === 0
          ? entity(`entity:${index.toString().padStart(3, "0")}`)
          : quantity(
              `quantity:${index.toString().padStart(3, "0")}`,
              index,
            ),
      );
      const forward = snapshot(nodes);
      const reverse = snapshot([...nodes].reverse());

      expect(canonicalSnapshotJson(forward)).toBe(
        canonicalSnapshotJson(reverse),
      );

      const serialized = serializeSnapshot(forward);
      const parsed = deserializeSnapshot(serialized);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(serializeSnapshot(parsed.value)).toBe(serialized);
      expect(
        serializeSnapshot(
          deserializeSnapshot(serializeSnapshot(parsed.value)).ok
            ? (
                deserializeSnapshot(serializeSnapshot(parsed.value)) as {
                  ok: true;
                  value: GraphSnapshot;
                }
              ).value
            : parsed.value,
        ),
      ).toBe(serialized);
    }
  });

  it("T294 failed semantic transactions and explicit rollback leave graph state byte-equivalent", () => {
    for (let index = 0; index < 32; index += 1) {
      const graph = new InMemorySemanticGraph(
        "0.1.0",
        "0.1.0",
        [entity(`entity:base-${index}`)],
      );
      const before = serializeSnapshot(graph.snapshot());

      const proposal = graph.beginTransaction([
        {
          kind: "add-node",
          node: entity(`entity:proposed-${index}`),
        },
      ]);

      const rolledBack = graph.rollback(proposal);
      expect(rolledBack.ok).toBe(true);
      expect(serializeSnapshot(graph.snapshot())).toBe(before);

      const rejected = graph.commit(proposal, (candidate) => [
        {
          code: "HARDENING_REJECT",
          severity: "error",
          message: `reject revision ${candidate.revision}`,
        },
      ]);
      expect(rejected.ok).toBe(false);
      expect(serializeSnapshot(graph.snapshot())).toBe(before);
    }
  });

  it("T294 identical valid transactions from identical revisions derive identical commits", () => {
    for (let index = 0; index < 24; index += 1) {
      const initial = [entity(`entity:seed-${index}`)];
      const left = new InMemorySemanticGraph("0.1.0", "0.1.0", initial);
      const right = new InMemorySemanticGraph("0.1.0", "0.1.0", initial);
      const operations = [
        {
          kind: "add-node" as const,
          node: quantity(`quantity:added-${index}`, index + 1),
        },
      ];

      const leftCommit = left.commit(
        left.beginTransaction(operations),
        () => [],
      );
      const rightCommit = right.commit(
        right.beginTransaction(operations),
        () => [],
      );

      expect(leftCommit.ok).toBe(true);
      expect(rightCommit.ok).toBe(true);
      if (!leftCommit.ok || !rightCommit.ok) continue;
      expect(leftCommit.value.revision).toBe(rightCommit.value.revision);
      expect(serializeSnapshot(leftCommit.value.snapshot)).toBe(
        serializeSnapshot(rightCommit.value.snapshot),
      );
    }
  });
});
