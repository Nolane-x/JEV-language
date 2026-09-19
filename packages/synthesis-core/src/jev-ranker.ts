import {
  StructuredError,
  type JsonValue,
} from "../../core-types/src/index.ts";
import type {
  DecisionBatchRequest,
  DecisionBatchResponse,
} from "../../decision-runtime/src/index.ts";
import type {
  CandidateId,
  CandidateRanker,
  CandidateRankingRequest,
} from "./model.ts";

export interface DecisionExecutor {
  execute(
    request: DecisionBatchRequest,
    signal?: AbortSignal,
  ): Promise<DecisionBatchResponse>;
}

export interface JevCandidateRankerOptions {
  executor: DecisionExecutor;
  modelProfile: string;
  requestPrefix?: string;
  minimumConfidence?: number;
}

const candidateDescription = (
  candidate: CandidateRankingRequest["candidates"][number],
): JsonValue => ({
  generator: candidate.provenance.generatorId,
  sourceKind: candidate.provenance.kind,
  heuristicCost: candidate.heuristicCost,
  resultType: candidate.resultType as unknown as JsonValue,
  effects: candidate.effects as unknown as JsonValue,
  obligations: candidate.proofObligations.map((entry) => ({
    kind: entry.kind,
    description: entry.description,
  })),
});

export class JevChoiceCandidateRanker implements CandidateRanker {
  readonly id = "synthesis.jev-choice-ranker.v1";

  constructor(readonly options: JevCandidateRankerOptions) {
    if (options.modelProfile.trim() === "") {
      throw new StructuredError(
        "SYNTH_RANKER_MODEL_PROFILE",
        "Jev candidate ranker requires a non-empty model profile.",
      );
    }
    if (
      options.minimumConfidence !== undefined &&
      (!Number.isFinite(options.minimumConfidence) ||
        options.minimumConfidence < 0 ||
        options.minimumConfidence > 1)
    ) {
      throw new StructuredError(
        "SYNTH_RANKER_CONFIDENCE",
        "minimumConfidence must be in [0, 1].",
      );
    }
  }

  async rank(request: CandidateRankingRequest): Promise<CandidateId[]> {
    if (request.candidates.length < 2) {
      return request.candidates.map((candidate) => candidate.id);
    }

    const questionId = "rank_expansion";
    const decisionRequest: DecisionBatchRequest = {
      id: `${this.options.requestPrefix ?? "synth-rank"}:${request.problemId}:${request.holeId}`,
      modelProfile: this.options.modelProfile,
      state: {
        problemId: request.problemId,
        holeId: request.holeId,
        requirements: request.requirements,
        candidateCount: request.candidates.length,
      },
      questions: {
        [questionId]: {
          type: "choice",
          instruction: {
            task:
              "Choose the already-valid PIR expansion candidate that best satisfies the bounded synthesis requirements. Do not invent new candidates.",
            requirements: request.requirements,
          },
          options: Object.fromEntries(
            request.candidates.map((candidate) => [
              candidate.id,
              {
                description: candidateDescription(candidate),
              },
            ]),
          ),
        },
      },
    };

    const response = await this.options.executor.execute(decisionRequest);
    const answer = response.answers.find(
      (entry) => entry.questionId === questionId,
    );
    if (
      answer === undefined ||
      answer.type !== "choice" ||
      typeof answer.selected !== "string"
    ) {
      throw new StructuredError(
        "SYNTH_RANKER_ANSWER",
        "Jev ranker did not return the expected bounded Choice answer.",
      );
    }

    const ids = new Set(request.candidates.map((candidate) => candidate.id));
    if (!ids.has(answer.selected)) {
      throw new StructuredError(
        "SYNTH_RANKER_OUT_OF_SET",
        `Jev selected candidate outside the supplied set: ${answer.selected}.`,
      );
    }

    const probability = answer.probabilities[answer.selected];
    const confidence = answer.confidence ?? probability;
    const threshold = this.options.minimumConfidence;
    if (
      threshold !== undefined &&
      (confidence === undefined ||
        !Number.isFinite(confidence) ||
        confidence < threshold)
    ) {
      return request.candidates
        .map((candidate) => candidate.id)
        .sort();
    }

    return [
      answer.selected,
      ...request.candidates
        .map((candidate) => candidate.id)
        .filter((id) => id !== answer.selected)
        .sort(),
    ];
  }
}
