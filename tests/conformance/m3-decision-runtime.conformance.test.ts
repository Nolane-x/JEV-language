import { describe, expect, it } from "vitest";
import {
  DecisionRuntime,
  JdrError,
  RecordedDecisionAdapter,
  validateDecisionBatchResponse,
  type DecisionBatchRequest,
  type DecisionBatchResponse,
  type DecisionProviderAdapter,
} from "../../packages/decision-runtime/src/index.ts";
import {
  CalibrationProfileRegistry,
  evaluateConfidence,
  loadCalibrationProfile,
  scheduleDecisionDag,
  validateDecisionPack,
  type DecisionPackManifest,
} from "../../packages/decision-packs/src/index.ts";
import { createTraceId } from "../../packages/core-types/src/index.ts";

const request: DecisionBatchRequest = {
  id: "m3:request",
  modelProfile: "jev-test",
  state: { subject: "candidate" },
  questions: {
    choose: {
      type: "choice",
      instruction: "Choose the semantically valid candidate.",
      options: {
        a: { description: "candidate A" },
        b: { description: "candidate B" },
      },
    },
  },
};

const response = (
  selected = "a",
): DecisionBatchResponse => ({
  requestId: request.id,
  answers: [
    {
      questionId: "choose",
      type: "choice",
      selected,
      probabilities: { a: 0.8, b: 0.2 },
      confidence: 0.8,
      model: "recorded:jev",
      latencyMs: 1,
    },
  ],
  model: "recorded:jev",
  usage: { inputTokens: 5, outputTokens: 1, requests: 1 },
  traceId: createTraceId(),
  source: "recorded",
});

describe("M3 Jev Decision Runtime conformance", () => {
  it("validates provider responses at the shared runtime boundary", () => {
    expect(validateDecisionBatchResponse(request, response()).ok).toBe(true);

    const invalid = validateDecisionBatchResponse(request, response("missing"));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe("JDR_SCHEMA_MISMATCH");
    }

    const duplicate: DecisionBatchResponse = {
      ...response(),
      answers: [response().answers[0]!, response().answers[0]!],
    };
    const duplicateResult = validateDecisionBatchResponse(request, duplicate);
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) {
      expect(["JDR_MISSING_ANSWER", "JDR_SCHEMA_MISMATCH"]).toContain(
        duplicateResult.error.code,
      );
    }
  });

  it("retries only configured transport/schema failures and charges each provider attempt", async () => {
    let attempts = 0;
    const events: string[] = [];
    const adapter: DecisionProviderAdapter = {
      id: "fixture:transient",
      async execute(input) {
        attempts += 1;
        if (attempts === 1) {
          throw new JdrError("JDR_TIMEOUT", "transient timeout");
        }
        return {
          ...response(),
          requestId: input.id,
          traceId: input.traceContext?.traceId ?? createTraceId(),
        };
      },
    };

    const runtime = new DecisionRuntime({
      adapter,
      budget: { maxRequests: 2 },
      traceSink: (event) => events.push(event.kind),
    });
    const result = await runtime.execute({
      ...request,
      retryPolicy: {
        maxAttempts: 2,
        retryableCodes: ["JDR_TIMEOUT"],
        backoffMs: 0,
      },
    });

    expect(result.answers[0]?.selected).toBe("a");
    expect(attempts).toBe(2);
    expect(runtime.requestsUsed).toBe(2);
    expect(events).toEqual([
      "request-start",
      "request-failed",
      "request-start",
      "request-complete",
    ]);
  });

  it("does not retry semantic uncertainty or an undesired low-confidence answer", async () => {
    let attempts = 0;
    const adapter: DecisionProviderAdapter = {
      id: "fixture:low-confidence",
      async execute(input) {
        attempts += 1;
        return {
          ...response("a"),
          requestId: input.id,
          answers: [
            {
              ...response("a").answers[0]!,
              probabilities: { a: 0.51, b: 0.49 },
              confidence: 0.51,
            },
          ],
          traceId: input.traceContext?.traceId ?? createTraceId(),
        };
      },
    };
    const runtime = new DecisionRuntime({
      adapter,
      budget: { maxRequests: 3 },
    });
    const result = await runtime.execute({
      ...request,
      retryPolicy: {
        maxAttempts: 3,
        retryableCodes: ["JDR_TIMEOUT", "JDR_RATE_LIMIT"],
      },
    });
    expect(attempts).toBe(1);

    const profile = loadCalibrationProfile({
      id: "calibration:test-choice",
      version: "1.0.0",
      decisionFamily: "test.choice",
      minConfidence: 0.7,
      minMargin: 0.1,
      datasetRef: "fixture:calibration",
      bins: [
        {
          minConfidence: 0.5,
          maxConfidence: 0.6,
          observedAccuracy: 0.52,
          count: 100,
        },
      ],
    });
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;

    const decision = evaluateConfidence(result.answers[0]!, profile.value);
    expect(decision).toMatchObject({
      action: "abstain",
      reason: "low-confidence",
    });
  });

  it("schedules independent decision DAG nodes into deterministic topological batches", () => {
    const manifest: DecisionPackManifest = {
      id: "pack:dag",
      version: "1.0.0",
      maturity: "draft",
      stateProjector: "projector:test",
      questions: {
        q1: { type: "noul", instruction: "Question one?" },
        q2: { type: "noul", instruction: "Question two?" },
        q3: { type: "noul", instruction: "Question three?" },
      },
      fallback: { onLowConfidence: "abstain" },
      fixtures: [],
    };
    const scheduled = scheduleDecisionDag(manifest, {
      nodes: [
        {
          id: "node:b",
          questionId: "q2",
          dependsOn: [],
          stateProjection: "projection:q2",
        },
        {
          id: "node:a",
          questionId: "q1",
          dependsOn: [],
          stateProjection: "projection:q1",
        },
        {
          id: "node:c",
          questionId: "q3",
          dependsOn: ["node:a", "node:b"],
          stateProjection: "projection:q3",
        },
      ],
    });
    expect(scheduled.ok).toBe(true);
    if (scheduled.ok) {
      expect(scheduled.value).toEqual([
        {
          batchIndex: 0,
          nodeIds: ["node:a", "node:b"],
          questionIds: ["q1", "q2"],
        },
        {
          batchIndex: 1,
          nodeIds: ["node:c"],
          questionIds: ["q3"],
        },
      ]);
    }
  });

  it("rejects cyclic decision DAGs", () => {
    const manifest: DecisionPackManifest = {
      id: "pack:cycle",
      version: "1.0.0",
      maturity: "draft",
      stateProjector: "projector:test",
      questions: {
        q1: { type: "noul", instruction: "Question one?" },
        q2: { type: "noul", instruction: "Question two?" },
      },
      fallback: { onLowConfidence: "abstain" },
      fixtures: [],
    };
    const result = scheduleDecisionDag(manifest, {
      nodes: [
        {
          id: "node:a",
          questionId: "q1",
          dependsOn: ["node:b"],
          stateProjection: "projection:q1",
        },
        {
          id: "node:b",
          questionId: "q2",
          dependsOn: ["node:a"],
          stateProjection: "projection:q2",
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DPACK_DAG_CYCLE");
  });

  it("requires candidate provenance and candidate-recall evidence for candidate Choice packs", () => {
    const pack: DecisionPackManifest = {
      id: "pack:choice-quality",
      version: "1.0.0",
      maturity: "candidate",
      stateProjector: "projector:test",
      questions: request.questions,
      calibrationProfile: "calibration:test-choice@1.0.0",
      fallback: { onLowConfidence: "preserve-ambiguity" },
      fixtures: ["fixture:choice:1"],
      semanticPurpose: "Select one candidate from a bounded semantic set.",
      inputSchema: { kind: "object" },
      candidateSemantics: ["candidate A", "candidate B"],
      candidateSources: [
        {
          id: "source:consumer",
          kind: "consumer",
          sourceRef: "fixture:candidates",
          questionIds: ["choose"],
        },
      ],
      candidateRecallReport: {
        datasetRef: "fixture:recall",
        recall: 1,
        cases: 20,
      },
      hardConstraints: ["selected option must exist in the supplied set"],
      counterexamples: ["provider selects an absent option"],
      knownFailureModes: ["candidate generator omitted the correct option"],
      versionHistory: ["1.0.0 initial fixture-tested revision"],
      traceOutput: true,
    };
    expect(validateDecisionPack(pack).ok).toBe(true);

    const missingRecall = structuredClone(pack);
    delete missingRecall.candidateRecallReport;
    expect(validateDecisionPack(missingRecall).ok).toBe(false);
  });

  it("loads calibration profiles and applies context/recall abstention policies", () => {
    const loaded = loadCalibrationProfile({
      id: "calibration:test",
      version: "1.0.0",
      decisionFamily: "test.choice",
      minConfidence: 0.6,
      minMargin: 0.05,
      datasetRef: "fixture:calibration",
      bins: [],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const registry = new CalibrationProfileRegistry();
    expect(registry.register(loaded.value).ok).toBe(true);
    expect(registry.get("calibration:test", "1.0.0")).toEqual(loaded.value);

    expect(
      evaluateConfidence(response().answers[0]!, loaded.value, {
        candidateRecallConfidence: 0.4,
        minCandidateRecallConfidence: 0.8,
      }),
    ).toMatchObject({
      action: "abstain",
      reason: "low-candidate-recall",
    });
  });

  it("keeps recorded mode deterministic without a live provider call", async () => {
    const runtime = new DecisionRuntime({
      adapter: new RecordedDecisionAdapter([response()]),
      budget: { maxRequests: 1 },
    });
    const result = await runtime.execute(request);
    expect(result.source).toBe("recorded");
    expect(result.answers[0]?.selected).toBe("a");
  });
});
