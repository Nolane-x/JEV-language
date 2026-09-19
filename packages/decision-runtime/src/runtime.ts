import {
  canonicalJson,
  createTraceId,
  type JsonValue,
} from "../../core-types/src/index.ts";
import { JdrError } from "./errors.ts";
import { validateDecisionBatchResponse } from "./validation.ts";
import type {
  CalibrationHook,
  DecisionBatchRequest,
  DecisionBatchResponse,
  DecisionBudget,
  DecisionBudgetUsage,
  DecisionCache,
  DecisionProviderAdapter,
  DecisionRetryPolicy,
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
  readonly #calibration?: CalibrationHook;
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
    calibration?: CalibrationHook;
    traceSink?: DecisionTraceSink;
  }) {
    this.#adapter = input.adapter;
    this.#budget = input.budget ?? { maxRequests: Number.POSITIVE_INFINITY };
    if (input.cache !== undefined) this.#cache = input.cache;
    if (input.calibration !== undefined) this.#calibration = input.calibration;
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
    this.#assertNotCancelled(signal);
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
        requestId: request.id,
        traceId,
        source: "cache",
      };
    }

    const retry = this.#normalizeRetryPolicy(request.retryPolicy);
    let lastError: JdrError | undefined;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      this.#assertNotCancelled(signal);
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
        this.#assertNotCancelled(signal);
        const validated = validateDecisionBatchResponse(
          requestWithTrace,
          response,
        );
        if (!validated.ok) throw validated.error;

        this.#usage.inputTokens += validated.value.usage.inputTokens;
        this.#usage.outputTokens += validated.value.usage.outputTokens;
        this.#assertTokenBudget();

        const calibrated =
          this.#calibration === undefined
            ? validated.value
            : {
                ...validated.value,
                answers: validated.value.answers.map((answer) => {
                  const question = request.questions[answer.questionId];
                  if (question === undefined) return answer;
                  return this.#calibration?.calibrate({
                    questionId: answer.questionId,
                    question,
                    answer,
                  }) ?? answer;
                }),
              };

        const normalized: DecisionBatchResponse = {
          ...calibrated,
          traceId,
        };
        const calibratedValidation = validateDecisionBatchResponse(
          requestWithTrace,
          normalized,
        );
        if (!calibratedValidation.ok) throw calibratedValidation.error;

        this.#cache?.set(key, normalized);
        this.#emit({
          kind: "request-complete",
          requestId: request.id,
          traceId,
          adapterId: this.#adapter.id,
          usage: validated.value.usage,
        });
        return normalized;
      } catch (error) {
        const normalizedError =
          signal?.aborted === true
            ? new JdrError(
                "JDR_CANCELLED",
                "Decision execution was cancelled.",
              )
            : error instanceof JdrError
              ? error
              : new JdrError(
                  "JDR_PROVIDER_ERROR",
                  error instanceof Error ? error.message : "Unknown provider error.",
                );
        lastError = normalizedError;
        this.#emit({
          kind: "request-failed",
          requestId: request.id,
          traceId,
          adapterId: this.#adapter.id,
          errorCode: normalizedError.code,
        });

        const canRetry =
          attempt < retry.maxAttempts &&
          retry.retryableCodes.includes(normalizedError.code);
        if (!canRetry) throw normalizedError;
        await this.#waitForRetryBackoff(retry.backoffMs ?? 0, signal);
      }
    }

    throw (
      lastError ??
      new JdrError(
        "JDR_PROVIDER_ERROR",
        "Decision execution ended without a response or structured error.",
      )
    );
  }

  #normalizeRetryPolicy(
    policy: DecisionRetryPolicy | undefined,
  ): DecisionRetryPolicy {
    const resolved: DecisionRetryPolicy = policy ?? {
      maxAttempts: 1,
      retryableCodes: [
        "JDR_TIMEOUT",
        "JDR_RATE_LIMIT",
        "JDR_PROVIDER_ERROR",
        "JDR_SCHEMA_MISMATCH",
      ],
      backoffMs: 0,
    };
    if (
      !Number.isInteger(resolved.maxAttempts) ||
      resolved.maxAttempts < 1 ||
      resolved.maxAttempts > 10 ||
      (resolved.backoffMs !== undefined &&
        (!Number.isFinite(resolved.backoffMs) || resolved.backoffMs < 0))
    ) {
      throw new JdrError(
        "JDR_INVALID_REQUEST",
        "Retry policy requires maxAttempts in [1, 10] and non-negative backoffMs.",
      );
    }
    return {
      maxAttempts: resolved.maxAttempts,
      retryableCodes: [...new Set(resolved.retryableCodes)],
      ...(resolved.backoffMs === undefined
        ? {}
        : { backoffMs: resolved.backoffMs }),
    };
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

  #assertNotCancelled(signal?: AbortSignal): void {
    if (signal?.aborted === true) {
      throw new JdrError(
        "JDR_CANCELLED",
        "Decision execution was cancelled.",
      );
    }
  }

  async #waitForRetryBackoff(
    backoffMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    this.#assertNotCancelled(signal);
    if (backoffMs <= 0) return;

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(
          new JdrError(
            "JDR_CANCELLED",
            "Decision retry backoff was cancelled.",
          ),
        );
        return;
      }

      const onAbort = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(
          new JdrError(
            "JDR_CANCELLED",
            "Decision retry backoff was cancelled.",
          ),
        );
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, backoffMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
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
