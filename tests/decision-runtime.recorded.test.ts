import { describe, expect, it } from "vitest";
import { createTraceId } from "../packages/core-types/src/index.ts";
import {
  DecisionRuntime,
  InMemoryDecisionCache,
  JdrError,
  RecordedDecisionAdapter,
  type DecisionBatchRequest,
  type DecisionBatchResponse,
} from "../packages/decision-runtime/src/index.ts";

const request: DecisionBatchRequest = {
  id: "fixture-1",
  modelProfile: "jev-latest",
  state: { text: "The service must not delete more than 3 files." },
  questions: {
    restricted: {
      type: "noul",
      instruction: "Is deletion above three files prohibited?",
    },
  },
};

const response: DecisionBatchResponse = {
  requestId: "fixture-1",
  answers: [
    {
      questionId: "restricted",
      type: "noul",
      selected: true,
      probabilities: { true: 0.97, false: 0.03 },
      model: "recorded:jev",
      latencyMs: 4,
    },
  ],
  model: "recorded:jev",
  usage: { inputTokens: 12, outputTokens: 2, requests: 1 },
  traceId: createTraceId(),
  source: "recorded",
};

describe("recorded JDR", () => {
  it("replays deterministic responses without live calls", async () => {
    const runtime = new DecisionRuntime({
      adapter: new RecordedDecisionAdapter([response]),
      budget: { maxRequests: 1 },
    });
    const result = await runtime.execute(request);
    expect(result.source).toBe("recorded");
    expect(result.answers[0]?.selected).toBe(true);
    expect(runtime.requestsUsed).toBe(1);
  });

  it("cache prevents duplicate provider budget use", async () => {
    const runtime = new DecisionRuntime({
      adapter: new RecordedDecisionAdapter([response]),
      cache: new InMemoryDecisionCache(),
      budget: { maxRequests: 1 },
    });
    await runtime.execute(request);
    const second = await runtime.execute(request);
    expect(second.source).toBe("cache");
    expect(runtime.requestsUsed).toBe(1);
  });

  it("enforces a hard request budget", async () => {
    const runtime = new DecisionRuntime({
      adapter: new RecordedDecisionAdapter([response]),
      budget: { maxRequests: 0 },
    });
    await expect(runtime.execute(request)).rejects.toBeInstanceOf(JdrError);
  });
});
