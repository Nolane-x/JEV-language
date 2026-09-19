import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  DecisionAnswer,
} from "../../decision-runtime/src/index.ts";

export interface CalibrationBin {
  minConfidence: number;
  maxConfidence: number;
  observedAccuracy: number;
  count: number;
}

export interface CalibrationProfile {
  id: string;
  version: string;
  decisionFamily: string;
  minConfidence: number;
  minMargin?: number;
  bins: CalibrationBin[];
  datasetRef: string;
}

export interface AbstentionContext {
  contextComplete?: boolean;
  outOfDistribution?: boolean;
  candidateRecallConfidence?: number;
  minCandidateRecallConfidence?: number;
}

export type ConfidenceDecision =
  | { action: "accept"; confidence: number; margin: number }
  | {
      action: "abstain";
      confidence: number;
      margin: number;
      reason:
        | "low-confidence"
        | "low-margin"
        | "missing-context"
        | "out-of-distribution"
        | "low-candidate-recall";
    };

const probabilitySummary = (
  answer: DecisionAnswer,
): { confidence: number; margin: number } => {
  const values = Object.values(answer.probabilities)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a);
  const confidence = answer.confidence ?? values[0] ?? 0;
  const margin = Math.max(0, confidence - (values[1] ?? 0));
  return { confidence, margin };
};

export const evaluateConfidence = (
  answer: DecisionAnswer,
  profile: CalibrationProfile,
  context: AbstentionContext = {},
): ConfidenceDecision => {
  const { confidence, margin } = probabilitySummary(answer);
  if (context.contextComplete === false) {
    return { action: "abstain", confidence, margin, reason: "missing-context" };
  }
  if (context.outOfDistribution === true) {
    return {
      action: "abstain",
      confidence,
      margin,
      reason: "out-of-distribution",
    };
  }
  if (
    context.minCandidateRecallConfidence !== undefined &&
    (context.candidateRecallConfidence ?? 0) <
      context.minCandidateRecallConfidence
  ) {
    return {
      action: "abstain",
      confidence,
      margin,
      reason: "low-candidate-recall",
    };
  }
  if (confidence < profile.minConfidence) {
    return { action: "abstain", confidence, margin, reason: "low-confidence" };
  }
  if (
    profile.minMargin !== undefined &&
    margin < profile.minMargin
  ) {
    return { action: "abstain", confidence, margin, reason: "low-margin" };
  }
  return { action: "accept", confidence, margin };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const loadCalibrationProfile = (
  input: unknown,
): Result<CalibrationProfile> => {
  if (
    !isRecord(input) ||
    typeof input.id !== "string" ||
    typeof input.version !== "string" ||
    typeof input.decisionFamily !== "string" ||
    typeof input.minConfidence !== "number" ||
    typeof input.datasetRef !== "string" ||
    !Array.isArray(input.bins)
  ) {
    return err(
      new StructuredError(
        "DPACK_CALIBRATION_SCHEMA",
        "Calibration profile is missing required typed fields.",
      ),
    );
  }
  if (
    input.id.trim() === "" ||
    input.version.trim() === "" ||
    input.decisionFamily.trim() === "" ||
    input.datasetRef.trim() === "" ||
    !Number.isFinite(input.minConfidence) ||
    input.minConfidence < 0 ||
    input.minConfidence > 1 ||
    (input.minMargin !== undefined &&
      (typeof input.minMargin !== "number" ||
        !Number.isFinite(input.minMargin) ||
        input.minMargin < 0 ||
        input.minMargin > 1))
  ) {
    return err(
      new StructuredError(
        "DPACK_CALIBRATION_RANGE",
        "Calibration thresholds must be finite probabilities in [0, 1].",
      ),
    );
  }

  const bins: CalibrationBin[] = [];
  for (const raw of input.bins) {
    if (
      !isRecord(raw) ||
      typeof raw.minConfidence !== "number" ||
      typeof raw.maxConfidence !== "number" ||
      typeof raw.observedAccuracy !== "number" ||
      typeof raw.count !== "number" ||
      raw.minConfidence < 0 ||
      raw.maxConfidence > 1 ||
      raw.minConfidence > raw.maxConfidence ||
      raw.observedAccuracy < 0 ||
      raw.observedAccuracy > 1 ||
      !Number.isInteger(raw.count) ||
      raw.count < 0
    ) {
      return err(
        new StructuredError(
          "DPACK_CALIBRATION_BIN",
          "Calibration bins require valid confidence ranges, observed accuracy, and non-negative counts.",
        ),
      );
    }
    bins.push({
      minConfidence: raw.minConfidence,
      maxConfidence: raw.maxConfidence,
      observedAccuracy: raw.observedAccuracy,
      count: raw.count,
    });
  }

  return ok({
    id: input.id,
    version: input.version,
    decisionFamily: input.decisionFamily,
    minConfidence: input.minConfidence,
    ...(input.minMargin === undefined ? {} : { minMargin: input.minMargin }),
    bins,
    datasetRef: input.datasetRef,
  });
};

export class CalibrationProfileRegistry {
  readonly #profiles = new Map<string, CalibrationProfile>();

  register(profile: CalibrationProfile): Result<void> {
    const loaded = loadCalibrationProfile(profile);
    if (!loaded.ok) return loaded;
    const key = `${profile.id}@${profile.version}`;
    if (this.#profiles.has(key)) {
      return err(
        new StructuredError(
          "DPACK_CALIBRATION_DUPLICATE",
          `Calibration profile already registered: ${key}.`,
        ),
      );
    }
    this.#profiles.set(key, structuredClone(loaded.value));
    return ok(undefined);
  }

  get(id: string, version: string): CalibrationProfile | undefined {
    const value = this.#profiles.get(`${id}@${version}`);
    return value === undefined ? undefined : structuredClone(value);
  }
}
