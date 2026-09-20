import { describe, expect, it } from "vitest";
import { reportConversationCandidateRecall } from "../../packages/evaluation-core/src/index.ts";
import { generateEnglishConversationProposals } from "../../packages/language-en/src/index.ts";
import { generateVietnameseConversationProposals } from "../../packages/language-vi/src/index.ts";

describe("conversation microgrammar wave-2 targeted recall", () => {
  it("closes the two preregistered v1 preferred-surface gaps", () => {
    const vi = generateVietnameseConversationProposals({
      id: "vi:topic-comment:wave2",
      content: "Mình chưa kiểm tra phần mobile.",
      relation: "peer",
      register: "casual",
      politeness: 0.4,
      dialogueAct: "answer",
      allowTopicCommentReshape: true,
    });
    const en = generateEnglishConversationProposals({
      id: "en:hedge:wave2",
      content: "The current evidence points to a timeout.",
      relation: "peer",
      register: "neutral",
      politeness: 0.4,
      dialogueAct: "answer",
      allowCalibratedHedge: true,
      epistemicStatus: "uncertain",
    });
    expect(vi.ok).toBe(true);
    expect(en.ok).toBe(true);
    if (!vi.ok || !en.ok) return;

    const viPreferred = "Còn phần mobile thì mình chưa kiểm tra.";
    const enPreferred = "It looks like a timeout, but I'm not certain yet.";

    const report = reportConversationCandidateRecall([
      {
        id: "vi-topic-comment-gap-v1",
        language: "vi",
        referenceAcceptableSurfaceIds: ["vi:base", "vi:preferred"],
        referencePreferredSurfaceIds: ["vi:preferred"],
        generated: vi.value.map((item) => ({
          id: item.id,
          surfaceId: item.surface === viPreferred ? "vi:preferred" : "vi:base",
          sourceFamily: item.sourceFamily,
          semanticVerified: true,
        })),
      },
      {
        id: "en-hedging-gap-v1",
        language: "en",
        referenceAcceptableSurfaceIds: ["en:base", "en:preferred"],
        referencePreferredSurfaceIds: ["en:preferred"],
        generated: en.value.map((item) => ({
          id: item.id,
          surfaceId: item.surface === enPreferred ? "en:preferred" : "en:base",
          sourceFamily: item.sourceFamily,
          semanticVerified: true,
        })),
      },
    ]);

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.acceptableHitRate).toBe(1);
    expect(report.value.preferredHitRate).toBe(1);
    expect(report.value.misses).toEqual([]);
  });

  it("does not generalize Vietnamese topic reshaping to unsupported verbs", () => {
    const result = generateVietnameseConversationProposals({
      id: "vi:topic-comment:guard",
      content: "Mình chưa đọc phần mobile.",
      relation: "peer",
      register: "casual",
      politeness: 0.4,
      dialogueAct: "answer",
      allowTopicCommentReshape: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.some((item) => item.sourceFamily === "topic-comment")).toBe(false);
  });

  it("does not generate uncertainty hedges when epistemic status is not uncertain", () => {
    const result = generateEnglishConversationProposals({
      id: "en:hedge:guard",
      content: "The current evidence points to a timeout.",
      relation: "peer",
      register: "neutral",
      politeness: 0.4,
      dialogueAct: "answer",
      allowCalibratedHedge: true,
      epistemicStatus: "probable",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.some((item) => item.sourceFamily === "calibrated-hedge")).toBe(false);
  });
});
