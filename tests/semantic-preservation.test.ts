import { describe, expect, it } from "vitest";
import type {
  EntityNode,
  EventNode,
  GraphSnapshot,
  QuantityNode,
  RelationNode,
} from "../packages/semantic-graph/src/index.ts";
import { verifySemanticPreservation } from "../packages/verifier-core/src/index.ts";

const snapshot = (nodes: GraphSnapshot["nodes"]): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision: "fixture",
  nodes,
});

const entity = (id: EntityNode["id"], concept: EntityNode["concept"]): EntityNode => ({
  id,
  kind: "entity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [],
  trust: "user-content",
  concept,
  attributes: [],
  memberships: [],
});

const quantity = (
  amount: number,
  unit: QuantityNode["unit"] = "concept:core.file",
): QuantityNode => ({
  id: "quantity:q1",
  kind: "quantity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [],
  trust: "user-content",
  amount,
  unit,
  comparator: "at-most",
  approximate: false,
});

const relation = (source: string, target: string): RelationNode => ({
  id: "relation:r1",
  kind: "relation",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [],
  trust: "user-content",
  relation: "relation:core.cause",
  source: source as RelationNode["source"],
  target: target as RelationNode["target"],
  polarity: "positive",
});

const event = (agent: string, polarity: EventNode["polarity"] = "positive"): EventNode => ({
  id: "event:e1",
  kind: "event",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [],
  trust: "user-content",
  predicate: "concept:core.delete",
  roles: [
    {
      role: "role:core.agent",
      value: { kind: "ref", ref: agent as EventNode["id"] },
    },
  ],
  polarity,
});

describe("strict semantic preservation", () => {
  it("accepts an unchanged semantic snapshot", () => {
    const source = snapshot([
      entity("entity:a", "concept:core.entity"),
      quantity(3),
      relation("event:a", "event:b"),
    ]);
    const report = verifySemanticPreservation(source, structuredClone(source));
    expect(report.ok).toBe(true);
    expect(report.missingSourceNodes).toBe(0);
    expect(report.violations).toEqual([]);
  });

  it("detects a dropped semantic node instead of silently skipping it", () => {
    const source = snapshot([
      entity("entity:a", "concept:core.entity"),
      quantity(3),
    ]);
    const candidate = snapshot([entity("entity:a", "concept:core.entity")]);

    const report = verifySemanticPreservation(source, candidate);
    expect(report.ok).toBe(false);
    expect(report.missingSourceNodes).toBe(1);
    expect(report.violations).toContainEqual(
      expect.objectContaining({ code: "SEM_SOURCE_NODE_DROPPED" }),
    );
  });

  it("detects quantity amount and unit drift", () => {
    const source = snapshot([quantity(3, "concept:core.file")]);
    const changedAmount = snapshot([quantity(4, "concept:core.file")]);
    const changedUnit = snapshot([quantity(3, "concept:core.entity")]);

    expect(
      verifySemanticPreservation(source, changedAmount, ["quantity"])
        .violations[0]?.code,
    ).toBe("SEM_QUANTITY_CHANGED");
    expect(
      verifySemanticPreservation(source, changedUnit, ["quantity"])
        .violations[0]?.code,
    ).toBe("SEM_QUANTITY_CHANGED");
  });

  it("detects reversed causal direction", () => {
    const source = snapshot([relation("event:a", "event:b")]);
    const candidate = snapshot([relation("event:b", "event:a")]);
    const report = verifySemanticPreservation(source, candidate, [
      "causal-direction",
    ]);
    expect(report.violations[0]?.code).toBe("SEM_CAUSAL_DIRECTION_CHANGED");
  });

  it("detects polarity and participant-role corruption", () => {
    const source = snapshot([event("entity:a", "negative")]);
    const candidate = snapshot([event("entity:b", "positive")]);
    const report = verifySemanticPreservation(source, candidate, [
      "negation",
      "role-bindings",
    ]);
    expect(report.violations.map((entry) => entry.code)).toEqual([
      "SEM_NEGATION_CHANGED",
      "SEM_ROLE_BINDINGS_CHANGED",
    ]);
  });
});
