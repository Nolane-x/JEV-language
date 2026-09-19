import { describe, expect, it } from "vitest";
import { parseControlledRequirement } from "../packages/grounding/src/index.ts";
import { realizeControlledEnglish } from "../packages/realizer-core/src/index.ts";
import { verifyControlledEquivalence } from "../packages/verifier-core/src/index.ts";

describe("first runnable vertical slice", () => {
  it("preserves requirement, upper bound, action, actor, and target through round trip", () => {
    const parsed = parseControlledRequirement(
      "The service must not delete more than 3 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const realized = realizeControlledEnglish(parsed.value.snapshot);
    expect(realized).toEqual({
      ok: true,
      value: "The service is not permitted to delete more than 3 files.",
    });
    if (!realized.ok) return;

    const reparsed = parseControlledRequirement(realized.value);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;

    const report = verifyControlledEquivalence(
      parsed.value.snapshot,
      reparsed.value.snapshot,
    );
    expect(report.equivalent).toBe(true);
  });

  it("rejects unsupported broad language instead of guessing", () => {
    const result = parseControlledRequirement(
      "Please do something sensible with my files.",
    );
    expect(result.ok).toBe(false);
  });
});
