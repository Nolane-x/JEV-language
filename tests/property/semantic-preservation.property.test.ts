import { describe, expect, it } from "vitest";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import type {
  GraphSnapshot,
  QuantityNode,
} from "../../packages/semantic-graph/src/index.ts";
import { verifySemanticPreservation } from "../../packages/verifier-core/src/index.ts";

const provenance = ["prov:property"] as ProvenanceRef[];

const quantity = (amount: number): QuantityNode => ({
  id: "quantity:property",
  kind: "quantity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  amount,
  unit: "concept:test.item",
  comparator: "at-most",
  approximate: false,
});

const snapshot = (amount: number): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision: "property:" + amount,
  nodes: [quantity(amount)],
});

describe("semantic-preservation properties", () => {
  it("is reflexive for the strict profile across a deterministic quantity corpus", () => {
    for (let amount = 0; amount < 64; amount += 1) {
      const source = snapshot(amount);
      expect(
        verifySemanticPreservation(source, structuredClone(source)).ok,
      ).toBe(true);
    }
  });

  it("detects every non-identity exact quantity mutation in the corpus", () => {
    for (let amount = 0; amount < 64; amount += 1) {
      const source = snapshot(amount);
      const candidate = snapshot((amount + 1) % 64);
      const report = verifySemanticPreservation(source, candidate);
      expect(report.ok).toBe(false);
      expect(report.violations.map((violation) => violation.code)).toContain(
        "SEM_QUANTITY_CHANGED",
      );
    }
  });

  it("is symmetric for pure exact-value drift detection", () => {
    for (let amount = 1; amount < 32; amount += 1) {
      const left = snapshot(amount);
      const right = snapshot(amount + 100);
      expect(verifySemanticPreservation(left, right).ok).toBe(false);
      expect(verifySemanticPreservation(right, left).ok).toBe(false);
    }
  });
});
