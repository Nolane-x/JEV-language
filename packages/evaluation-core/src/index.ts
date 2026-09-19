import {
  createTraceId,
  err,
  ok,
  StructuredError,
  type Digest,
  type JsonValue,
  type Result,
  type TraceId,
} from "../../core-types/src/index.ts";
import {
  createReplayManifest,
  type ReplayManifest,
} from "../../trace-replay/src/index.ts";

export type DatasetSplit =
  | "development"
  | "calibration"
  | "validation"
  | "test";

export type EvaluationDomain =
  | "semantic"
  | "nlu"
  | "nlg"
  | "dialogue"
  | "multilingual"
  | "synthesis"
  | "repair";

export type LabelsProvenance =
  | "human-reviewed"
  | "human-authored"
  | "deterministic-derived"
  | "recorded-provider"
  | "mixed";

export interface DatasetManifest {
  schemaVersion: "jl-eval-dataset-1";
  id: string;
  version: string;
  domain: EvaluationDomain;
  split: DatasetSplit;
  itemCount: number;
  contentDigest: Digest;
  labelsProvenance: LabelsProvenance;
  source?: string;
  license?: string;
  languageTags?: string[];
  tags?: string[];
  disjointFrom?: string[];
  heldOutCombinations?: boolean;
  annotations?: Record<string, JsonValue>;
}

const DATASET_SPLITS = new Set<DatasetSplit>([
  "development",
  "calibration",
  "validation",
  "test",
]);

const EVALUATION_DOMAINS = new Set<EvaluationDomain>([
  "semantic",
  "nlu",
  "nlg",
  "dialogue",
  "multilingual",
  "synthesis",
  "repair",
]);

const LABELS_PROVENANCE = new Set<LabelsProvenance>([
  "human-reviewed",
  "human-authored",
  "deterministic-derived",
  "recorded-provider",
  "mixed",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isJsonValue = (value: unknown): value is JsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
};

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === "string" && entry.trim() !== "");

const unique = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

export const validateDatasetManifest = (
  input: unknown,
): Result<DatasetManifest> => {
  if (!isRecord(input)) {
    return err(
      new StructuredError(
        "EVAL_DATASET_SCHEMA",
        "Dataset manifest must be an object.",
      ),
    );
  }

  if (
    input.schemaVersion !== "jl-eval-dataset-1" ||
    typeof input.id !== "string" ||
    typeof input.version !== "string" ||
    typeof input.domain !== "string" ||
    typeof input.split !== "string" ||
    typeof input.itemCount !== "number" ||
    typeof input.contentDigest !== "string" ||
    typeof input.labelsProvenance !== "string"
  ) {
    return err(
      new StructuredError(
        "EVAL_DATASET_SCHEMA",
        "Dataset manifest is missing required typed fields.",
      ),
    );
  }

  if (
    input.id.trim() === "" ||
    input.version.trim() === "" ||
    input.contentDigest.trim() === "" ||
    !EVALUATION_DOMAINS.has(input.domain as EvaluationDomain) ||
    !DATASET_SPLITS.has(input.split as DatasetSplit) ||
    !LABELS_PROVENANCE.has(input.labelsProvenance as LabelsProvenance) ||
    !Number.isSafeInteger(input.itemCount) ||
    input.itemCount < 0
  ) {
    return err(
      new StructuredError(
        "EVAL_DATASET_VALUE",
        "Dataset manifest contains invalid identifiers, split/domain values, digest, provenance, or item count.",
      ),
    );
  }

  const optionalArrays = [
    input.languageTags,
    input.tags,
    input.disjointFrom,
  ];
  if (
    optionalArrays.some(
      (value) => value !== undefined && !stringArray(value),
    )
  ) {
    return err(
      new StructuredError(
        "EVAL_DATASET_ARRAY",
        "Dataset manifest string-array fields require non-empty strings.",
      ),
    );
  }

  for (const value of optionalArrays) {
    if (Array.isArray(value) && !unique(value)) {
      return err(
        new StructuredError(
          "EVAL_DATASET_DUPLICATE",
          "Dataset manifest list fields may not contain duplicates.",
        ),
      );
    }
  }

  if (
    input.source !== undefined &&
    (typeof input.source !== "string" || input.source.trim() === "")
  ) {
    return err(
      new StructuredError(
        "EVAL_DATASET_SOURCE",
        "Dataset source must be a non-empty string when supplied.",
      ),
    );
  }
  if (
    input.license !== undefined &&
    (typeof input.license !== "string" || input.license.trim() === "")
  ) {
    return err(
      new StructuredError(
        "EVAL_DATASET_LICENSE",
        "Dataset license must be a non-empty string when supplied.",
      ),
    );
  }
  if (
    input.heldOutCombinations !== undefined &&
    typeof input.heldOutCombinations !== "boolean"
  ) {
    return err(
      new StructuredError(
        "EVAL_DATASET_HELD_OUT",
        "heldOutCombinations must be boolean when supplied.",
      ),
    );
  }
  if (
    input.annotations !== undefined &&
    (!isRecord(input.annotations) || !isJsonValue(input.annotations))
  ) {
    return err(
      new StructuredError(
        "EVAL_DATASET_ANNOTATIONS",
        "Dataset annotations must contain JSON values.",
      ),
    );
  }

  return ok(structuredClone(input) as unknown as DatasetManifest);
};

export interface BenchmarkCaseBase {
  id: string;
  tags?: string[];
}

export type BenchmarkCaseStatus = "pass" | "fail" | "unknown";

export interface BenchmarkCaseEvaluation {
  status: BenchmarkCaseStatus;
  metrics?: Record<string, number>;
  diagnostics?: string[];
  evidenceRefs?: string[];
  metadata?: Record<string, JsonValue>;
}

export interface BenchmarkCaseResult extends BenchmarkCaseEvaluation {
  id: string;
}

export interface BenchmarkRunSummary {
  cases: number;
  passed: number;
  failed: number;
  unknown: number;
  passRate: number;
  knownPassRate: number;
}

export interface BenchmarkReport {
  benchmarkId: string;
  benchmarkVersion: string;
  dataset: DatasetManifest;
  summary: BenchmarkRunSummary;
  results: BenchmarkCaseResult[];
  startedAt?: string;
  completedAt?: string;
}

const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const validateCaseEvaluation = (
  evaluation: BenchmarkCaseEvaluation,
): StructuredError | undefined => {
  if (!["pass", "fail", "unknown"].includes(evaluation.status)) {
    return new StructuredError(
      "EVAL_CASE_STATUS",
      "Benchmark case returned an invalid status.",
    );
  }
  for (const [key, value] of Object.entries(evaluation.metrics ?? {})) {
    if (key.trim() === "" || !Number.isFinite(value)) {
      return new StructuredError(
        "EVAL_CASE_METRIC",
        "Benchmark metrics require non-empty names and finite numeric values.",
      );
    }
  }
  return undefined;
};

export const runBenchmark = async <TCase extends BenchmarkCaseBase>(input: {
  benchmarkId: string;
  benchmarkVersion: string;
  dataset: DatasetManifest;
  cases: readonly TCase[];
  evaluate: (
    benchmarkCase: TCase,
  ) => BenchmarkCaseEvaluation | Promise<BenchmarkCaseEvaluation>;
  timestamps?: { startedAt?: string; completedAt?: string };
}): Promise<Result<BenchmarkReport>> => {
  if (
    input.benchmarkId.trim() === "" ||
    input.benchmarkVersion.trim() === ""
  ) {
    return err(
      new StructuredError(
        "EVAL_BENCHMARK_ID",
        "Benchmark id and version are required.",
      ),
    );
  }

  const validDataset = validateDatasetManifest(input.dataset);
  if (!validDataset.ok) return validDataset;

  if (input.cases.length !== validDataset.value.itemCount) {
    return err(
      new StructuredError(
        "EVAL_DATASET_COUNT",
        `Dataset declares ${validDataset.value.itemCount} items but runner received ${input.cases.length}.`,
      ),
    );
  }

  const ids = input.cases.map((entry) => entry.id);
  if (
    ids.some((id) => id.trim() === "") ||
    new Set(ids).size !== ids.length
  ) {
    return err(
      new StructuredError(
        "EVAL_CASE_IDS",
        "Benchmark cases require unique, non-empty ids.",
      ),
    );
  }

  const ordered = [...input.cases].sort((a, b) => a.id.localeCompare(b.id));
  const results: BenchmarkCaseResult[] = [];

  for (const benchmarkCase of ordered) {
    try {
      const evaluation = await input.evaluate(benchmarkCase);
      const invalid = validateCaseEvaluation(evaluation);
      if (invalid) return err(invalid);
      results.push({
        id: benchmarkCase.id,
        ...structuredClone(evaluation),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        id: benchmarkCase.id,
        status: "fail",
        diagnostics: [`Evaluator threw: ${message}`],
      });
    }
  }

  const passed = results.filter((entry) => entry.status === "pass").length;
  const failed = results.filter((entry) => entry.status === "fail").length;
  const unknown = results.filter((entry) => entry.status === "unknown").length;
  const known = passed + failed;

  return ok({
    benchmarkId: input.benchmarkId,
    benchmarkVersion: input.benchmarkVersion,
    dataset: validDataset.value,
    summary: {
      cases: results.length,
      passed,
      failed,
      unknown,
      passRate: rate(passed, results.length),
      knownPassRate: rate(passed, known),
    },
    results,
    ...(input.timestamps?.startedAt === undefined
      ? {}
      : { startedAt: input.timestamps.startedAt }),
    ...(input.timestamps?.completedAt === undefined
      ? {}
      : { completedAt: input.timestamps.completedAt }),
  });
};

export interface CandidateRecallSample {
  id: string;
  acceptableCandidateIds: string[];
  generatedCandidateIds: string[];
  selectedCandidateId?: string;
}

export interface CandidateRecallReport {
  samples: number;
  recallAtK: Record<string, number>;
  fullCandidateRecall: number;
  meanCandidateCount: number;
  oracleEndToEndUpperBound: number;
  conditionalSelectionAccuracy: number;
  endToEndAccuracy: number;
  missingGoldSampleIds: string[];
}

const firstAcceptableRank = (
  sample: CandidateRecallSample,
): number | undefined => {
  const acceptable = new Set(sample.acceptableCandidateIds);
  const index = sample.generatedCandidateIds.findIndex((id) =>
    acceptable.has(id),
  );
  return index < 0 ? undefined : index + 1;
};

export const reportCandidateRecall = (
  samples: readonly CandidateRecallSample[],
  ks: readonly number[] = [1, 3, 5, 10],
): Result<CandidateRecallReport> => {
  if (
    samples.some(
      (sample) =>
        sample.id.trim() === "" ||
        sample.acceptableCandidateIds.length === 0 ||
        !unique(sample.acceptableCandidateIds) ||
        !unique(sample.generatedCandidateIds),
    )
  ) {
    return err(
      new StructuredError(
        "EVAL_CANDIDATE_SAMPLE",
        "Candidate recall samples require ids, non-empty acceptable sets, and duplicate-free candidates.",
      ),
    );
  }
  const normalizedKs = [...new Set(ks)].sort((a, b) => a - b);
  if (
    normalizedKs.some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    )
  ) {
    return err(
      new StructuredError(
        "EVAL_CANDIDATE_K",
        "Recall@K values must be positive integers.",
      ),
    );
  }

  const ranks = samples.map((sample) => ({
    sample,
    rank: firstAcceptableRank(sample),
  }));
  const present = ranks.filter((entry) => entry.rank !== undefined);
  const selectedCorrect = samples.filter((sample) =>
    sample.selectedCandidateId === undefined
      ? false
      : sample.acceptableCandidateIds.includes(sample.selectedCandidateId),
  ).length;

  const conditionalCorrect = present.filter(({ sample }) =>
    sample.selectedCandidateId === undefined
      ? false
      : sample.acceptableCandidateIds.includes(sample.selectedCandidateId),
  ).length;

  const recallAtK: Record<string, number> = {};
  for (const k of normalizedKs) {
    recallAtK[String(k)] = rate(
      ranks.filter((entry) => entry.rank !== undefined && entry.rank <= k)
        .length,
      samples.length,
    );
  }

  return ok({
    samples: samples.length,
    recallAtK,
    fullCandidateRecall: rate(present.length, samples.length),
    meanCandidateCount:
      samples.length === 0
        ? 0
        : samples.reduce(
            (sum, sample) => sum + sample.generatedCandidateIds.length,
            0,
          ) / samples.length,
    oracleEndToEndUpperBound: rate(present.length, samples.length),
    conditionalSelectionAccuracy: rate(
      conditionalCorrect,
      present.length,
    ),
    endToEndAccuracy: rate(selectedCorrect, samples.length),
    missingGoldSampleIds: ranks
      .filter((entry) => entry.rank === undefined)
      .map((entry) => entry.sample.id),
  });
};

export interface CalibrationSample {
  id: string;
  confidence: number;
  correct: boolean;
  abstained?: boolean;
}

export interface ReliabilityBin {
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number;
  accuracy: number;
  calibrationGap: number;
}

export interface RiskCoveragePoint {
  threshold: number;
  coverage: number;
  accuracy: number;
  risk: number;
}

export interface CalibrationReport {
  samples: number;
  brierScore: number;
  expectedCalibrationError: number;
  reliabilityBins: ReliabilityBin[];
  coverage: number;
  selectiveAccuracy: number;
  riskCoverage: RiskCoveragePoint[];
}

const validateProbability = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

export const reportCalibration = (
  samples: readonly CalibrationSample[],
  binCount = 10,
): Result<CalibrationReport> => {
  if (!Number.isSafeInteger(binCount) || binCount <= 0) {
    return err(
      new StructuredError(
        "EVAL_CALIBRATION_BINS",
        "Calibration bin count must be a positive integer.",
      ),
    );
  }
  if (
    samples.some(
      (sample) =>
        sample.id.trim() === "" || !validateProbability(sample.confidence),
    )
  ) {
    return err(
      new StructuredError(
        "EVAL_CALIBRATION_SAMPLE",
        "Calibration samples require ids and confidence in [0, 1].",
      ),
    );
  }

  const bins: ReliabilityBin[] = [];
  let ece = 0;
  for (let index = 0; index < binCount; index += 1) {
    const lower = index / binCount;
    const upper = (index + 1) / binCount;
    const members = samples.filter((sample) =>
      index === binCount - 1
        ? sample.confidence >= lower && sample.confidence <= upper
        : sample.confidence >= lower && sample.confidence < upper,
    );
    const meanConfidence =
      members.length === 0
        ? 0
        : members.reduce((sum, sample) => sum + sample.confidence, 0) /
          members.length;
    const accuracy = rate(
      members.filter((sample) => sample.correct).length,
      members.length,
    );
    const calibrationGap =
      members.length === 0 ? 0 : Math.abs(meanConfidence - accuracy);
    ece += rate(members.length, samples.length) * calibrationGap;
    bins.push({
      lower,
      upper,
      count: members.length,
      meanConfidence,
      accuracy,
      calibrationGap,
    });
  }

  const brierScore =
    samples.length === 0
      ? 0
      : samples.reduce((sum, sample) => {
          const target = sample.correct ? 1 : 0;
          return sum + (sample.confidence - target) ** 2;
        }, 0) / samples.length;

  const accepted = samples.filter((sample) => sample.abstained !== true);
  const selectiveAccuracy = rate(
    accepted.filter((sample) => sample.correct).length,
    accepted.length,
  );

  const riskCoverage: RiskCoveragePoint[] = [];
  for (let step = 0; step <= 10; step += 1) {
    const threshold = step / 10;
    const selected = samples.filter(
      (sample) =>
        sample.abstained !== true && sample.confidence >= threshold,
    );
    const accuracy = rate(
      selected.filter((sample) => sample.correct).length,
      selected.length,
    );
    riskCoverage.push({
      threshold,
      coverage: rate(selected.length, samples.length),
      accuracy,
      risk: selected.length === 0 ? 0 : 1 - accuracy,
    });
  }

  return ok({
    samples: samples.length,
    brierScore,
    expectedCalibrationError: ece,
    reliabilityBins: bins,
    coverage: rate(accepted.length, samples.length),
    selectiveAccuracy,
    riskCoverage,
  });
};

export interface MetricSummary {
  sampleCount: number;
  means: Record<string, number>;
  observedCounts: Record<string, number>;
}

type NumericMetricSample = Record<string, number | undefined>;

const summarizeMetrics = (
  samples: readonly NumericMetricSample[],
  metricNames: readonly string[],
  normalizedMetrics: ReadonlySet<string>,
): Result<MetricSummary> => {
  const means: Record<string, number> = {};
  const observedCounts: Record<string, number> = {};

  for (const metric of metricNames) {
    const values = samples
      .map((sample) => sample[metric])
      .filter((value): value is number => value !== undefined);

    if (
      values.some(
        (value) =>
          !Number.isFinite(value) ||
          (normalizedMetrics.has(metric) && !validateProbability(value)),
      )
    ) {
      return err(
        new StructuredError(
          "EVAL_DOMAIN_METRIC",
          `Metric ${metric} contains an invalid value.`,
        ),
      );
    }

    observedCounts[metric] = values.length;
    means[metric] =
      values.length === 0
        ? 0
        : values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  return ok({
    sampleCount: samples.length,
    means,
    observedCounts,
  });
};

const allNormalized = (names: readonly string[]): ReadonlySet<string> =>
  new Set(names);

export interface SemanticBenchmarkSample extends NumericMetricSample {
  schemaConformance: number;
  invariantPreservation: number;
  serializationRoundTrip: number;
  semanticExactMatch: number;
  semanticPartialMatch: number;
}

const SEMANTIC_METRICS = [
  "schemaConformance",
  "invariantPreservation",
  "serializationRoundTrip",
  "semanticExactMatch",
  "semanticPartialMatch",
] as const;

export const reportSemanticBenchmark = (
  samples: readonly SemanticBenchmarkSample[],
): Result<MetricSummary> =>
  summarizeMetrics(samples, SEMANTIC_METRICS, allNormalized(SEMANTIC_METRICS));

export interface NluBenchmarkSample extends NumericMetricSample {
  semanticExactMatch: number;
  semanticPartialMatch: number;
  criticalInvariantAccuracy: number;
  referenceResolutionAccuracy?: number;
  candidateRecall?: number;
  ambiguityCalibration?: number;
  unknownTermPreservation: number;
}

const NLU_METRICS = [
  "semanticExactMatch",
  "semanticPartialMatch",
  "criticalInvariantAccuracy",
  "referenceResolutionAccuracy",
  "candidateRecall",
  "ambiguityCalibration",
  "unknownTermPreservation",
] as const;

export const reportNluBenchmark = (
  samples: readonly NluBenchmarkSample[],
): Result<MetricSummary> =>
  summarizeMetrics(samples, NLU_METRICS, allNormalized(NLU_METRICS));

export interface NlgBenchmarkSample extends NumericMetricSample {
  criticalSemanticPreservation: number;
  roundTripSemanticPreservation: number;
  grammarValidity: number;
  referenceRecoverability?: number;
  humanNaturalness?: number;
  styleAdherence?: number;
  repetitionScore?: number;
}

const NLG_METRICS = [
  "criticalSemanticPreservation",
  "roundTripSemanticPreservation",
  "grammarValidity",
  "referenceRecoverability",
  "humanNaturalness",
  "styleAdherence",
  "repetitionScore",
] as const;

export const reportNlgBenchmark = (
  samples: readonly NlgBenchmarkSample[],
): Result<MetricSummary> =>
  summarizeMetrics(samples, NLG_METRICS, allNormalized(NLG_METRICS));

export interface DialogueBenchmarkSample extends NumericMetricSample {
  referenceAccuracy: number;
  correctionHandling: number;
  openQuestionTracking: number;
  topicReturnAccuracy: number;
  commitmentConsistency: number;
  semanticStateIntegrity: number;
}

const DIALOGUE_METRICS = [
  "referenceAccuracy",
  "correctionHandling",
  "openQuestionTracking",
  "topicReturnAccuracy",
  "commitmentConsistency",
  "semanticStateIntegrity",
] as const;

export const reportDialogueBenchmark = (
  samples: readonly DialogueBenchmarkSample[],
): Result<MetricSummary> =>
  summarizeMetrics(
    samples,
    DIALOGUE_METRICS,
    allNormalized(DIALOGUE_METRICS),
  );

export interface MultilingualBenchmarkSample extends NumericMetricSample {
  semanticPreservation: number;
  polarityPreservation: number;
  quantityPreservation: number;
  modalityPreservation: number;
  referencePreservation: number;
}

const MULTILINGUAL_METRICS = [
  "semanticPreservation",
  "polarityPreservation",
  "quantityPreservation",
  "modalityPreservation",
  "referencePreservation",
] as const;

export const reportMultilingualBenchmark = (
  samples: readonly MultilingualBenchmarkSample[],
): Result<MetricSummary> =>
  summarizeMetrics(
    samples,
    MULTILINGUAL_METRICS,
    allNormalized(MULTILINGUAL_METRICS),
  );

export interface SynthesisBenchmarkSample extends NumericMetricSample {
  validPirCompletionRate: number;
  backendLoweringRate: number;
  compileRate: number;
  testPassRate: number;
  requirementSatisfaction: number;
  candidateOracleUpperBound: number;
  jevCalls: number;
  searchStates: number;
}

const SYNTHESIS_METRICS = [
  "validPirCompletionRate",
  "backendLoweringRate",
  "compileRate",
  "testPassRate",
  "requirementSatisfaction",
  "candidateOracleUpperBound",
  "jevCalls",
  "searchStates",
] as const;

const SYNTHESIS_NORMALIZED = new Set<string>([
  "validPirCompletionRate",
  "backendLoweringRate",
  "compileRate",
  "testPassRate",
  "requirementSatisfaction",
  "candidateOracleUpperBound",
]);

export const reportSynthesisBenchmark = (
  samples: readonly SynthesisBenchmarkSample[],
): Result<MetricSummary> =>
  summarizeMetrics(samples, SYNTHESIS_METRICS, SYNTHESIS_NORMALIZED);

export interface RepairBenchmarkSample extends NumericMetricSample {
  repairSuccessRate: number;
  regressionFreeRate: number;
  requirementSatisfaction: number;
  iterations: number;
  compilerCalls: number;
  testCalls: number;
  diffSize?: number;
}

const REPAIR_METRICS = [
  "repairSuccessRate",
  "regressionFreeRate",
  "requirementSatisfaction",
  "iterations",
  "compilerCalls",
  "testCalls",
  "diffSize",
] as const;

const REPAIR_NORMALIZED = new Set<string>([
  "repairSuccessRate",
  "regressionFreeRate",
  "requirementSatisfaction",
]);

export const reportRepairBenchmark = (
  samples: readonly RepairBenchmarkSample[],
): Result<MetricSummary> =>
  summarizeMetrics(samples, REPAIR_METRICS, REPAIR_NORMALIZED);

export interface ZeroGenerativeAuditRecord {
  generativeModelCalls: number;
  generativeEmbeddingCalls: number;
  externalGenerationServices: number;
  embeddingProfile?: string;
}

export interface ZeroGenerativeAuditResult {
  jevNative: boolean;
  violations: string[];
  record: ZeroGenerativeAuditRecord;
}

const nonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

export const auditZeroGenerative = (
  record: ZeroGenerativeAuditRecord,
  options: { allowEmbeddingCalls?: boolean } = {},
): Result<ZeroGenerativeAuditResult> => {
  if (
    !nonNegativeInteger(record.generativeModelCalls) ||
    !nonNegativeInteger(record.generativeEmbeddingCalls) ||
    !nonNegativeInteger(record.externalGenerationServices)
  ) {
    return err(
      new StructuredError(
        "EVAL_ZERO_GENERATIVE_COUNTER",
        "Generation audit counters must be non-negative integers.",
      ),
    );
  }
  if (
    record.generativeEmbeddingCalls > 0 &&
    options.allowEmbeddingCalls === true &&
    (record.embeddingProfile === undefined ||
      record.embeddingProfile.trim() === "")
  ) {
    return err(
      new StructuredError(
        "EVAL_ZERO_GENERATIVE_EMBEDDING_PROFILE",
        "Permitted embedding calls require an explicit profile.",
      ),
    );
  }

  const violations: string[] = [];
  if (record.generativeModelCalls !== 0) {
    violations.push("generative_model_calls");
  }
  if (record.externalGenerationServices !== 0) {
    violations.push("external_generation_services");
  }
  if (
    record.generativeEmbeddingCalls !== 0 &&
    options.allowEmbeddingCalls !== true
  ) {
    violations.push("generative_embedding_calls");
  }

  return ok({
    jevNative: violations.length === 0,
    violations,
    record: structuredClone(record),
  });
};

export interface BenchmarkReplayInput {
  traceId?: TraceId;
  determinism: "D0" | "D1" | "D2" | "D3";
  dataset: DatasetManifest;
  benchmarkId: string;
  benchmarkVersion: string;
  inputSourceDigests?: Digest[];
  configurationVersions?: Record<string, string>;
  schemaVersions?: Record<string, string>;
  ontologyVersions?: Record<string, string>;
  languagePackVersions?: Record<string, string>;
  decisionPackVersions?: Record<string, string>;
  graphRevisions?: string[];
  featureFlags?: string[];
  jevModelId?: string;
  recordedDecisionRefs?: string[];
  externalVerifierRefs?: string[];
  randomSeeds?: number[];
  audit: ZeroGenerativeAuditResult;
}

export const generateBenchmarkReplayManifest = (
  input: BenchmarkReplayInput,
): Result<ReplayManifest> => {
  const dataset = validateDatasetManifest(input.dataset);
  if (!dataset.ok) return dataset;
  if (input.benchmarkId.trim() === "" || input.benchmarkVersion.trim() === "") {
    return err(
      new StructuredError(
        "EVAL_REPLAY_BENCHMARK",
        "Replay metadata requires benchmark id and version.",
      ),
    );
  }

  return ok(
    createReplayManifest({
      traceId: input.traceId ?? createTraceId(),
      version: "jl-eval-replay-1",
      determinism: input.determinism,
      inputSourceDigests:
        input.inputSourceDigests ?? [dataset.value.contentDigest],
      configurationVersions: {
        benchmark: input.benchmarkVersion,
        dataset: dataset.value.version,
        ...(input.configurationVersions ?? {}),
      },
      schemaVersions: input.schemaVersions ?? {},
      ontologyVersions: input.ontologyVersions ?? {},
      languagePackVersions: input.languagePackVersions ?? {},
      decisionPackVersions: input.decisionPackVersions ?? {},
      graphRevisions: input.graphRevisions ?? [],
      featureFlags: input.featureFlags ?? [],
      ...(input.jevModelId === undefined
        ? {}
        : { jevModelId: input.jevModelId }),
      ...(input.randomSeeds === undefined
        ? {}
        : { randomSeeds: input.randomSeeds }),
      ...(input.recordedDecisionRefs === undefined
        ? {}
        : { recordedDecisionRefs: input.recordedDecisionRefs }),
      ...(input.externalVerifierRefs === undefined
        ? {}
        : { externalVerifierRefs: input.externalVerifierRefs }),
      annotations: {
        benchmarkId: input.benchmarkId,
        datasetId: dataset.value.id,
        datasetSplit: dataset.value.split,
        datasetDomain: dataset.value.domain,
        jevNative: input.audit.jevNative,
        zeroGenerativeViolations: input.audit.violations,
        generativeModelCalls: input.audit.record.generativeModelCalls,
        generativeEmbeddingCalls:
          input.audit.record.generativeEmbeddingCalls,
        externalGenerationServices:
          input.audit.record.externalGenerationServices,
      },
    }),
  );
};
