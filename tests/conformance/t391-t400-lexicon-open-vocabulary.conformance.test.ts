import { describe, expect, it } from "vitest";
import type { ConceptRef } from "../../packages/ontology/src/index.ts";
import {
  LanguageNeutralLexiconIndex,
  createUnknownLexeme,
  graphemeSegments,
  sliceGraphemes,
  transitionLexicalExtensionProposal,
  unicodeNormalizationLayers,
  validateLexeme,
  validateMultiwordExpression,
  validateNamedEntityLexicalModel,
  validateTransliterationCandidates,
  type LexicalExtensionProposal,
  type TransliterationAdapter,
} from "../../packages/lexicon-core/src/index.ts";
import {
  runBenchmark,
  type DatasetManifest,
} from "../../packages/evaluation-core/src/index.ts";

describe("T391-T400 lexicon and open vocabulary conformance", () => {
  it("T391 keeps lexeme identity separate from multiple lexical senses", () => {
    const result = validateLexeme({
      id: "lexeme:bank",
      language: "en",
      lemma: "bank",
      partOfSpeech: "noun",
      senses: [
        {
          id: "sense:bank:finance",
          semanticTag: "financial-institution",
        },
        {
          id: "sense:bank:river",
          semanticTag: "river-edge",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.senses).toHaveLength(2);
      expect(result.value.id).toBe("lexeme:bank");
    }
  });

  it("T392 carries explicit valency and selectional-preference metadata", () => {
    const result = validateLexeme({
      id: "lexeme:eat",
      language: "en",
      lemma: "eat",
      partOfSpeech: "verb",
      senses: [
        {
          id: "sense:eat",
          semanticTag: "consume",
          valencyFrames: [
            {
              id: "frame:eat:transitive",
              slots: [
                {
                  id: "object",
                  syntacticFunctions: ["object"],
                  required: false,
                  expectedConcepts: [
                    "concept:core.physical-object" as ConceptRef,
                  ],
                  selectionalPreference: {
                    preferredConcepts: [
                      "concept:core.physical-object" as ConceptRef,
                    ],
                    semanticFeatures: ["edible"],
                    strength: 0.8,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("T393 validates and matches multiword lexical units", () => {
    const expression = {
      id: "mwe:in-spite-of",
      language: "en",
      components: [
        { kind: "fixed" as const, surface: "in" },
        { kind: "fixed" as const, surface: "spite" },
        { kind: "fixed" as const, surface: "of" },
      ],
      syntacticCategory: "preposition",
      semanticMapping: "contrast/concession",
    };
    expect(validateMultiwordExpression(expression).ok).toBe(true);
    const index = new LanguageNeutralLexiconIndex();
    expect(index.registerMultiword(expression).ok).toBe(true);
    expect(
      index.matchMultiword(["we", "worked", "in", "spite", "of", "rain"], "en"),
    ).toMatchObject([
      {
        expressionId: "mwe:in-spite-of",
        start: 2,
        end: 5,
        semanticMapping: "contrast/concession",
      },
    ]);
  });

  it("T394 validates named-entity aliases across script and time-validity metadata", () => {
    expect(
      validateNamedEntityLexicalModel({
        entityId: "entity:city",
        canonicalName: "Hải Phòng",
        canonicalScript: "Latn",
        aliases: [
          {
            surface: "Hai Phong",
            language: "vi",
            script: "Latn",
            sourceRef: "source:transliteration",
          },
          {
            surface: "Haiphong",
            language: "en",
            script: "Latn",
            validFrom: "1900-01-01",
            validTo: "2100-01-01",
          },
        ],
      }).ok,
    ).toBe(true);

    expect(
      validateNamedEntityLexicalModel({
        entityId: "entity:bad",
        canonicalName: "Bad",
        aliases: [
          {
            surface: "Bad",
            validFrom: "2100-01-01",
            validTo: "2000-01-01",
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("T395 preserves unknown lexeme surface exactly while exposing normalized layers", () => {
    const surface = "NolaneQX-Ω";
    const unknown = createUnknownLexeme({
      surface,
      languageHypotheses: ["en", "vi", "en"],
      script: "mixed",
    });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) {
      expect(unknown.value.surfaceExact).toBe(surface);
      expect(unknown.value.preservedExact).toBe(true);
      expect(unknown.value.languageHypotheses).toEqual(["en", "vi"]);
      expect(
        unknown.value.normalization.some((layer) => layer.layer === "NFKC"),
      ).toBe(true);
    }
  });

  it("T396 enforces an evidence-backed lexical extension proposal lifecycle", () => {
    const proposal: LexicalExtensionProposal = {
      id: "proposal:nolaneqx",
      surface: "NolaneQX",
      language: "en",
      proposedSenseId: "sense:nolaneqx:project",
      evidenceRefs: ["source:doc-1"],
      status: "proposed",
    };

    const reviewed = transitionLexicalExtensionProposal(proposal, "reviewed", {
      reviewedBy: "reviewer:1",
    });
    expect(reviewed.ok).toBe(true);
    if (reviewed.ok) {
      const accepted = transitionLexicalExtensionProposal(
        reviewed.value,
        "accepted",
        {
          reviewedBy: "reviewer:1",
          decisionReason: "supported by project documentation",
        },
      );
      expect(accepted.ok).toBe(true);
      if (accepted.ok) expect(accepted.value.status).toBe("accepted");
    }

    expect(
      transitionLexicalExtensionProposal(proposal, "accepted", {
        reviewedBy: "reviewer:1",
      }).ok,
    ).toBe(false);
  });

  it("T397 exposes explicit Unicode normalization layers without losing source-exact form", () => {
    const source = "Cafe\u0301";
    const layers = unicodeNormalizationLayers(source, "en");
    expect(layers[0]).toEqual({
      layer: "source-exact",
      value: source,
    });
    expect(layers.find((layer) => layer.layer === "NFC")?.value).toBe("Café");
  });

  it("T398 performs grapheme-safe surface segmentation and slicing", () => {
    const source = "A👨‍👩‍👧‍👦B";
    expect(graphemeSegments(source)).toEqual(["A", "👨‍👩‍👧‍👦", "B"]);
    const slice = sliceGraphemes(source, 1, 2);
    expect(slice).toEqual({ ok: true, value: "👨‍👩‍👧‍👦" });
  });

  it("T399 defines a transliteration adapter ABI and validates inspectable candidates", () => {
    const adapter: TransliterationAdapter = {
      id: "translit:test",
      sourceLanguage: "vi",
      targetLanguage: "en",
      sourceScripts: ["Latn"],
      targetScripts: ["Latn"],
      transliterate(input) {
        return {
          ok: true,
          value: [
            {
              source: input.surface,
              target: input.surface.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
              ...(input.sourceScript === undefined
                ? {}
                : { sourceScript: input.sourceScript }),
              targetScript: input.targetScript,
              reversible: false,
              confidence: 0.7,
            },
          ],
        };
      },
    };
    const candidates = adapter.transliterate({
      surface: "Hải Phòng",
      sourceScript: "Latn",
      targetScript: "Latn",
    });
    expect(candidates.ok).toBe(true);
    if (candidates.ok) {
      expect(validateTransliterationCandidates(candidates.value).ok).toBe(true);
      expect(candidates.value[0]?.target).toBe("Hai Phong");
    }
  });

  it("T400 runs a held-out open-vocabulary benchmark with exact unknown preservation", async () => {
    const cases = [
      { id: "project-name", surface: "NolaneQX-380" },
      { id: "mixed-script", surface: "模型NolaneΩ" },
      { id: "emoji-grapheme", surface: "Core👩‍💻X" },
      { id: "decomposed", surface: "Cafe\u0301-X" },
    ];

    const dataset: DatasetManifest = {
      schemaVersion: "jl-eval-dataset-1",
      id: "t400-open-vocabulary-held-out",
      version: "1.0.0",
      domain: "nlu",
      split: "test",
      itemCount: cases.length,
      contentDigest: "sha256:t400-open-vocabulary-held-out",
      labelsProvenance: "deterministic-derived",
      tags: ["T400", "open-vocabulary", "held-out", "unicode"],
      heldOutCombinations: true,
    };

    const report = await runBenchmark({
      benchmarkId: "t400-open-vocabulary-held-out",
      benchmarkVersion: "1.0.0",
      dataset,
      cases,
      evaluate(testCase) {
        const unknown = createUnknownLexeme({ surface: testCase.surface });
        const passed =
          unknown.ok &&
          unknown.value.surfaceExact === testCase.surface &&
          unknown.value.preservedExact === true &&
          graphemeSegments(testCase.surface).join("") === testCase.surface;
        return {
          status: passed ? "pass" : "fail",
          metrics: {
            exactPreservation: passed ? 1 : 0,
          },
        };
      },
    });

    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.summary).toMatchObject({
        cases: 4,
        passed: 4,
        failed: 0,
        unknown: 0,
        passRate: 1,
      });
    }
  });
});
