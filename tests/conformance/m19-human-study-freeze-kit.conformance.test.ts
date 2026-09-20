import { describe, expect, it } from "vitest";
import manifestJson from "../../evals/manifests/m19-natural-conversation.json";
import {
  createM19BlindedBundle,
  createM19RatingWorksheet,
  freezeM19HumanStudyEvidence,
  importM19RatingWorksheets,
  type M19RatingWorksheet,
  type M19Stimulus,
  type M19StudyManifest,
} from "../../packages/evaluation-core/src/index.ts";

const manifest = manifestJson as unknown as M19StudyManifest;

const makeBundle = () => {
  const stimuli: M19Stimulus[] = manifest.items.flatMap((item, itemIndex) =>
    manifest.armCodes.map((armCode, armIndex) => ({
      itemId: item.id,
      armCode,
      output: `Protocol stimulus ${itemIndex}-${armIndex}`,
      latencyMs: 20 + itemIndex + armIndex,
      costUnits: 1 + armIndex,
      semanticEvidenceRefs: [`evidence:${item.id}:${armCode}`],
    })),
  );
  const bundle = createM19BlindedBundle(manifest, stimuli);
  if (!bundle.ok) throw bundle.error;
  return bundle.value;
};

const completedWorksheet = (
  evaluatorId: string,
  score: number,
): M19RatingWorksheet => {
  const worksheet = createM19RatingWorksheet(manifest, makeBundle());
  if (!worksheet.ok) throw worksheet.error;
  worksheet.value.evaluatorId = evaluatorId;
  worksheet.value.rows = worksheet.value.rows.map((row) => ({
    ...row,
    naturalness: score,
    semanticAccuracy: score,
    multiTurnCoherence: score,
    templateJudgment: score >= 3 ? "not-template" : "template",
  }));
  return worksheet.value;
};

describe("M19 real human-study freeze kit", () => {
  it("creates an evaluator worksheet without latency, cost, or semantic-evidence leakage", () => {
    const worksheet = createM19RatingWorksheet(manifest, makeBundle());
    expect(worksheet.ok).toBe(true);
    if (!worksheet.ok) return;

    expect(worksheet.value.blinded).toBe(true);
    expect(worksheet.value.evaluatorId).toBe("");
    expect(worksheet.value.rows).toHaveLength(
      manifest.items.length * manifest.armCodes.length,
    );
    const serialized = JSON.stringify(worksheet.value);
    expect(serialized).not.toContain("latencyMs");
    expect(serialized).not.toContain("costUnits");
    expect(serialized).not.toContain("semanticEvidenceRefs");
  });

  it("imports complete pseudonymous worksheets through the existing rating validator", () => {
    const bundle = makeBundle();
    const imported = importM19RatingWorksheets(manifest, bundle, [
      completedWorksheet("evaluator-a", 4),
      completedWorksheet("evaluator-b", 3),
    ]);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    expect(imported.value).toHaveLength(
      bundle.stimuli.length * manifest.minRatingsPerStimulus,
    );
    expect(new Set(imported.value.map((rating) => rating.evaluatorId))).toEqual(
      new Set(["evaluator-a", "evaluator-b"]),
    );
  });

  it("rejects incomplete worksheets instead of silently treating blanks as human data", () => {
    const bundle = makeBundle();
    const worksheet = completedWorksheet("evaluator-a", 4);
    worksheet.rows[0] = {
      ...worksheet.rows[0]!,
      naturalness: null,
    };

    const imported = importM19RatingWorksheets(manifest, bundle, [worksheet]);
    expect(imported.ok).toBe(false);
    if (!imported.ok) {
      expect(imported.error.code).toBe("EVAL_M19_WORKSHEET_ROW");
    }
  });

  it("freezes a complete study into order-independent content digests without changing negative results", () => {
    const bundle = makeBundle();
    const imported = importM19RatingWorksheets(manifest, bundle, [
      completedWorksheet("evaluator-a", 1),
      completedWorksheet("evaluator-b", 1),
    ]);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const failures = bundle.stimuli.map((stimulus) => ({
      itemId: stimulus.itemId,
      armCode: stimulus.armCode,
      category: "template-like" as const,
      description: "Observed negative result.",
      evidenceRefs: [`human:evidence:${stimulus.itemId}:${stimulus.armCode}`],
    }));

    const frozen = freezeM19HumanStudyEvidence({
      manifest,
      bundle,
      ratings: imported.value,
      failures,
      frozenAt: "2026-09-20T08:30:00.000Z",
    });
    const reordered = freezeM19HumanStudyEvidence({
      manifest,
      bundle,
      ratings: [...imported.value].reverse(),
      failures: [...failures].reverse(),
      frozenAt: "2026-09-20T08:30:00.000Z",
    });

    expect(frozen.ok).toBe(true);
    expect(reordered.ok).toBe(true);
    if (!frozen.ok || !reordered.ok) return;

    expect(frozen.value.status).toBe("complete");
    expect(frozen.value.measurementComplete).toBe(true);
    expect(frozen.value.ratingCount).toBe(imported.value.length);
    expect(frozen.value.evaluatorCount).toBe(2);
    expect(frozen.value.report.arms.every((arm) => arm.naturalnessMean === 1)).toBe(
      true,
    );
    expect(frozen.value.digests).toEqual(reordered.value.digests);
  });
});
