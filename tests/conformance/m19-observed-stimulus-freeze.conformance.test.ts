import { describe, expect, it } from "vitest";
import manifestJson from "../../evals/manifests/m19-natural-conversation.json";
import scenarioJson from "../../evals/scenarios/m19-natural-conversation-v1.json";
import {
  freezeM19ObservedStimuli,
  formatM19ObservedTranscript,
  type M19ObservedStimulusCapture,
  type M19StudyManifest,
} from "../../packages/evaluation-core/src/index.ts";

const manifest = manifestJson as unknown as M19StudyManifest;

type ScenarioPack = {
  schemaVersion: string;
  studyId: string;
  version: string;
  items: Array<{
    id: string;
    conversationRef: string;
    languageTags: string[];
    userTurns: string[];
  }>;
};

const scenarios = scenarioJson as ScenarioPack;

const captures = (): M19ObservedStimulusCapture[] =>
  manifest.items.flatMap((item) => {
    const scenario = scenarios.items.find((entry) => entry.id === item.id);
    if (scenario === undefined) throw new Error(`Missing scenario: ${item.id}`);

    return manifest.armCodes.map((armCode) => {
      const turns = scenario.userTurns.flatMap((text, index) => [
        { role: "user" as const, text },
        {
          role: "assistant" as const,
          text: `Synthetic capture mechanics fixture ${item.id} ${armCode} assistant turn ${index + 1}.`,
        },
      ]);
      return {
        itemId: item.id,
        armCode,
        conversationRef: item.conversationRef,
        turns,
        latencyMs: 100 + turns.length,
        costUnits: 1,
        semanticEvidenceRefs: [`fixture:semantic:${item.id}:${armCode}`],
        observationEvidenceRefs: [`fixture:observation:${item.id}:${armCode}`],
        observedAt: "2026-09-20T11:50:00.000Z",
      };
    });
  });

describe("M19 observed stimulus freeze", () => {
  it("keeps the scenario pack aligned with the preregistered manifest", () => {
    expect(scenarios.schemaVersion).toBe("jl-m19-scenario-pack-1");
    expect(scenarios.studyId).toBe(manifest.id);
    expect(scenarios.items.map((item) => item.id).sort()).toEqual(
      manifest.items.map((item) => item.id).sort(),
    );

    for (const item of manifest.items) {
      const scenario = scenarios.items.find((entry) => entry.id === item.id);
      expect(scenario).toBeDefined();
      expect(scenario?.conversationRef).toBe(item.conversationRef);
      expect(scenario?.languageTags).toEqual(item.languageTags);
      expect(scenario?.userTurns).toHaveLength(item.expectedTurns / 2);
      expect(
        scenario?.userTurns.every((turn) => turn.trim().length > 0),
      ).toBe(true);
    }
  });

  it("formats the complete multi-turn transcript without exposing measurement metadata", () => {
    const transcript = formatM19ObservedTranscript([
      { role: "user", text: "First user turn." },
      { role: "assistant", text: "First assistant turn." },
      { role: "user", text: "Second user turn." },
      { role: "assistant", text: "Second assistant turn." },
    ]);
    expect(transcript.ok).toBe(true);
    if (!transcript.ok) return;
    expect(transcript.value).toBe(
      "[User]\nFirst user turn.\n\n[Assistant]\nFirst assistant turn.\n\n[User]\nSecond user turn.\n\n[Assistant]\nSecond assistant turn.",
    );
  });

  it("freezes exactly one observed capture for every item/arm pair and emits a blinded worksheet", () => {
    const frozen = freezeM19ObservedStimuli({
      manifest,
      captures: captures(),
      frozenAt: "2026-09-20T11:55:00.000Z",
    });
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;

    expect(frozen.value.blinded).toBe(true);
    expect(frozen.value.observedCaptureCount).toBe(
      manifest.items.length * manifest.armCodes.length,
    );
    expect(frozen.value.bundle.stimuli).toHaveLength(
      manifest.items.length * manifest.armCodes.length,
    );
    expect(frozen.value.evaluatorWorksheetTemplate.rows).toHaveLength(
      frozen.value.bundle.stimuli.length,
    );

    const worksheet = JSON.stringify(
      frozen.value.evaluatorWorksheetTemplate,
    );
    expect(worksheet).not.toContain("latencyMs");
    expect(worksheet).not.toContain("costUnits");
    expect(worksheet).not.toContain("semanticEvidenceRefs");
    expect(worksheet).not.toContain("observationEvidenceRefs");
    expect(worksheet).not.toContain("observedAt");
  });

  it("makes the freeze digest independent of capture input ordering", () => {
    const input = captures();
    const first = freezeM19ObservedStimuli({
      manifest,
      captures: input,
      frozenAt: "2026-09-20T11:55:00.000Z",
    });
    const second = freezeM19ObservedStimuli({
      manifest,
      captures: [...input].reverse(),
      frozenAt: "2026-09-20T11:55:00.000Z",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.digests).toEqual(second.value.digests);
  });

  it("fails closed on missing real item/arm coverage instead of fabricating a stimulus", () => {
    const incomplete = captures().slice(1);
    const frozen = freezeM19ObservedStimuli({
      manifest,
      captures: incomplete,
      frozenAt: "2026-09-20T11:55:00.000Z",
    });
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) {
      expect(frozen.error.code).toBe("EVAL_M19_OBSERVED_COVERAGE");
    }
  });

  it("rejects turn-count, conversation-ref, and alternation mismatches", () => {
    const badCount = captures();
    badCount[0]!.turns = badCount[0]!.turns.slice(0, -2);
    const countResult = freezeM19ObservedStimuli({
      manifest,
      captures: badCount,
      frozenAt: "2026-09-20T11:55:00.000Z",
    });
    expect(countResult.ok).toBe(false);
    if (!countResult.ok) {
      expect(countResult.error.code).toBe("EVAL_M19_OBSERVED_CAPTURE");
    }

    const badRef = captures();
    badRef[0]!.conversationRef = "eval:m19:not-this-item";
    const refResult = freezeM19ObservedStimuli({
      manifest,
      captures: badRef,
      frozenAt: "2026-09-20T11:55:00.000Z",
    });
    expect(refResult.ok).toBe(false);

    const badOrder = captures();
    badOrder[0]!.turns[1] = {
      role: "user",
      text: "This breaks turn alternation.",
    };
    const orderResult = freezeM19ObservedStimuli({
      manifest,
      captures: badOrder,
      frozenAt: "2026-09-20T11:55:00.000Z",
    });
    expect(orderResult.ok).toBe(false);
    if (!orderResult.ok) {
      expect(orderResult.error.code).toBe("EVAL_M19_OBSERVED_TURN_ORDER");
    }
  });

  it("requires separate observation evidence in addition to semantic evidence", () => {
    const missingObservation = captures();
    missingObservation[0]!.observationEvidenceRefs = [];
    const result = freezeM19ObservedStimuli({
      manifest,
      captures: missingObservation,
      frozenAt: "2026-09-20T11:55:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EVAL_M19_OBSERVED_CAPTURE");
    }
  });
});
