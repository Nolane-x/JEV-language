import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type { DecisionAnswer } from "../../decision-runtime/src/index.ts";

export interface CalibrationBin {
  raw: readonly [number, number];
  empiricalAccuracy: number;
  sampleCount: number;
}

export interface QuestionCalibrationRule {
  questionId: string;
  bins?: CalibrationBin[];
  minConfidence?: number;
  minSelectedProbability?: number;
  noulAbstainBand?: readonly [number, number];
}

export interface CalibrationProfile {
  id: string;
  version: string;
  decisionPackId: string;
  decisionPackVersion: string;
  domain: string;
  rules: Record<string, QuestionCalibrationRule>;
}

export type ConfidenceDisposition =
  | "accept"
  | "preserve-ambiguity"
  | "abstain"
  | "deterministic-fallback"
  | "consumer-clarification";

export interface ConfidenceDecision {
  disposition: ConfidenceDisposition;
  reason:
    | "accepted"
    | "missing-rule"
    | "low-confidence"
    | "low-selected-probability"
    | "noul-abstain-band";
  observed?: number;
  threshold?: number;
}

const isProbability = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

export const validateCalibrationProfile = (
  profile: CalibrationProfile,
): Result<CalibrationProfile> => {
  if (
    profile.id.trim() === "" ||
    profile.version.trim() === "" ||
    profile.decisionPackId.trim() === "" ||
    profile.decisionPackVersion.trim() === ""
  ) {
    return err(
      new StructuredError(
        "DPACK_CALIBRATION_ID",
        "Calibration profile identifiers and versions are required.",
      ),
    );
  }

  for (const [questionId, rule] of Object.entries(profile.rules)) {
    if (rule.questionId !== questionId) {
      return err(
        new StructuredError(
          "DPACK_CALIBRATION_QUESTION_MISMATCH",
          `Calibration rule key ${questionId} does not match rule.questionId ${rule.questionId}.`,
        ),
      );
    }
    for (const value of [rule.minConfidence, rule.minSelectedProbability]) {
      if (value !== undefined && !isProbability(value)) {
        return err(
          new StructuredError(
            "DPACK_CALIBRATION_THRESHOLD",
            `Calibration threshold for ${questionId} must be in [0,1].`,
          ),
        );
      }
    }
    if (rule.noulAbstainBand !== undefined) {
      const [low, high] = rule.noulAbstainBand;
      if (!isProbability(low) || !isProbability(high) || low >= high) {
        return err(
          new StructuredError(
            "DPACK_CALIBRATION_ABSTAIN_BAND",
            `Noul abstention band for ${questionId} must be an increasing [0,1] interval.`,
          ),
        );
      }
    }
    for (const bin of rule.bins ?? []) {
      const [low, high] = bin.raw;
      if (
        !isProbability(low) ||
        !isProbability(high) ||
        low > high ||
        !isProbability(bin.empiricalAccuracy) ||
        !Number.isInteger(bin.sampleCount) ||
        bin.sampleCount < 0
      ) {
        return err(
          new StructuredError(
            "DPACK_CALIBRATION_BIN",
            `Invalid calibration bin for ${questionId}.`,
          ),
        );
      }
    }
  }

  return ok(structuredClone(profile));
};

const selectedProbability = (answer: DecisionAnswer): number | undefined => {
  if (answer.type === "noul") {
    return answer.probabilities[answer.selected ? "true" : "false"];
  }
  return answer.probabilities[String(answer.selected)];
};

export const evaluateConfidence = (
  answer: DecisionAnswer,
  rule: QuestionCalibrationRule | undefined,
  fallback: Exclude<ConfidenceDisposition, "accept">,
): ConfidenceDecision => {
  if (rule === undefined) {
    return { disposition: fallback, reason: "missing-rule" };
  }

  if (answer.type === "noul" && rule.noulAbstainBand !== undefined) {
    const probabilityTrue = answer.probabilities.true;
    const [low, high] = rule.noulAbstainBand;
    if (
      probabilityTrue !== undefined &&
      probabilityTrue >= low &&
      probabilityTrue <= high
    ) {
      return {
        disposition: fallback,
        reason: "noul-abstain-band",
        observed: probabilityTrue,
      };
    }
  }

  if (
    rule.minConfidence !== undefined &&
    answer.confidence !== undefined &&
    answer.confidence < rule.minConfidence
  ) {
    return {
      disposition: fallback,
      reason: "low-confidence",
      observed: answer.confidence,
      threshold: rule.minConfidence,
    };
  }

  const probability = selectedProbability(answer);
  if (
    rule.minSelectedProbability !== undefined &&
    probability !== undefined &&
    probability < rule.minSelectedProbability
  ) {
    return {
      disposition: fallback,
      reason: "low-selected-probability",
      observed: probability,
      threshold: rule.minSelectedProbability,
    };
  }

  return { disposition: "accept", reason: "accepted" };
};
