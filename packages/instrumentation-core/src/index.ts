import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";

export interface OperationBudget {
  wallTimeMs?: number;
  maxJevCalls?: number;
  maxCandidates?: number;
  maxSearchStates?: number;
  maxMemoryBytes?: number;
}

export interface OperationCounters {
  jevCalls?: number;
  candidates?: number;
  searchStates?: number;
  memoryBytes?: number;
  [key: string]: number | undefined;
}

export interface OperationMeasurement {
  operation: string;
  status: "success" | "failure" | "budget-exceeded" | "cancelled";
  wallTimeMs: number;
  counters: OperationCounters;
  exceeded: string[];
  annotations?: Record<string, JsonValue>;
}

export interface OperationClock {
  now(): number;
}

const systemClock: OperationClock = {
  now: () => performance.now(),
};

const finiteNonNegative = (value: number | undefined): boolean =>
  value === undefined || (Number.isFinite(value) && value >= 0);

export const validateOperationBudget = (
  budget: OperationBudget,
): Result<OperationBudget> => {
  if (
    !finiteNonNegative(budget.wallTimeMs) ||
    !finiteNonNegative(budget.maxJevCalls) ||
    !finiteNonNegative(budget.maxCandidates) ||
    !finiteNonNegative(budget.maxSearchStates) ||
    !finiteNonNegative(budget.maxMemoryBytes)
  ) {
    return err(
      new StructuredError(
        "INSTRUMENTATION_INVALID_BUDGET",
        "Performance budgets must be finite non-negative numbers.",
      ),
    );
  }
  return ok(structuredClone(budget));
};

export const budgetViolations = (
  measurement: Pick<OperationMeasurement, "wallTimeMs" | "counters">,
  budget: OperationBudget,
): string[] => {
  const violations: string[] = [];
  if (
    budget.wallTimeMs !== undefined &&
    measurement.wallTimeMs > budget.wallTimeMs
  ) {
    violations.push("wallTimeMs");
  }
  if (
    budget.maxJevCalls !== undefined &&
    (measurement.counters.jevCalls ?? 0) > budget.maxJevCalls
  ) {
    violations.push("maxJevCalls");
  }
  if (
    budget.maxCandidates !== undefined &&
    (measurement.counters.candidates ?? 0) > budget.maxCandidates
  ) {
    violations.push("maxCandidates");
  }
  if (
    budget.maxSearchStates !== undefined &&
    (measurement.counters.searchStates ?? 0) > budget.maxSearchStates
  ) {
    violations.push("maxSearchStates");
  }
  if (
    budget.maxMemoryBytes !== undefined &&
    (measurement.counters.memoryBytes ?? 0) > budget.maxMemoryBytes
  ) {
    violations.push("maxMemoryBytes");
  }
  return violations;
};

export interface MeasureOperationContext {
  increment(name: string, amount?: number): void;
  set(name: string, value: number): void;
  counters(): OperationCounters;
}

const createContext = (): MeasureOperationContext => {
  const values: OperationCounters = {};
  return {
    increment(name, amount = 1) {
      if (!Number.isFinite(amount) || amount < 0) {
        throw new StructuredError(
          "INSTRUMENTATION_INVALID_COUNTER",
          "Instrumentation counter increments must be finite and non-negative.",
        );
      }
      values[name] = (values[name] ?? 0) + amount;
    },
    set(name, value) {
      if (!Number.isFinite(value) || value < 0) {
        throw new StructuredError(
          "INSTRUMENTATION_INVALID_COUNTER",
          "Instrumentation counters must be finite and non-negative.",
        );
      }
      values[name] = value;
    },
    counters: () => structuredClone(values),
  };
};

export const measureOperation = async <T>(input: {
  operation: string;
  budget?: OperationBudget;
  clock?: OperationClock;
  signal?: AbortSignal;
  annotations?: Record<string, JsonValue>;
  run(context: MeasureOperationContext): T | Promise<T>;
}): Promise<
  | {
      result: T;
      measurement: OperationMeasurement;
    }
  | {
      error: unknown;
      measurement: OperationMeasurement;
    }
> => {
  if (input.operation.trim() === "") {
    throw new StructuredError(
      "INSTRUMENTATION_OPERATION_ID",
      "Operation instrumentation requires a non-empty operation id.",
    );
  }
  const budget = input.budget ?? {};
  const validBudget = validateOperationBudget(budget);
  if (!validBudget.ok) throw validBudget.error;

  const clock = input.clock ?? systemClock;
  const started = clock.now();
  const context = createContext();

  if (input.signal?.aborted === true) {
    return {
      error: new StructuredError(
        "INSTRUMENTATION_CANCELLED",
        "Operation was cancelled before execution.",
      ),
      measurement: {
        operation: input.operation,
        status: "cancelled",
        wallTimeMs: Math.max(0, clock.now() - started),
        counters: context.counters(),
        exceeded: [],
        ...(input.annotations === undefined
          ? {}
          : { annotations: structuredClone(input.annotations) }),
      },
    };
  }

  try {
    const result = await input.run(context);
    const wallTimeMs = Math.max(0, clock.now() - started);
    const counters = context.counters();
    const exceeded = budgetViolations({ wallTimeMs, counters }, budget);
    return {
      result,
      measurement: {
        operation: input.operation,
        status: exceeded.length === 0 ? "success" : "budget-exceeded",
        wallTimeMs,
        counters,
        exceeded,
        ...(input.annotations === undefined
          ? {}
          : { annotations: structuredClone(input.annotations) }),
      },
    };
  } catch (error) {
    const wallTimeMs = Math.max(0, clock.now() - started);
    const counters = context.counters();
    const exceeded = budgetViolations({ wallTimeMs, counters }, budget);
    return {
      error,
      measurement: {
        operation: input.operation,
        status:
          input.signal?.aborted === true
            ? "cancelled"
            : exceeded.length === 0
              ? "failure"
              : "budget-exceeded",
        wallTimeMs,
        counters,
        exceeded,
        ...(input.annotations === undefined
          ? {}
          : { annotations: structuredClone(input.annotations) }),
      },
    };
  }
};
