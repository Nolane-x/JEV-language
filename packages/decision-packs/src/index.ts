import {
  err,
  ok,
  parseVersion,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  DecisionQuestion,
  DecisionState,
} from "../../decision-runtime/src/index.ts";
import {
  validateCandidateSourceBindings,
  type CandidateSourceBinding,
} from "./scheduler.ts";

export type DecisionPackLifecycle =
  | "draft"
  | "fixture-tested"
  | "calibration-tested"
  | "candidate"
  | "production"
  | "deprecated";

export type LowConfidenceFallback =
  | "preserve-ambiguity"
  | "abstain"
  | "deterministic-fallback"
  | "consumer-clarification";

export interface DecisionPackManifest {
  id: string;
  version: string;
  maturity: DecisionPackLifecycle;
  stateProjector: string;
  questions: Record<string, DecisionQuestion>;
  calibrationProfile?: string;
  fallback: {
    onLowConfidence: LowConfidenceFallback;
  };
  fixtures: string[];

  // Normative quality assets from the v0.4 Decision Pack contract. They remain
  // optional for draft/bootstrap packs, but candidate/production gates require
  // increasing evidence instead of silently treating source code as proof.
  semanticPurpose?: string;
  inputSchema?: JsonValue;
  candidateSemantics?: string[];
  hardConstraints?: string[];
  counterexamples?: string[];
  knownFailureModes?: string[];
  versionHistory?: string[];
  traceOutput?: boolean;
  candidateSources?: CandidateSourceBinding[];
  candidateRecallReport?: {
    datasetRef: string;
    recall: number;
    cases: number;
  };
}

export interface StateProjector<I> {
  readonly id: string;
  project(input: I): DecisionState;
}

export interface DecisionPackQualityReport {
  readyForCandidate: boolean;
  readyForProduction: boolean;
  missingCandidateEvidence: string[];
  missingProductionEvidence: string[];
}

const lifecycle = new Set<DecisionPackLifecycle>([
  "draft",
  "fixture-tested",
  "calibration-tested",
  "candidate",
  "production",
  "deprecated",
]);

const fallbackPolicies = new Set<LowConfidenceFallback>([
  "preserve-ambiguity",
  "abstain",
  "deterministic-fallback",
  "consumer-clarification",
]);

const hasText = (value: string | undefined): boolean =>
  value !== undefined && value.trim().length > 0;

const hasItems = (value: readonly unknown[] | undefined): boolean =>
  value !== undefined && value.length > 0;

export const assessDecisionPackQuality = (
  input: DecisionPackManifest,
): DecisionPackQualityReport => {
  const missingCandidateEvidence: string[] = [];
  if (!hasText(input.semanticPurpose)) {
    missingCandidateEvidence.push("semanticPurpose");
  }
  if (input.inputSchema === undefined) {
    missingCandidateEvidence.push("inputSchema");
  }
  if (!hasItems(input.candidateSemantics)) {
    missingCandidateEvidence.push("candidateSemantics");
  }
  if (!hasItems(input.hardConstraints)) {
    missingCandidateEvidence.push("hardConstraints");
  }
  if (!hasItems(input.fixtures)) {
    missingCandidateEvidence.push("fixtures");
  }
  if (!hasItems(input.counterexamples)) {
    missingCandidateEvidence.push("counterexamples");
  }
  if (!hasItems(input.knownFailureModes)) {
    missingCandidateEvidence.push("knownFailureModes");
  }
  if (input.traceOutput !== true) {
    missingCandidateEvidence.push("traceOutput");
  }
  const hasChoiceQuestion = Object.values(input.questions).some(
    (question) => question.type === "choice",
  );
  if (hasChoiceQuestion && !hasItems(input.candidateSources)) {
    missingCandidateEvidence.push("candidateSources");
  }
  if (hasChoiceQuestion && input.candidateRecallReport === undefined) {
    missingCandidateEvidence.push("candidateRecallReport");
  }

  const missingProductionEvidence = [...missingCandidateEvidence];
  if (!hasText(input.calibrationProfile)) {
    missingProductionEvidence.push("calibrationProfile");
  }
  if (!hasItems(input.versionHistory)) {
    missingProductionEvidence.push("versionHistory");
  }

  return {
    readyForCandidate: missingCandidateEvidence.length === 0,
    readyForProduction: missingProductionEvidence.length === 0,
    missingCandidateEvidence,
    missingProductionEvidence,
  };
};

export const validateDecisionPack = (
  input: DecisionPackManifest,
): Result<DecisionPackManifest> => {
  if (input.id.trim() === "" || input.version.trim() === "") {
    return err(
      new StructuredError(
        "DPACK_INVALID_ID",
        "Decision pack id and version are required.",
      ),
    );
  }
  if (!parseVersion(input.version).ok) {
    return err(
      new StructuredError(
        "DPACK_INVALID_VERSION",
        `Decision pack version must be semantic-version compatible: ${input.version}.`,
      ),
    );
  }
  if (!lifecycle.has(input.maturity)) {
    return err(
      new StructuredError(
        "DPACK_INVALID_MATURITY",
        `Unsupported decision pack maturity: ${String(input.maturity)}.`,
      ),
    );
  }
  if (input.stateProjector.trim() === "") {
    return err(
      new StructuredError(
        "DPACK_STATE_PROJECTOR",
        "Decision pack stateProjector is required.",
      ),
    );
  }
  if (!fallbackPolicies.has(input.fallback.onLowConfidence)) {
    return err(
      new StructuredError(
        "DPACK_INVALID_FALLBACK",
        "Decision pack has an unsupported low-confidence fallback.",
      ),
    );
  }
  if (Object.keys(input.questions).length === 0) {
    return err(
      new StructuredError(
        "DPACK_NO_QUESTIONS",
        "Decision pack must contain at least one question.",
      ),
    );
  }

  if (input.candidateSources !== undefined) {
    const bindings = validateCandidateSourceBindings(input, input.candidateSources);
    if (!bindings.ok) return bindings;
  }
  if (input.candidateRecallReport !== undefined) {
    const report = input.candidateRecallReport;
    if (
      report.datasetRef.trim() === "" ||
      !Number.isFinite(report.recall) ||
      report.recall < 0 ||
      report.recall > 1 ||
      !Number.isInteger(report.cases) ||
      report.cases < 1
    ) {
      return err(
        new StructuredError(
          "DPACK_CANDIDATE_RECALL_REPORT",
          "Candidate recall reports require a dataset ref, recall in [0,1], and at least one case.",
        ),
      );
    }
  }

  const quality = assessDecisionPackQuality(input);
  if (input.maturity === "candidate" && !quality.readyForCandidate) {
    return err(
      new StructuredError(
        "DPACK_CANDIDATE_GATE",
        "Candidate decision packs require explicit semantic purpose, schema, constraints, fixtures, counterexamples, known failure modes, and trace output.",
        { missing: quality.missingCandidateEvidence },
      ),
    );
  }
  if (input.maturity === "production" && !quality.readyForProduction) {
    return err(
      new StructuredError(
        "DPACK_PRODUCTION_GATE",
        "Production decision packs require the candidate evidence plus calibration and version history.",
        { missing: quality.missingProductionEvidence },
      ),
    );
  }
  return ok(structuredClone(input));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const loadDecisionPack = (
  input: unknown,
): Result<DecisionPackManifest> => {
  if (!isRecord(input)) {
    return err(
      new StructuredError("DPACK_SCHEMA", "Decision pack must be an object."),
    );
  }
  if (
    typeof input.id !== "string" ||
    typeof input.version !== "string" ||
    typeof input.maturity !== "string" ||
    typeof input.stateProjector !== "string" ||
    !isRecord(input.questions) ||
    !isRecord(input.fallback) ||
    typeof input.fallback.onLowConfidence !== "string" ||
    !Array.isArray(input.fixtures)
  ) {
    return err(
      new StructuredError(
        "DPACK_SCHEMA",
        "Decision pack is missing required runtime manifest fields.",
      ),
    );
  }
  const arrayFields = [
    "candidateSemantics",
    "hardConstraints",
    "counterexamples",
    "knownFailureModes",
    "versionHistory",
  ] as const;
  for (const field of arrayFields) {
    const value = input[field];
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    ) {
      return err(
        new StructuredError(
          "DPACK_SCHEMA",
          `Decision pack field ${field} must be an array of strings when present.`,
        ),
      );
    }
  }
  if (
    input.candidateSources !== undefined &&
    (!Array.isArray(input.candidateSources) ||
      input.candidateSources.some(
        (binding) =>
          !isRecord(binding) ||
          typeof binding.id !== "string" ||
          typeof binding.kind !== "string" ||
          typeof binding.sourceRef !== "string" ||
          !Array.isArray(binding.questionIds) ||
          binding.questionIds.some((id) => typeof id !== "string"),
      ))
  ) {
    return err(
      new StructuredError(
        "DPACK_SCHEMA",
        "Decision pack candidateSources must contain typed candidate-source bindings.",
      ),
    );
  }
  if (
    input.candidateRecallReport !== undefined &&
    (!isRecord(input.candidateRecallReport) ||
      typeof input.candidateRecallReport.datasetRef !== "string" ||
      typeof input.candidateRecallReport.recall !== "number" ||
      typeof input.candidateRecallReport.cases !== "number")
  ) {
    return err(
      new StructuredError(
        "DPACK_SCHEMA",
        "Decision pack candidateRecallReport has an invalid shape.",
      ),
    );
  }

  if (input.traceOutput !== undefined && typeof input.traceOutput !== "boolean") {
    return err(
      new StructuredError(
        "DPACK_SCHEMA",
        "Decision pack traceOutput must be boolean when present.",
      ),
    );
  }
  return validateDecisionPack(input as unknown as DecisionPackManifest);
};

export const sentinelDecisionPack: DecisionPackManifest = {
  id: "sentinel.semantic-preservation.v1",
  version: "1.0.0",
  maturity: "draft",
  stateProjector: "sentinel.compact-v1",
  questions: {
    preserves_negation: {
      type: "noul",
      instruction:
        "Does the candidate preserve the source requirement's negation or upper-bound restriction?",
      criteria: {
        true: "The restriction is preserved.",
        false: "The restriction is weakened, dropped, or reversed.",
      },
    },
  },
  fallback: { onLowConfidence: "preserve-ambiguity" },
  fixtures: [],
  semanticPurpose:
    "Detect whether a candidate transformation preserves a critical semantic restriction.",
  knownFailureModes: [
    "The projected state omits a source restriction.",
    "The source/candidate pair is genuinely ambiguous.",
  ],
  traceOutput: true,
};

export class DecisionPackRegistry {
  #packs = new Map<string, DecisionPackManifest>();

  register(pack: DecisionPackManifest): Result<void> {
    const validated = validateDecisionPack(pack);
    if (!validated.ok) return validated;
    const key = `${pack.id}@${pack.version}`;
    if (this.#packs.has(key)) {
      return err(
        new StructuredError(
          "DPACK_DUPLICATE",
          `Decision pack already registered: ${key}`,
        ),
      );
    }
    this.#packs.set(key, structuredClone(pack));
    return ok(undefined);
  }

  get(id: string, version: string): DecisionPackManifest | undefined {
    const value = this.#packs.get(`${id}@${version}`);
    return value === undefined ? undefined : structuredClone(value);
  }

  list(): DecisionPackManifest[] {
    return [...this.#packs.values()]
      .map((value) => structuredClone(value))
      .sort((a, b) =>
        a.id === b.id
          ? a.version.localeCompare(b.version)
          : a.id.localeCompare(b.id),
      );
  }
}

export * from "./scheduler.ts";
export * from "./calibration.ts";
export * from "./pragmatics.ts";
