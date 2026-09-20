import { describe, expect, it } from "vitest";
import {
  generateEnglishConversationProposals,
} from "../../packages/language-en/src/index.ts";
import {
  generateVietnameseConversationProposals,
} from "../../packages/language-vi/src/index.ts";
import {
  reportConversationCandidateRecall,
  type ConversationCandidateRecallCase,
} from "../../packages/evaluation-core/src/index.ts";

type GeneratedProposal = {
  id: string;
  surface: string;
  sourceFamily: string;
};

interface EngineeringCase {
  id: string;
  language: "vi" | "en";
  preferredSurface: string;
  generated: GeneratedProposal[];
}

const toRecallCase = (
  item: EngineeringCase,
): ConversationCandidateRecallCase => ({
  id: item.id,
  language: item.language,
  referenceAcceptableSurfaceIds: [
    `surface:${item.id}:base`,
    `surface:${item.id}:preferred`,
  ],
  referencePreferredSurfaceIds: [`surface:${item.id}:preferred`],
  generated: item.generated.map((proposal) => ({
    id: proposal.id,
    surfaceId:
      proposal.surface === item.preferredSurface
        ? `surface:${item.id}:preferred`
        : `surface:${item.id}:base`,
    sourceFamily: proposal.sourceFamily,
    semanticVerified: true,
  })),
});

const requireVi = (
  input: Parameters<typeof generateVietnameseConversationProposals>[0],
): GeneratedProposal[] => {
  const result = generateVietnameseConversationProposals(input);
  if (!result.ok) throw result.error;
  return result.value;
};

const requireEn = (
  input: Parameters<typeof generateEnglishConversationProposals>[0],
): GeneratedProposal[] => {
  const result = generateEnglishConversationProposals(input);
  if (!result.ok) throw result.error;
  return result.value;
};

const engineeringCases = (): EngineeringCase[] => [
  {
    id: "vi-teacher-respectful-ack",
    language: "vi",
    preferredSurface: "Dạ, em hiểu rồi. Em sẽ sửa phần đó.",
    generated: requireVi({
      id: "vi:teacher-recall",
      content: "{{speaker}} hiểu rồi. {{speaker}} sẽ sửa phần đó.",
      relation: "teacher",
      register: "formal",
      politeness: 0.95,
      dialogueAct: "acknowledge",
      speakerFormHint: "em",
      addresseeFormHint: "thầy",
      allowDiscourseMarker: true,
      allowSentenceFinalParticle: true,
    }),
  },
  {
    id: "vi-peer-ellipsis",
    language: "vi",
    preferredSurface: "kiểm tra rồi, hiện chưa thấy lỗi nào.",
    generated: requireVi({
      id: "vi:peer-ellipsis-recall",
      content: "{{speaker}} kiểm tra rồi, hiện chưa thấy lỗi nào.",
      relation: "peer",
      register: "casual",
      politeness: 0.45,
      dialogueAct: "answer",
      speakerFormHint: "mình",
      addresseeFormHint: "bạn",
      allowSpeakerEllipsis: true,
    }),
  },
  {
    id: "vi-peer-softener",
    language: "vi",
    preferredSurface: "Mình kiểm tra rồi, hiện chưa thấy lỗi nào nhé.",
    generated: requireVi({
      id: "vi:peer-softener-recall",
      content: "{{speaker}} kiểm tra rồi, hiện chưa thấy lỗi nào.",
      relation: "peer",
      register: "casual",
      politeness: 0.45,
      dialogueAct: "answer",
      speakerFormHint: "mình",
      allowSentenceFinalParticle: true,
    }),
  },
  {
    id: "vi-code-switch-opaque",
    language: "vi",
    preferredSurface: "deploy JEV-Lattice-X7 rồi.",
    generated: requireVi({
      id: "vi:code-switch-recall",
      content: "{{speaker}} deploy JEV-Lattice-X7 rồi.",
      language: "vi-en",
      relation: "peer",
      register: "casual",
      politeness: 0.4,
      dialogueAct: "answer",
      speakerFormHint: "mình",
      allowSpeakerEllipsis: true,
      preserveTerms: ["JEV-Lattice-X7"],
    }),
  },
  {
    id: "vi-topic-comment-unsupported",
    language: "vi",
    preferredSurface: "Còn phần mobile thì mình chưa kiểm tra.",
    generated: requireVi({
      id: "vi:topic-comment-gap",
      content: "Mình chưa kiểm tra phần mobile.",
      relation: "peer",
      register: "casual",
      politeness: 0.4,
      dialogueAct: "answer",
    }),
  },
  {
    id: "en-contraction",
    language: "en",
    preferredSurface: "I'm checking it now and I'll let you know.",
    generated: requireEn({
      id: "en:contraction-recall",
      content: "I am checking it now and I will let you know.",
      relation: "peer",
      register: "casual",
      politeness: 0.4,
      dialogueAct: "answer",
      allowContractions: true,
    }),
  },
  {
    id: "en-correction-ack",
    language: "en",
    preferredSurface: "Right — i mixed those up. I'll check staging.",
    generated: requireEn({
      id: "en:correction-recall",
      content: "I mixed those up. I'll check staging.",
      relation: "peer",
      register: "neutral",
      politeness: 0.5,
      dialogueAct: "correct",
      allowDiscourseMarker: true,
    }),
  },
  {
    id: "en-compact-followup",
    language: "en",
    preferredSurface: "On Windows, use the same command in PowerShell.",
    generated: requireEn({
      id: "en:compact-recall",
      content: "For Windows, you can use the same command in PowerShell.",
      relation: "peer",
      register: "neutral",
      politeness: 0.4,
      dialogueAct: "answer",
      allowCompactFollowup: true,
    }),
  },
  {
    id: "en-peer-ack",
    language: "en",
    preferredSurface: "Got it — i'll check that now.",
    generated: requireEn({
      id: "en:ack-recall",
      content: "I'll check that now.",
      relation: "peer",
      register: "casual",
      politeness: 0.4,
      dialogueAct: "acknowledge",
      allowDiscourseMarker: true,
    }),
  },
  {
    id: "en-hedging-unsupported",
    language: "en",
    preferredSurface: "It looks like a timeout, but I'm not certain yet.",
    generated: requireEn({
      id: "en:hedging-gap",
      content: "The current evidence points to a timeout.",
      relation: "peer",
      register: "neutral",
      politeness: 0.4,
      dialogueAct: "answer",
    }),
  },
];

describe("conversation microgrammar preferred-variant recall integration", () => {
  it("freezes a non-perfect engineering baseline instead of pretending candidate generation is solved", () => {
    const cases = engineeringCases().map(toRecallCase);
    const report = reportConversationCandidateRecall(cases);

    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.caseCount).toBe(10);
    expect(report.value.acceptableHitRate).toBe(1);
    expect(report.value.preferredHitRate).toBe(0.8);
    expect(report.value.misses).toEqual([
      {
        id: "vi-topic-comment-unsupported",
        language: "vi",
        kind: "no-preferred-candidate",
      },
      {
        id: "en-hedging-unsupported",
        language: "en",
        kind: "no-preferred-candidate",
      },
    ]);
  });

  it("keeps unsupported preferred variants visible as research targets", () => {
    const cases = engineeringCases().map(toRecallCase);
    const report = reportConversationCandidateRecall(cases);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    const gaps = report.value.cases
      .filter((item) => item.preferredHit === false)
      .map((item) => item.id)
      .sort();
    expect(gaps).toEqual([
      "en-hedging-unsupported",
      "vi-topic-comment-unsupported",
    ]);
  });

  it("requires each successful preferred variant to come from an actual generated surface", () => {
    const cases = engineeringCases();
    for (const item of cases) {
      const hasPreferred = item.generated.some(
        (proposal) => proposal.surface === item.preferredSurface,
      );
      if (
        item.id === "vi-topic-comment-unsupported" ||
        item.id === "en-hedging-unsupported"
      ) {
        expect(hasPreferred).toBe(false);
      } else {
        expect(hasPreferred).toBe(true);
      }
    }
  });
});
