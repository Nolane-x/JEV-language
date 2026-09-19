import { describe, expect, it } from "vitest";
import {
  parseControlledEnglishCorpus,
} from "../../packages/grounding/src/index.ts";
import {
  realizeExpandedEnglishAlternatives,
} from "../../packages/realizer-core/src/index.ts";
import {
  verifyControlledCorpusEquivalence,
} from "../../packages/verifier-core/src/index.ts";

const canonicalInputs = [
  "The service deletes exactly 3 files.",
  "The service does not delete exactly 2 files.",
  "The service deletes exactly 4 files on 2026-09-19.",
  "The service must delete exactly 1 file.",
  "The service may delete at most 3 files.",
  "The service must not delete any files.",
  "The service must not delete more than 3 files.",
  "If deletion is prohibited, the service must not delete more than 3 files.",
  "The service must not delete more than 3 files because deletion is prohibited.",
  "May the service delete exactly 3 files?",
  "According to the service, the service deletes exactly 3 files.",
] as const;

describe("M6 bidirectional English lexical and syntactic variants", () => {
  for (const canonicalInput of canonicalInputs) {
    it(`round-trips every generated alternative for: ${canonicalInput}`, () => {
      const source = parseControlledEnglishCorpus(canonicalInput);
      expect(source.ok).toBe(true);
      if (!source.ok) return;

      const alternatives = realizeExpandedEnglishAlternatives(
        source.value.snapshot,
      );
      expect(alternatives.ok).toBe(true);
      if (!alternatives.ok) return;
      expect(alternatives.value.length).toBeGreaterThanOrEqual(2);

      for (const alternative of alternatives.value) {
        expect(alternative.semanticJustificationRuleIds.length).toBeGreaterThan(
          0,
        );
        const reparsed = parseControlledEnglishCorpus(alternative.text);
        expect(
          reparsed.ok,
          `variant failed to parse: ${alternative.text}`,
        ).toBe(true);
        if (!reparsed.ok) continue;

        const equivalence = verifyControlledCorpusEquivalence(
          source.value.snapshot,
          reparsed.value.snapshot,
        );
        expect(
          equivalence.equivalent,
          `variant changed semantics: ${alternative.text}`,
        ).toBe(true);
      }
    });
  }

  it("supports delete/remove lexical equivalence through the same JSG", () => {
    const canonical = parseControlledEnglishCorpus(
      "The service deletes exactly 3 files.",
    );
    const synonym = parseControlledEnglishCorpus(
      "The service removes exactly 3 files.",
    );
    expect(canonical.ok).toBe(true);
    expect(synonym.ok).toBe(true);
    if (!canonical.ok || !synonym.ok) return;
    expect(
      verifyControlledCorpusEquivalence(
        canonical.value.snapshot,
        synonym.value.snapshot,
      ).equivalent,
    ).toBe(true);
  });

  it("supports active/passive frame equivalence", () => {
    const active = parseControlledEnglishCorpus(
      "The service deletes exactly 3 files.",
    );
    const passive = parseControlledEnglishCorpus(
      "Exactly 3 files are deleted by the service.",
    );
    expect(active.ok).toBe(true);
    expect(passive.ok).toBe(true);
    if (!active.ok || !passive.ok) return;
    expect(
      verifyControlledCorpusEquivalence(
        active.value.snapshot,
        passive.value.snapshot,
      ).equivalent,
    ).toBe(true);
  });

  it("supports temporal adjunct movement without changing time semantics", () => {
    const trailing = parseControlledEnglishCorpus(
      "The service deletes exactly 4 files on 2026-09-19.",
    );
    const fronted = parseControlledEnglishCorpus(
      "On 2026-09-19, the service removes exactly 4 files.",
    );
    expect(trailing.ok).toBe(true);
    expect(fronted.ok).toBe(true);
    if (!trailing.ok || !fronted.ok) return;
    expect(
      verifyControlledCorpusEquivalence(
        trailing.value.snapshot,
        fronted.value.snapshot,
      ).equivalent,
    ).toBe(true);
  });

  it("supports reported-speech surface variation while preserving attribution", () => {
    const according = parseControlledEnglishCorpus(
      "According to the service, the service deletes exactly 3 files.",
    );
    const reported = parseControlledEnglishCorpus(
      "The service reports that it removes exactly 3 files.",
    );
    expect(according.ok).toBe(true);
    expect(reported.ok).toBe(true);
    if (!according.ok || !reported.ok) return;
    expect(
      verifyControlledCorpusEquivalence(
        according.value.snapshot,
        reported.value.snapshot,
      ).equivalent,
    ).toBe(true);
  });

  it("lets style preferences rank legal alternatives without changing the candidate set semantics", () => {
    const source = parseControlledEnglishCorpus(
      "The service deletes exactly 3 files.",
    );
    expect(source.ok).toBe(true);
    if (!source.ok) return;

    const alternatives = realizeExpandedEnglishAlternatives(
      source.value.snapshot,
      {
        preferredTerms: {
          "concept:core.delete": "remove",
        },
      },
    );
    expect(alternatives.ok).toBe(true);
    if (!alternatives.ok) return;
    expect(alternatives.value[0]?.lexicalChoice).toBe("remove");

    for (const alternative of alternatives.value) {
      const reparsed = parseControlledEnglishCorpus(alternative.text);
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) continue;
      expect(
        verifyControlledCorpusEquivalence(
          source.value.snapshot,
          reparsed.value.snapshot,
        ).equivalent,
      ).toBe(true);
    }
  });
});
