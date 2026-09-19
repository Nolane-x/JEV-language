import { describe, expect, it } from "vitest";
import { createTraceId } from "../packages/core-types/src/index.ts";
import {
  DecisionRuntime,
  RecordedDecisionAdapter,
  type DecisionBatchResponse,
} from "../packages/decision-runtime/src/index.ts";
import { resolveReference } from "../packages/grounding/src/index.ts";

describe("second vertical slice: recorded Jev reference choice", () => {
  it("selects a compatible discourse referent without a live call", async () => {
    const fixture: DecisionBatchResponse = {
      requestId: "reference-1",
      answers: [
        {
          questionId: "referent",
          type: "choice",
          selected: "candidate_1",
          probabilities: { candidate_0: 0.08, candidate_1: 0.92 },
          confidence: 0.84,
          model: "recorded:jev",
          latencyMs: 3,
        },
      ],
      model: "recorded:jev",
      usage: { inputTokens: 18, outputTokens: 3, requests: 1 },
      traceId: createTraceId(),
      source: "recorded",
    };
    const runtime = new DecisionRuntime({
      adapter: new RecordedDecisionAdapter([fixture]),
      budget: { maxRequests: 1 },
    });
    const result = await resolveReference({
      requestId: "reference-1",
      mention: "that file",
      candidates: [
        {
          id: "entity:readme",
          label: "README.md",
          semanticType: "file",
          recencyRank: 2,
        },
        {
          id: "entity:config",
          label: "config.ts",
          semanticType: "file",
          recencyRank: 1,
        },
      ],
      runtime,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolved).toBe("entity:readme");
    expect(result.value.source).toBe("jev");
    expect(runtime.requestsUsed).toBe(1);
  });

  it("preserves ambiguity below the configured confidence threshold", async () => {
    const fixture: DecisionBatchResponse = {
      requestId: "reference-low",
      answers: [
        {
          questionId: "referent",
          type: "choice",
          selected: "candidate_0",
          probabilities: { candidate_0: 0.51, candidate_1: 0.49 },
          confidence: 0.02,
          model: "recorded:jev",
          latencyMs: 3,
        },
      ],
      model: "recorded:jev",
      usage: { inputTokens: 18, outputTokens: 3, requests: 1 },
      traceId: createTraceId(),
      source: "recorded",
    };
    const runtime = new DecisionRuntime({
      adapter: new RecordedDecisionAdapter([fixture]),
      budget: { maxRequests: 1 },
    });
    const result = await resolveReference({
      requestId: "reference-low",
      mention: "it",
      candidates: [
        {
          id: "entity:a",
          label: "A",
          semanticType: "file",
          recencyRank: 1,
        },
        {
          id: "entity:b",
          label: "B",
          semanticType: "file",
          recencyRank: 2,
        },
      ],
      runtime,
      minimumConfidence: 0.65,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolved).toBeUndefined();
    expect(result.value.source).toBe("unresolved");
  });
});
