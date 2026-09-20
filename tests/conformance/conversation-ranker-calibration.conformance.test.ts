import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  reportConversationRankerThreshold,
  sweepConversationRankerThresholds,
} from "../../packages/evaluation-core/src/index.ts";

type EvidenceCase = {
  id: string;
  agreement_with_preregistered_preference: boolean;
  observed: {
    confidence: number | null;
    margin: number | null;
  };
};

describe("conversation-ranker threshold calibration", () => {
  it("evaluates the current selection defaults against frozen v3 live evidence without pretending the all-correct set is fully calibrating", () => {
    const evidence = JSON.parse(
      readFileSync(
        "docs/evidence/CONVERSATION-RANKER-ORDER-SYMMETRY-v3.json",
        "utf8",
      ),
    ) as { cases: EvidenceCase[] };

    const observations = evidence.cases.map((item) => ({
      id: item.id,
      confidence: Number(item.observed.confidence ?? 0),
      margin: Number(item.observed.margin ?? 0),
      correct: item.agreement_with_preregistered_preference,
    }));

    const report = reportConversationRankerThreshold(observations);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.observations).toBe(20);
    expect(report.value.correctObservations).toBe(20);
    expect(report.value.incorrectObservations).toBe(0);
    expect(report.value.status).toBe("insufficient-errors");
    expect(report.value.coverage).toBe(0.95);
    expect(report.value.selectiveAccuracy).toBe(1);
    expect(report.value.falseAbstentionRate).toBe(0.05);
    expect(report.value.errorCatchRate).toBeUndefined();
    expect(report.value.abstainedIds).toEqual([
      "ja-workplace-register:mirrored",
    ]);
  });

  it("can measure whether thresholds catch actual ranking errors on a synthetic mixed set", () => {
    const report = reportConversationRankerThreshold(
      [
        {
          id: "correct-high",
          confidence: 0.9,
          margin: 0.8,
          correct: true,
        },
        {
          id: "correct-low",
          confidence: 0.55,
          margin: 0.3,
          correct: true,
        },
        {
          id: "wrong-low",
          confidence: 0.4,
          margin: 0.05,
          correct: false,
        },
        {
          id: "wrong-high",
          confidence: 0.9,
          margin: 0.7,
          correct: false,
        },
      ],
      {
        minConfidence: 0.62,
        minMargin: 0.08,
      },
    );

    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.status).toBe("adequate");
    expect(report.value.coverage).toBe(0.5);
    expect(report.value.selectiveAccuracy).toBe(0.5);
    expect(report.value.falseAbstentionRate).toBe(0.5);
    expect(report.value.errorCatchRate).toBe(0.5);
    expect(report.value.acceptedIncorrect).toBe(1);
    expect(report.value.abstainedIncorrect).toBe(1);
  });

  it("sweeps thresholds without selecting a winner from insufficient evidence", () => {
    const observations = [
      {
        id: "a",
        confidence: 0.9,
        margin: 0.8,
        correct: true,
      },
      {
        id: "b",
        confidence: 0.5,
        margin: 0.4,
        correct: true,
      },
    ];

    const reports = sweepConversationRankerThresholds(observations, [
      { minConfidence: 0.4, minMargin: 0.08 },
      { minConfidence: 0.62, minMargin: 0.08 },
      { minConfidence: 0.8, minMargin: 0.5 },
    ]);
    expect(reports.ok).toBe(true);
    if (!reports.ok) return;

    expect(reports.value).toHaveLength(3);
    expect(reports.value.every((item) => item.status === "insufficient-errors")).toBe(true);
    expect(reports.value.map((item) => item.coverage)).toEqual([1, 0.5, 0.5]);
  });

  it("rejects invalid threshold probabilities and duplicate sweep points", () => {
    const invalid = reportConversationRankerThreshold([], {
      minConfidence: 1.1,
      minMargin: 0.1,
    });
    expect(invalid.ok).toBe(false);

    const duplicate = sweepConversationRankerThresholds(
      [
        {
          id: "a",
          confidence: 0.8,
          margin: 0.5,
          correct: true,
        },
      ],
      [
        { minConfidence: 0.5, minMargin: 0.1 },
        { minConfidence: 0.5, minMargin: 0.1 },
      ],
    );
    expect(duplicate.ok).toBe(false);
  });
});
