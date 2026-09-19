import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  createSemanticId,
  StructuredError,
} from "../packages/core-types/src/index.ts";
import {
  InMemorySemanticGraph,
  semanticDiff,
  type EntityNode,
} from "../packages/semantic-graph/src/index.ts";
import { validateSnapshot } from "../packages/semantic-validator/src/index.ts";

const entity = (id = createSemanticId("entity")): EntityNode => ({
  id,
  kind: "entity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [],
  trust: "user-content",
  concept: "concept:core.entity",
  attributes: [],
  memberships: [],
});

describe("core contracts", () => {
  it("canonical JSON is key-order stable", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
  });

  it("structured errors serialize deterministically", () => {
    const error = new StructuredError("TEST", "failure", { z: 1, a: 2 });
    expect(canonicalJson(error.toJSON())).toBe(
      '{"code":"TEST","details":{"a":2,"z":1},"message":"failure","name":"StructuredError"}',
    );
  });
});

describe("semantic graph", () => {
  it("failed transaction leaves graph unchanged", () => {
    const graph = new InMemorySemanticGraph();
    const before = graph.revision;
    const node = entity();

    const tx = graph.beginTransaction([
      { kind: "add-node", node },
      { kind: "add-node", node },
    ]);
    const result = graph.commit(tx, validateSnapshot);

    expect(result.ok).toBe(false);
    expect(graph.revision).toBe(before);
    expect(graph.has(node.id)).toBe(false);
  });

  it("commits valid nodes and produces deterministic semantic diff", () => {
    const graph = new InMemorySemanticGraph();
    const before = graph.snapshot();
    const node = entity();

    const result = graph.commit(
      graph.beginTransaction([{ kind: "add-node", node }]),
      validateSnapshot,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const diff = semanticDiff(before, result.value.snapshot);
    expect(diff).toEqual({ added: [node.id], removed: [], changed: [] });
  });

  it("rejects dangling internal references", () => {
    const node = entity();
    node.memberships.push("collection:missing");
    const graph = new InMemorySemanticGraph();
    const result = graph.commit(
      graph.beginTransaction([{ kind: "add-node", node }]),
      validateSnapshot,
    );
    expect(result.ok).toBe(false);
  });
});
