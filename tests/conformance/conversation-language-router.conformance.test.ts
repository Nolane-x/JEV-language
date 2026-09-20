import { describe, expect, it } from "vitest";
import type { ResponseSemanticPlan } from "../../packages/discourse-ir/src/index.ts";
import {
  routeConversationSurfaceProposals,
} from "../../packages/universal-expression/src/index.ts";

const plan = (
  overrides: Partial<ResponseSemanticPlan> = {},
): ResponseSemanticPlan => ({
  schemaVersion: "jl-response-semantic-plan-1",
  id: "response:router:1",
  dialogueAct: "answer",
  targetLanguage: "en",
  requiredSemanticRefs: ["semantic:answer"],
  optionalSemanticRefs: [],
  activeTopicRefs: ["semantic:topic"],
  referenceBindings: [],
  epistemic: {
    status: "certain",
    confidence: 0.95,
  },
  social: {
    relation: "peer",
    register: "casual",
    politeness: 0.45,
  },
  desiredLength: "concise",
  allowCodeSwitch: false,
  preserveOpaqueTerms: true,
  ...overrides,
});

describe("conversation language router", () => {
  it("routes a Vietnamese peer plan into multiple bounded conversational proposal families", () => {
    const result = routeConversationSurfaceProposals(
      plan({
        targetLanguage: "vi",
        social: {
          relation: "peer",
          register: "casual",
          politeness: 0.45,
          speakerFormHint: "mình",
          addresseeFormHint: "bạn",
        },
      }),
      "{{speaker}} kiểm tra rồi, hiện chưa thấy lỗi nào.",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.languageFamily).toBe("vi");
    expect(result.value.drafts.map((item) => item.sourceFamily)).toEqual(
      expect.arrayContaining([
        "direct",
        "speaker-ellipsis",
        "peer-softener",
      ]),
    );
    expect(
      result.value.drafts.some(
        (item) =>
          item.surface ===
          "Mình kiểm tra rồi, hiện chưa thấy lỗi nào nhé.",
      ),
    ).toBe(true);
    expect(
      result.value.drafts.every(
        (item) =>
          !("semanticPreservationVerified" in item) &&
          !("semanticEvidenceRefs" in item),
      ),
    ).toBe(true);
  });

  it("uses the response-plan epistemic state to license English calibrated hedging", () => {
    const result = routeConversationSurfaceProposals(
      plan({
        epistemic: {
          status: "uncertain",
          confidence: 0.45,
          evidenceRefs: ["evidence:partial-log"],
        },
        social: {
          relation: "peer",
          register: "neutral",
          politeness: 0.45,
        },
      }),
      "The current evidence points to a timeout.",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.languageFamily).toBe("en");
    expect(result.value.drafts.map((item) => item.surface)).toContain(
      "It looks like a timeout, but I'm not certain yet.",
    );
  });

  it("does not force casual English contractions into a formal response plan", () => {
    const result = routeConversationSurfaceProposals(
      plan({
        social: {
          relation: "customer",
          register: "formal",
          politeness: 0.95,
        },
      }),
      "I am checking it now and I will let you know.",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.drafts).toHaveLength(1);
    expect(result.value.drafts[0]?.surface).toBe(
      "I am checking it now and I will let you know.",
    );
  });

  it("routes explicitly licensed Vietnamese-English code-switch while preserving opaque terms", () => {
    const result = routeConversationSurfaceProposals(
      plan({
        targetLanguage: "vi-en",
        allowCodeSwitch: true,
        social: {
          relation: "peer",
          register: "casual",
          politeness: 0.4,
          speakerFormHint: "mình",
        },
      }),
      "{{speaker}} deploy JEV-Lattice-X7 rồi.",
      {
        opaqueTerms: ["JEV-Lattice-X7"],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.languageFamily).toBe("vi");
    expect(
      result.value.drafts.every(
        (item) =>
          item.language === "vi-en" &&
          item.surface.includes("JEV-Lattice-X7"),
      ),
    ).toBe(true);
  });

  it("keeps Vietnamese topic-comment reshaping opt-in at the router boundary", () => {
    const base = plan({
      targetLanguage: "vi",
      social: {
        relation: "peer",
        register: "casual",
        politeness: 0.4,
      },
    });

    const disabled = routeConversationSurfaceProposals(
      base,
      "Mình chưa kiểm tra phần mobile.",
    );
    const enabled = routeConversationSurfaceProposals(
      base,
      "Mình chưa kiểm tra phần mobile.",
      {
        enableVietnameseTopicCommentReshape: true,
      },
    );

    expect(disabled.ok).toBe(true);
    expect(enabled.ok).toBe(true);
    if (!disabled.ok || !enabled.ok) return;

    expect(
      disabled.value.drafts.some(
        (item) => item.sourceFamily === "topic-comment",
      ),
    ).toBe(false);
    expect(
      enabled.value.drafts.some(
        (item) =>
          item.surface ===
          "Còn phần mobile thì mình chưa kiểm tra.",
      ),
    ).toBe(true);
  });

  it("fails explicitly for languages without a native conversational surface pack", () => {
    const result = routeConversationSurfaceProposals(
      plan({
        targetLanguage: "zh-Hans",
      }),
      "当前没有发现问题。",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "EXPRESSION_CONVERSATION_LANGUAGE_UNSUPPORTED",
      );
    }
  });
});
