import { describe, expect, it } from "vitest";
import type { ResponseSemanticPlan } from "../../packages/discourse-ir/src/index.ts";
import {
  buildConversationCandidateSet,
  createConversationStyleMemory,
  recordConversationStyle,
  scoreConversationStyleRepetition,
} from "../../packages/realizer-core/src/index.ts";

const plan = (): ResponseSemanticPlan => ({
  schemaVersion: "jl-response-semantic-plan-1",
  id: "response:style-memory",
  dialogueAct: "answer",
  targetLanguage: "en",
  requiredSemanticRefs: ["semantic:answer"],
  optionalSemanticRefs: [],
  activeTopicRefs: ["semantic:topic"],
  referenceBindings: [],
  epistemic: {
    status: "probable",
    confidence: 0.8,
  },
  social: {
    relation: "peer",
    register: "casual",
    politeness: 0.4,
  },
  desiredLength: "concise",
  allowCodeSwitch: false,
  preserveOpaqueTerms: true,
});

describe("conversation anti-template style memory", () => {
  it("records only a bounded recent style window", () => {
    const created = createConversationStyleMemory(2);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const one = recordConversationStyle(created.value, {
      surface: "Sure, I checked it.",
      constructionIds: ["construction:opening:sure"],
      sourceFamily: "direct",
    });
    expect(one.ok).toBe(true);
    if (!one.ok) return;

    const two = recordConversationStyle(one.value, {
      surface: "Sure, I checked that too.",
      constructionIds: ["construction:opening:sure"],
      sourceFamily: "direct",
    });
    expect(two.ok).toBe(true);
    if (!two.ok) return;

    const three = recordConversationStyle(two.value, {
      surface: "On Windows, use the same command.",
      constructionIds: ["construction:technical:direct"],
      sourceFamily: "technical",
    });
    expect(three.ok).toBe(true);
    if (!three.ok) return;

    expect(three.value.entries).toHaveLength(2);
    expect(three.value.entries[0]?.surface).toBe("Sure, I checked that too.");
    expect(three.value.entries[1]?.surface).toBe(
      "On Windows, use the same command.",
    );
  });

  it("penalizes exact, opening, construction, family and lexical repetition deterministically", () => {
    const created = createConversationStyleMemory();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const recorded = recordConversationStyle(created.value, {
      surface: "Sure, I checked the logs and found no errors.",
      constructionIds: [
        "construction:opening:sure",
        "construction:checked-result",
      ],
      sourceFamily: "direct",
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;

    const repeated = scoreConversationStyleRepetition(recorded.value, {
      surface: "Sure, I checked the logs and found no errors.",
      constructionIds: [
        "construction:opening:sure",
        "construction:checked-result",
      ],
      sourceFamily: "direct",
    });
    const fresh = scoreConversationStyleRepetition(recorded.value, {
      surface: "The logs look clean so far.",
      constructionIds: ["construction:status:compact"],
      sourceFamily: "status",
    });

    expect(repeated.exactSurfaceRepeat).toBe(true);
    expect(repeated.penalty).toBeGreaterThan(fresh.penalty);
    expect(repeated.maxLexicalOverlap).toBe(1);
  });

  it("uses repetition only as a pre-rank preference and never as a semantic rejection", () => {
    const created = createConversationStyleMemory();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const memory = recordConversationStyle(created.value, {
      surface: "Sure, I checked the logs.",
      constructionIds: ["construction:opening:sure"],
      sourceFamily: "direct",
    });
    expect(memory.ok).toBe(true);
    if (!memory.ok) return;

    const result = buildConversationCandidateSet({
      id: "set:anti-template",
      plan: plan(),
      dialogueContext: {},
      maxCandidates: 2,
      styleMemory: memory.value,
      drafts: [
        {
          id: "repeated",
          surface: "Sure, I checked the logs.",
          language: "en",
          register: "casual",
          semanticPreservationVerified: true,
          semanticEvidenceRefs: ["verify:repeated"],
          sourceFamily: "direct",
          constructionIds: ["construction:opening:sure"],
        },
        {
          id: "fresh",
          surface: "I checked the logs; they look clean so far.",
          language: "en",
          register: "casual",
          semanticPreservationVerified: true,
          semanticEvidenceRefs: ["verify:fresh"],
          sourceFamily: "direct",
          constructionIds: ["construction:status:compact"],
        },
        {
          id: "other-family",
          surface: "The logs are clean based on the check I just ran.",
          language: "en",
          register: "casual",
          semanticPreservationVerified: true,
          semanticEvidenceRefs: ["verify:other"],
          sourceFamily: "status",
          constructionIds: ["construction:status:full"],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.set.candidates.map((candidate) => candidate.id)).toEqual(
      ["fresh", "other-family"],
    );
    const fresh = result.value.set.candidates.find(
      (candidate) => candidate.id === "fresh",
    );
    expect(
      Number(fresh?.annotations?.styleRepetitionPenalty ?? 0),
    ).toBeLessThan(1);
    expect(
      result.value.report.rejected.some(
        (entry) => entry.id === "repeated" && entry.reason === "budget",
      ),
    ).toBe(true);
    expect(
      result.value.report.rejected.some(
        (entry) => entry.reason === "not-semantically-verified",
      ),
    ).toBe(false);
  });

  it("does not penalize anything when no memory exists", () => {
    const score = scoreConversationStyleRepetition(undefined, {
      surface: "Fresh answer.",
      constructionIds: ["construction:fresh"],
      sourceFamily: "direct",
    });
    expect(score.penalty).toBe(0);
    expect(score.exactSurfaceRepeat).toBe(false);
  });
});
