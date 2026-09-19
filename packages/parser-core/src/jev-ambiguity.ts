import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  DecisionBatchRequest,
  DecisionBatchResponse,
} from "../../decision-runtime/src/index.ts";
import type {
  AmbiguityClass,
  AmbiguityResolver,
  AmbiguitySet,
  AmbiguityResolutionContext,
} from "./index.ts";

export interface DecisionExecutor {
  execute(
    request: DecisionBatchRequest,
    signal?: AbortSignal,
  ): Promise<DecisionBatchResponse>;
}

export interface JevChoiceAmbiguityResolverOptions {
  executor: DecisionExecutor;
  requestId: string;
  modelProfile: string;
  questionId?: string;
  calibrationProfile?: string;
  minimumConfidence?: number;
  supported?: readonly AmbiguityClass[];
}

const candidateDescription = (
  ambiguity: AmbiguitySet,
  candidateId: string,
) => {
  const candidate = ambiguity.candidates.find(
    (entry) => entry.id === candidateId,
  );
  if (candidate === undefined) return null;
  return {
    id: candidate.id,
    rootNodeId: candidate.rootNodeId,
    ambiguityTags: candidate.ambiguityTags,
    deterministicScore: candidate.deterministicScore ?? null,
    notes: candidate.notes ?? [],
  };
};

export const createJevChoiceAmbiguityResolver = (
  options: JevChoiceAmbiguityResolverOptions,
): AmbiguityResolver => {
  if (options.requestId.trim() === "" || options.modelProfile.trim() === "") {
    throw new StructuredError(
      "PARSER_JEV_RESOLVER_CONFIG",
      "Jev ambiguity resolver requires non-empty requestId and modelProfile.",
    );
  }
  if (
    options.minimumConfidence !== undefined &&
    (!Number.isFinite(options.minimumConfidence) ||
      options.minimumConfidence < 0 ||
      options.minimumConfidence > 1)
  ) {
    throw new StructuredError(
      "PARSER_JEV_RESOLVER_CONFIDENCE",
      "minimumConfidence must be a finite probability in [0, 1].",
    );
  }

  const questionId = options.questionId ?? "select_candidate";
  const supported = options.supported ?? [
    "lexical",
    "syntactic",
    "reference",
    "scope",
    "semantic",
    "mixed",
    "unknown",
  ];

  return {
    id: "parser.jev-choice.v1",
    supported,
    kind: "external-probabilistic",
    async resolve(
      ambiguity: AmbiguitySet,
      context: AmbiguityResolutionContext,
    ): Promise<Result<string | undefined>> {
      if (ambiguity.candidates.length < 2) {
        return ok(ambiguity.candidates[0]?.id);
      }

      const optionsMap = Object.fromEntries(
        ambiguity.candidates.map((candidate) => [
          candidate.id,
          {
            description: candidateDescription(ambiguity, candidate.id),
            metadata: {
              ambiguityClass: ambiguity.classification,
            },
          },
        ]),
      );

      const request: DecisionBatchRequest = {
        id: options.requestId,
        modelProfile: options.modelProfile,
        state: {
          source: context.grounding.normalized.text,
          ambiguityClass: ambiguity.classification,
          candidateCount: ambiguity.candidates.length,
        },
        questions: {
          [questionId]: {
            type: "choice",
            instruction:
              "Select the candidate that best preserves the grounded source semantics. Abstention is handled by the caller when confidence is insufficient.",
            options: optionsMap,
            ...(options.calibrationProfile === undefined
              ? {}
              : { calibrationProfile: options.calibrationProfile }),
          },
        },
      };

      let response: DecisionBatchResponse;
      try {
        response = await options.executor.execute(request);
      } catch (error) {
        return err(
          error instanceof StructuredError
            ? error
            : new StructuredError(
                "PARSER_JEV_RESOLVER_FAILURE",
                error instanceof Error
                  ? error.message
                  : "Jev ambiguity resolver failed.",
              ),
        );
      }

      const answer = response.answers.find(
        (entry) => entry.questionId === questionId,
      );
      if (answer === undefined || answer.type !== "choice") {
        return err(
          new StructuredError(
            "PARSER_JEV_RESOLVER_ANSWER",
            "Jev ambiguity resolver did not return the expected Choice answer.",
          ),
        );
      }
      if (typeof answer.selected !== "string") {
        return err(
          new StructuredError(
            "PARSER_JEV_RESOLVER_SELECTION",
            "Jev Choice answer did not contain a candidate id.",
          ),
        );
      }

      const selected = ambiguity.candidates.find(
        (candidate) => candidate.id === answer.selected,
      );
      if (selected === undefined) {
        return err(
          new StructuredError(
            "PARSER_JEV_RESOLVER_SELECTION",
            `Jev selected unknown parse candidate ${answer.selected}.`,
          ),
        );
      }

      const probability = answer.probabilities[answer.selected];
      const confidence = answer.confidence ?? probability;
      if (
        options.minimumConfidence !== undefined &&
        (confidence === undefined ||
          !Number.isFinite(confidence) ||
          confidence < options.minimumConfidence)
      ) {
        return ok(undefined);
      }

      return ok(selected.id);
    },
  };
};
