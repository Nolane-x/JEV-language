import { describe, expect, it } from "vitest";
import {
  generateEnglishConversationProposals,
  promoteEnglishConversationProposal,
} from "../../packages/language-en/src/index.ts";

describe("English conversational microgrammar", () => {
  it("adds contractions only in registers where they are licensed", () => {
    const result = generateEnglishConversationProposals({
      id: "en:contraction",
      content: "I am checking it now and I will let you know.",
      relation: "peer",
      register: "casual",
      politeness: 0.4,
      dialogueAct: "answer",
      allowContractions: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map((item) => item.surface)).toContain(
      "I'm checking it now and I'll let you know.",
    );

    const formal = generateEnglishConversationProposals({
      id: "en:formal",
      content: "I am checking it now and I will let you know.",
      relation: "customer",
      register: "formal",
      politeness: 0.9,
      dialogueAct: "answer",
      allowContractions: true,
    });
    expect(formal.ok).toBe(true);
    if (!formal.ok) return;
    expect(formal.value).toHaveLength(1);
  });

  it("creates explicit correction ownership without inventing it for ordinary answers", () => {
    const correction = generateEnglishConversationProposals({
      id: "en:correction",
      content: "I mixed those up. I'll check staging.",
      relation: "peer",
      register: "neutral",
      politeness: 0.5,
      dialogueAct: "correct",
      allowDiscourseMarker: true,
    });
    expect(correction.ok).toBe(true);
    if (!correction.ok) return;
    expect(
      correction.value.some(
        (item) =>
          item.sourceFamily === "correction-ack" &&
          item.surface === "Right — I mixed those up. I'll check staging.",
      ),
    ).toBe(true);

    const answer = generateEnglishConversationProposals({
      id: "en:answer",
      content: "The logs look clean.",
      relation: "peer",
      register: "neutral",
      politeness: 0.5,
      dialogueAct: "answer",
      allowDiscourseMarker: true,
    });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(
      answer.value.some((item) => item.sourceFamily === "correction-ack"),
    ).toBe(false);
  });

  it("creates compact follow-up proposals only from bounded rewrite patterns", () => {
    const result = generateEnglishConversationProposals({
      id: "en:followup",
      content: "For Windows, you can use the same command in PowerShell.",
      relation: "peer",
      register: "neutral",
      politeness: 0.4,
      dialogueAct: "answer",
      allowCompactFollowup: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map((item) => item.surface)).toContain(
      "On Windows, use the same command in PowerShell.",
    );
  });

  it("preserves opaque terms through contractions and compact rewrites", () => {
    const result = generateEnglishConversationProposals({
      id: "en:opaque",
      content: "I am checking JEV-Lattice-X7 now.",
      relation: "peer",
      register: "casual",
      politeness: 0.4,
      dialogueAct: "answer",
      allowContractions: true,
      preserveTerms: ["JEV-Lattice-X7"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const item of result.value) {
      expect(item.surface).toContain("JEV-Lattice-X7");
    }
  });

  it("requires independent semantic evidence before promotion into ranking", () => {
    const result = generateEnglishConversationProposals({
      id: "en:promotion",
      content: "The logs look clean.",
      relation: "peer",
      register: "neutral",
      politeness: 0.4,
      dialogueAct: "answer",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      promoteEnglishConversationProposal(result.value[0]!, []).ok,
    ).toBe(false);

    const promoted = promoteEnglishConversationProposal(
      result.value[0]!,
      ["verify:roundtrip:en:1"],
    );
    expect(promoted.ok).toBe(true);
    if (promoted.ok) {
      expect(promoted.value.semanticPreservationVerified).toBe(true);
      expect(promoted.value.semanticEvidenceRefs).toEqual([
        "verify:roundtrip:en:1",
      ]);
    }
  });
});
