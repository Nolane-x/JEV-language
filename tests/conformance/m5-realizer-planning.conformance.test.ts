import { describe, expect, it } from "vitest";
import {
  err,
  ok,
  StructuredError,
} from "../../packages/core-types/src/index.ts";
import {
  createEnglishSeedLexicon,
  EnglishMorphologyProvider,
} from "../../packages/language-en/src/index.ts";
import {
  formatControlledSentence,
  generateBasicReference,
  generateLexicalCandidates,
  mapRolesToSyntax,
  propagateMorphFeatures,
  realizeLexicalCandidate,
  runRealizationFallback,
} from "../../packages/realizer-core/src/index.ts";

describe("M5 realizer planning primitives", () => {
  it("generates lexical candidates from semantic concepts and realizes morphology", () => {
    const lexicon = createEnglishSeedLexicon();
    const morphology = new EnglishMorphologyProvider(lexicon);
    const candidates = generateLexicalCandidates(
      lexicon,
      "concept:core.file",
      "en",
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]).toMatchObject({
      lemma: "file",
      concept: "concept:core.file",
    });

    const plural = realizeLexicalCandidate(
      candidates[0]!,
      lexicon,
      morphology,
      { number: "plural" },
    );
    expect(plural.ok).toBe(true);
    if (plural.ok) expect(plural.value).toContain("files");
  });

  it("maps semantic roles to syntax deterministically", () => {
    const mapped = mapRolesToSyntax(
      [
        {
          role: "role:core.agent",
          value: { kind: "concept", concept: "concept:core.person" },
        },
        {
          role: "role:core.quantity-limit",
          value: { kind: "number", value: 3 },
        },
      ],
      [
        {
          role: "role:core.agent",
          syntacticFunction: "subject",
          required: true,
          priority: 10,
        },
        {
          role: "role:core.quantity-limit",
          syntacticFunction: "object-quantity",
          priority: 10,
        },
      ],
    );
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.value.map((entry) => entry.syntacticFunction)).toEqual([
        "subject",
        "object-quantity",
      ]);
    }
  });

  it("propagates morphology features and rejects conflicts", () => {
    const propagated = propagateMorphFeatures(
      {
        subject: { number: "singular", person: "third" },
        predicate: {},
      },
      [
        {
          from: "subject",
          to: "predicate",
          feature: "number",
          required: true,
        },
        {
          from: "subject",
          to: "predicate",
          feature: "person",
          required: true,
        },
      ],
    );
    expect(propagated.ok).toBe(true);
    if (propagated.ok) {
      expect(propagated.value.predicate).toMatchObject({
        number: "singular",
        person: "third",
      });
    }

    const conflict = propagateMorphFeatures(
      {
        subject: { number: "singular" },
        predicate: { number: "plural" },
      },
      [{ from: "subject", to: "predicate", feature: "number" }],
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.error.code).toBe("REALIZE_FEATURE_CONFLICT");
    }
  });

  it("generates full and pronoun references from discourse status", () => {
    const profile = {
      language: "en",
      definiteArticle: "the",
      singularPronoun: "it",
      pluralPronoun: "they",
    };
    expect(
      generateBasicReference(
        {
          head: "service",
          number: "singular",
          discourseStatus: "new",
          allowPronoun: true,
        },
        profile,
      ),
    ).toEqual({
      ok: true,
      value: { surface: "the service", strategy: "full-definite" },
    });
    expect(
      generateBasicReference(
        {
          head: "service",
          number: "singular",
          discourseStatus: "given",
          allowPronoun: true,
        },
        profile,
      ),
    ).toEqual({
      ok: true,
      value: { surface: "it", strategy: "pronoun" },
    });
  });

  it("formats punctuation from clause type rather than caller string quirks", () => {
    expect(
      formatControlledSentence("the service deletes exactly 3 files...", "declarative"),
    ).toEqual({
      ok: true,
      value: "The service deletes exactly 3 files.",
    });
    expect(
      formatControlledSentence("may the service delete exactly 3 files.", "yes-no-question"),
    ).toEqual({
      ok: true,
      value: "May the service delete exactly 3 files?",
    });
  });

  it("uses an explicit fallback ladder and records failed stages", () => {
    const result = runRealizationFallback([
      {
        id: "strict",
        run: () =>
          err(
            new StructuredError(
              "STRICT_UNSUPPORTED",
              "strict stage unsupported",
            ),
          ),
      },
      {
        id: "controlled",
        run: () => ok("controlled output"),
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        value: "controlled output",
        stageId: "controlled",
        failedStages: [{ id: "strict", code: "STRICT_UNSUPPORTED" }],
      });
    }
  });
});
