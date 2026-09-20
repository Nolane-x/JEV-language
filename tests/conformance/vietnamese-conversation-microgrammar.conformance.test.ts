import { describe, expect, it } from "vitest";
import {
  generateVietnameseConversationProposals,
  promoteVietnameseConversationProposal,
} from "../../packages/language-vi/src/index.ts";

describe("Vietnamese conversational microgrammar", () => {
  it("uses explicit teacher-address hints and produces respectful variants without guessing gender", () => {
    const result = generateVietnameseConversationProposals({
      id: "vi:teacher",
      content: "{{speaker}} hiểu rồi. {{speaker}} sẽ sửa phần đó.",
      relation: "teacher",
      register: "formal",
      politeness: 0.95,
      dialogueAct: "acknowledge",
      speakerFormHint: "em",
      addresseeFormHint: "thầy",
      allowSpeakerEllipsis: true,
      allowDiscourseMarker: true,
      allowSentenceFinalParticle: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const surfaces = result.value.map((item) => item.surface);
    expect(surfaces).toContain("Em hiểu rồi. Em sẽ sửa phần đó.");
    expect(surfaces.some((surface) => surface.startsWith("Dạ,"))).toBe(true);
    expect(surfaces.some((surface) => surface.endsWith("ạ."))).toBe(true);
    expect(surfaces.some((surface) => surface.includes("mình"))).toBe(false);
  });

  it("fails closed when a social-pronoun placeholder lacks an explicit hint", () => {
    const result = generateVietnameseConversationProposals({
      id: "vi:no-guess",
      content: "{{speaker}} hiểu rồi.",
      relation: "teacher",
      register: "formal",
      politeness: 0.9,
      dialogueAct: "acknowledge",
      allowDiscourseMarker: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "LANG_VI_CONVERSATION_SPEAKER_HINT_REQUIRED",
      );
    }
  });

  it("creates peer ellipsis and softener proposals but does not mark them verified automatically", () => {
    const result = generateVietnameseConversationProposals({
      id: "vi:peer",
      content: "{{speaker}} kiểm tra rồi, hiện chưa thấy lỗi nào.",
      relation: "peer",
      register: "casual",
      politeness: 0.45,
      dialogueAct: "answer",
      speakerFormHint: "mình",
      addresseeFormHint: "bạn",
      allowSpeakerEllipsis: true,
      allowDiscourseMarker: true,
      allowSentenceFinalParticle: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map((item) => item.sourceFamily)).toEqual(
      expect.arrayContaining([
        "direct",
        "speaker-ellipsis",
        "casual-ack",
        "peer-softener",
      ]),
    );

    const ellipsis = result.value.find(
      (item) => item.sourceFamily === "speaker-ellipsis",
    );
    expect(ellipsis?.surface.startsWith("kiểm tra")).toBe(true);
    expect(ellipsis).not.toHaveProperty("semanticPreservationVerified");
  });

  it("preserves opaque technical terms exactly through Vietnamese and vi-en proposals", () => {
    const result = generateVietnameseConversationProposals({
      id: "vi:code-switch",
      content: "{{speaker}} deploy JEV-Lattice-X7 rồi.",
      language: "vi-en",
      relation: "peer",
      register: "casual",
      politeness: 0.4,
      dialogueAct: "answer",
      speakerFormHint: "mình",
      allowSpeakerEllipsis: true,
      allowDiscourseMarker: true,
      allowSentenceFinalParticle: true,
      preserveTerms: ["JEV-Lattice-X7"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const proposal of result.value) {
      expect(proposal.surface).toContain("JEV-Lattice-X7");
      expect(proposal.language).toBe("vi-en");
    }
  });

  it("requires independent semantic evidence before proposals can enter the ranking lattice", () => {
    const result = generateVietnameseConversationProposals({
      id: "vi:promotion",
      content: "Mình kiểm tra rồi.",
      relation: "peer",
      register: "casual",
      politeness: 0.4,
      dialogueAct: "answer",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const withoutEvidence = promoteVietnameseConversationProposal(
      result.value[0]!,
      [],
    );
    expect(withoutEvidence.ok).toBe(false);

    const promoted = promoteVietnameseConversationProposal(
      result.value[0]!,
      ["verify:semantic-roundtrip:1"],
    );
    expect(promoted.ok).toBe(true);
    if (promoted.ok) {
      expect(promoted.value.semanticPreservationVerified).toBe(true);
      expect(promoted.value.semanticEvidenceRefs).toEqual([
        "verify:semantic-roundtrip:1",
      ]);
    }
  });

  it("does not attach casual markers to unknown or formal relations", () => {
    const result = generateVietnameseConversationProposals({
      id: "vi:unknown",
      content: "Tôi đã kiểm tra rồi.",
      relation: "unknown",
      register: "neutral",
      politeness: 0.5,
      dialogueAct: "answer",
      allowDiscourseMarker: true,
      allowSentenceFinalParticle: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.sourceFamily).toBe("direct");
  });
});
