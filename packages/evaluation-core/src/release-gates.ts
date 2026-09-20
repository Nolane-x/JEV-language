import {
  canonicalJson,
  err,
  ok,
  sha256,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";

export type ReleaseGateId =
  | "critical-semantic-preservation"
  | "ambiguity-honesty"
  | "candidate-recall"
  | "open-world"
  | "long-discourse"
  | "multilingual-invariance"
  | "translation-loss"
  | "program-correctness"
  | "search-budget"
  | "solver-honesty"
  | "source-preservation"
  | "reproducibility"
  | "extension-compatibility"
  | "anti-template"
  | "anti-hidden-generator"
  | "anti-benchmark-special-case"
  | "coverage-accounting"
  | "unsupported-case-ledger";

export const V04_RELEASE_GATE_IDS: readonly ReleaseGateId[] = [
  "critical-semantic-preservation",
  "ambiguity-honesty",
  "candidate-recall",
  "open-world",
  "long-discourse",
  "multilingual-invariance",
  "translation-loss",
  "program-correctness",
  "search-budget",
  "solver-honesty",
  "source-preservation",
  "reproducibility",
  "extension-compatibility",
  "anti-template",
  "anti-hidden-generator",
  "anti-benchmark-special-case",
  "coverage-accounting",
  "unsupported-case-ledger",
];

export type ReleaseGateRequirement = "must" | "should";
export type ReleaseGateStatus = "pass" | "fail";

export interface ReleaseGateEvidence {
  id: ReleaseGateId;
  requirement: ReleaseGateRequirement;
  status: ReleaseGateStatus;
  evidenceRefs: string[];
  diagnostics: string[];
  metrics?: Record<string, number | string | boolean>;
}

const nonEmpty = (value: string): boolean => value.trim() !== "";
const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.every(nonEmpty) && new Set(values).size === values.length;

const gate = (
  id: ReleaseGateId,
  requirement: ReleaseGateRequirement,
  diagnostics: string[],
  evidenceRefs: string[],
  metrics?: Record<string, number | string | boolean>,
): ReleaseGateEvidence => ({
  id,
  requirement,
  status: diagnostics.length === 0 ? "pass" : "fail",
  evidenceRefs: [...new Set(evidenceRefs)].sort(),
  diagnostics: [...new Set(diagnostics)].sort(),
  ...(metrics === undefined ? {} : { metrics: structuredClone(metrics) }),
});

export const auditCriticalSemanticPreservation = (input: {
  checkedDimensions: string[];
  requiredDimensions?: string[];
  violationCodes: string[];
  evidenceRefs: string[];
}): ReleaseGateEvidence => {
  const required = input.requiredDimensions ?? [
    "negation",
    "quantity-unit",
    "identity-reference",
    "scope",
    "condition",
    "modality",
    "attribution",
    "source-provenance",
    "program-type-effect",
  ];
  const checked = new Set(input.checkedDimensions);
  const diagnostics = required
    .filter((dimension) => !checked.has(dimension))
    .map((dimension) => `MISSING_DIMENSION:${dimension}`);
  diagnostics.push(
    ...input.violationCodes.map((code) => `SEMANTIC_REGRESSION:${code}`),
  );
  return gate(
    "critical-semantic-preservation",
    "must",
    diagnostics,
    input.evidenceRefs,
    {
      requiredDimensions: required.length,
      checkedDimensions: input.checkedDimensions.length,
      violationCount: input.violationCodes.length,
    },
  );
};

export interface AmbiguityHonestySample {
  id: string;
  legitimateAmbiguity: boolean;
  forcedDisambiguation: boolean;
  evidenceSupportsDisambiguation: boolean;
}

export const auditAmbiguityHonesty = (
  samples: readonly AmbiguityHonestySample[],
  evidenceRefs: string[],
): ReleaseGateEvidence => {
  const forcedWithoutEvidence = samples
    .filter(
      (sample) =>
        sample.legitimateAmbiguity &&
        sample.forcedDisambiguation &&
        !sample.evidenceSupportsDisambiguation,
    )
    .map((sample) => sample.id);
  return gate(
    "ambiguity-honesty",
    "must",
    forcedWithoutEvidence.map((id) => `FORCED_WITHOUT_EVIDENCE:${id}`),
    evidenceRefs,
    {
      samples: samples.length,
      forcedWithoutEvidence: forcedWithoutEvidence.length,
    },
  );
};

export const auditCandidateRecallGate = (input: {
  samples: number;
  fullCandidateRecall: number;
  minimumFullCandidateRecall: number;
  missingGoldSampleIds: string[];
  evidenceRefs: string[];
}): ReleaseGateEvidence => {
  const diagnostics: string[] = [];
  if (
    !Number.isFinite(input.fullCandidateRecall) ||
    input.fullCandidateRecall < 0 ||
    input.fullCandidateRecall > 1 ||
    !Number.isFinite(input.minimumFullCandidateRecall) ||
    input.minimumFullCandidateRecall < 0 ||
    input.minimumFullCandidateRecall > 1
  ) {
    diagnostics.push("INVALID_RECALL_RATE");
  } else if (input.fullCandidateRecall < input.minimumFullCandidateRecall) {
    diagnostics.push("RECALL_BELOW_DECLARED_FLOOR");
  }
  if (input.missingGoldSampleIds.length > 0) {
    diagnostics.push(
      ...input.missingGoldSampleIds.map((id) => `MISSING_GOLD_CANDIDATE:${id}`),
    );
  }
  return gate("candidate-recall", "must", diagnostics, input.evidenceRefs, {
    samples: input.samples,
    fullCandidateRecall: input.fullCandidateRecall,
    minimumFullCandidateRecall: input.minimumFullCandidateRecall,
    missingGold: input.missingGoldSampleIds.length,
  });
};

export type UnknownHandlingOutcome =
  | "preserved"
  | "opaque"
  | "provisional"
  | "hallucinated-substitution"
  | "silent-deletion"
  | "forced-nearest";

export const auditOpenWorldSafety = (
  samples: readonly { id: string; outcome: UnknownHandlingOutcome }[],
  evidenceRefs: string[],
): ReleaseGateEvidence => {
  const unsafe = samples.filter((sample) =>
    [
      "hallucinated-substitution",
      "silent-deletion",
      "forced-nearest",
    ].includes(sample.outcome),
  );
  return gate(
    "open-world",
    "must",
    unsafe.map((sample) => `UNSAFE_UNKNOWN:${sample.id}:${sample.outcome}`),
    evidenceRefs,
    { samples: samples.length, unsafe: unsafe.length },
  );
};

export const auditLongDiscourse = (input: {
  turnCount: number;
  repeatedEntityReturns: number;
  corrections: number;
  nestedAttributions: number;
  oldTopicReturns: number;
  identityErrors: number;
  commitmentErrors: number;
  evidenceRefs: string[];
}): ReleaseGateEvidence => {
  const diagnostics: string[] = [];
  if (input.turnCount < 20) diagnostics.push("DISCOURSE_TOO_SHORT");
  if (input.repeatedEntityReturns < 1) diagnostics.push("NO_REPEATED_ENTITY_RETURN");
  if (input.corrections < 1) diagnostics.push("NO_CORRECTION");
  if (input.nestedAttributions < 1) diagnostics.push("NO_NESTED_ATTRIBUTION");
  if (input.oldTopicReturns < 1) diagnostics.push("NO_OLD_TOPIC_RETURN");
  if (input.identityErrors > 0) diagnostics.push("ENTITY_IDENTITY_ERROR");
  if (input.commitmentErrors > 0) diagnostics.push("COMMITMENT_COHERENCE_ERROR");
  return gate("long-discourse", "must", diagnostics, input.evidenceRefs, {
    turnCount: input.turnCount,
    identityErrors: input.identityErrors,
    commitmentErrors: input.commitmentErrors,
  });
};

export const auditMultilingualInvariance = (input: {
  comparedCases: number;
  semanticMismatchCaseIds: string[];
  evidenceRefs: string[];
}): ReleaseGateEvidence =>
  gate(
    "multilingual-invariance",
    "must",
    input.semanticMismatchCaseIds.map((id) => `SEMANTIC_MISMATCH:${id}`),
    input.evidenceRefs,
    {
      comparedCases: input.comparedCases,
      mismatches: input.semanticMismatchCaseIds.length,
    },
  );

export interface TranslationLossSample {
  id: string;
  distinctionLostOrSelected: boolean;
  disclosureEmitted: boolean;
}

export const auditTranslationLoss = (
  samples: readonly TranslationLossSample[],
  evidenceRefs: string[],
): ReleaseGateEvidence => {
  const silent = samples.filter(
    (sample) =>
      sample.distinctionLostOrSelected && !sample.disclosureEmitted,
  );
  return gate(
    "translation-loss",
    "must",
    silent.map((sample) => `SILENT_TRANSLATION_LOSS:${sample.id}`),
    evidenceRefs,
    { samples: samples.length, silentLosses: silent.length },
  );
};

export type ProgramValidationLevel =
  | "parse"
  | "compile"
  | "test"
  | "property"
  | "proof";

const validationRank: Record<ProgramValidationLevel, number> = {
  parse: 0,
  compile: 1,
  test: 2,
  property: 3,
  proof: 4,
};

export const auditProgramCorrectness = (input: {
  requiredLevel: ProgramValidationLevel;
  achievedLevel: ProgramValidationLevel;
  acceptedAsComplete: boolean;
  evidenceRefs: string[];
}): ReleaseGateEvidence => {
  const diagnostics: string[] = [];
  if (
    input.acceptedAsComplete &&
    validationRank[input.achievedLevel] < validationRank[input.requiredLevel]
  ) {
    diagnostics.push("INSUFFICIENT_VALIDATION_REPORTED_COMPLETE");
  }
  if (input.acceptedAsComplete && input.evidenceRefs.length === 0) {
    diagnostics.push("COMPLETE_WITHOUT_EVIDENCE");
  }
  return gate("program-correctness", "must", diagnostics, input.evidenceRefs, {
    requiredLevel: input.requiredLevel,
    achievedLevel: input.achievedLevel,
    acceptedAsComplete: input.acceptedAsComplete,
  });
};

export const auditSearchBudgetHonesty = (input: {
  budgetExhausted: boolean;
  resultStatus: string;
  verified: boolean;
  evidenceRefs: string[];
}): ReleaseGateEvidence => {
  const diagnostics: string[] = [];
  if (
    input.budgetExhausted &&
    ["success", "complete", "pass"].includes(input.resultStatus) &&
    !input.verified
  ) {
    diagnostics.push("UNVERIFIED_BEST_REPORTED_COMPLETE");
  }
  return gate("search-budget", "must", diagnostics, input.evidenceRefs, {
    budgetExhausted: input.budgetExhausted,
    resultStatus: input.resultStatus,
    verified: input.verified,
  });
};

export type SolverEvidenceStatus = "SAT" | "UNSAT" | "UNKNOWN" | "TIMEOUT";

export const auditSolverHonesty = (
  cases: readonly {
    id: string;
    solverStatus: SolverEvidenceStatus;
    reportedAsProof: boolean;
    bounded: boolean;
    reportedUnbounded: boolean;
  }[],
  evidenceRefs: string[],
): ReleaseGateEvidence => {
  const diagnostics: string[] = [];
  for (const item of cases) {
    if (
      (item.solverStatus === "UNKNOWN" || item.solverStatus === "TIMEOUT") &&
      item.reportedAsProof
    ) {
      diagnostics.push(`NON_PROOF_REPORTED_AS_PROOF:${item.id}`);
    }
    if (item.bounded && item.reportedUnbounded) {
      diagnostics.push(`BOUNDED_REPORTED_UNBOUNDED:${item.id}`);
    }
  }
  return gate("solver-honesty", "must", diagnostics, evidenceRefs, {
    cases: cases.length,
  });
};

export const auditSourcePreservation = (input: {
  benchmarkPassed: boolean;
  unexplainedLargeChurn: boolean;
  formatterOrRefactorRequested: boolean;
  testsPassed: boolean;
  evidenceRefs: string[];
}): ReleaseGateEvidence => {
  const diagnostics: string[] = [];
  if (!input.benchmarkPassed) diagnostics.push("SOURCE_BENCHMARK_FAILED");
  if (!input.testsPassed) diagnostics.push("EDIT_TESTS_FAILED");
  if (
    input.unexplainedLargeChurn &&
    !input.formatterOrRefactorRequested
  ) {
    diagnostics.push("UNEXPLAINED_SOURCE_CHURN");
  }
  return gate("source-preservation", "must", diagnostics, input.evidenceRefs);
};

export const auditReproducibility = (input: {
  determinism: "D0" | "D1" | "D2" | "D3";
  capturedVersions: boolean;
  inputDigests: number;
  traceOrMetadataCaptured: boolean;
  deterministicSeedsCaptured: boolean;
  evidenceRefs: string[];
}): ReleaseGateEvidence => {
  const diagnostics: string[] = [];
  if (!input.capturedVersions) diagnostics.push("VERSIONS_NOT_CAPTURED");
  if (input.inputDigests < 1) diagnostics.push("INPUT_DIGEST_MISSING");
  if (!input.traceOrMetadataCaptured) diagnostics.push("TRACE_METADATA_MISSING");
  if (
    input.determinism !== "D0" &&
    !input.deterministicSeedsCaptured
  ) {
    diagnostics.push("SEED_MISSING");
  }
  return gate("reproducibility", "must", diagnostics, input.evidenceRefs, {
    determinism: input.determinism,
    inputDigests: input.inputDigests,
  });
};

export const auditExtensionCompatibility = (
  cases: readonly {
    id: string;
    incompatible: boolean;
    loadedPartially: boolean;
    failedFast: boolean;
    diagnosticCode?: string;
  }[],
  evidenceRefs: string[],
): ReleaseGateEvidence => {
  const diagnostics: string[] = [];
  for (const item of cases) {
    if (
      item.incompatible &&
      (!item.failedFast ||
        item.loadedPartially ||
        item.diagnosticCode === undefined ||
        item.diagnosticCode.trim() === "")
    ) {
      diagnostics.push(`INCOMPATIBLE_EXTENSION_NOT_REJECTED:${item.id}`);
    }
  }
  return gate("extension-compatibility", "must", diagnostics, evidenceRefs, {
    cases: cases.length,
  });
};

export const auditAntiTemplate = (input: {
  heldOutSemanticCombinations: number;
  exactStoredTemplateMatches: number;
  exactTemplatePrimaryPath: boolean;
  evidenceRefs: string[];
}): ReleaseGateEvidence => {
  const diagnostics: string[] = [];
  if (input.heldOutSemanticCombinations < 1) {
    diagnostics.push("NO_HELD_OUT_SEMANTIC_COMBINATIONS");
  }
  if (input.exactStoredTemplateMatches > 0) {
    diagnostics.push("HELD_OUT_EXACT_TEMPLATE_MATCH");
  }
  if (input.exactTemplatePrimaryPath) {
    diagnostics.push("EXACT_TEMPLATE_PRIMARY_PATH");
  }
  return gate("anti-template", "must", diagnostics, input.evidenceRefs, {
    heldOutSemanticCombinations: input.heldOutSemanticCombinations,
    exactStoredTemplateMatches: input.exactStoredTemplateMatches,
  });
};

export const auditAntiHiddenGenerator = (input: {
  generativeModelCalls: number;
  externalGenerationServices: number;
  instrumentationRefs: string[];
  evidenceRefs: string[];
}): ReleaseGateEvidence => {
  const diagnostics: string[] = [];
  if (input.generativeModelCalls !== 0) diagnostics.push("GENERATIVE_MODEL_CALL");
  if (input.externalGenerationServices !== 0) {
    diagnostics.push("EXTERNAL_GENERATION_SERVICE");
  }
  if (input.instrumentationRefs.length === 0) {
    diagnostics.push("NO_DEPENDENCY_OR_NETWORK_INSTRUMENTATION");
  }
  return gate("anti-hidden-generator", "should", diagnostics, [
    ...input.evidenceRefs,
    ...input.instrumentationRefs,
  ]);
};

export const auditAntiBenchmarkSpecialCase = (input: {
  scannedRuleCount: number;
  fixtureIdHits: string[];
  expectedOutputLiteralHits: string[];
  evidenceRefs: string[];
}): ReleaseGateEvidence => {
  const diagnostics = [
    ...input.fixtureIdHits.map((hit) => `FIXTURE_ID_IN_RULE:${hit}`),
    ...input.expectedOutputLiteralHits.map(
      (hit) => `EXPECTED_OUTPUT_LITERAL_IN_RULE:${hit}`,
    ),
  ];
  if (input.scannedRuleCount < 1) diagnostics.push("NO_RULES_SCANNED");
  return gate(
    "anti-benchmark-special-case",
    "must",
    diagnostics,
    input.evidenceRefs,
    { scannedRuleCount: input.scannedRuleCount },
  );
};

export type CoverageStatus = "supported" | "partial" | "unsupported";

export interface PhenomenonCoverageEntry {
  dimension: string;
  status: CoverageStatus;
  evidenceRefs: string[];
  notes?: string;
}

export const auditCoverageAccounting = (
  entries: readonly PhenomenonCoverageEntry[],
  evidenceRefs: string[],
): ReleaseGateEvidence => {
  const requiredDimensions = [
    "semantics",
    "discourse",
    "morphology",
    "syntax",
    "parsing",
    "generation",
    "translation",
    "program-ir",
    "synthesis",
    "verification",
    "formal-ir",
  ];
  const diagnostics: string[] = [];
  const byDimension = new Map<string, PhenomenonCoverageEntry>();
  for (const entry of entries) {
    if (
      !nonEmpty(entry.dimension) ||
      byDimension.has(entry.dimension) ||
      !["supported", "partial", "unsupported"].includes(entry.status) ||
      entry.evidenceRefs.length === 0 ||
      !uniqueNonEmpty(entry.evidenceRefs)
    ) {
      diagnostics.push(`INVALID_COVERAGE_ENTRY:${entry.dimension || "<empty>"}`);
      continue;
    }
    byDimension.set(entry.dimension, entry);
  }
  for (const dimension of requiredDimensions) {
    if (!byDimension.has(dimension)) {
      diagnostics.push(`MISSING_COVERAGE_DIMENSION:${dimension}`);
    }
  }
  return gate("coverage-accounting", "should", diagnostics, evidenceRefs, {
    entries: entries.length,
    requiredDimensions: requiredDimensions.length,
  });
};

export type UnsupportedCaseSeverity =
  | "low"
  | "medium"
  | "high"
  | "critical";

export interface UnsupportedCaseEntry {
  featureId: string;
  description: string;
  affectedModules: string[];
  severity: UnsupportedCaseSeverity;
  workaround?: string;
  targetMilestone: string;
  relatedRegressionFixtures: string[];
}

export interface UnsupportedCaseLedger {
  schemaVersion: "jl-unsupported-cases-1";
  version: string;
  entries: UnsupportedCaseEntry[];
}

export const validateUnsupportedCaseLedger = (
  ledger: UnsupportedCaseLedger,
): Result<UnsupportedCaseLedger> => {
  if (
    ledger.schemaVersion !== "jl-unsupported-cases-1" ||
    !nonEmpty(ledger.version)
  ) {
    return err(
      new StructuredError(
        "EVAL_UNSUPPORTED_LEDGER_SCHEMA",
        "Unsupported-case ledger requires schema version and version.",
      ),
    );
  }
  const ids = new Set<string>();
  for (const entry of ledger.entries) {
    if (
      !nonEmpty(entry.featureId) ||
      ids.has(entry.featureId) ||
      !nonEmpty(entry.description) ||
      entry.affectedModules.length === 0 ||
      !uniqueNonEmpty(entry.affectedModules) ||
      !["low", "medium", "high", "critical"].includes(entry.severity) ||
      !nonEmpty(entry.targetMilestone) ||
      entry.relatedRegressionFixtures.length === 0 ||
      !uniqueNonEmpty(entry.relatedRegressionFixtures) ||
      (entry.workaround !== undefined && !nonEmpty(entry.workaround))
    ) {
      return err(
        new StructuredError(
          "EVAL_UNSUPPORTED_LEDGER_ENTRY",
          `Invalid unsupported-case entry: ${entry.featureId || "<empty>"}.`,
        ),
      );
    }
    ids.add(entry.featureId);
  }
  return ok(structuredClone(ledger));
};

export const auditUnsupportedCaseLedger = (
  ledger: UnsupportedCaseLedger,
  evidenceRefs: string[],
): ReleaseGateEvidence => {
  const valid = validateUnsupportedCaseLedger(ledger);
  return gate(
    "unsupported-case-ledger",
    "must",
    valid.ok ? [] : [`${valid.error.code}:${valid.error.message}`],
    evidenceRefs,
    { entries: ledger.entries.length },
  );
};

export interface V04ReleaseGateReport {
  schemaVersion: "jl-release-gates-1";
  releaseId: string;
  status: "pass" | "blocked";
  gates: ReleaseGateEvidence[];
  blockers: Array<{
    gateId: ReleaseGateId;
    requirement: ReleaseGateRequirement;
    diagnostics: string[];
  }>;
  evidenceDigest: string;
}

export const buildV04ReleaseGateReport = (input: {
  releaseId: string;
  gates: ReleaseGateEvidence[];
  requireShouldGates?: boolean;
}): Result<V04ReleaseGateReport> => {
  if (!nonEmpty(input.releaseId)) {
    return err(
      new StructuredError(
        "EVAL_RELEASE_GATE_ID",
        "Release gate report requires a non-empty release id.",
      ),
    );
  }
  const ids = input.gates.map((item) => item.id);
  if (ids.length !== new Set(ids).size) {
    return err(
      new StructuredError(
        "EVAL_RELEASE_GATE_DUPLICATE",
        "Release gate evidence may not contain duplicate gate ids.",
      ),
    );
  }
  const missing = V04_RELEASE_GATE_IDS.filter((id) => !ids.includes(id));
  if (missing.length > 0) {
    return err(
      new StructuredError(
        "EVAL_RELEASE_GATE_MISSING",
        `Missing release gates: ${missing.join(", ")}.`,
      ),
    );
  }
  const invalidEvidence = input.gates.filter(
    (item) =>
      item.evidenceRefs.length === 0 ||
      !uniqueNonEmpty(item.evidenceRefs) ||
      item.diagnostics.some((diagnostic) => !nonEmpty(diagnostic)),
  );
  if (invalidEvidence.length > 0) {
    return err(
      new StructuredError(
        "EVAL_RELEASE_GATE_EVIDENCE",
        "Every release gate requires unique non-empty evidence refs and valid diagnostics.",
      ),
    );
  }

  const blockers = input.gates
    .filter(
      (item) =>
        item.status === "fail" &&
        (item.requirement === "must" || input.requireShouldGates === true),
    )
    .map((item) => ({
      gateId: item.id,
      requirement: item.requirement,
      diagnostics: [...item.diagnostics],
    }))
    .sort((a, b) => a.gateId.localeCompare(b.gateId));

  const canonical = canonicalJson({
    releaseId: input.releaseId,
    gates: [...input.gates].sort((a, b) => a.id.localeCompare(b.id)),
    requireShouldGates: input.requireShouldGates ?? false,
  } as unknown as JsonValue);

  return ok({
    schemaVersion: "jl-release-gates-1",
    releaseId: input.releaseId,
    status: blockers.length === 0 ? "pass" : "blocked",
    gates: [...input.gates].sort((a, b) => a.id.localeCompare(b.id)),
    blockers,
    evidenceDigest: sha256(canonical),
  });
};
