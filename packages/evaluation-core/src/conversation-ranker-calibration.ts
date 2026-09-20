import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";

export interface ConversationRankerCalibrationObservation {
  id: string;
  confidence: number;
  margin: number;
  correct: boolean;
  language?: string;
  category?: string;
}

export interface ConversationRankerThresholds {
  minConfidence: number;
  minMargin: number;
}

export type ConversationRankerCalibrationStatus =
  | "adequate"
  | "insufficient-errors"
  | "insufficient-correct"
  | "empty";

export interface ConversationRankerThresholdReport {
  schemaVersion: "jl-conversation-ranker-threshold-report-1";
  thresholds: ConversationRankerThresholds;
  status: ConversationRankerCalibrationStatus;
  observations: number;
  correctObservations: number;
  incorrectObservations: number;
  accepted: number;
  abstained: number;
  acceptedCorrect: number;
  acceptedIncorrect: number;
  abstainedCorrect: number;
  abstainedIncorrect: number;
  coverage: number;
  selectiveAccuracy: number;
  falseAbstentionRate?: number;
  errorCatchRate?: number;
  acceptedIds: string[];
  abstainedIds: string[];
}

const probability = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

const rate = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const round = (value: number): number =>
  Math.round(value * 10_000) / 10_000;

const calibrationStatus = (
  correct: number,
  incorrect: number,
): ConversationRankerCalibrationStatus => {
  if (correct + incorrect === 0) return "empty";
  if (incorrect === 0) return "insufficient-errors";
  if (correct === 0) return "insufficient-correct";
  return "adequate";
};

export const reportConversationRankerThreshold = (
  observations: readonly ConversationRankerCalibrationObservation[],
  thresholds: ConversationRankerThresholds = {
    minConfidence: 0.62,
    minMargin: 0.08,
  },
): Result<ConversationRankerThresholdReport> => {
  if (
    !probability(thresholds.minConfidence) ||
    !probability(thresholds.minMargin)
  ) {
    return err(
      new StructuredError(
        "EVAL_CONVERSATION_RANKER_THRESHOLD",
        "Conversation-ranker calibration thresholds must be in [0, 1].",
      ),
    );
  }

  const ids = new Set<string>();
  for (const observation of observations) {
    if (
      observation.id.trim() === "" ||
      ids.has(observation.id) ||
      !probability(observation.confidence) ||
      !probability(observation.margin) ||
      (observation.language !== undefined &&
        observation.language.trim() === "") ||
      (observation.category !== undefined &&
        observation.category.trim() === "")
    ) {
      return err(
        new StructuredError(
          "EVAL_CONVERSATION_RANKER_OBSERVATION",
          "Calibration observations require unique ids, valid confidence/margin probabilities, and non-empty optional labels.",
        ),
      );
    }
    ids.add(observation.id);
  }

  const accepted = observations.filter(
    (item) =>
      item.confidence >= thresholds.minConfidence &&
      item.margin >= thresholds.minMargin,
  );
  const abstained = observations.filter(
    (item) =>
      item.confidence < thresholds.minConfidence ||
      item.margin < thresholds.minMargin,
  );
  const correctObservations = observations.filter((item) => item.correct);
  const incorrectObservations = observations.filter((item) => !item.correct);
  const acceptedCorrect = accepted.filter((item) => item.correct);
  const acceptedIncorrect = accepted.filter((item) => !item.correct);
  const abstainedCorrect = abstained.filter((item) => item.correct);
  const abstainedIncorrect = abstained.filter((item) => !item.correct);

  return ok({
    schemaVersion: "jl-conversation-ranker-threshold-report-1",
    thresholds: structuredClone(thresholds),
    status: calibrationStatus(
      correctObservations.length,
      incorrectObservations.length,
    ),
    observations: observations.length,
    correctObservations: correctObservations.length,
    incorrectObservations: incorrectObservations.length,
    accepted: accepted.length,
    abstained: abstained.length,
    acceptedCorrect: acceptedCorrect.length,
    acceptedIncorrect: acceptedIncorrect.length,
    abstainedCorrect: abstainedCorrect.length,
    abstainedIncorrect: abstainedIncorrect.length,
    coverage: round(rate(accepted.length, observations.length)),
    selectiveAccuracy: round(
      rate(acceptedCorrect.length, accepted.length),
    ),
    ...(correctObservations.length === 0
      ? {}
      : {
          falseAbstentionRate: round(
            rate(abstainedCorrect.length, correctObservations.length),
          ),
        }),
    ...(incorrectObservations.length === 0
      ? {}
      : {
          errorCatchRate: round(
            rate(abstainedIncorrect.length, incorrectObservations.length),
          ),
        }),
    acceptedIds: accepted.map((item) => item.id),
    abstainedIds: abstained.map((item) => item.id),
  });
};

export const sweepConversationRankerThresholds = (
  observations: readonly ConversationRankerCalibrationObservation[],
  grid: readonly ConversationRankerThresholds[],
): Result<ConversationRankerThresholdReport[]> => {
  if (grid.length === 0) {
    return err(
      new StructuredError(
        "EVAL_CONVERSATION_RANKER_THRESHOLD_GRID",
        "Conversation-ranker threshold sweep requires a non-empty grid.",
      ),
    );
  }

  const reports: ConversationRankerThresholdReport[] = [];
  const seen = new Set<string>();
  for (const thresholds of grid) {
    const key = `${thresholds.minConfidence}:${thresholds.minMargin}`;
    if (seen.has(key)) {
      return err(
        new StructuredError(
          "EVAL_CONVERSATION_RANKER_THRESHOLD_DUPLICATE",
          "Conversation-ranker threshold sweep may not contain duplicate threshold pairs.",
        ),
      );
    }
    seen.add(key);
    const report = reportConversationRankerThreshold(
      observations,
      thresholds,
    );
    if (!report.ok) return report;
    reports.push(report.value);
  }
  return ok(reports);
};
