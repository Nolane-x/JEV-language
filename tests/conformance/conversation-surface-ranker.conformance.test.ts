import { describe, expect, it } from "vitest";
import {
  conversationalSurfaceRankerPack,
  validateDecisionPack,
} from "../../packages/decision-packs/src/index.ts";
import {
  conversationRankingState,
  selectConversationCandidate,
  validateConversationCandidateSet,
  type ConversationCandidateSet,
} from "../../packages/realizer-core/src/index.ts";

const fixture = (): ConversationCandidateSet => ({
  id: "conversation:test:vi",
  targetLanguage: "vi",
  dialogueContext: {
    user: "Bạn xem giúp mình lỗi này với nhé.",
    relation: "peer",
  },
  responseSemantics: {
    act: "answer",
    proposition: "inspection complete; no error observed yet",
  },
  candidates: [
    {
      id: "a",
      surface: "Mình kiểm tra rồi, hiện chưa thấy lỗi nào nhé.",
      language: "vi",
      register: "casual",
      semanticPreservationVerified: true,
      semanticEvidenceRefs: ["verify:roundtrip:a"],
    },
    {
      id: "b",
      surface:
        "Tôi đã tiến hành sự kiểm tra và tại thời điểm hiện tại chưa quan sát thấy lỗi nào.",
      language: "vi",
      register: "formal",
      semanticPreservationVerified: true,
      semanticEvidenceRefs: ["verify:roundtrip:b"],
    },
  ],
});

describe("conversational surface ranking", () => {
  it("registers a candidate-gated Jev naturalness decision pack", () => {
    const result = validateDecisionPack(conversationalSurfaceRankerPack);
    expect(result.ok).toBe(true);
    expect(conversationalSurfaceRankerPack.maturity).toBe("candidate");
    expect(conversationalSurfaceRankerPack.questions.candidate?.type).toBe(
      "choice",
    );
    expect(conversationalSurfaceRankerPack.hardConstraints).toContain(
      "selected candidate must already pass semantic-preservation verification",
    );
  });

  it("projects only bounded verified surfaces into the Jev ranking state", () => {
    const set = fixture();
    const validated = validateConversationCandidateSet(set);
    expect(validated.ok).toBe(true);

    const state = conversationRankingState(set);
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.value.targetLanguage).toBe("vi");
    expect(state.value.candidates).toEqual({
      a: {
        surface: "Mình kiểm tra rồi, hiện chưa thấy lỗi nào nhé.",
        language: "vi",
        register: "casual",
      },
      b: {
        surface:
          "Tôi đã tiến hành sự kiểm tra và tại thời điểm hiện tại chưa quan sát thấy lỗi nào.",
        language: "vi",
        register: "formal",
      },
    });
  });

  it("accepts a confident bounded winner and preserves low-margin ambiguity", () => {
    const set = fixture();

    const selected = selectConversationCandidate(set, {
      choice: "a",
      confidence: 0.94,
      probabilities: { a: 0.94, b: 0.06 },
    });
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.value.status).toBe("selected");
      if (selected.value.status === "selected") {
        expect(selected.value.candidate.id).toBe("a");
      }
    }

    const ambiguous = selectConversationCandidate(set, {
      choice: "a",
      confidence: 0.55,
      probabilities: { a: 0.55, b: 0.45 },
    });
    expect(ambiguous.ok).toBe(true);
    if (ambiguous.ok) {
      expect(ambiguous.value.status).toBe("ambiguous");
    }
  });

  it("rejects duplicate surfaces, unverified candidates, and out-of-set winners", () => {
    const duplicate = fixture();
    duplicate.candidates[1]!.surface = duplicate.candidates[0]!.surface;
    expect(validateConversationCandidateSet(duplicate).ok).toBe(false);

    const unknownWinner = selectConversationCandidate(fixture(), {
      choice: "not-present",
      confidence: 1,
      probabilities: { "not-present": 1 },
    });
    expect(unknownWinner.ok).toBe(false);
  });
});
