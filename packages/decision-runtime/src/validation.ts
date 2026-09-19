import {
  err,
  ok,
  type Result,
} from "../../core-types/src/index.ts";
import { JdrError } from "./errors.ts";
import type {
  DecisionAnswer,
  DecisionBatchRequest,
  DecisionBatchResponse,
} from "./types.ts";

const validProbabilityMap = (
  probabilities: Record<string, number>,
): boolean =>
  Object.values(probabilities).every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );

const validateAnswer = (
  request: DecisionBatchRequest,
  answer: DecisionAnswer,
): Result<void> => {
  const question = request.questions[answer.questionId];
  if (question === undefined) {
    return err(
      new JdrError(
        "JDR_SCHEMA_MISMATCH",
        `Provider returned an answer for unknown question ${answer.questionId}.`,
      ),
    );
  }
  if (answer.type !== question.type) {
    return err(
      new JdrError(
        "JDR_SCHEMA_MISMATCH",
        `Answer type ${answer.type} does not match question type ${question.type} for ${answer.questionId}.`,
      ),
    );
  }
  if (!validProbabilityMap(answer.probabilities)) {
    return err(
      new JdrError(
        "JDR_INVALID_PROBABILITY",
        `Answer probabilities for ${answer.questionId} must be finite values in [0, 1].`,
      ),
    );
  }

  if (question.type === "noul") {
    if (typeof answer.selected !== "boolean") {
      return err(
        new JdrError(
          "JDR_SCHEMA_MISMATCH",
          `Noul answer ${answer.questionId} must select a boolean.`,
        ),
      );
    }
    return ok(undefined);
  }

  if (question.type === "choice") {
    if (
      typeof answer.selected !== "string" ||
      !(answer.selected in question.options)
    ) {
      return err(
        new JdrError(
          "JDR_SCHEMA_MISMATCH",
          `Choice answer ${answer.questionId} selected an option outside the supplied candidate set.`,
        ),
      );
    }
    return ok(undefined);
  }

  if (
    typeof answer.selected !== "number" ||
    !Number.isFinite(answer.selected)
  ) {
    return err(
      new JdrError(
        "JDR_SCHEMA_MISMATCH",
        `Score answer ${answer.questionId} must select a finite numeric score.`,
      ),
    );
  }
  return ok(undefined);
};

export const validateDecisionBatchResponse = (
  request: DecisionBatchRequest,
  response: DecisionBatchResponse,
): Result<DecisionBatchResponse> => {
  if (response.requestId !== request.id) {
    return err(
      new JdrError(
        "JDR_SCHEMA_MISMATCH",
        "Provider response requestId does not match the submitted request.",
      ),
    );
  }
  if (response.model.trim() === "") {
    return err(
      new JdrError(
        "JDR_SCHEMA_MISMATCH",
        "Provider response model identifier must be non-empty.",
      ),
    );
  }
  if (
    !Number.isInteger(response.usage.requests) ||
    response.usage.requests < 0 ||
    !Number.isInteger(response.usage.inputTokens) ||
    response.usage.inputTokens < 0 ||
    !Number.isInteger(response.usage.outputTokens) ||
    response.usage.outputTokens < 0
  ) {
    return err(
      new JdrError(
        "JDR_SCHEMA_MISMATCH",
        "Provider response usage counters must be non-negative integers.",
      ),
    );
  }

  const expected = Object.keys(request.questions);
  if (response.answers.length !== expected.length) {
    return err(
      new JdrError(
        "JDR_MISSING_ANSWER",
        "Provider response must contain exactly one answer per submitted question.",
      ),
    );
  }

  const seen = new Set<string>();
  for (const answer of response.answers) {
    if (seen.has(answer.questionId)) {
      return err(
        new JdrError(
          "JDR_SCHEMA_MISMATCH",
          `Provider returned duplicate answer for ${answer.questionId}.`,
        ),
      );
    }
    seen.add(answer.questionId);
    const valid = validateAnswer(request, answer);
    if (!valid.ok) return valid;
  }

  for (const questionId of expected) {
    if (!seen.has(questionId)) {
      return err(
        new JdrError(
          "JDR_MISSING_ANSWER",
          `Provider response omitted question ${questionId}.`,
        ),
      );
    }
  }

  return ok(structuredClone(response));
};
