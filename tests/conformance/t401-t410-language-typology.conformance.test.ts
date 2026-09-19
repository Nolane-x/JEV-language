import { describe, expect, it } from "vitest";
import {
  validateConstituentOrder,
  validateDependencyStructure,
  validateDiscontinuousConstituent,
  type ConstituentOrderingProvider,
} from "../../packages/grammar-core/src/index.ts";
import {
  assertTypologyProviderLanguages,
  validateCodeSwitchSegments,
  type ClassifierSelectionProvider,
  type SocialDeixisRealizationProvider,
  type ZeroRealizationProvider,
} from "../../packages/language-pack-core/src/index.ts";
import {
  MorphFeatureRegistry,
  type MorphologicalConstructionProvider,
} from "../../packages/morphology-core/src/index.ts";
import type { SemanticId } from "../../packages/core-types/src/index.ts";
import {
  runBenchmark,
  type DatasetManifest,
} from "../../packages/evaluation-core/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;

describe("T401-T410 language typology conformance", () => {
  it("T401 supports extensible morphology features beyond the built-in object shape", () => {
    const registry = new MorphFeatureRegistry();
    expect(
      registry.register({
        id: "evidential",
        language: "mock-evidential",
        values: ["direct", "reported", "inferred"],
        description: "Mock evidential morphology.",
      }).ok,
    ).toBe(true);
    expect(registry.validate("evidential", "reported", "mock-evidential").ok).toBe(
      true,
    );
    expect(registry.validate("evidential", "unsupported", "mock-evidential").ok).toBe(
      false,
    );
  });

  it("T402 licenses pro-drop through an explicit zero-realization provider", () => {
    const provider: ZeroRealizationProvider = {
      id: "mock-pro-drop.zero",
      language: "mock-pro-drop",
      decide(input) {
        return [
          {
            kind: "pro-drop",
            semanticRef: input.semanticRef,
            licensed:
              input.grammaticalRole === "subject" &&
              input.features.person !== undefined,
            reason: "subject agreement recovers person",
            recoverability:
              input.features.person === undefined
                ? "ambiguous"
                : "unambiguous",
          },
        ];
      },
    };
    expect(
      provider.decide({
        semanticRef: sid("entity:speaker"),
        grammaticalRole: "subject",
        features: { person: "first" },
      })[0],
    ).toMatchObject({ kind: "pro-drop", licensed: true });
  });

  it("T403 exposes classifier selection as a language-specific ABI", () => {
    const provider: ClassifierSelectionProvider = {
      id: "mock-classifier",
      language: "mock-classifier",
      select(input) {
        return [
          {
            classifier: input.quantity === 1 ? "CL.SG" : "CL.GEN",
            semanticClass: "generic-object",
            score: 1,
            reason: "deterministic mock classifier rule",
          },
        ];
      },
    };
    expect(
      provider.select({
        nounSemanticRef: sid("entity:book"),
        quantity: 1,
      })[0]?.classifier,
    ).toBe("CL.SG");
  });

  it("T404 exposes honorific/social-deixis realization hooks without hard-coding surfaces", () => {
    const provider: SocialDeixisRealizationProvider = {
      id: "mock-honorific",
      language: "mock-honorific",
      realize(context) {
        return [
          {
            surface: (context.politeness ?? 0) > 0.5 ? "FORMAL-YOU" : "YOU",
            features: {
              politeness: context.politeness ?? 0,
              relation: context.relation ?? "unknown",
            },
            reason: "mock social-deixis realization",
          },
        ];
      },
    };
    expect(provider.realize({ politeness: 0.9 })[0]?.surface).toBe("FORMAL-YOU");
  });

  it("T405 demonstrates shared constituent ordering has no fixed SVO assumption", () => {
    const sov: ConstituentOrderingProvider = {
      id: "mock-sov.order",
      language: "mock-sov",
      order: () => ["subject", "object", "verb"],
    };
    const vso: ConstituentOrderingProvider = {
      id: "mock-vso.order",
      language: "mock-vso",
      order: () => ["verb", "subject", "object"],
    };
    const roles = ["subject", "verb", "object"];
    expect(validateConstituentOrder(roles, sov.order({
      semanticRoles: roles,
      clauseType: "declarative",
    })).ok).toBe(true);
    expect(validateConstituentOrder(roles, vso.order({
      semanticRoles: roles,
      clauseType: "declarative",
    })).ok).toBe(true);
  });

  it("T406 represents discontinuous constituents as multiple non-overlapping ranges", () => {
    expect(
      validateDiscontinuousConstituent({
        id: "const:split",
        category: "VP",
        ranges: [
          { start: 0, end: 1 },
          { start: 3, end: 4 },
        ],
        childIds: ["token:0", "token:3"],
      }).ok,
    ).toBe(true);
    expect(
      validateDiscontinuousConstituent({
        id: "const:overlap",
        category: "VP",
        ranges: [
          { start: 0, end: 3 },
          { start: 2, end: 4 },
        ],
        childIds: [],
      }).ok,
    ).toBe(false);
  });

  it("T407 permits non-projective dependency structures while reporting crossing edges", () => {
    const result = validateDependencyStructure({
      tokenCount: 4,
      edges: [
        { id: "e1", headToken: 0, dependentToken: 2, relation: "rel-a" },
        { id: "e2", headToken: 1, dependentToken: 3, relation: "rel-b" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nonProjectiveEdgePairs).toEqual([["e1", "e2"]]);
    }
  });

  it("T408 exposes compound and derivation extension interfaces", () => {
    const provider: MorphologicalConstructionProvider = {
      id: "mock-constructions",
      language: "mock-compound",
      analyzeCompound(surface) {
        return surface === "sunflower"
          ? [{ surface, components: ["sun", "flower"], headIndex: 1 }]
          : [];
      },
      analyzeDerivation(surface) {
        return surface === "happiness"
          ? [
              {
                surface,
                base: "happy",
                operation: "suffix:-ness",
                derivedCategory: "noun",
              },
            ]
          : [];
      },
    };
    expect(provider.analyzeCompound("sunflower")[0]?.components).toEqual([
      "sun",
      "flower",
    ]);
    expect(provider.analyzeDerivation("happiness")[0]?.base).toBe("happy");
  });

  it("T409 validates code-switch metadata as non-overlapping token spans", () => {
    expect(
      validateCodeSwitchSegments(
        [
          {
            startToken: 0,
            endToken: 2,
            language: "vi",
            source: "lexicon",
            confidence: 0.9,
          },
          {
            startToken: 2,
            endToken: 4,
            language: "en",
            source: "lexicon",
            confidence: 0.8,
          },
        ],
        4,
      ).ok,
    ).toBe(true);

    expect(
      validateCodeSwitchSegments(
        [
          { startToken: 0, endToken: 3, language: "vi", source: "lexicon" },
          { startToken: 2, endToken: 4, language: "en", source: "lexicon" },
        ],
        4,
      ).ok,
    ).toBe(false);
  });

  it("T410 runs typological mock-pack conformance across contrasting profiles", async () => {
    const cases = [
      {
        id: "sov-order",
        run: () =>
          validateConstituentOrder(
            ["subject", "verb", "object"],
            ["subject", "object", "verb"],
          ).ok,
      },
      {
        id: "vso-order",
        run: () =>
          validateConstituentOrder(
            ["subject", "verb", "object"],
            ["verb", "subject", "object"],
          ).ok,
      },
      {
        id: "nonprojective",
        run: () => {
          const result = validateDependencyStructure({
            tokenCount: 4,
            edges: [
              { id: "a", headToken: 0, dependentToken: 2, relation: "x" },
              { id: "b", headToken: 1, dependentToken: 3, relation: "y" },
            ],
          });
          return result.ok && result.value.nonProjectiveEdgePairs.length === 1;
        },
      },
      {
        id: "provider-language-isolation",
        run: () => {
          const order: ConstituentOrderingProvider = {
            id: "mock",
            language: "mock",
            order: (input) => [...input.semanticRoles],
          };
          try {
            assertTypologyProviderLanguages("mock", { constituentOrder: order });
            return true;
          } catch {
            return false;
          }
        },
      },
    ];

    const dataset: DatasetManifest = {
      schemaVersion: "jl-eval-dataset-1",
      id: "t410-typology-mock-packs",
      version: "1.0.0",
      domain: "multilingual",
      split: "test",
      itemCount: cases.length,
      contentDigest: "sha256:t410-typology-mock-packs",
      labelsProvenance: "deterministic-derived",
      tags: ["T410", "typology", "mock-pack", "non-svo"],
      heldOutCombinations: true,
    };
    const report = await runBenchmark({
      benchmarkId: "t410-typology-mock-packs",
      benchmarkVersion: "1.0.0",
      dataset,
      cases,
      evaluate(testCase) {
        const passed = testCase.run();
        return {
          status: passed ? "pass" : "fail",
          metrics: { typologyConformance: passed ? 1 : 0 },
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
