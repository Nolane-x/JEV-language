import { describe, expect, it } from "vitest";
import {
  parseControlledRequirement,
  parseControlledVietnameseRequirement,
} from "../packages/grounding/src/index.ts";
import {
  realizeControlledEnglish,
  realizeControlledVietnamese,
} from "../packages/realizer-core/src/index.ts";
import { verifyControlledEquivalence } from "../packages/verifier-core/src/index.ts";

describe("third vertical slice: bilingual semantic core", () => {
  it("maps Vietnamese directly into JSG and realizes semantically equivalent English", () => {
    const vi = parseControlledVietnameseRequirement(
      "Dịch vụ không được phép xóa quá 3 tệp.",
    );
    expect(vi.ok).toBe(true);
    if (!vi.ok) return;

    const enSurface = realizeControlledEnglish(vi.value.snapshot);
    expect(enSurface.ok).toBe(true);
    if (!enSurface.ok) return;
    const en = parseControlledRequirement(enSurface.value);
    expect(en.ok).toBe(true);
    if (!en.ok) return;

    expect(
      verifyControlledEquivalence(vi.value.snapshot, en.value.snapshot).equivalent,
    ).toBe(true);
  });

  it("realizes shared JSG into Vietnamese without routing through English surface text", () => {
    const en = parseControlledRequirement(
      "The service must not delete more than 2 files.",
    );
    expect(en.ok).toBe(true);
    if (!en.ok) return;

    const viSurface = realizeControlledVietnamese(en.value.snapshot);
    expect(viSurface).toEqual({
      ok: true,
      value: "Dịch vụ không được phép xóa quá 2 tệp.",
    });
    if (!viSurface.ok) return;

    const vi = parseControlledVietnameseRequirement(viSurface.value);
    expect(vi.ok).toBe(true);
    if (!vi.ok) return;
    expect(
      verifyControlledEquivalence(en.value.snapshot, vi.value.snapshot).equivalent,
    ).toBe(true);
  });
});
