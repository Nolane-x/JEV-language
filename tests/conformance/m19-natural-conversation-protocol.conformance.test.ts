import { describe, expect, it } from "vitest";
import manifestJson from "../../evals/manifests/m19-natural-conversation.json";
import {
  createM19BlindedBundle,
  reportM19NaturalConversation,
  validateM19HumanRatings,
  validateM19StudyManifest,
  type M19HumanRating,
  type M19Stimulus,
  type M19StudyManifest,
} from "../../packages/evaluation-core/src/index.ts";

const manifest =
  manifestJson as unknown as M19StudyManifest;

const stimuli = (): M19Stimulus[] =>
  manifest.items.flatMap((item, itemIndex) =>
    manifest.armCodes.map((armCode, armIndex) => ({
      itemId: item.id,
      armCode,
      output: `Synthetic protocol fixture output ${itemIndex}-${armIndex}`,
      latencyMs: 10 + itemIndex + armIndex,
      costUnits: 1 + armIndex,
      semanticEvidenceRefs: [`fixture:semantic:${item.id}:${armCode}`],
    })),
  );

const completeSyntheticRatings = (): M19HumanRating[] =>
  stimuli().flatMap((stimulus) => [
    {
      evaluatorId: "synthetic-evaluator-1",
      itemId: stimulus.itemId,
      armCode: stimulus.armCode,
      naturalness: 4,
      semanticAccuracy: 5,
      multiTurnCoherence: 4,
      templateJudgment: "not-template",
    },
    {
      evaluatorId: "synthetic-evaluator-2",
      itemId: stimulus.itemId,
      armCode: stimulus.armCode,
      naturalness: 3,
      semanticAccuracy: 4,
      multiTurnCoherence: 4,
      templateJudgment: "unsure",
    },
  ]);

describe("M19 natural-conversation research protocol", () => {
  it("validates the preregistered manifest only when every required phenomenon is represented", () => {
    const valid = validateM19StudyManifest(manifest);
    expect(valid.ok).toBe(true);

    const incomplete = structuredClone(manifest);
    incomplete.items = incomplete.items.map((item) => ({
      ...item,
      phenomena: item.phenomena.filter(
        (phenomenon) => phenomenon !== "open-domain-unknown-term",
      ),
    }));
    const rejected = validateM19StudyManifest(incomplete);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe(
        "EVAL_M19_PHENOMENON_COVERAGE",
      );
    }
  });

  it("creates a blinded arm-coded bundle without requiring or exposing system identities", () => {
    const bundle = createM19BlindedBundle(manifest, stimuli());
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;

    expect(bundle.value.blinded).toBe(true);
    expect(bundle.value.stimuli).toHaveLength(
      manifest.items.length * manifest.armCodes.length,
    );
    expect(
      bundle.value.stimuli.every((stimulus) =>
        manifest.armCodes.includes(stimulus.armCode),
      ),
    ).toBe(true);
    expect(
      JSON.stringify(bundle.value).toLowerCase(),
    ).not.toContain("systemidentity");
  });

  it("keeps M19 pending-human-data when no observed human ratings are supplied", () => {
    const bundle = createM19BlindedBundle(manifest, stimuli());
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;

    const report = reportM19NaturalConversation({
      manifest,
      bundle: bundle.value,
      ratings: [],
      failures: [],
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.status).toBe("pending-human-data");
    expect(report.value.measurementComplete).toBe(false);
    expect(report.value.humanRatingsObserved).toBe(false);
    expect(report.value.diagnostics).toContain(
      "HUMAN_RATINGS_NOT_OBSERVED",
    );
    expect(report.value.unratedStimulusIds.length).toBe(
      bundle.value.stimuli.length,
    );
  });

  it("rejects invalid or duplicate human rating records at the import boundary", () => {
    const bundle = createM19BlindedBundle(manifest, stimuli());
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;

    const bad: M19HumanRating = {
      evaluatorId: "evaluator-1",
      itemId: bundle.value.stimuli[0]!.itemId,
      armCode: bundle.value.stimuli[0]!.armCode,
      naturalness: 6,
      semanticAccuracy: 5,
      multiTurnCoherence: 5,
      templateJudgment: "not-template",
    };
    expect(
      validateM19HumanRatings(manifest, bundle.value, [bad]).ok,
    ).toBe(false);

    const good = { ...bad, naturalness: 5 };
    expect(
      validateM19HumanRatings(manifest, bundle.value, [good, good]).ok,
    ).toBe(false);
  });

  it("marks a synthetic mechanics fixture complete only after every stimulus meets the preregistered rating floor", () => {
    const bundle = createM19BlindedBundle(manifest, stimuli());
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;

    // These values test aggregation mechanics only. They are not observed
    // human ratings and MUST NOT be persisted as M19 research results.
    const ratings = completeSyntheticRatings();
    const report = reportM19NaturalConversation({
      manifest,
      bundle: bundle.value,
      ratings,
      failures: [
        {
          itemId: bundle.value.stimuli[0]!.itemId,
          armCode: bundle.value.stimuli[0]!.armCode,
          category: "style-mismatch",
          description: "Synthetic failure-taxonomy fixture.",
          evidenceRefs: ["fixture:m19:failure-taxonomy"],
        },
      ],
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.status).toBe("complete");
    expect(report.value.measurementComplete).toBe(true);
    expect(report.value.humanRatingsObserved).toBe(true);
    expect(report.value.unratedStimulusIds).toEqual([]);
    expect(report.value.failureTaxonomy).toEqual({
      "style-mismatch": 1,
    });
    expect(
      report.value.arms.every(
        (arm) =>
          arm.naturalnessMean === 3.5 &&
          arm.semanticAccuracyMean === 4.5 &&
          arm.multiTurnCoherenceMean === 4 &&
          arm.ratingCount ===
            manifest.items.length * manifest.minRatingsPerStimulus,
      ),
    ).toBe(true);
  });

  it("does not convert negative human outcomes into protocol failure or fake success", () => {
    const bundle = createM19BlindedBundle(manifest, stimuli());
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;

    const ratings = completeSyntheticRatings().map((rating) => ({
      ...rating,
      naturalness: 1,
      semanticAccuracy: 1,
      multiTurnCoherence: 1,
      templateJudgment: "template" as const,
    }));
    const report = reportM19NaturalConversation({
      manifest,
      bundle: bundle.value,
      ratings,
      failures: bundle.value.stimuli.map((stimulus) => ({
        itemId: stimulus.itemId,
        armCode: stimulus.armCode,
        category: "template-like" as const,
        description: "Synthetic negative-result fixture.",
        evidenceRefs: ["fixture:m19:negative-result"],
      })),
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.status).toBe("complete");
    expect(report.value.measurementComplete).toBe(true);
    expect(
      report.value.arms.every(
        (arm) =>
          arm.naturalnessMean === 1 &&
          arm.templateDetectionRate === 1,
      ),
    ).toBe(true);
    expect(report.value.failureTaxonomy["template-like"]).toBe(
      bundle.value.stimuli.length,
    );
  });
});
