import { describe, expect, it } from "vitest";
import { createTraceId } from "../../packages/core-types/src/index.ts";
import {
  DecisionRuntime,
  RecordedDecisionAdapter,
  type CalibrationHook,
  type DecisionBatchResponse,
} from "../../packages/decision-runtime/src/index.ts";
import {
  DecisionPackRegistry,
  assessDecisionPackQuality,
  loadDecisionPack,
  sentinelDecisionPack,
} from "../../packages/decision-packs/src/index.ts";

describe("M3 deterministic runtime hardening", () => {
  it("loads versioned decision packs without duplicates", () => {
    const registry = new DecisionPackRegistry();
    expect(registry.register(sentinelDecisionPack).ok).toBe(true);
    expect(registry.register(sentinelDecisionPack).ok).toBe(false);
    expect(
      registry.get(sentinelDecisionPack.id, sentinelDecisionPack.version)?.id,
    ).toBe(sentinelDecisionPack.id);
  });

  it("applies an explicit calibration hook after provider normalization", async () => {
    const fixture: DecisionBatchResponse = {
      requestId: "calibration-fixture",
      answers: [
        {
          questionId: "q",
          type: "noul",
          selected: true,
          probabilities: { true: 0.8, false: 0.2 },
          model: "recorded",
          latencyMs: 1,
        },
      ],
      model: "recorded",
      usage: { inputTokens: 4, outputTokens: 1, requests: 1 },
      traceId: createTraceId(),
      source: "recorded",
    };
    const calibration: CalibrationHook = {
      id: "test-calibration",
      calibrate({ answer }) {
        return {
          ...answer,
          probabilities: { true: 0.7, false: 0.3 },
        };
      },
    };
    const runtime = new DecisionRuntime({
      adapter: new RecordedDecisionAdapter([fixture]),
      calibration,
      budget: { maxRequests: 1 },
    });
    const result = await runtime.execute({
      id: "calibration-fixture",
      modelProfile: "jev-latest",
      state: "state",
      questions: {
        q: { type: "noul", instruction: "Does the condition hold?" },
      },
    });
    expect(result.answers[0]?.probabilities.true).toBe(0.7);
  });

  it("rejects malformed runtime decision-pack manifests", () => {
    const loaded = loadDecisionPack({
      id: "broken",
      version: "1.0.0",
      maturity: "draft",
    });
    expect(loaded.ok).toBe(false);
  });

  it("requires evidence before candidate or production maturity claims", () => {
    const candidate = {
      ...sentinelDecisionPack,
      maturity: "candidate" as const,
    };
    const candidateQuality = assessDecisionPackQuality(candidate);
    expect(candidateQuality.readyForCandidate).toBe(false);
    expect(candidateQuality.missingCandidateEvidence).toContain("fixtures");

    const result = loadDecisionPack(candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DPACK_CANDIDATE_GATE");
    }
  });

  it("rejects non-semver decision pack versions", () => {
    const result = loadDecisionPack({
      ...sentinelDecisionPack,
      version: "latest",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DPACK_INVALID_VERSION");
    }
  });
});
