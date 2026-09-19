import { describe, expect, it } from "vitest";
import {
  parseControlledEnglishCorpus,
  parseControlledVietnameseCorpus,
} from "../../packages/grounding/src/index.ts";
import {
  realizeControlledEnglishCorpus,
  realizeControlledVietnameseCorpus,
} from "../../packages/realizer-core/src/index.ts";
import {
  projectControlledCorpusSemantics,
  verifyControlledCorpusEquivalence,
} from "../../packages/verifier-core/src/index.ts";

const bilingual = [
  {
    en: "The service deletes exactly 3 files.",
    vi: "Dịch vụ xóa đúng 3 tệp.",
  },
  {
    en: "The service does not delete exactly 2 files.",
    vi: "Dịch vụ không xóa đúng 2 tệp.",
  },
  {
    en: "The service deletes exactly 4 files on 2026-09-19.",
    vi: "Dịch vụ xóa đúng 4 tệp vào 2026-09-19.",
  },
  {
    en: "The service must delete exactly 1 file.",
    vi: "Dịch vụ phải xóa đúng 1 tệp.",
  },
  {
    en: "The service may delete at most 3 files.",
    vi: "Dịch vụ được phép xóa tối đa 3 tệp.",
  },
  {
    en: "The service must not delete any files.",
    vi: "Dịch vụ không được phép xóa bất kỳ tệp nào.",
  },
  {
    en: "The service must not delete more than 3 files.",
    vi: "Dịch vụ không được xóa quá 3 tệp.",
  },
  {
    en: "If deletion is prohibited, the service must not delete more than 3 files.",
    vi: "Nếu việc xóa bị cấm, dịch vụ không được xóa quá 3 tệp.",
  },
  {
    en: "The service must not delete more than 3 files because deletion is prohibited.",
    vi: "Dịch vụ không được xóa quá 3 tệp vì việc xóa bị cấm.",
  },
  {
    en: "May the service delete exactly 3 files?",
    vi: "Dịch vụ có được phép xóa đúng 3 tệp không?",
  },
  {
    en: "According to the service, the service deletes exactly 3 files.",
    vi: "Theo dịch vụ, dịch vụ xóa đúng 3 tệp.",
  },
] as const;

const requireOk = <T>(
  result: { ok: true; value: T } | { ok: false; error: Error },
): T => {
  if (!result.ok) throw result.error;
  return result.value;
};

describe("M8 independent Vietnamese parsing/realization and cross-lingual semantics", () => {
  for (const fixture of bilingual) {
    it(`maps English and Vietnamese to equivalent JSG: ${fixture.vi}`, () => {
      const enValue = requireOk(parseControlledEnglishCorpus(fixture.en));
      const viValue = requireOk(parseControlledVietnameseCorpus(fixture.vi));

      const equivalence = verifyControlledCorpusEquivalence(
        enValue.snapshot,
        viValue.snapshot,
      );
      expect(equivalence.equivalent).toBe(true);
    });

    it(`executes Vietnamese -> JSG -> English without an English parsing pivot: ${fixture.vi}`, () => {
      const vi = parseControlledVietnameseCorpus(fixture.vi);
      const viValue = requireOk(vi);

      const english = realizeControlledEnglishCorpus(viValue.snapshot);
      expect(english.ok).toBe(true);
      if (!english.ok) return;

      const reparsed = parseControlledEnglishCorpus(english.value);
      const reparsedValue = requireOk(reparsed);

      expect(
        verifyControlledCorpusEquivalence(
          viValue.snapshot,
          reparsedValue.snapshot,
        ).equivalent,
      ).toBe(true);
    });

    it(`executes English -> JSG -> Vietnamese without phrase substitution: ${fixture.en}`, () => {
      const en = parseControlledEnglishCorpus(fixture.en);
      expect(en.ok).toBe(true);
      if (!en.ok) return;

      const vietnamese = realizeControlledVietnameseCorpus(en.value.snapshot);
      expect(vietnamese.ok).toBe(true);
      if (!vietnamese.ok) return;

      const reparsed = parseControlledVietnameseCorpus(vietnamese.value);
      const reparsedValue = requireOk(reparsed);

      expect(
        verifyControlledCorpusEquivalence(
          en.value.snapshot,
          reparsedValue.snapshot,
        ).equivalent,
      ).toBe(true);
    });

    it(`round-trips JSG -> Vietnamese -> JSG semantically: ${fixture.en}`, () => {
      const sourceValue = requireOk(
        parseControlledEnglishCorpus(fixture.en),
      );
      const vietnameseValue = requireOk(
        realizeControlledVietnameseCorpus(sourceValue.snapshot),
      );
      const roundTripValue = requireOk(
        parseControlledVietnameseCorpus(vietnameseValue),
      );

      expect(
        verifyControlledCorpusEquivalence(
          sourceValue.snapshot,
          roundTripValue.snapshot,
        ).equivalent,
      ).toBe(true);
    });
  }

  it("maps optional Vietnamese classifier construction to the same semantics", () => {
    const plain = parseControlledVietnameseCorpus(
      "Dịch vụ xóa đúng 3 tệp.",
    );
    const classified = parseControlledVietnameseCorpus(
      "Dịch vụ xóa đúng 3 cái tệp.",
    );
    const plainValue = requireOk(plain);
    const classifiedValue = requireOk(classified);

    expect(
      verifyControlledCorpusEquivalence(
        plainValue.snapshot,
        classifiedValue.snapshot,
      ).equivalent,
    ).toBe(true);
  });

  for (const fixture of [
    { surface: "Dịch vụ đã xóa đúng 3 tệp.", aspect: "completed" },
    { surface: "Dịch vụ đang xóa đúng 3 tệp.", aspect: "ongoing" },
    { surface: "Dịch vụ sẽ xóa đúng 3 tệp.", aspect: "planned" },
  ] as const) {
    it(`preserves Vietnamese aspect marker semantics: ${fixture.surface}`, () => {
      const parsed = parseControlledVietnameseCorpus(fixture.surface);
      const parsedValue = requireOk(parsed);

      const event = parsedValue.snapshot.nodes.find(
        (node) => node.kind === "event",
      );
      expect(event?.kind).toBe("event");
      if (event?.kind !== "event") return;
      expect(event.aspect).toBe(fixture.aspect);

      const realized = realizeControlledVietnameseCorpus(
        parsedValue.snapshot,
      );
      expect(realized).toEqual({ ok: true, value: fixture.surface });

      const reparsed =
        realized.ok
          ? parseControlledVietnameseCorpus(realized.value)
          : realized;
      const reparsedValue = requireOk(reparsed);

      expect(
        projectControlledCorpusSemantics(reparsedValue.snapshot),
      ).toEqual(projectControlledCorpusSemantics(parsedValue.snapshot));
    });
  }

  it("rejects unsupported free-form Vietnamese instead of translating through English", () => {
    const result = parseControlledVietnameseCorpus(
      "Hãy làm mọi thứ tốt hơn theo cách nào đó.",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("GROUNDING_VI_CONTROLLED_UNSUPPORTED");
    }
  });
});
