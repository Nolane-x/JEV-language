import { describe, expect, it } from "vitest";
import { sha256 } from "../../packages/core-types/src/index.ts";
import {
  auditZeroGenerative,
  generateBenchmarkReplayManifest,
  reportCalibration,
  reportCandidateRecall,
  reportDialogueBenchmark,
  reportMultilingualBenchmark,
  reportNlgBenchmark,
  reportNluBenchmark,
  reportRepairBenchmark,
  reportSemanticBenchmark,
  reportSynthesisBenchmark,
  runBenchmark,
  validateDatasetManifest,
  validateReproducibleEvaluationCase,
  type DatasetManifest,
} from "../../packages/evaluation-core/src/index.ts";
import {
  parseControlledEnglishCorpus,
  parseControlledVietnameseCorpus,
} from "../../packages/grounding/src/index.ts";
import {
  realizeControlledEnglishCorpus,
} from "../../packages/realizer-core/src/index.ts";
import {
  verifyControlledCorpusEquivalence,
} from "../../packages/verifier-core/src/index.ts";
import {
  parseDialogueTurnIntent,
} from "../../packages/dialogue-state/src/index.ts";
import {
  createTypeScriptBackend,
  type SourceDocument,
} from "../../packages/code-backend-core/src/index.ts";
import {
  BackendRepairCompiler,
  normalizeRepairTestResult,
  repairProgram,
  type RepairTestRunner,
} from "../../packages/repair-core/src/index.ts";
import type {
  PirFunction,
  PirProgram,
  PirType,
  ProgramHole,
} from "../../packages/program-ir/src/index.ts";
import {
  InScopeSymbolGenerator,
  createCoreGeneratorRegistry,
  synthesizeProgram,
  type ProgramAcceptanceVerifier,
  type SearchBudget,
  type SynthesisProblem,
} from "../../packages/synthesis-core/src/index.ts";

const dataset = (
  overrides: Partial<DatasetManifest> = {},
): DatasetManifest => ({
  schemaVersion: "jl-eval-dataset-1",
  id: "dataset:controlled-eval",
  version: "1.0.0",
  domain: "semantic",
  split: "test",
  itemCount: 2,
  contentDigest: sha256("controlled-eval-v1"),
  labelsProvenance: "human-reviewed",
  tags: ["controlled", "zero-generative"],
  ...overrides,
});

describe("T276-T288 evaluation core conformance", () => {
  it("T276 validates explicit dataset split/domain/provenance and rejects malformed runtime input", () => {
    expect(validateDatasetManifest(dataset()).ok).toBe(true);

    const malformed = validateDatasetManifest({
      schemaVersion: "jl-eval-dataset-1",
      id: "bad",
      version: "1.0.0",
      domain: "semantic",
      split: "secret-test-split",
      itemCount: -1,
      contentDigest: "x",
      labelsProvenance: "human-reviewed",
    });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.error.code).toBe("EVAL_DATASET_VALUE");
    }

    const duplicateTags = validateDatasetManifest(
      dataset({ tags: ["same", "same"] }),
    );
    expect(duplicateTags.ok).toBe(false);
    if (!duplicateTags.ok) {
      expect(duplicateTags.error.code).toBe("EVAL_DATASET_DUPLICATE");
    }
  });

  it("T276 validates reproducible evaluation-case semantics beyond exact target strings", () => {
    const valid = validateReproducibleEvaluationCase({
      id: "sem-00001",
      input: "The service must not delete more than 3 files.",
      expectedSemanticConstraints: [
        { polarity: "negative" },
        { quantity: { comparator: "at-most", amount: 3 } },
      ],
      allowedAlternatives: [
        "The service may delete no more than 3 files.",
      ],
      forbiddenSemanticErrors: [
        "negation-removed",
        "quantity-changed",
      ],
      languageDomainVersion: "en-controlled@1",
      expectedVerificationLevel: "semantic-round-trip",
      tags: ["negation", "quantity"],
    });
    expect(valid.ok).toBe(true);

    const missingSemantics = validateReproducibleEvaluationCase({
      id: "bad-case",
      input: "text",
      allowedAlternatives: [],
      forbiddenSemanticErrors: [],
      languageDomainVersion: "en@1",
      expectedVerificationLevel: "semantic",
    });
    expect(missingSemantics.ok).toBe(false);
    if (!missingSemantics.ok) {
      expect(missingSemantics.error.code).toBe("EVAL_CASE_SCHEMA");
    }
  });

  it("T277 runs cases in deterministic id order and preserves fail/unknown separately", async () => {
    const result = await runBenchmark({
      benchmarkId: "benchmark:runner",
      benchmarkVersion: "1.0.0",
      dataset: dataset(),
      cases: [
        { id: "case:b", value: 2 },
        { id: "case:a", value: 1 },
      ],
      evaluate: ({ value }) =>
        value === 1
          ? { status: "pass" as const, metrics: { score: 1 } }
          : { status: "unknown" as const, diagnostics: ["ambiguous"] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results.map((entry) => entry.id)).toEqual([
      "case:a",
      "case:b",
    ]);
    expect(result.value.summary).toEqual({
      cases: 2,
      passed: 1,
      failed: 0,
      unknown: 1,
      passRate: 0.5,
      knownPassRate: 1,
    });

    const wrongCount = await runBenchmark({
      benchmarkId: "benchmark:count",
      benchmarkVersion: "1.0.0",
      dataset: dataset({ itemCount: 3 }),
      cases: [{ id: "only" }],
      evaluate: () => ({ status: "pass" as const }),
    });
    expect(wrongCount.ok).toBe(false);
    if (!wrongCount.ok) {
      expect(wrongCount.error.code).toBe("EVAL_DATASET_COUNT");
    }
  });

  it("T277 converts evaluator exceptions into explicit failed cases instead of crashing the whole report", async () => {
    const result = await runBenchmark({
      benchmarkId: "benchmark:exception",
      benchmarkVersion: "1.0.0",
      dataset: dataset({ itemCount: 1 }),
      cases: [{ id: "case:throws" }],
      evaluate: () => {
        throw new Error("fixture failure");
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results[0]).toMatchObject({
      id: "case:throws",
      status: "fail",
    });
    expect(result.value.results[0]?.diagnostics?.[0]).toContain(
      "fixture failure",
    );
  });

  it("T278 reports candidate recall separately from conditional selection and end-to-end accuracy", () => {
    const report = reportCandidateRecall(
      [
        {
          id: "present-correct",
          acceptableCandidateIds: ["gold:a"],
          generatedCandidateIds: ["other", "gold:a"],
          selectedCandidateId: "gold:a",
        },
        {
          id: "present-wrong",
          acceptableCandidateIds: ["gold:b"],
          generatedCandidateIds: ["gold:b", "other"],
          selectedCandidateId: "other",
        },
        {
          id: "omitted",
          acceptableCandidateIds: ["gold:c"],
          generatedCandidateIds: ["other"],
          selectedCandidateId: "other",
        },
      ],
      [1, 2],
    );
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.recallAtK).toEqual({
      "1": 1 / 3,
      "2": 2 / 3,
    });
    expect(report.value.fullCandidateRecall).toBe(2 / 3);
    expect(report.value.oracleEndToEndUpperBound).toBe(2 / 3);
    expect(report.value.conditionalSelectionAccuracy).toBe(0.5);
    expect(report.value.endToEndAccuracy).toBe(1 / 3);
    expect(report.value.missingGoldSampleIds).toEqual(["omitted"]);
  });

  it("T279 emits reliability bins, Brier score, ECE and selective risk/coverage", () => {
    const report = reportCalibration(
      [
        { id: "a", confidence: 0.9, correct: true },
        { id: "b", confidence: 0.8, correct: false },
        { id: "c", confidence: 0.2, correct: false, abstained: true },
        { id: "d", confidence: 0.1, correct: true },
      ],
      5,
    );
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.samples).toBe(4);
    expect(report.value.reliabilityBins).toHaveLength(5);
    expect(report.value.brierScore).toBeCloseTo(0.375, 10);
    expect(report.value.expectedCalibrationError).toBeGreaterThan(0);
    expect(report.value.coverage).toBe(0.75);
    expect(report.value.selectiveAccuracy).toBeCloseTo(2 / 3, 10);
    expect(report.value.riskCoverage).toHaveLength(11);
  });

  it("T280/T281 execute a controlled semantic+NLU benchmark against the real parser", async () => {
    const cases = [
      {
        id: "sem:negation",
        input: "The service does not delete exactly 2 files.",
        requiredPhenomena: ["simple-event", "negation", "exact-quantity"],
      },
      {
        id: "sem:condition",
        input:
          "If deletion is prohibited, the service must not delete more than 3 files.",
        requiredPhenomena: [
          "condition",
          "requirement",
          "negation",
          "comparison",
        ],
      },
    ] as const;

    const run = await runBenchmark({
      benchmarkId: "benchmark:controlled-nlu",
      benchmarkVersion: "1.0.0",
      dataset: dataset({
        id: "dataset:controlled-nlu",
        domain: "nlu",
        itemCount: cases.length,
      }),
      cases,
      evaluate: (fixture) => {
        const parsed = parseControlledEnglishCorpus(fixture.input);
        if (!parsed.ok) {
          return {
            status: "fail" as const,
            metrics: {
              semanticExactMatch: 0,
              criticalInvariantAccuracy: 0,
            },
            diagnostics: [parsed.error.code],
          };
        }
        const exact =
          JSON.stringify(parsed.value.phenomena) ===
          JSON.stringify(fixture.requiredPhenomena);
        const allProvenanced = parsed.value.snapshot.nodes.every(
          (node) => node.provenance.length > 0,
        );
        return {
          status: exact && allProvenanced ? "pass" as const : "fail" as const,
          metrics: {
            semanticExactMatch: exact ? 1 : 0,
            criticalInvariantAccuracy: allProvenanced ? 1 : 0,
          },
        };
      },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.summary.passRate).toBe(1);

    const semantic = reportSemanticBenchmark([
      {
        schemaConformance: 1,
        invariantPreservation: 1,
        serializationRoundTrip: 1,
        semanticExactMatch: 1,
        semanticPartialMatch: 1,
      },
      {
        schemaConformance: 1,
        invariantPreservation: 1,
        serializationRoundTrip: 1,
        semanticExactMatch: 1,
        semanticPartialMatch: 1,
      },
    ]);
    expect(semantic.ok).toBe(true);
    expect(semantic.ok && semantic.value.means.semanticExactMatch).toBe(1);

    const nlu = reportNluBenchmark([
      {
        semanticExactMatch: 1,
        semanticPartialMatch: 1,
        criticalInvariantAccuracy: 1,
        unknownTermPreservation: 1,
      },
    ]);
    expect(nlu.ok).toBe(true);
    expect(nlu.ok && nlu.value.observedCounts.referenceResolutionAccuracy).toBe(
      0,
    );
  });

  it("T282 measures NLG semantic round-trip without inventing a human naturalness score", () => {
    const parsed = parseControlledEnglishCorpus(
      "The service must not delete more than 3 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const realized = realizeControlledEnglishCorpus(parsed.value.snapshot);
    expect(realized.ok).toBe(true);
    if (!realized.ok) return;

    const reparsed = parseControlledEnglishCorpus(realized.value);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;

    const equivalent = verifyControlledCorpusEquivalence(
      parsed.value.snapshot,
      reparsed.value.snapshot,
    ).equivalent;

    const report = reportNlgBenchmark([
      {
        criticalSemanticPreservation: equivalent ? 1 : 0,
        roundTripSemanticPreservation: equivalent ? 1 : 0,
        grammarValidity: reparsed.ok ? 1 : 0,
      },
    ]);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.means.roundTripSemanticPreservation).toBe(1);
    expect(report.value.observedCounts.humanNaturalness).toBe(0);
  });

  it("T283 keeps dialogue dimensions independent and exercises the real dialogue-act parser", () => {
    const request = parseDialogueTurnIntent("Please compare them.");
    const correction = parseDialogueTurnIntent("Correction: use Rust.");
    const report = reportDialogueBenchmark([
      {
        referenceAccuracy: 1,
        correctionHandling:
          correction.acts[0]?.kind === "CORRECT" ? 1 : 0,
        openQuestionTracking: 1,
        topicReturnAccuracy: 1,
        commitmentConsistency:
          request.acts[0]?.kind === "REQUEST" ? 1 : 0,
        semanticStateIntegrity: 1,
      },
    ]);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.means.correctionHandling).toBe(1);
    expect(report.value.means.commitmentConsistency).toBe(1);
  });

  it("T284 measures English/Vietnamese semantic equivalence through independent parsers", () => {
    const en = parseControlledEnglishCorpus(
      "The service does not delete exactly 2 files.",
    );
    const vi = parseControlledVietnameseCorpus(
      "Dịch vụ không xóa đúng 2 tệp.",
    );
    expect(en.ok).toBe(true);
    expect(vi.ok).toBe(true);
    if (!en.ok || !vi.ok) return;

    const equivalent = verifyControlledCorpusEquivalence(
      en.value.snapshot,
      vi.value.snapshot,
    ).equivalent;
    const report = reportMultilingualBenchmark([
      {
        semanticPreservation: equivalent ? 1 : 0,
        polarityPreservation: equivalent ? 1 : 0,
        quantityPreservation: equivalent ? 1 : 0,
        modalityPreservation: equivalent ? 1 : 0,
        referencePreservation: equivalent ? 1 : 0,
      },
    ]);
    expect(report.ok).toBe(true);
    expect(report.ok && report.value.means.semanticPreservation).toBe(1);
  });

  it("T285 evaluates a real typed-hole synthesis run before reporting synthesis metrics", async () => {
    const numberType: PirType = { kind: "number" };
    const parameter = {
      id: "param:eval-identity:value",
      name: "value",
      type: numberType,
    };
    const hole: ProgramHole = {
      id: "hole:eval-identity",
      expectedType: numberType,
      expectedEffect: "pure",
      requiredFacts: [],
      forbiddenFacts: [],
      scopeSymbols: [parameter.id],
      budget: {
        maxExpansions: 16,
        maxDepth: 4,
        maxCost: 16,
      },
    };
    const fn: PirFunction = {
      kind: "function",
      id: "function:eval-identity",
      name: "evalIdentity",
      parameters: [parameter],
      returnType: numberType,
      body: {
        kind: "hole",
        id: hole.id,
        expected: numberType,
      },
      effects: [{ kind: "pure" }],
    };
    const program: PirProgram = {
      version: "1.0.0",
      modules: [
        {
          id: "module:eval-identity",
          kind: "module",
          nameIntent: { preferredTerms: ["evalIdentity"] },
          exports: [fn.id],
          imports: [],
          declarations: [fn.id],
        },
      ],
      functions: [fn],
      holes: [hole],
    };
    const problem: SynthesisProblem = {
      id: "problem:eval-identity",
      program,
      environment: { literals: [], callables: [], branchSeeds: [] },
      requirements: ["return the available numeric input"],
    };
    const verifier: ProgramAcceptanceVerifier = {
      id: "verifier:eval-identity",
      verify({ program: candidate }) {
        const body = candidate.functions[0]?.body;
        const accepted =
          body?.kind === "variable" && body.symbolId === parameter.id;
        return {
          accepted,
          evidence: accepted ? ["eval:identity:accepted"] : [],
          diagnostics: [],
        };
      },
    };
    const budget: SearchBudget = {
      maxStates: 16,
      maxDepth: 4,
      maxJevCalls: 0,
      maxCompilerRuns: 0,
      maxTestRuns: 0,
      deadlineMs: 10_000,
    };

    const synthesis = await synthesizeProgram(problem, {
      registry: createCoreGeneratorRegistry([new InScopeSymbolGenerator()]),
      budget,
      verifiers: [verifier],
    });
    expect(synthesis.status).toBe("success");
    if (synthesis.status !== "success") return;

    const report = reportSynthesisBenchmark([
      {
        validPirCompletionRate: 1,
        backendLoweringRate: 1,
        compileRate: 1,
        testPassRate: 1,
        requirementSatisfaction: 1,
        candidateOracleUpperBound: 1,
        jevCalls: synthesis.usage.jevCalls,
        searchStates: synthesis.usage.statesExpanded,
      },
    ]);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.means.jevCalls).toBe(0);
    expect(report.value.means.searchStates).toBeGreaterThan(0);
  });

  it("T286 evaluates a real compiler repair loop before reporting repair metrics", async () => {
    const backend = createTypeScriptBackend();
    expect(backend.ok).toBe(true);
    if (!backend.ok) return;

    const source: SourceDocument = {
      sourceId: "eval-repair",
      language: "typescript",
      path: "/virtual/eval-repair.ts",
      text: 'export function answer(): number { return "41"; }\n',
    };

    const passRunner: RepairTestRunner = {
      id: "eval.pass-runner",
      run({ source: current }) {
        return normalizeRepairTestResult({
          runner: "eval.pass-runner",
          source: current,
          cases: [
            {
              id: "compile-repaired",
              status: current.text.includes("return 41;") ? "pass" : "fail",
              evidence: current.text.includes("return 41;")
                ? ["source:return-41"]
                : [],
            },
          ],
        });
      },
    };

    const repaired = await repairProgram({
      source,
      options: {
        compiler: new BackendRepairCompiler(backend.value),
        tests: passRunner,
        regression: passRunner,
        knowledge: {
          symbolImports: {},
          argumentDefaults: {},
          nullGuards: {},
          returnReplacements: {
            TS2322: [{ source: "41", cost: 1 }],
          },
        },
        budget: {
          maxIterations: 3,
          maxCandidatesPerIteration: 4,
          maxCompileRuns: 5,
          maxTestRuns: 5,
          deadlineMs: 10_000,
        },
      },
    });
    expect(repaired.status).toBe("success");
    if (repaired.status !== "success") return;

    const report = reportRepairBenchmark([
      {
        repairSuccessRate: 1,
        regressionFreeRate: repaired.regression.ok ? 1 : 0,
        requirementSatisfaction: repaired.tests.ok ? 1 : 0,
        iterations: repaired.usage.iterations,
        compilerCalls: repaired.usage.compileRuns,
        testCalls: repaired.usage.testRuns,
        diffSize: Math.abs(repaired.source.text.length - source.text.length),
      },
    ]);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.means.repairSuccessRate).toBe(1);
    expect(report.value.means.regressionFreeRate).toBe(1);
    expect(report.value.means.compilerCalls).toBeGreaterThanOrEqual(2);
  });

  it("T285 reports synthesis quality separately from resource usage", () => {
    const report = reportSynthesisBenchmark([
      {
        validPirCompletionRate: 1,
        backendLoweringRate: 1,
        compileRate: 1,
        testPassRate: 1,
        requirementSatisfaction: 1,
        candidateOracleUpperBound: 1,
        jevCalls: 0,
        searchStates: 3,
      },
      {
        validPirCompletionRate: 0,
        backendLoweringRate: 0,
        compileRate: 0,
        testPassRate: 0,
        requirementSatisfaction: 0,
        candidateOracleUpperBound: 0.5,
        jevCalls: 1,
        searchStates: 9,
      },
    ]);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.means.compileRate).toBe(0.5);
    expect(report.value.means.jevCalls).toBe(0.5);
    expect(report.value.means.searchStates).toBe(6);
  });

  it("T286 reports repair success/regression separately from iterations and tool calls", () => {
    const report = reportRepairBenchmark([
      {
        repairSuccessRate: 1,
        regressionFreeRate: 1,
        requirementSatisfaction: 1,
        iterations: 1,
        compilerCalls: 2,
        testCalls: 2,
        diffSize: 1,
      },
      {
        repairSuccessRate: 0,
        regressionFreeRate: 1,
        requirementSatisfaction: 0,
        iterations: 2,
        compilerCalls: 3,
        testCalls: 1,
        diffSize: 0,
      },
    ]);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.means.repairSuccessRate).toBe(0.5);
    expect(report.value.means.regressionFreeRate).toBe(1);
    expect(report.value.means.compilerCalls).toBe(2.5);
  });

  it("T287 invalidates the Jev-native label when a generative model/service is used", () => {
    const native = auditZeroGenerative({
      generativeModelCalls: 0,
      generativeEmbeddingCalls: 0,
      externalGenerationServices: 0,
    });
    expect(native).toEqual({
      ok: true,
      value: {
        jevNative: true,
        violations: [],
        record: {
          generativeModelCalls: 0,
          generativeEmbeddingCalls: 0,
          externalGenerationServices: 0,
        },
      },
    });

    const violated = auditZeroGenerative({
      generativeModelCalls: 1,
      generativeEmbeddingCalls: 0,
      externalGenerationServices: 1,
    });
    expect(violated.ok).toBe(true);
    if (!violated.ok) return;
    expect(violated.value.jevNative).toBe(false);
    expect(violated.value.violations).toEqual([
      "generative_model_calls",
      "external_generation_services",
    ]);
  });

  it("T287 requires an explicit profile when non-zero embeddings are permitted", () => {
    const missingProfile = auditZeroGenerative(
      {
        generativeModelCalls: 0,
        generativeEmbeddingCalls: 1,
        externalGenerationServices: 0,
      },
      { allowEmbeddingCalls: true },
    );
    expect(missingProfile.ok).toBe(false);
    if (!missingProfile.ok) {
      expect(missingProfile.error.code).toBe(
        "EVAL_ZERO_GENERATIVE_EMBEDDING_PROFILE",
      );
    }
  });

  it("T288 generates replay metadata bound to dataset/benchmark versions and zero-generative audit", () => {
    const audit = auditZeroGenerative({
      generativeModelCalls: 0,
      generativeEmbeddingCalls: 0,
      externalGenerationServices: 0,
    });
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;

    const manifest = generateBenchmarkReplayManifest({
      determinism: "D0",
      dataset: dataset(),
      benchmarkId: "benchmark:replay",
      benchmarkVersion: "2.0.0",
      schemaVersions: { jsg: "0.3.0" },
      languagePackVersions: { en: "1.0.0" },
      audit: audit.value,
    });
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    expect(manifest.value.version).toBe("jl-eval-replay-1");
    expect(manifest.value.configurationVersions).toMatchObject({
      benchmark: "2.0.0",
      dataset: "1.0.0",
    });
    expect(manifest.value.annotations).toMatchObject({
      benchmarkId: "benchmark:replay",
      datasetId: "dataset:controlled-eval",
      datasetSplit: "test",
      jevNative: true,
      generativeModelCalls: 0,
      externalGenerationServices: 0,
    });
  });
});
