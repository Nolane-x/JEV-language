import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  canonicalizeJson,
  type JsonValue,
} from "../../packages/core-types/src/index.ts";
import {
  InMemorySemanticGraph,
  type GraphOperation,
  type JsgNode,
} from "../../packages/semantic-graph/src/index.ts";

const permutations = <T>(entries: readonly T[]): T[][] => {
  if (entries.length <= 1) return [[...entries]];
  const result: T[][] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const head = entries[index]!;
    const tail = entries.filter((_value, i) => i !== index);
    for (const rest of permutations(tail)) result.push([head, ...rest]);
  }
  return result;
};

const entity = (id: string, label: string): JsgNode => ({
  id: id as JsgNode["id"],
  kind: "entity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: ["prov:property"],
  trust: "user-content",
  concept: "concept:core.entity",
  attributes: [
    {
      relation: "relation:core.label",
      value: {
        kind: "string",
        value: {
          kind: "surface-literal",
          value: label,
          origin: "configured",
        },
      },
    },
  ],
  memberships: [],
});

describe("T293-T294 property hardening", () => {
  it("T293 canonical JSON is invariant to object insertion order and idempotent", () => {
    const entries = [
      ["z", 3],
      ["a", { y: true, x: [3, 2, 1] }],
      ["m", "value"],
    ] as const;

    const outputs = permutations(entries).map((order) =>
      canonicalJson(
        Object.fromEntries(order) as unknown as JsonValue,
      ),
    );
    expect(new Set(outputs).size).toBe(1);

    const canonical = canonicalizeJson(
      {
        z: 3,
        a: { y: true, x: [3, 2, 1] },
        m: "value",
      },
    );
    const first = canonicalJson(canonical);
    const second = canonicalJson(
      JSON.parse(first) as JsonValue,
    );
    expect(second).toBe(first);
  });

  it("T293 canonicalization preserves array order while sorting nested object keys", () => {
    const left = canonicalJson({
      items: [
        { b: 2, a: 1 },
        { d: 4, c: 3 },
      ],
    });
    const right = canonicalJson({
      items: [
        { a: 1, b: 2 },
        { c: 3, d: 4 },
      ],
    });
    expect(left).toBe(right);

    expect(
      canonicalJson({ items: [1, 2, 3] }),
    ).not.toBe(
      canonicalJson({ items: [3, 2, 1] }),
    );
  });

  it("T293 rejects non-finite numeric values instead of producing unstable JSON", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => canonicalJson({ value })).toThrow();
    }
  });

  it("T294 identical transactions on identical revisions produce identical revisions and snapshots", () => {
    const left = new InMemorySemanticGraph();
    const right = new InMemorySemanticGraph();
    expect(left.revision).toBe(right.revision);

    const operations: GraphOperation[] = [
      { kind: "add-node", node: entity("entity:a", "A") },
      { kind: "add-node", node: entity("entity:b", "B") },
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
    if (!leftCommit.ok || !rightCommit.ok) return;

    expect(leftCommit.value.revision).toBe(rightCommit.value.revision);
    expect(leftCommit.value.snapshot).toEqual(rightCommit.value.snapshot);
  });

  it("T294 rollback and failed validation never mutate committed graph state", () => {
    const graph = new InMemorySemanticGraph();
    const before = graph.snapshot();
    const tx = graph.beginTransaction([
      { kind: "add-node", node: entity("entity:rollback", "rollback") },
    ]);

    const rollback = graph.rollback(tx);
    expect(rollback.ok).toBe(true);
    expect(graph.snapshot()).toEqual(before);

    const failed = graph.commit(tx, () => [
      {
        code: "TEST_BLOCK",
        severity: "error",
        message: "block commit",
        nodeRefs: [],
      },
    ]);
    expect(failed.ok).toBe(false);
    expect(graph.snapshot()).toEqual(before);
  });

  it("T294 stale transactions cannot overwrite a newer committed revision", () => {
    const graph = new InMemorySemanticGraph();
    const stale = graph.beginTransaction([
      { kind: "add-node", node: entity("entity:stale", "stale") },
    ]);
    const current = graph.beginTransaction([
      { kind: "add-node", node: entity("entity:current", "current") },
    ]);
    const committed = graph.commit(current, () => []);
    expect(committed.ok).toBe(true);

    const rejected = graph.commit(stale, () => []);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe("JSG_REVISION_CONFLICT");
    }
    expect(graph.has("entity:current" as JsgNode["id"])).toBe(true);
    expect(graph.has("entity:stale" as JsgNode["id"])).toBe(false);
  });

  it("T294 transaction operation ordering is semantically significant and therefore revision-significant", () => {
    const first = new InMemorySemanticGraph();
    const second = new InMemorySemanticGraph();
    const a = entity("entity:order-a", "A");
    const b = entity("entity:order-b", "B");

    const one = first.commit(
      first.beginTransaction([
        { kind: "add-node", node: a },
        { kind: "add-node", node: b },
      ]),
      () => [],
    );
    const two = second.commit(
      second.beginTransaction([
        { kind: "add-node", node: b },
        { kind: "add-node", node: a },
      ]),
      () => [],
    );
    expect(one.ok).toBe(true);
    expect(two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    expect(one.value.snapshot.nodes).toEqual(two.value.snapshot.nodes);
    expect(one.value.revision).not.toBe(two.value.revision);
  });
});
