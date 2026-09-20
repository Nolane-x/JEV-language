import { describe, expect, it } from "vitest";
import { ok } from "../../packages/core-types/src/index.ts";
import type { ResponseSemanticPlan } from "../../packages/discourse-ir/src/index.ts";
import {
  createConversationStyleMemory,
  runConversationSelectionPipeline,
  type ConversationRanker,
  type ConversationSurfaceDraft,
} from "../../packages/realizer-core/src/index.ts";

const plan = (): ResponseSemanticPlan => ({
  schemaVersion: "jl-response-semantic-plan-1",
  id: "response:pipeline",
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

const draft = (
  id: string,
  surface: string,
  family: string,
): ConversationSurfaceDraft => ({
  id,
  surface,
  language: "en",
  register: "casual",
  semanticPreservationVerified: true,
  semanticEvidenceRefs: [`verify:${id}`],
  sourceFamily: family,
  constructionIds: [`construction:${family}`],
});

const ranker = (
  choice: string,
  confidence = 0.95,
  probabilities: Record<string, number> = {
    a: 0.95,
    b: 0.05,
  },
): ConversationRanker => ({
  async rank(state) {
    expect(state.candidates).toBeDefined();
    return ok({
      choice,
      confidence,
      probabilities,
    });
  },
});

describe("conversation selection pipeline", () => {
  it("builds, ranks, selects, and records style only after a confident bounded selection", async () => {
    const memory = createConversationStyleMemory();
    expect(memory.ok).toBe(true);
    if (!memory.ok) return;

    const result = await runConversationSelectionPipeline({
      id: "set:pipeline",
      plan: plan(),
      dialogueContext: { turn: 3 },
      drafts: [
        draft("a", "The logs look clean so far.", "status"),
        draft("b", "I checked the logs and do not see any errors.", "direct"),
      ],
      styleMemory: memory.value,
      ranker: ranker("a"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.status).toBe("selected");
    expect(result.value.trace.selectedCandidateId).toBe("a");
    expect(result.value.trace.styleMemoryRecorded).toBe(true);
    expect(result.value.updatedStyleMemory?.entries).toHaveLength(1);
    expect(result.value.updatedStyleMemory?.entries[0]?.surface).toBe(
      "The logs look clean so far.",
    );
  });

  it("preserves ambiguity and does not mutate style memory on a low-margin result", async () => {
    const memory = createConversationStyleMemory();
    expect(memory.ok).toBe(true);
    if (!memory.ok) return;

    const result = await runConversationSelectionPipeline({
      id: "set:ambiguous",
      plan: plan(),
      dialogueContext: {},
      drafts: [
        draft("a", "The logs look clean so far.", "status"),
        draft("b", "I checked the logs and do not see any errors.", "direct"),
      ],
      styleMemory: memory.value,
      ranker: ranker("a", 0.54, { a: 0.54, b: 0.46 }),
      minConfidence: 0.5,
      minMargin: 0.1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.status).toBe("ambiguous");
    expect(result.value.trace.selectedCandidateId).toBeNull();
    expect(result.value.trace.styleMemoryRecorded).toBe(false);
    expect(result.value.updatedStyleMemory?.entries).toHaveLength(0);
  });

  it("fails closed if the ranker selects an id outside the bounded candidate set", async () => {
    const result = await runConversationSelectionPipeline({
      id: "set:unknown",
      plan: plan(),
      dialogueContext: {},
      drafts: [
        draft("a", "The logs look clean so far.", "status"),
        draft("b", "I checked the logs and do not see any errors.", "direct"),
      ],
      ranker: ranker("not-present", 1, { "not-present": 1 }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REALIZE_CONVERSATION_CHOICE_UNKNOWN");
    }
  });

  it("does not record style when no style-memory policy is supplied", async () => {
    const result = await runConversationSelectionPipeline({
      id: "set:no-memory",
      plan: plan(),
      dialogueContext: {},
      drafts: [
        draft("a", "The logs look clean so far.", "status"),
        draft("b", "I checked the logs and do not see any errors.", "direct"),
      ],
      ranker: ranker("a"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trace.styleMemoryRecorded).toBe(false);
    expect(result.value.updatedStyleMemory).toBeUndefined();
  });
});
