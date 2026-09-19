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
  DecisionBudgetUsage,
  DecisionCache,
  DecisionProviderAdapter,
  DecisionTraceEvent,
  DecisionTraceSink,
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
  readonly #traceSink?: DecisionTraceSink;
  #usage: DecisionBudgetUsage = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  constructor(input: {
    adapter: DecisionProviderAdapter;
    budget?: DecisionBudget;
    cache?: DecisionCache;
    traceSink?: DecisionTraceSink;
  }) {
    this.#adapter = input.adapter;
    this.#budget = input.budget ?? { maxRequests: Number.POSITIVE_INFINITY };
    if (input.cache !== undefined) this.#cache = input.cache;
    if (input.traceSink !== undefined) this.#traceSink = input.traceSink;
  }

  get requestsUsed(): number {
    return this.#usage.requests;
  }

  get budgetUsage(): DecisionBudgetUsage {
    return { ...this.#usage };
  }

  async execute(
    request: DecisionBatchRequest,
    signal?: AbortSignal,
  ): Promise<DecisionBatchResponse> {
    const traceId = request.traceContext?.traceId ?? createTraceId();
    const requestWithTrace: DecisionBatchRequest = {
      ...request,
      traceContext: {
        traceId,
        ...(request.traceContext?.parentSpan === undefined
          ? {}
          : { parentSpan: request.traceContext.parentSpan }),
      },
    };

    const key = this.#cacheKey(request);
    const cached = this.#cache?.get(key);
    if (cached !== undefined) {
      this.#emit({
        kind: "cache-hit",
        requestId: request.id,
        traceId,
        adapterId: this.#adapter.id,
      });
      return {
        ...cached,
        traceId,
        source: "cache",
      };
    }

    this.#assertBudgetAvailable();

    this.#usage.requests += 1;
    this.#emit({
      kind: "request-start",
      requestId: request.id,
      traceId,
      adapterId: this.#adapter.id,
      requestNumber: this.#usage.requests,
    });

    try {
      const response = await this.#adapter.execute(requestWithTrace, signal);
      this.#usage.inputTokens += response.usage.inputTokens;
      this.#usage.outputTokens += response.usage.outputTokens;
      this.#assertTokenBudget();

      const normalized: DecisionBatchResponse = {
        ...response,
        traceId,
      };
      this.#cache?.set(key, normalized);
      this.#emit({
        kind: "request-complete",
        requestId: request.id,
        traceId,
        adapterId: this.#adapter.id,
        usage: response.usage,
      });
      return normalized;
    } catch (error) {
      this.#emit({
        kind: "request-failed",
        requestId: request.id,
        traceId,
        adapterId: this.#adapter.id,
        errorCode:
          error instanceof JdrError ? error.code : "JDR_PROVIDER_ERROR",
      });
      throw error;
    }
  }

  #assertBudgetAvailable(): void {
    if (this.#usage.requests >= this.#budget.maxRequests) {
      throw new JdrError(
        "JDR_BUDGET_EXCEEDED",
        `Decision request budget exhausted at ${this.#budget.maxRequests} request(s).`,
      );
    }

    const totalTokens = this.#usage.inputTokens + this.#usage.outputTokens;
    if (
      (this.#budget.maxInputTokens !== undefined &&
        this.#usage.inputTokens >= this.#budget.maxInputTokens) ||
      (this.#budget.maxOutputTokens !== undefined &&
        this.#usage.outputTokens >= this.#budget.maxOutputTokens) ||
      (this.#budget.maxTotalTokens !== undefined &&
        totalTokens >= this.#budget.maxTotalTokens)
    ) {
      throw new JdrError(
        "JDR_BUDGET_EXCEEDED",
        "Decision token budget is already exhausted; refusing another provider request.",
      );
    }
  }

  #assertTokenBudget(): void {
    const totalTokens = this.#usage.inputTokens + this.#usage.outputTokens;
    if (
      (this.#budget.maxInputTokens !== undefined &&
        this.#usage.inputTokens > this.#budget.maxInputTokens) ||
      (this.#budget.maxOutputTokens !== undefined &&
        this.#usage.outputTokens > this.#budget.maxOutputTokens) ||
      (this.#budget.maxTotalTokens !== undefined &&
        totalTokens > this.#budget.maxTotalTokens)
    ) {
      throw new JdrError(
        "JDR_BUDGET_EXCEEDED",
        "Provider response exceeded the configured token budget.",
        {
          requests: this.#usage.requests,
          inputTokens: this.#usage.inputTokens,
          outputTokens: this.#usage.outputTokens,
        },
      );
    }
  }

  #emit(event: DecisionTraceEvent): void {
    this.#traceSink?.(structuredClone(event));
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
