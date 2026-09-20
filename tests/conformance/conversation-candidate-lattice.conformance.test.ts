import { describe, expect, it } from "vitest";
import type { ResponseSemanticPlan } from "../../packages/discourse-ir/src/index.ts";
import {
  buildConversationCandidateSet,
  type ConversationSurfaceDraft,
} from "../../packages/realizer-core/src/index.ts";

const plan = (): ResponseSemanticPlan => ({
  schemaVersion: "jl-response-semantic-plan-1",
  id: "response:lattice:vi",
  dialogueAct: "answer",
  targetLanguage: "vi",
  requiredSemanticRefs: ["semantic:answer"],
  optionalSemanticRefs: [],
  activeTopicRefs: ["semantic:topic"],
  referenceBindings: [],
  epistemic: {
    status: "probable",
    confidence: 0.8,
    evidenceRefs: ["evidence:1"],
  },
  social: {
    relation: "peer",
    register: "casual",
    politeness: 0.5,
    speakerFormHint: "mình",
    addresseeFormHint: "bạn",
  },
  desiredLength: "concise",
  allowCodeSwitch: true,
  preserveOpaqueTerms: true,
});

const draft = (
  id: string,
  surface: string,
  family: string,
  overrides: Partial<ConversationSurfaceDraft> = {},
): ConversationSurfaceDraft => ({
  id,
  surface,
  language: "vi",
  register: "casual",
  semanticPreservationVerified: true,
  semanticEvidenceRefs: [`verify:${id}`],
  sourceFamily: family,
  constructionIds: [`construction:${family}`],
  ...overrides,
});

describe("conversation candidate lattice", () => {
  it("keeps multiple generation families under a tight candidate budget", () => {
    const result = buildConversationCandidateSet({
      id: "set:diverse",
      plan: plan(),
      dialogueContext: { previousTurn: "Bạn xem giúp mình nhé." },
      maxCandidates: 3,
      drafts: [
        draft("direct-1", "Mình kiểm tra rồi, hiện chưa thấy lỗi.", "direct", {
          baseCost: 0,
        }),
        draft("direct-2", "Mình vừa kiểm tra, chưa thấy lỗi nào.", "direct", {
          baseCost: 0.1,
        }),
        draft("ack-1", "Ừ, mình kiểm tra rồi và hiện chưa thấy lỗi.", "acknowledge", {
          baseCost: 0.15,
        }),
        draft("hedge-1", "Hiện tại mình chưa thấy lỗi nào sau khi kiểm tra.", "hedged", {
          baseCost: 0.2,
        }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.set.candidates).toHaveLength(3);
    expect(result.value.report.representedFamilies).toEqual([
      "acknowledge",
      "direct",
      "hedged",
    ]);
    expect(
      result.value.report.rejected.some((item) => item.reason === "budget"),
    ).toBe(true);
  });

  it("rejects unverified, language-mismatched, duplicate, and opaque-term-corrupt drafts", () => {
    const p = plan();
    p.allowCodeSwitch = false;

    const result = buildConversationCandidateSet({
      id: "set:gated",
      plan: p,
      dialogueContext: {},
      opaqueTerms: ["JEV-Lattice-X7"],
      drafts: [
        draft(
          "good-a",
          "Mình giữ nguyên JEV-Lattice-X7 và đã kiểm tra xong.",
          "direct",
        ),
        draft(
          "good-b",
          "JEV-Lattice-X7 vẫn được giữ nguyên; mình vừa kiểm tra xong.",
          "alternate",
        ),
        draft(
          "unverified",
          "Mình đã kiểm tra JEV-Lattice-X7.",
          "direct",
          { semanticPreservationVerified: false },
        ),
        draft(
          "wrong-language",
          "I checked JEV-Lattice-X7.",
          "english",
          { language: "en" },
        ),
        draft(
          "corrupt",
          "Mình đã kiểm tra JEV Lattice X7.",
          "direct",
        ),
        draft(
          "duplicate",
          "Mình giữ nguyên JEV-Lattice-X7 và đã kiểm tra xong.",
          "alternate",
        ),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.set.candidates.map((candidate) => candidate.id)).toEqual([
      "good-b",
      "good-a",
    ]);
    expect(
      new Set(result.value.report.rejected.map((item) => item.reason)),
    ).toEqual(
      new Set([
        "not-semantically-verified",
        "language-mismatch",
        "opaque-term-corruption",
        "duplicate-surface",
      ]),
    );
  });

  it("allows evidence-based code-switch candidates only when the target language remains represented", () => {
    const allowed = buildConversationCandidateSet({
      id: "set:code-switch",
      plan: plan(),
      dialogueContext: {},
      drafts: [
        draft("vi", "Mình kiểm tra rồi.", "vi"),
        draft(
          "vi-en",
          "Mình deploy bản fix rồi.",
          "code-switch",
          { language: "vi-en" },
        ),
      ],
    });
    expect(allowed.ok).toBe(true);

    const p = plan();
    p.allowCodeSwitch = false;
    const blocked = buildConversationCandidateSet({
      id: "set:no-code-switch",
      plan: p,
      dialogueContext: {},
      drafts: [
        draft("vi", "Mình kiểm tra rồi.", "vi"),
        draft(
          "vi-en",
          "Mình deploy bản fix rồi.",
          "code-switch",
          { language: "vi-en" },
        ),
      ],
    });
    expect(blocked.ok).toBe(false);
  });

  it("fails closed when semantic verification leaves fewer than two candidates", () => {
    const result = buildConversationCandidateSet({
      id: "set:recall-failure",
      plan: plan(),
      dialogueContext: {},
      drafts: [
        draft("only-good", "Mình kiểm tra rồi.", "direct"),
        draft("bad", "Mình đoán là xong.", "guess", {
          semanticPreservationVerified: false,
        }),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REALIZE_CONVERSATION_LATTICE_RECALL");
    }
  });

  it("projects response context and candidate provenance into the bounded set", () => {
    const result = buildConversationCandidateSet({
      id: "set:projection",
      plan: plan(),
      dialogueContext: { turn: 7, activeTopic: "repo" },
      drafts: [
        draft("a", "Mình kiểm tra rồi, chưa thấy lỗi.", "direct"),
        draft("b", "Hiện mình chưa thấy lỗi sau khi kiểm tra.", "alternate"),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.set.responseSemantics).toMatchObject({
      dialogueAct: "answer",
      targetLanguage: "vi",
      social: {
        relation: "peer",
        register: "casual",
      },
    });
    expect(result.value.set.candidates[0]?.annotations).toHaveProperty(
      "sourceFamily",
    );
    expect(result.value.set.candidates[0]?.annotations).toHaveProperty(
      "deterministicPreRankCost",
    );
  });
});
