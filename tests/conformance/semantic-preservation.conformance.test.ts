import { describe, expect, it } from "vitest";
import { parseControlledRequirement } from "../../packages/grounding/src/index.ts";
import { realizeControlledEnglish } from "../../packages/realizer-core/src/index.ts";
import {
  verifyControlledEquivalence,
  verifySemanticPreservation,
} from "../../packages/verifier-core/src/index.ts";

describe("semantic-preservation conformance", () => {
  it("keeps the controlled requirement semantically stable across parse/realize/reparse", () => {
    const parsed = parseControlledRequirement(
      "The service must not delete more than 3 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const realized = realizeControlledEnglish(parsed.value.snapshot);
    expect(realized.ok).toBe(true);
    if (!realized.ok) return;

    const reparsed = parseControlledRequirement(realized.value);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;

    expect(
      verifyControlledEquivalence(
        parsed.value.snapshot,
        reparsed.value.snapshot,
      ).equivalent,
    ).toBe(true);
  });

  it("fails the critical gate when a controlled quantity is changed in-place", () => {
    const parsed = parseControlledRequirement(
      "The service must not delete more than 3 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const candidate = structuredClone(parsed.value.snapshot);
    const quantity = candidate.nodes.find((node) => node.kind === "quantity");
    expect(quantity?.kind).toBe("quantity");
    if (quantity?.kind !== "quantity") return;
    quantity.amount += 1;

    const report = verifySemanticPreservation(parsed.value.snapshot, candidate);
    expect(report.ok).toBe(false);
    expect(report.violations.map((violation) => violation.code)).toContain(
      "SEM_QUANTITY_CHANGED",
    );
  });
});
