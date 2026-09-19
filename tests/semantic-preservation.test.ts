import { describe, expect, it } from "vitest";
import type { GraphSnapshot, QuantityNode, RelationNode } from "../packages/semantic-graph/src/index.ts";
import { verifySemanticPreservation } from "../packages/verifier-core/src/index.ts";

const base = (nodes: GraphSnapshot["nodes"]): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision: "fixture",
  nodes,
});

const quantity = (amount: number): QuantityNode => ({
  id: "quantity:q1",
  kind: "quantity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [],
  trust: "user-content",
  amount,
  comparator: "at-most",
  approximate: false,
});

const causal = (source: string, target: string): RelationNode => ({
  id: "relation:r1",
  kind: "relation",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [],
  trust: "user-content",
  relation: "concept:core.cause",
  source: source as RelationNode["source"],
  target: target as RelationNode["target"],
  polarity: "positive",
});

describe("semantic preservation invariants", () => {
  it("accepts an unchanged strict semantic snapshot", () => {
    const source = base([quantity(3), causal("event:a", "event:b")]);
    const report = verifySemanticPreservation(source, structuredClone(source));
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it("detects exact quantity drift", () => {
    const source = base([quantity(3)]);
    const candidate = base([quantity(4)]);
    const report = verifySemanticPreservation(source, candidate, ["quantity"]);
    expect(report.ok).toBe(false);
    expect(report.violations[0]?.code).toBe("SEM_QUANTITY_CHANGED");
  });

  it("detects reversed causal direction", () => {
    const source = base([causal("event:a", "event:b")]);
    const candidate = base([causal("event:b", "event:a")]);
    const report = verifySemanticPreservation(source, candidate, ["causal-direction"]);
    expect(report.ok).toBe(false);
    expect(report.violations[0]?.code).toBe("SEM_CAUSAL_DIRECTION_CHANGED");
  });
});
