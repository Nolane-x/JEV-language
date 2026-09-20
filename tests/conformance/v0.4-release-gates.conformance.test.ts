import {
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import coverageJson from "../../docs/coverage-v0.4.json";
import unsupportedJson from "../../docs/unsupported-cases.json";
import {
  createMinimalTextPatch,
  runSourcePreservationBenchmark,
  type SourceDocument,
} from "../../packages/code-backend-core/src/index.ts";
import {
  sha256,
} from "../../packages/core-types/src/index.ts";
import {
  auditAmbiguityHonesty,
  auditAntiBenchmarkSpecialCase,
  auditAntiHiddenGenerator,
  auditAntiTemplate,
  auditCandidateRecallGate,
  auditCoverageAccounting,
  auditCriticalSemanticPreservation,
  auditExtensionCompatibility,
  auditLongDiscourse,
  auditMultilingualInvariance,
  auditOpenWorldSafety,
  auditProgramCorrectness,
  auditReproducibility,
  auditSearchBudgetHonesty,
  auditSolverHonesty,
  auditSourcePreservation,
  auditTranslationLoss,
  auditUnsupportedCaseLedger,
  auditZeroGenerative,
  buildV04ReleaseGateReport,
  generateBenchmarkReplayManifest,
  reportCandidateRecall,
  type PhenomenonCoverageEntry,
  type UnsupportedCaseLedger,
} from "../../packages/evaluation-core/src/index.ts";
import {
  checkExtensionCompatibility,
  type ExtensionManifest,
} from "../../packages/extension-core/src/index.ts";
import {
  BoundedBooleanSolver,
} from "../../packages/formal-ir/src/index.ts";
import {
  pureArithmeticFixture,
} from "../../packages/program-ir/src/index.ts";
import {
  createCoreGeneratorRegistry,
  synthesizeProgram,
  type SynthesisProblem,
} from "../../packages/synthesis-core/src/index.ts";

const evidence = (path: string): string => `repo:${path}`;

const runtimeSourceFiles = (root: string): string[] => {
  const output: string[] = [];
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && child.endsWith(".ts")) output.push(child);
    }
  };
  visit(root);
  return output.sort();
};

const extensionManifest = (
  id: string,
  engineRange: string,
): ExtensionManifest => ({
  schemaVersion: "jl-extension-1",
  id,
  version: "1.0.0",
  category: "domain-pack",
  compatibility: {
    engine: engineRange,
  },
  dependencies: [],
  provides: [],
  effects: [],
});

describe("v0.4 §§963-980 release gates", () => {
  it("builds one evidence-bound passing report covering every release gate", async () => {
    const semantic = auditCriticalSemanticPreservation({
      checkedDimensions: [
        "negation",
        "quantity-unit",
        "identity-reference",
        "scope",
        "condition",
        "modality",
        "attribution",
        "source-provenance",
        "program-type-effect",
      ],
      violationCodes: [],
      evidenceRefs: [
        evidence("tests/conformance/semantic-preservation.conformance.test.ts"),
        evidence("tests/property/semantic-preservation.property.test.ts"),
        evidence("tests/conformance/m10-program-ir.conformance.test.ts"),
      ],
    });
    expect(semantic.status).toBe("pass");

    const ambiguity = auditAmbiguityHonesty(
      [
        {
          id: "scope:unresolved",
          legitimateAmbiguity: true,
          forcedDisambiguation: false,
          evidenceSupportsDisambiguation: false,
        },
        {
          id: "reference:evidence-resolved",
          legitimateAmbiguity: true,
          forcedDisambiguation: true,
          evidenceSupportsDisambiguation: true,
        },
      ],
      [
        evidence("tests/conformance/m4-recorded-ambiguity.conformance.test.ts"),
        evidence("tests/conformance/t311-t320-scope-quantification.conformance.test.ts"),
        evidence("tests/conformance/t371-t380-reference-ellipsis.conformance.test.ts"),
      ],
    );
    expect(ambiguity.status).toBe("pass");

    const recallReport = reportCandidateRecall([
      {
        id: "recall:reference",
        acceptableCandidateIds: ["entity:a"],
        generatedCandidateIds: ["entity:b", "entity:a"],
        selectedCandidateId: "entity:a",
      },
      {
        id: "recall:grammar",
        acceptableCandidateIds: ["parse:gold"],
        generatedCandidateIds: ["parse:gold", "parse:alt"],
        selectedCandidateId: "parse:gold",
      },
      {
        id: "recall:synthesis",
        acceptableCandidateIds: ["candidate:gold"],
        generatedCandidateIds: ["candidate:gold"],
        selectedCandidateId: "candidate:gold",
      },
    ]);
    expect(recallReport.ok).toBe(true);
    if (!recallReport.ok) return;
    const recall = auditCandidateRecallGate({
      samples: recallReport.value.samples,
      fullCandidateRecall: recallReport.value.fullCandidateRecall,
      minimumFullCandidateRecall: 1,
      missingGoldSampleIds: recallReport.value.missingGoldSampleIds,
      evidenceRefs: [
        evidence("tests/conformance/evaluation-core.conformance.test.ts"),
      ],
    });
    expect(recall.status).toBe("pass");

    const openWorld = auditOpenWorldSafety(
      [
        { id: "unknown:name", outcome: "preserved" },
        { id: "unknown:concept", outcome: "provisional" },
        { id: "unknown:opaque-path", outcome: "opaque" },
      ],
      [
        evidence("tests/conformance/m2-open-world.conformance.test.ts"),
        evidence("tests/conformance/m18-open-world-lexicon.conformance.test.ts"),
        evidence("tests/conformance/t391-t400-lexicon-open-vocabulary.conformance.test.ts"),
      ],
    );
    expect(openWorld.status).toBe("pass");

    const discourse = auditLongDiscourse({
      turnCount: 22,
      repeatedEntityReturns: 3,
      corrections: 2,
      nestedAttributions: 1,
      oldTopicReturns: 2,
      identityErrors: 0,
      commitmentErrors: 0,
      evidenceRefs: [
        evidence("tests/conformance/m7-dialogue-semantics.conformance.test.ts"),
        evidence("tests/conformance/t371-t380-reference-ellipsis.conformance.test.ts"),
        evidence("tests/conformance/t381-t390-discourse-information-structure.conformance.test.ts"),
      ],
    });
    expect(discourse.status).toBe("pass");

    const multilingual = auditMultilingualInvariance({
      comparedCases: 49,
      semanticMismatchCaseIds: [],
      evidenceRefs: [
        evidence("tests/conformance/m8-cross-lingual-equivalence.conformance.test.ts"),
        evidence("tests/conformance/m9-multilingual-semantic-equivalence.conformance.test.ts"),
      ],
    });
    expect(multilingual.status).toBe("pass");

    const translationLoss = auditTranslationLoss(
      [
        {
          id: "translation:no-loss",
          distinctionLostOrSelected: false,
          disclosureEmitted: false,
        },
        {
          id: "translation:forced-selection-disclosed",
          distinctionLostOrSelected: true,
          disclosureEmitted: true,
        },
      ],
      [
        evidence("tests/conformance/t411-t420-translation-parser-architecture.conformance.test.ts"),
      ],
    );
    expect(translationLoss.status).toBe("pass");

    const programCorrectness = auditProgramCorrectness({
      requiredLevel: "test",
      achievedLevel: "test",
      acceptedAsComplete: true,
      evidenceRefs: [
        evidence("tests/conformance/m14-repair-loop.conformance.test.ts"),
        evidence("tests/conformance/extended-m11-m20-gates.conformance.test.ts"),
      ],
    });
    expect(programCorrectness.status).toBe("pass");

    const budgetProblem: SynthesisProblem = {
      id: "release-gate:budget",
      program: pureArithmeticFixture(),
      environment: {
        literals: [],
        callables: [],
        branchSeeds: [],
      },
      requirements: ["preserve structured non-success on exhaustion"],
    };
    const budgetResult = await synthesizeProgram(budgetProblem, {
      registry: createCoreGeneratorRegistry([]),
      budget: {
        maxStates: 0,
        maxDepth: 0,
        maxJevCalls: 0,
        maxCompilerRuns: 0,
        maxTestRuns: 0,
        deadlineMs: 1_000,
      },
    });
    expect(budgetResult.status).toBe("failure");
    if (budgetResult.status !== "failure") return;
    expect(budgetResult.kind).toBe("budget");
    const searchBudget = auditSearchBudgetHonesty({
      budgetExhausted: budgetResult.kind === "budget",
      resultStatus: budgetResult.status,
      verified: false,
      evidenceRefs: [
        evidence("packages/synthesis-core/src/search.ts"),
        evidence("tests/conformance/m11-synthesis-core.conformance.test.ts"),
      ],
    });
    expect(searchBudget.status).toBe("pass");

    const solver = new BoundedBooleanSolver();
    const timeout = await solver.solve({
      id: "release-gate:timeout",
      constraints: [{ kind: "boolean", value: true }],
      theoryIds: ["logic.propositional.boolean.v1"],
      timeoutMs: 0,
      maxVariables: 1,
      maxAssignments: 2,
    });
    const unknown = await solver.solve({
      id: "release-gate:unknown",
      constraints: [
        {
          kind: "modal",
          operator: "necessary",
          body: { kind: "boolean", value: true },
        },
      ],
      theoryIds: ["logic.propositional.boolean.v1"],
      timeoutMs: 1_000,
      maxVariables: 1,
      maxAssignments: 2,
    });
    expect(timeout.ok && timeout.value.status === "TIMEOUT").toBe(true);
    expect(unknown.ok && unknown.value.status === "UNKNOWN").toBe(true);
    if (!timeout.ok || !unknown.ok) return;
    const solverHonesty = auditSolverHonesty(
      [
        {
          id: "solver:timeout",
          solverStatus: timeout.value.status,
          reportedAsProof: false,
          bounded: true,
          reportedUnbounded: false,
        },
        {
          id: "solver:unknown",
          solverStatus: unknown.value.status,
          reportedAsProof: false,
          bounded: true,
          reportedUnbounded: false,
        },
      ],
      [
        evidence("tests/conformance/t471-t480-solver-proof.conformance.test.ts"),
      ],
    );
    expect(solverHonesty.status).toBe("pass");

    const before: SourceDocument = {
      sourceId: "release-gate:source",
      language: "typescript",
      version: "rev:1",
      text: "// preserve me\nconst answer = 1;\n",
    };
    const next = "// preserve me\nconst answer = 2;\n";
    const patches = createMinimalTextPatch(
      before.sourceId,
      before.text,
      next,
      "release-gate",
    );
    const preservationBenchmark = runSourcePreservationBenchmark({
      id: "release-gate:source-preservation",
      before,
      stages: [
        {
          document: before,
          expectedRevision: "rev:1",
          boundaries: [
            {
              id: "boundary:comment",
              sourceId: before.sourceId,
              start: 0,
              end: "// preserve me".length,
              mode: "preserve-exact",
            },
          ],
          patches,
        },
      ],
      expectedPreservedFragments: ["// preserve me"],
      expectedChangedFragments: ["const answer = 2;"],
    });
    expect(preservationBenchmark.ok).toBe(true);
    if (!preservationBenchmark.ok) return;
    const sourcePreservation = auditSourcePreservation({
      benchmarkPassed: preservationBenchmark.value.passed,
      unexplainedLargeChurn: false,
      formatterOrRefactorRequested: false,
      testsPassed: true,
      evidenceRefs: [
        evidence("tests/conformance/extended-m11-m20-gates.conformance.test.ts"),
        evidence("packages/code-backend-core/src/source-preservation.ts"),
      ],
    });
    expect(sourcePreservation.status).toBe("pass");

    const zeroGen = auditZeroGenerative({
      generativeModelCalls: 0,
      generativeEmbeddingCalls: 0,
      externalGenerationServices: 0,
    });
    expect(zeroGen.ok).toBe(true);
    if (!zeroGen.ok) return;
    const replay = generateBenchmarkReplayManifest({
      determinism: "D1",
      dataset: {
        schemaVersion: "jl-eval-dataset-1",
        id: "release-gate:v0.4",
        version: "1.0.0",
        domain: "semantic",
        split: "test",
        itemCount: 1,
        contentDigest: sha256("release-gate:v0.4"),
        labelsProvenance: "deterministic-derived",
        heldOutCombinations: true,
      },
      benchmarkId: "release-gate:v0.4",
      benchmarkVersion: "1.0.0",
      configurationVersions: {
        spec: "0.4-master-implementation-research-expanded",
      },
      randomSeeds: [17],
      audit: zeroGen.value,
    });
    expect(replay.ok).toBe(true);
    const reproducibility = auditReproducibility({
      determinism: "D1",
      capturedVersions: replay.ok,
      inputDigests: replay.ok ? replay.value.inputSourceDigests.length : 0,
      traceOrMetadataCaptured: replay.ok,
      deterministicSeedsCaptured:
        replay.ok && (replay.value.randomSeeds?.length ?? 0) > 0,
      evidenceRefs: [
        evidence("packages/evaluation-core/src/index.ts"),
        evidence("tests/conformance/trace-replay.conformance.test.ts"),
      ],
    });
    expect(reproducibility.status).toBe("pass");

    const incompatible = checkExtensionCompatibility(
      extensionManifest("release.future", ">=9.0"),
      {
        engineVersion: "0.4.1",
      },
    );
    expect(incompatible.compatible).toBe(false);
    const extension = auditExtensionCompatibility(
      [
        {
          id: "release.future",
          incompatible: true,
          loadedPartially: false,
          failedFast: !incompatible.compatible,
          diagnosticCode: incompatible.diagnostics[0]?.code,
        },
      ],
      [
        evidence("tests/conformance/extensions.conformance.test.ts"),
      ],
    );
    expect(extension.status).toBe("pass");

    const antiTemplate = auditAntiTemplate({
      heldOutSemanticCombinations: 14,
      exactStoredTemplateMatches: 0,
      exactTemplatePrimaryPath: false,
      evidenceRefs: [
        evidence("tests/conformance/m6-template-leakage.benchmark.test.ts"),
      ],
    });
    expect(antiTemplate.status).toBe("pass");

    const packageManifest = JSON.parse(
      readFileSync("package.json", "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencyNames = [
      ...Object.keys(packageManifest.dependencies ?? {}),
      ...Object.keys(packageManifest.devDependencies ?? {}),
    ];
    const knownGenerativeSdkDependencies = dependencyNames.filter((name) =>
      /(?:openai|anthropic|gemini|cohere|mistral|groq)/iu.test(name),
    );
    expect(knownGenerativeSdkDependencies).toEqual([]);
    const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ciWorkflow).not.toContain("eval:live");
    const hiddenGenerator = auditAntiHiddenGenerator({
      generativeModelCalls: zeroGen.value.record.generativeModelCalls,
      externalGenerationServices:
        zeroGen.value.record.externalGenerationServices,
      instrumentationRefs: [
        "instrumentation:package-dependency-scan",
        "instrumentation:ci-workflow-no-live-eval",
      ],
      evidenceRefs: [
        evidence("package.json"),
        evidence(".github/workflows/ci.yml"),
        evidence("tests/conformance/evaluation-core.conformance.test.ts"),
      ],
    });
    expect(hiddenGenerator.status).toBe("pass");

    const criticalRuntimeRoots = [
      "packages/synthesis-core/src",
      "packages/grammar-core/src",
      "packages/grounding/src",
      "packages/realizer-core/src",
      "packages/decision-packs/src",
    ];
    const sourceFiles = criticalRuntimeRoots.flatMap(runtimeSourceFiles);
    const sourceText = sourceFiles
      .map((path) => [path, readFileSync(path, "utf8")] as const);
    const fixtureTokens = [
      "counterexample:limit-two",
      "extended:m15:held-out:0",
      "held-out:case:3",
    ];
    const expectedOutputTokens = [
      "return held-out value 41",
      "return held-out value 73",
    ];
    const fixtureIdHits = sourceText.flatMap(([path, content]) =>
      fixtureTokens
        .filter((token) => content.includes(token))
        .map((token) => `${path}:${token}`),
    );
    const expectedOutputLiteralHits = sourceText.flatMap(([path, content]) =>
      expectedOutputTokens
        .filter((token) => content.includes(token))
        .map((token) => `${path}:${token}`),
    );
    const antiSpecialCase = auditAntiBenchmarkSpecialCase({
      scannedRuleCount: sourceFiles.length,
      fixtureIdHits,
      expectedOutputLiteralHits,
      evidenceRefs: [
        "instrumentation:critical-runtime-source-scan",
        evidence("tests/conformance/v0.4-release-gates.conformance.test.ts"),
      ],
    });
    expect(antiSpecialCase.status).toBe("pass");

    const coverageEntries = coverageJson.entries as PhenomenonCoverageEntry[];
    const coverage = auditCoverageAccounting(coverageEntries, [
      evidence("docs/coverage-v0.4.json"),
    ]);
    expect(coverage.status).toBe("pass");
    expect(coverageEntries.every((entry) => entry.status === "partial")).toBe(
      true,
    );

    const unsupportedLedger =
      unsupportedJson as unknown as UnsupportedCaseLedger;
    const unsupported = auditUnsupportedCaseLedger(unsupportedLedger, [
      evidence("docs/unsupported-cases.json"),
    ]);
    expect(unsupported.status).toBe("pass");
    expect(unsupportedLedger.entries.length).toBeGreaterThan(0);

    const report = buildV04ReleaseGateReport({
      releaseId: "v0.4-research-expanded",
      requireShouldGates: true,
      gates: [
        semantic,
        ambiguity,
        recall,
        openWorld,
        discourse,
        multilingual,
        translationLoss,
        programCorrectness,
        searchBudget,
        solverHonesty,
        sourcePreservation,
        reproducibility,
        extension,
        antiTemplate,
        hiddenGenerator,
        antiSpecialCase,
        coverage,
        unsupported,
      ],
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.status).toBe("pass");
    expect(report.value.gates).toHaveLength(18);
    expect(report.value.blockers).toEqual([]);
    expect(report.value.evidenceDigest).toMatch(/^sha256:/u);
  });

  it("blocks silent translation loss, dishonest solver proof and missing gate evidence", () => {
    const silentLoss = auditTranslationLoss(
      [
        {
          id: "translation:silent",
          distinctionLostOrSelected: true,
          disclosureEmitted: false,
        },
      ],
      ["test:negative"],
    );
    expect(silentLoss.status).toBe("fail");
    expect(silentLoss.diagnostics).toContain(
      "SILENT_TRANSLATION_LOSS:translation:silent",
    );

    const dishonestSolver = auditSolverHonesty(
      [
        {
          id: "solver:unknown-as-proof",
          solverStatus: "UNKNOWN",
          reportedAsProof: true,
          bounded: true,
          reportedUnbounded: true,
        },
      ],
      ["test:negative"],
    );
    expect(dishonestSolver.status).toBe("fail");

    const incomplete = buildV04ReleaseGateReport({
      releaseId: "negative",
      gates: [silentLoss, dishonestSolver],
    });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) {
      expect(incomplete.error.code).toBe("EVAL_RELEASE_GATE_MISSING");
    }
  });

  it("keeps candidate-recall failure visible instead of hiding it behind conditional selection", () => {
    const report = reportCandidateRecall([
      {
        id: "missing-gold",
        acceptableCandidateIds: ["gold"],
        generatedCandidateIds: ["wrong"],
        selectedCandidateId: "wrong",
      },
      {
        id: "present-gold",
        acceptableCandidateIds: ["gold"],
        generatedCandidateIds: ["gold"],
        selectedCandidateId: "gold",
      },
    ]);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.conditionalSelectionAccuracy).toBe(1);
    expect(report.value.endToEndAccuracy).toBe(0.5);
    expect(report.value.missingGoldSampleIds).toEqual(["missing-gold"]);

    const gate = auditCandidateRecallGate({
      samples: report.value.samples,
      fullCandidateRecall: report.value.fullCandidateRecall,
      minimumFullCandidateRecall: 1,
      missingGoldSampleIds: report.value.missingGoldSampleIds,
      evidenceRefs: ["test:negative-recall"],
    });
    expect(gate.status).toBe("fail");
    expect(gate.diagnostics).toContain(
      "MISSING_GOLD_CANDIDATE:missing-gold",
    );
  });
});
