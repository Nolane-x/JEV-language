import { describe, expect, it } from "vitest";
import { createTraceId } from "../../packages/core-types/src/index.ts";
import {
  DecisionRuntime,
  InMemoryDecisionCache,
  JdrError,
  type DecisionBatchRequest,
  type DecisionBatchResponse,
  type DecisionProviderAdapter,
} from "../../packages/decision-runtime/src/index.ts";
import {
  PerformanceRecorder,
  buildReleaseConformanceReport,
  summarizePerformance,
} from "../../packages/evaluation-core/src/index.ts";

const request = (
  id: string,
  input: {
    state?: string;
    modelProfile?: string;
    instruction?: string;
    trace?: ReturnType<typeof createTraceId>;
  } = {},
): DecisionBatchRequest => ({
  id,
  modelProfile: input.modelProfile ?? "jev-test",
  state: input.state ?? "same-state",
  questions: {
    q: {
      type: "noul",
      instruction: input.instruction ?? "Does the condition hold?",
    },
  },
  ...(input.trace === undefined
    ? {}
    : { traceContext: { traceId: input.trace } }),
});

const responseFor = (
  req: DecisionBatchRequest,
): DecisionBatchResponse => ({
  requestId: req.id,
  answers: [
    {
      questionId: "q",
      type: "noul",
      selected: true,
      probabilities: { true: 0.75, false: 0.25 },
      model: req.modelProfile,
      latencyMs: 1,
    },
  ],
  model: req.modelProfile,
  usage: { inputTokens: 2, outputTokens: 1, requests: 1 },
  traceId: req.traceContext?.traceId ?? createTraceId(),
  source: "recorded",
});

class CountingAdapter implements DecisionProviderAdapter {
  readonly id = "hardening-counting";
  calls = 0;

  async execute(
    req: DecisionBatchRequest,
  ): Promise<DecisionBatchResponse> {
    this.calls += 1;
    return responseFor(req);
  }
}

class AbortAwareAdapter implements DecisionProviderAdapter {
  readonly id = "hardening-abort-aware";
  calls = 0;

  async execute(
    req: DecisionBatchRequest,
    signal?: AbortSignal,
  ): Promise<DecisionBatchResponse> {
    this.calls += 1;
    return await new Promise<DecisionBatchResponse>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new Error("adapter observed pre-abort"));
        return;
      }
      const onAbort = (): void => {
        signal?.removeEventListener("abort", onAbort);
        reject(new Error("adapter aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      void resolve;
      void req;
    });
  }
}

class CrashingAdapter implements DecisionProviderAdapter {
  readonly id = "hardening-crash";

  async execute(): Promise<DecisionBatchResponse> {
    throw new Error("synthetic provider crash");
  }
}

describe("T297-T300 performance/runtime/release hardening", () => {
  it("T297 records deterministic latency percentiles, memory observations and cache-hit rate", async () => {
    const ticks = [0, 10, 10, 30, 30, 60];
    let memory = 100;
    const recorder = new PerformanceRecorder({
      now: () => ticks.shift() ?? 60,
      memory: () => (memory += 10),
    });

    await recorder.measure("decision", () => "a", { cacheHit: false });
    await recorder.measure("decision", async () => "b", { cacheHit: true });
    await recorder.measure("decision", () => "c", { cacheHit: true });

    const summary = recorder.summary();
    expect(summary.ok).toBe(true);
    if (!summary.ok) return;
    expect(summary.value).toHaveLength(1);
    expect(summary.value[0]).toMatchObject({
      operation: "decision",
      count: 3,
      latencyMs: {
        min: 10,
        max: 30,
        mean: 20,
        p50: 20,
        p95: 30,
        p99: 30,
      },
      cacheHitRate: 2 / 3,
    });
    expect(summary.value[0]?.memoryBytes).toMatchObject({
      min: 110,
      max: 130,
    });

    expect(
      summarizePerformance([
        { operation: "invalid", latencyMs: -1 },
      ]).ok,
    ).toBe(false);
  });

  it("T298 preserves cache isolation and request identity while sharing semantic cache entries", async () => {
    const adapter = new CountingAdapter();
    const runtime = new DecisionRuntime({
      adapter,
      cache: new InMemoryDecisionCache(),
      budget: { maxRequests: 10 },
    });

    const first = await runtime.execute(
      request("cache-first", { trace: createTraceId() }),
    );
    expect(first.source).toBe("recorded");
    expect(adapter.calls).toBe(1);

    const secondTrace = createTraceId();
    const second = await runtime.execute(
      request("cache-second", { trace: secondTrace }),
    );
    expect(second.source).toBe("cache");
    expect(second.requestId).toBe("cache-second");
    expect(second.traceId).toBe(secondTrace);
    expect(adapter.calls).toBe(1);

    second.answers[0]!.probabilities.true = 0;
    const third = await runtime.execute(request("cache-third"));
    expect(third.answers[0]!.probabilities.true).toBe(0.75);
    expect(adapter.calls).toBe(1);

    await runtime.execute(request("cache-state", { state: "different" }));
    await runtime.execute(
      request("cache-model", { modelProfile: "jev-other" }),
    );
    await runtime.execute(
      request("cache-question", { instruction: "A different question?" }),
    );
    expect(adapter.calls).toBe(4);
  });

  it("T299 treats pre-abort and in-flight abort as cancellation and normalizes provider crashes", async () => {
    const preAdapter = new CountingAdapter();
    const preRuntime = new DecisionRuntime({
      adapter: preAdapter,
      budget: { maxRequests: 2 },
    });
    const preController = new AbortController();
    preController.abort();
    await expect(
      preRuntime.execute(request("pre-abort"), preController.signal),
    ).rejects.toMatchObject({ code: "JDR_CANCELLED" });
    expect(preAdapter.calls).toBe(0);

    const abortAdapter = new AbortAwareAdapter();
    const abortRuntime = new DecisionRuntime({
      adapter: abortAdapter,
      budget: { maxRequests: 2 },
    });
    const controller = new AbortController();
    const pending = abortRuntime.execute(
      request("in-flight-abort"),
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "JDR_CANCELLED",
    });
    expect(abortAdapter.calls).toBe(1);

    const crashRuntime = new DecisionRuntime({
      adapter: new CrashingAdapter(),
      budget: { maxRequests: 1 },
    });
    await expect(
      crashRuntime.execute(request("provider-crash")),
    ).rejects.toMatchObject({
      code: "JDR_PROVIDER_ERROR",
      message: "synthetic provider crash",
    });
  });

  it("T300 produces a passing report only from complete evidence and blocks unfinished research tasks", () => {
    const base = {
      releaseId: "bootstrap-hardening-v0.4",
      specVersion: "0.4-master-implementation-research-expanded",
      commit: "commit:verified",
      requiredTasks: [
        { id: "T297", status: "verified" as const },
        { id: "T298", status: "verified" as const },
        { id: "T299", status: "verified" as const },
        { id: "T300", status: "verified" as const },
      ],
      ci: {
        runId: "ci:hardening",
        conclusion: "success" as const,
        boundariesPassed: true,
        typecheckPassed: true,
        testFilesPassed: 50,
        testFilesTotal: 50,
        testsPassed: 420,
        testsTotal: 420,
      },
      zeroGenerative: {
        jevNative: true,
        generativeModelCalls: 0,
        violations: [],
      },
      knownFailures: [],
      blockedItems: [],
    };

    const passed = buildReleaseConformanceReport(base);
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    expect(passed.value.status).toBe("pass");
    expect(passed.value.evidenceDigest).toMatch(/^sha256:/u);

    const incomplete = buildReleaseConformanceReport({
      ...base,
      requiredTasks: [
        ...base.requiredTasks,
        { id: "T301+", status: "todo" as const },
      ],
    });
    expect(incomplete.ok).toBe(true);
    if (!incomplete.ok) return;
    expect(incomplete.value.status).toBe("blocked");
    expect(
      incomplete.value.blockers.map((blocker) => blocker.code),
    ).toContain("RELEASE_TASK_UNVERIFIED");
    expect(incomplete.value.blockers[0]?.refs).toContain("T301+");
  });
});
