import { describe, expect, it } from "vitest";
import { createTraceId } from "../../packages/core-types/src/index.ts";
import {
  DecisionRuntime,
  RecordedDecisionAdapter,
  type DecisionBatchResponse,
} from "../../packages/decision-runtime/src/index.ts";
import { groundSource } from "../../packages/grounding/src/index.ts";
import {
  AmbiguityResolverRegistry,
  createJevChoiceAmbiguityResolver,
  type ParseCandidate,
  type SyntaxForest,
} from "../../packages/parser-core/src/index.ts";
import type { GroundingSource } from "../../packages/open-world-values/src/index.ts";

const source: GroundingSource = {
  id: "source:m4-ambiguity",
  version: "1",
  mediaType: "text/plain",
  languageHint: "en",
  content: "bank near river",
  trust: "user-content",
};

const forest: SyntaxForest = {
  version: "0.1.0",
  roots: ["syntax:s"],
  nodes: [
    {
      id: "syntax:s",
      category: "S",
      tokenStart: 0,
      tokenEnd: 3,
      alternatives: [
        { ruleId: "grammar.bank.financial", children: [] },
        { ruleId: "grammar.bank.river", children: [] },
      ],
    },
  ],
};

const candidates: ParseCandidate[] = [
  {
    id: "candidate:financial-bank",
    rootNodeId: "syntax:s",
    operations: [],
    ambiguityTags: ["lexical"],
    notes: ["bank = financial institution"],
  },
  {
    id: "candidate:river-bank",
    rootNodeId: "syntax:s",
    operations: [],
    ambiguityTags: ["lexical"],
    notes: ["bank = side of a river"],
  },
];

const recorded = (
  requestId: string,
  selected: string,
  confidence: number,
): DecisionBatchResponse => ({
  requestId,
  answers: [
    {
      questionId: "select_candidate",
      type: "choice",
      selected,
      probabilities: {
        "candidate:financial-bank":
          selected === "candidate:financial-bank" ? confidence : 1 - confidence,
        "candidate:river-bank":
          selected === "candidate:river-bank" ? confidence : 1 - confidence,
      },
      confidence,
      model: "recorded:jev",
      latencyMs: 1,
    },
  ],
  model: "recorded:jev",
  usage: { inputTokens: 10, outputTokens: 1, requests: 1 },
  traceId: createTraceId(),
  source: "recorded",
});

describe("M4 recorded Jev ambiguity resolution", () => {
  it("resolves one bounded lexical ambiguity through recorded JDR Choice", async () => {
    const grounding = groundSource(source);
    expect(grounding.ok).toBe(true);
    if (!grounding.ok) return;

    const requestId = "m4:lexical-bank:recorded";
    const runtime = new DecisionRuntime({
      adapter: new RecordedDecisionAdapter([
        recorded(requestId, "candidate:river-bank", 0.91),
      ]),
      budget: { maxRequests: 1 },
    });
    const registry = new AmbiguityResolverRegistry();
    registry.register(
      createJevChoiceAmbiguityResolver({
        executor: runtime,
        requestId,
        modelProfile: "recorded:jev",
        minimumConfidence: 0.7,
        supported: ["lexical"],
      }),
    );

    const result = await registry.resolve(candidates, {
      grounding: grounding.value,
      forest,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("resolved");
    expect(result.value.selected?.id).toBe("candidate:river-bank");
    expect(result.value.resolverId).toBe("parser.jev-choice.v1");
    expect(runtime.requestsUsed).toBe(1);
  });

  it("preserves the ambiguity when recorded Jev confidence is below the configured threshold", async () => {
    const grounding = groundSource(source);
    expect(grounding.ok).toBe(true);
    if (!grounding.ok) return;

    const requestId = "m4:lexical-bank:low-confidence";
    const runtime = new DecisionRuntime({
      adapter: new RecordedDecisionAdapter([
        recorded(requestId, "candidate:river-bank", 0.55),
      ]),
      budget: { maxRequests: 1 },
    });
    const registry = new AmbiguityResolverRegistry();
    registry.register(
      createJevChoiceAmbiguityResolver({
        executor: runtime,
        requestId,
        modelProfile: "recorded:jev",
        minimumConfidence: 0.7,
        supported: ["lexical"],
      }),
    );

    const result = await registry.resolve(candidates, {
      grounding: grounding.value,
      forest,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("preserved");
    expect(result.value.selected).toBeUndefined();
    expect(runtime.requestsUsed).toBe(1);
  });
});
