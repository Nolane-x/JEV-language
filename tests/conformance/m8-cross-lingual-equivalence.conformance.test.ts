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

describe("M8 independent Vietnamese parsing/realization and cross-lingual semantics", () => {
  for (const fixture of bilingual) {
    it(`maps English and Vietnamese to equivalent JSG: ${fixture.vi}`, () => {
      const en = parseControlledEnglishCorpus(fixture.en);
      const vi = parseControlledVietnameseCorpus(fixture.vi);
      expect(en.ok).toBe(true);
      expect(vi.ok).toBe(true);
      if (!en.ok || !vi.ok) return;

      const equivalence = verifyControlledCorpusEquivalence(
        en.value.snapshot,
        vi.value.snapshot,
      );
      expect(equivalence.equivalent).toBe(true);
    });

    it(`executes Vietnamese -> JSG -> English without an English parsing pivot: ${fixture.vi}`, () => {
      const vi = parseControlledVietnameseCorpus(fixture.vi);
      expect(vi.ok).toBe(true);
      if (!vi.ok) return;

      const english = realizeControlledEnglishCorpus(vi.value.snapshot);
      expect(english.ok).toBe(true);
      if (!english.ok) return;

      const reparsed = parseControlledEnglishCorpus(english.value);
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) return;

      expect(
        verifyControlledCorpusEquivalence(
          vi.value.snapshot,
          reparsed.value.snapshot,
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
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) return;

      expect(
        verifyControlledCorpusEquivalence(
          en.value.snapshot,
          reparsed.value.snapshot,
        ).equivalent,
      ).toBe(true);
    });

    it(`round-trips JSG -> Vietnamese -> JSG semantically: ${fixture.en}`, () => {
      const source = parseControlledEnglishCorpus(fixture.en);
      expect(source.ok).toBe(true);
      if (!source.ok) return;

      const vietnamese = realizeControlledVietnameseCorpus(
        source.value.snapshot,
      );
      expect(vietnamese.ok).toBe(true);
      if (!vietnamese.ok) return;

      const roundTrip = parseControlledVietnameseCorpus(vietnamese.value);
      expect(roundTrip.ok).toBe(true);
      if (!roundTrip.ok) return;

      expect(
        verifyControlledCorpusEquivalence(
          source.value.snapshot,
          roundTrip.value.snapshot,
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
    expect(plain.ok).toBe(true);
    expect(classified.ok).toBe(true);
    if (!plain.ok || !classified.ok) return;

    expect(
      verifyControlledCorpusEquivalence(
        plain.value.snapshot,
        classified.value.snapshot,
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
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const event = parsed.value.snapshot.nodes.find(
        (node) => node.kind === "event",
      );
      expect(event?.kind).toBe("event");
      if (event?.kind !== "event") return;
      expect(event.aspect).toBe(fixture.aspect);

      const realized = realizeControlledVietnameseCorpus(
        parsed.value.snapshot,
      );
      expect(realized).toEqual({ ok: true, value: fixture.surface });

      const reparsed =
        realized.ok
          ? parseControlledVietnameseCorpus(realized.value)
          : realized;
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) return;

      expect(
        projectControlledCorpusSemantics(reparsed.value.snapshot),
      ).toEqual(projectControlledCorpusSemantics(parsed.value.snapshot));
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
