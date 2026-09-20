import { describe, expect, it } from "vitest";
import {
  reportConversationCandidateRecall,
} from "../../packages/evaluation-core/src/index.ts";

describe("conversation candidate recall evaluation", () => {
  it("separates acceptable recall from preferred recall and counts only verified candidates", () => {
    const report = reportConversationCandidateRecall([
      {
        id: "vi-peer",
        language: "vi",
        referenceAcceptableSurfaceIds: ["surface:a", "surface:b"],
        referencePreferredSurfaceIds: ["surface:a"],
        generated: [
          {
            id: "candidate:a",
            surfaceId: "surface:a",
            sourceFamily: "direct",
            semanticVerified: true,
          },
          {
            id: "candidate:x",
            surfaceId: "surface:x",
            sourceFamily: "alternate",
            semanticVerified: true,
          },
        ],
      },
      {
        id: "en-followup",
        language: "en",
        referenceAcceptableSurfaceIds: ["surface:c"],
        referencePreferredSurfaceIds: ["surface:c"],
        generated: [
          {
            id: "candidate:c",
            surfaceId: "surface:c",
            sourceFamily: "compact-followup",
            semanticVerified: false,
          },
          {
            id: "candidate:y",
            surfaceId: "surface:y",
            sourceFamily: "direct",
            semanticVerified: true,
          },
        ],
      },
    ]);

    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.acceptableHitRate).toBe(0.5);
    expect(report.value.preferredHitRate).toBe(0.5);
    expect(report.value.cases[0]).toMatchObject({
      acceptableHit: true,
      preferredHit: true,
      verifiedGeneratedCount: 2,
      representedFamilies: 2,
    });
    expect(report.value.cases[1]).toMatchObject({
      acceptableHit: false,
      preferredHit: false,
      verifiedGeneratedCount: 1,
    });
    expect(report.value.misses).toEqual([
      {
        id: "en-followup",
        language: "en",
        kind: "no-acceptable-candidate",
      },
      {
        id: "en-followup",
        language: "en",
        kind: "no-preferred-candidate",
      },
    ]);
  });

  it("reports partial acceptable-surface coverage instead of hiding missing variants", () => {
    const report = reportConversationCandidateRecall([
      {
        id: "coverage",
        language: "vi",
        referenceAcceptableSurfaceIds: [
          "surface:direct",
          "surface:ellipsis",
          "surface:softener",
        ],
        generated: [
          {
            id: "candidate:direct",
            surfaceId: "surface:direct",
            sourceFamily: "direct",
            semanticVerified: true,
          },
          {
            id: "candidate:ellipsis",
            surfaceId: "surface:ellipsis",
            sourceFamily: "speaker-ellipsis",
            semanticVerified: true,
          },
        ],
      },
    ]);

    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.acceptableHitRate).toBe(1);
    expect(report.value.meanAcceptableCoverage).toBe(0.6667);
    expect(report.value.cases[0]?.missingAcceptableSurfaceIds).toEqual([
      "surface:softener",
    ]);
  });

  it("requires preferred references to be a subset of acceptable references", () => {
    const report = reportConversationCandidateRecall([
      {
        id: "invalid",
        language: "en",
        referenceAcceptableSurfaceIds: ["surface:a"],
        referencePreferredSurfaceIds: ["surface:not-acceptable"],
        generated: [
          {
            id: "candidate:a",
            surfaceId: "surface:a",
            sourceFamily: "direct",
            semanticVerified: true,
          },
        ],
      },
    ]);

    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.error.code).toBe(
        "EVAL_CONVERSATION_RECALL_PREFERRED_SUBSET",
      );
    }
  });

  it("fails on duplicate benchmark case ids", () => {
    const base = {
      id: "duplicate",
      language: "vi",
      referenceAcceptableSurfaceIds: ["surface:a"],
      generated: [
        {
          id: "candidate:a",
          surfaceId: "surface:a",
          sourceFamily: "direct",
          semanticVerified: true,
        },
      ],
    };

    const report = reportConversationCandidateRecall([base, base]);
    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.error.code).toBe(
        "EVAL_CONVERSATION_RECALL_DUPLICATE_CASE",
      );
    }
  });
});
