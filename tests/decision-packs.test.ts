import { describe, expect, it } from "vitest";
import {
  DecisionPackRegistry,
  evaluateConfidence,
  loadDecisionPack,
  sentinelDecisionPack,
  validateCalibrationProfile,
  validateDecisionPack,
  type CalibrationProfile,
  type DecisionPackManifest,
} from "../packages/decision-packs/src/index.ts";
import type { DecisionAnswer } from "../packages/decision-runtime/src/index.ts";

describe("decision pack contracts", () => {
  it("loads the sentinel through the runtime boundary", () => {
    const loaded = loadDecisionPack(structuredClone(sentinelDecisionPack));
    expect(loaded.ok).toBe(true);
  });

  it("rejects malformed runtime manifests", () => {
    const loaded = loadDecisionPack({
      id: "broken",
      version: "1.0.0",
      maturity: "draft",
    });
    expect(loaded.ok).toBe(false);
  });

  it("rejects non-semver versions", () => {
    const invalid = {
      ...sentinelDecisionPack,
      version: "latest",
    };
    expect(validateDecisionPack(invalid).ok).toBe(false);
  });

  it("enforces the production quality gate", () => {
    const invalid: DecisionPackManifest = {
      ...sentinelDecisionPack,
      maturity: "production",
      fixtures: [],
      counterexamples: [],
      calibrationProfile: undefined,
    };
    const result = validateDecisionPack(invalid);
    expect(result.ok).toBe(false);
  });

  it("registers exact versions and rejects duplicates", () => {
    const registry = new DecisionPackRegistry();
    expect(registry.register(sentinelDecisionPack).ok).toBe(true);
    expect(registry.register(sentinelDecisionPack).ok).toBe(false);
    const resolved = registry.resolve(
      sentinelDecisionPack.id,
      sentinelDecisionPack.version,
    );
    expect(resolved.ok).toBe(true);
  });
});

describe("calibration and abstention", () => {
  const profile: CalibrationProfile = {
    id: "sentinel.calibration.test",
    version: "1.0.0",
    decisionPackId: sentinelDecisionPack.id,
    decisionPackVersion: sentinelDecisionPack.version,
    domain: "fixture",
    rules: {
      preserves_negation: {
        questionId: "preserves_negation",
        noulAbstainBand: [0.4, 0.6],
        minSelectedProbability: 0.7,
        bins: [
          {
            raw: [0.9, 1],
            empiricalAccuracy: 0.95,
            sampleCount: 20,
          },
        ],
      },
    },
  };

  const answer = (pTrue: number): DecisionAnswer => ({
    questionId: "preserves_negation",
    type: "noul",
    selected: pTrue >= 0.5,
    probabilities: { true: pTrue, false: 1 - pTrue },
    model: "recorded:jev",
    latencyMs: 1,
  });

  it("validates a decision-family-specific profile", () => {
    expect(validateCalibrationProfile(profile).ok).toBe(true);
  });

  it("preserves ambiguity inside the configured Noul abstention band", () => {
    const result = evaluateConfidence(
      answer(0.52),
      profile.rules.preserves_negation,
      "preserve-ambiguity",
    );
    expect(result.disposition).toBe("preserve-ambiguity");
    expect(result.reason).toBe("noul-abstain-band");
  });

  it("accepts high-support answers under the pack-specific rule", () => {
    const result = evaluateConfidence(
      answer(0.93),
      profile.rules.preserves_negation,
      "preserve-ambiguity",
    );
    expect(result.disposition).toBe("accept");
  });

  it("does not invent a universal threshold when a rule is missing", () => {
    const result = evaluateConfidence(
      answer(0.99),
      undefined,
      "consumer-clarification",
    );
    expect(result.disposition).toBe("consumer-clarification");
    expect(result.reason).toBe("missing-rule");
  });
});
