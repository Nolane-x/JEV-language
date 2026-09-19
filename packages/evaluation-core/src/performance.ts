import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";

export interface PerformanceSample {
  operation: string;
  latencyMs: number;
  memoryBytes?: number;
  cacheHit?: boolean;
}

export interface PercentileSummary {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface PerformanceOperationSummary {
  operation: string;
  count: number;
  latencyMs: PercentileSummary;
  memoryBytes?: PercentileSummary;
  cacheHitRate?: number;
}

const finiteNonNegative = (value: number): boolean =>
  Number.isFinite(value) && value >= 0;

const percentile = (sorted: readonly number[], ratio: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
};

const summarizeNumbers = (
  values: readonly number[],
): PercentileSummary => {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    mean: sorted.length === 0 ? 0 : sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
};

export const summarizePerformance = (
  samples: readonly PerformanceSample[],
): Result<PerformanceOperationSummary[]> => {
  const groups = new Map<string, PerformanceSample[]>();

  for (const sample of samples) {
    if (
      sample.operation.trim() === "" ||
      !finiteNonNegative(sample.latencyMs) ||
      (sample.memoryBytes !== undefined &&
        !finiteNonNegative(sample.memoryBytes))
    ) {
      return err(
        new StructuredError(
          "EVAL_PERFORMANCE_SAMPLE",
          "Performance samples require a non-empty operation and finite non-negative measurements.",
        ),
      );
    }
    const group = groups.get(sample.operation) ?? [];
    group.push(structuredClone(sample));
    groups.set(sample.operation, group);
  }

  return ok(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([operation, group]) => {
        const memory = group
          .map((sample) => sample.memoryBytes)
          .filter((value): value is number => value !== undefined);
        const cacheObservations = group.filter(
          (sample) => sample.cacheHit !== undefined,
        );
        return {
          operation,
          count: group.length,
          latencyMs: summarizeNumbers(
            group.map((sample) => sample.latencyMs),
          ),
          ...(memory.length === 0
            ? {}
            : { memoryBytes: summarizeNumbers(memory) }),
          ...(cacheObservations.length === 0
            ? {}
            : {
                cacheHitRate:
                  cacheObservations.filter((sample) => sample.cacheHit === true)
                    .length / cacheObservations.length,
              }),
        };
      }),
  );
};

export class PerformanceRecorder {
  readonly #samples: PerformanceSample[] = [];
  readonly #now: () => number;
  readonly #memory?: () => number;

  constructor(input: {
    now?: () => number;
    memory?: () => number;
  } = {}) {
    this.#now = input.now ?? (() => Date.now());
    if (input.memory !== undefined) this.#memory = input.memory;
  }

  record(sample: PerformanceSample): Result<void> {
    const validated = summarizePerformance([sample]);
    if (!validated.ok) return err(validated.error);
    this.#samples.push(structuredClone(sample));
    return ok(undefined);
  }

  async measure<T>(
    operation: string,
    run: () => T | Promise<T>,
    input: { cacheHit?: boolean } = {},
  ): Promise<T> {
    const started = this.#now();
    try {
      return await run();
    } finally {
      const ended = this.#now();
      const sample: PerformanceSample = {
        operation,
        latencyMs: Math.max(0, ended - started),
        ...(this.#memory === undefined
          ? {}
          : { memoryBytes: Math.max(0, this.#memory()) }),
        ...(input.cacheHit === undefined
          ? {}
          : { cacheHit: input.cacheHit }),
      };
      const recorded = this.record(sample);
      if (!recorded.ok) throw recorded.error;
    }
  }

  samples(): PerformanceSample[] {
    return this.#samples.map((sample) => structuredClone(sample));
  }

  summary(): Result<PerformanceOperationSummary[]> {
    return summarizePerformance(this.#samples);
  }
}
