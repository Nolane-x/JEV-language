import {
  canonicalJson,
  createTraceId,
  type JsonValue,
} from "../../core-types/src/index.ts";
import { JdrError } from "./errors.ts";
import type {
  DecisionBatchRequest,
  DecisionBatchResponse,
  DecisionBudget,
  CalibrationHook,
  DecisionCache,
  DecisionProviderAdapter,
} from "./types.ts";

export class InMemoryDecisionCache implements DecisionCache {
  #values = new Map<string, DecisionBatchResponse>();

  get(key: string): DecisionBatchResponse | undefined {
    const value = this.#values.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  set(key: string, value: DecisionBatchResponse): void {
    this.#values.set(key, structuredClone(value));
  }
}

export class DecisionRuntime {
  readonly #adapter: DecisionProviderAdapter;
  readonly #cache?: DecisionCache;
  readonly #budget: DecisionBudget;
  readonly #calibration?: CalibrationHook;
  #requestsUsed = 0;

  constructor(input: {
    adapter: DecisionProviderAdapter;
    budget?: DecisionBudget;
    cache?: DecisionCache;
    calibration?: CalibrationHook;
  }) {
    this.#adapter = input.adapter;
    this.#budget = input.budget ?? { maxRequests: Number.POSITIVE_INFINITY };
    if (input.cache !== undefined) this.#cache = input.cache;
    if (input.calibration !== undefined) this.#calibration = input.calibration;
  }

  get requestsUsed(): number {
    return this.#requestsUsed;
  }

  async execute(
    request: DecisionBatchRequest,
    signal?: AbortSignal,
  ): Promise<DecisionBatchResponse> {
    const key = this.#cacheKey(request);
    const cached = this.#cache?.get(key);
    if (cached !== undefined) {
      return {
        ...cached,
        traceId: request.traceContext?.traceId ?? cached.traceId,
        source: "cache",
      };
    }

    if (this.#requestsUsed >= this.#budget.maxRequests) {
      throw new JdrError(
        "JDR_BUDGET_EXCEEDED",
        `Decision request budget exhausted at ${this.#budget.maxRequests} request(s).`,
      );
    }

    this.#requestsUsed += 1;
    const response = await this.#adapter.execute(
      {
        ...request,
        traceContext: request.traceContext ?? { traceId: createTraceId() },
      },
      signal,
    );
    const calibrated =
      this.#calibration === undefined
        ? response
        : {
            ...response,
            answers: response.answers.map((answer) => {
              const question = request.questions[answer.questionId];
              if (question === undefined) return answer;
              return this.#calibration?.calibrate({
                questionId: answer.questionId,
                question,
                answer,
              }) ?? answer;
            }),
          };
    this.#cache?.set(key, calibrated);
    return calibrated;
  }

  #cacheKey(request: DecisionBatchRequest): string {
    const payload: Record<string, JsonValue> = {
      modelProfile: request.modelProfile,
      state: request.state,
      questions: request.questions as unknown as JsonValue,
    };
    return canonicalJson(payload);
  }
}
