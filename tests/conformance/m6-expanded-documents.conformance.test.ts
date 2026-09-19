import { describe, expect, it } from "vitest";
import {
  parseExpandedEnglishDocument,
} from "../../packages/grounding/src/index.ts";
import {
  realizeExpandedEnglishDocument,
} from "../../packages/realizer-core/src/index.ts";
import {
  projectExpandedEnglishSemantics,
  verifyExpandedEnglishEquivalence,
} from "../../packages/verifier-core/src/index.ts";

describe("M6 expanded English documents", () => {
  it("maps a relative clause and a pronoun-linked multi-sentence form to the same JSG semantics", () => {
    const relative = parseExpandedEnglishDocument(
      "The service, which deletes exactly 3 files, deletes exactly 4 files.",
    );
    const multi = parseExpandedEnglishDocument(
      "The service deletes exactly 3 files. It removes exactly 4 files.",
    );
    expect(relative.ok).toBe(true);
    expect(multi.ok).toBe(true);
    if (!relative.ok || !multi.ok) return;

    expect(relative.value.kind).toBe("dual-event-relative");
    expect(multi.value.kind).toBe("dual-event-multisentence");
    expect(
      verifyExpandedEnglishEquivalence(
        relative.value.snapshot,
        multi.value.snapshot,
      ).equivalent,
    ).toBe(true);
  });

  it("realizes both relative-clause and multi-sentence alternatives from one semantic graph", () => {
    const parsed = parseExpandedEnglishDocument(
      "The service, which deletes exactly 3 files, deletes exactly 4 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const alternatives = realizeExpandedEnglishDocument(
      parsed.value.snapshot,
      [parsed.value.source],
    );
    expect(alternatives.ok).toBe(true);
    if (!alternatives.ok) return;
    expect(alternatives.value.map((entry) => entry.kind)).toEqual([
      "relative-clause",
      "multi-sentence",
    ]);

    for (const alternative of alternatives.value) {
      const reparsed = parseExpandedEnglishDocument(alternative.text);
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) continue;
      expect(
        verifyExpandedEnglishEquivalence(
          parsed.value.snapshot,
          reparsed.value.snapshot,
        ).equivalent,
      ).toBe(true);
    }
  });

  it("preserves an unknown project-specific name exactly through source spans", () => {
    const parsed = parseExpandedEnglishDocument(
      "QuuxFluxNode deletes exactly 7 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe("unknown-named-event");

    const projection = projectExpandedEnglishSemantics(
      parsed.value.snapshot,
    );
    expect(projection.ok).toBe(true);
    if (projection.ok) {
      expect(projection.value.actorNameDigest).toBeDefined();
    }

    const realized = realizeExpandedEnglishDocument(
      parsed.value.snapshot,
      [parsed.value.source],
    );
    expect(realized.ok).toBe(true);
    if (!realized.ok) return;
    expect(realized.value.map((entry) => entry.text)).toEqual([
      "QuuxFluxNode deletes exactly 7 files.",
      "QuuxFluxNode removes exactly 7 files.",
    ]);

    for (const alternative of realized.value) {
      expect(alternative.text).toContain("QuuxFluxNode");
      const reparsed = parseExpandedEnglishDocument(alternative.text);
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) continue;
      expect(
        verifyExpandedEnglishEquivalence(
          parsed.value.snapshot,
          reparsed.value.snapshot,
        ).equivalent,
      ).toBe(true);
    }
  });

  it("refuses to invent an unknown name when its grounding source is unavailable", () => {
    const parsed = parseExpandedEnglishDocument(
      "QuuxFluxNode deletes exactly 7 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const missing = realizeExpandedEnglishDocument(
      parsed.value.snapshot,
      [],
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("REALIZE_M6_SOURCE_MISSING");
    }

    const tampered = realizeExpandedEnglishDocument(
      parsed.value.snapshot,
      [
        {
          ...parsed.value.source,
          content: "FakeFluxNode deletes exactly 7 files.",
        },
      ],
    );
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) {
      expect(tampered.error.code).toBe("OWV_STALE_SPAN");
    }
  });
});
