import {
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  choice,
  noul,
  RateLimitError,
  score,
  TypeSafeClient,
  type EntryType,
  type Question,
} from "@typesafe-ai/sdk";
import {
  createTraceId,
  type JsonValue,
} from "../../core-types/src/index.ts";
import { JdrError } from "./errors.ts";
import type {
  DecisionAnswer,
  DecisionBatchRequest,
  DecisionBatchResponse,
  DecisionProviderAdapter,
} from "./types.ts";

const cloneResponse = (value: DecisionBatchResponse): DecisionBatchResponse =>
  structuredClone(value);

export class RecordedDecisionAdapter implements DecisionProviderAdapter {
  readonly id = "recorded";
  #responses = new Map<string, DecisionBatchResponse>();

  constructor(responses: DecisionBatchResponse[] = []) {
    for (const response of responses) {
      this.#responses.set(response.requestId, cloneResponse(response));
    }
  }

  record(response: DecisionBatchResponse): void {
    this.#responses.set(response.requestId, cloneResponse(response));
  }

  async execute(request: DecisionBatchRequest): Promise<DecisionBatchResponse> {
    const response = this.#responses.get(request.id);
    if (response === undefined) {
      throw new JdrError(
        "JDR_REPLAY_MISS",
        `No recorded decision response for request ${request.id}`,
      );
    }
    return { ...cloneResponse(response), source: "recorded" };
  }
}

export interface TypeSafeAdapterOptions {
  client?: TypeSafeClient;
}

export class TypeSafeDecisionAdapter implements DecisionProviderAdapter {
  readonly id = "typesafe";
  readonly #client: TypeSafeClient;

  constructor(options: TypeSafeAdapterOptions = {}) {
    this.#client =
      options.client ??
      new TypeSafeClient({
        retry: { maxRetries: 0 },
        logLevel: "warn",
      });
  }

  async execute(
    request: DecisionBatchRequest,
    signal?: AbortSignal,
  ): Promise<DecisionBatchResponse> {
    if (Object.keys(request.questions).length === 0) {
      throw new JdrError(
        "JDR_INVALID_REQUEST",
        "A decision batch must contain at least one question.",
      );
    }

    const providerQuestions: Record<string, Question> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      switch (question.type) {
        case "noul":
          providerQuestions[id] = noul(
            question.instruction as EntryType,
            question.criteria as
              | { true?: EntryType; false?: EntryType }
              | undefined,
          );
          break;
        case "choice":
          providerQuestions[id] = choice(
            question.instruction as EntryType,
            Object.fromEntries(
              Object.entries(question.options).map(([key, candidate]) => [
                key,
                candidate?.description ?? null,
              ]),
            ) as Record<string, EntryType>,
          );
          break;
        case "score":
          providerQuestions[id] = score(
            question.instruction as EntryType,
            question.levels as readonly [
              EntryType,
              EntryType,
              ...EntryType[],
            ],
          );
          break;
      }
    }

    const started = Date.now();
    try {
      const response = await this.#client.systemOne(
        {
          state: request.state as EntryType,
          questions: providerQuestions,
          model: request.modelProfile,
        },
        {
          signal,
          ...(request.deadlineMs === undefined
            ? {}
            : { timeout: request.deadlineMs }),
          retry: { maxRetries: 0 },
        },
      );
      const latencyMs = Date.now() - started;
      const answers: DecisionAnswer[] = [];

      for (const [questionId, rawAnswer] of Object.entries(response.answers)) {
        if (rawAnswer.type === "noul") {
          if (
            !Number.isFinite(rawAnswer.noul) ||
            rawAnswer.noul < 0 ||
            rawAnswer.noul > 1
          ) {
            throw new JdrError(
              "JDR_INVALID_PROBABILITY",
              `Invalid Noul probability for ${questionId}`,
            );
          }
          answers.push({
            questionId,
            type: "noul",
            selected: rawAnswer.noul >= 0.5,
            probabilities: {
              true: rawAnswer.noul,
              false: 1 - rawAnswer.noul,
            },
            raw: rawAnswer as unknown as JsonValue,
            model: response.model,
            latencyMs,
          });
        } else if (rawAnswer.type === "choice") {
          answers.push({
            questionId,
            type: "choice",
            selected: rawAnswer.choice,
            probabilities: { ...rawAnswer.probabilities },
            confidence: rawAnswer.confidence,
            raw: rawAnswer as unknown as JsonValue,
            model: response.model,
            latencyMs,
          });
        } else {
          answers.push({
            questionId,
            type: "score",
            selected: rawAnswer.score,
            probabilities: Object.fromEntries(
              Object.entries(rawAnswer.probabilities).map(([key, value]) => [
                key,
                value,
              ]),
            ),
            confidence: rawAnswer.confidence,
            raw: rawAnswer as unknown as JsonValue,
            model: response.model,
            latencyMs,
          });
        }
      }

      if (answers.length !== Object.keys(request.questions).length) {
        throw new JdrError(
          "JDR_MISSING_ANSWER",
          "Provider response did not contain exactly one answer per question.",
        );
      }

      return {
        requestId: request.id,
        answers,
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          requests: 1,
        },
        traceId: request.traceContext?.traceId ?? createTraceId(),
        source: "live",
      };
    } catch (error) {
      if (error instanceof JdrError) throw error;
      if (error instanceof AuthenticationError) {
        throw new JdrError("JDR_AUTH", "TypeSafe authentication failed.");
      }
      if (error instanceof RateLimitError) {
        throw new JdrError("JDR_RATE_LIMIT", "TypeSafe rate limit reached.");
      }
      if (error instanceof APITimeoutError) {
        throw new JdrError("JDR_TIMEOUT", "TypeSafe request timed out.");
      }
      if (error instanceof APIUserAbortError) {
        throw new JdrError("JDR_CANCELLED", "TypeSafe request was cancelled.");
      }
      if (error instanceof APIError) {
        throw new JdrError(
          "JDR_PROVIDER_ERROR",
          `TypeSafe API error: ${error.message}`,
        );
      }
      throw new JdrError(
        "JDR_PROVIDER_ERROR",
        error instanceof Error ? error.message : "Unknown provider error.",
      );
    }
  }
}
