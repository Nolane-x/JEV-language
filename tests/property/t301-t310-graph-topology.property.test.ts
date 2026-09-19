import { describe, expect, it } from "vitest";
import type { SemanticId } from "../../packages/core-types/src/index.ts";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import {
  canonicalSnapshotJson,
  createCanonicalGraphView,
  createProvisionalGraphFragment,
  mergeGraphFragments,
  type EntityNode,
  type GraphSnapshot,
  type QuantityNode,
} from "../../packages/semantic-graph/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;
const provenance = ["prov:t310"] as ProvenanceRef[];

const entity = (id: SemanticId, memberships: SemanticId[] = []): EntityNode => ({
  id,
  kind: "entity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  concept: sid("concept:test.entity"),
  attributes: [],
  memberships,
});

const quantity = (id: SemanticId, amount: number): QuantityNode => ({
  id,
  kind: "quantity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  amount,
  unit: sid("concept:test.item"),
  comparator: "exact",
});

const snapshot = (
  nodes: GraphSnapshot["nodes"],
  revision = "rev:t310",
): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision,
  nodes,
});

describe("T310 graph topology properties", () => {
  it("canonical graph views are invariant to node ordering across bounded graph families", () => {
    for (let size = 1; size <= 24; size += 1) {
      const nodes: GraphSnapshot["nodes"] = [];
      for (let index = 0; index < size; index += 1) {
        const id = sid(`entity:n-${index.toString().padStart(2, "0")}`);
        const next =
          index + 1 < size
            ? [sid(`entity:n-${(index + 1).toString().padStart(2, "0")}`)]
            : [];
        nodes.push(entity(id, next));
      }

      const forward = snapshot(nodes);
      const reverse = snapshot([...nodes].reverse());
      expect(createCanonicalGraphView(forward)).toEqual(
        createCanonicalGraphView(reverse),
      );
      expect(canonicalSnapshotJson(forward)).toBe(canonicalSnapshotJson(reverse));
    }
  });

  it("fragment merge is deterministic under fragment ordering when fragments do not conflict", () => {
    for (let size = 2; size <= 20; size += 2) {
      const fragments = Array.from({ length: size }, (_, index) => {
        const node =
          index % 2 === 0
            ? entity(sid(`entity:f-${index}`))
            : quantity(sid(`quantity:f-${index}`), index);
        const fragment = createProvisionalGraphFragment({
          id: `fragment:${index.toString().padStart(2, "0")}`,
          schemaVersion: "0.1.0",
          ontologyVersion: "0.1.0",
          nodes: [node],
        });
        expect(fragment.ok).toBe(true);
        if (!fragment.ok) throw fragment.error;
        return fragment.value;
      });

      const base = snapshot([], "rev:fragment-base");
      const forward = mergeGraphFragments(base, fragments);
      const reverse = mergeGraphFragments(base, [...fragments].reverse());

      expect(forward.diagnostics).toEqual([]);
      expect(reverse.diagnostics).toEqual([]);
      expect(forward.snapshot).toBeDefined();
      expect(reverse.snapshot).toBeDefined();
      expect(canonicalSnapshotJson(forward.snapshot!)).toBe(
        canonicalSnapshotJson(reverse.snapshot!),
      );
      expect(forward.snapshot?.revision).toBe(reverse.snapshot?.revision);
    }
  });

  it("projection exposes every disconnected component without silently dropping isolated nodes", () => {
    for (let size = 1; size <= 20; size += 1) {
      const nodes = Array.from({ length: size }, (_, index) =>
        entity(sid(`entity:isolated-${index}`)),
      );
      const view = createCanonicalGraphView(snapshot(nodes));
      expect(view.components).toHaveLength(size);
      expect(view.components.flat().sort()).toEqual(
        nodes.map((node) => node.id).sort(),
      );
      expect(view.edges).toEqual([]);
    }
  });
});
