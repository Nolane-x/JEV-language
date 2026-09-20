import { describe, expect, it } from "vitest";
import manifestJson from "../../evals/manifests/m19-natural-conversation.json";
import scenarioJson from "../../evals/scenarios/m19-natural-conversation-v1.json";
import {
  err,
  ok,
  StructuredError,
} from "../../packages/core-types/src/index.ts";
import {
  runM19ObservedArm,
  validateM19ScenarioPack,
  type M19ObservedArm,
  type M19ScenarioPack,
  type M19StudyManifest,
} from "../../packages/evaluation-core/src/index.ts";

const manifest = manifestJson as unknown as M19StudyManifest;
const scenarios = scenarioJson as unknown as M19ScenarioPack;

describe("M19 observed arm runner", () => {
  it("validates the fixed scenario pack against the preregistered manifest", () => {
    const result = validateM19ScenarioPack(manifest, scenarios);
    expect(result.ok).toBe(true);
  });

  it("executes one anonymous arm across all scenarios and records exact observed turns", async () => {
    let resetCount = 0;
    let responseCount = 0;
    let activeItem = "";

    const arm: M19ObservedArm & { internalSystemIdentity: string } = {
      internalSystemIdentity: "secret-system-a",
      reset({ itemId }) {
        resetCount += 1;
        activeItem = itemId;
        return ok(undefined);
      },
      respond({ itemId, userText, userTurnIndex }) {
        expect(activeItem).toBe(itemId);
        responseCount += 1;
        return ok({
          text: `Observed response ${itemId} turn ${userTurnIndex + 1}: ${userText.slice(0, 18)}`,
          latencyMs: 25 + userTurnIndex,
          costUnits: 0.5,
          semanticEvidenceRefs: [
            `semantic:${itemId}:${userTurnIndex}`,
          ],
          observationEvidenceRefs: [
            `trace:${itemId}:${userTurnIndex}`,
          ],
        });
      },
    };

    const result = await runM19ObservedArm({
      manifest,
      scenarios,
      armCode: "A",
      arm,
      observedAt: () => "2026-09-20T11:58:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(resetCount).toBe(manifest.items.length);
    expect(responseCount).toBe(
      manifest.items.reduce(
        (sum, item) => sum + item.expectedTurns / 2,
        0,
      ),
    );
    expect(result.value).toHaveLength(manifest.items.length);
    for (const capture of result.value) {
      const item = manifest.items.find(
        (entry) => entry.id === capture.itemId,
      )!;
      expect(capture.armCode).toBe("A");
      expect(capture.conversationRef).toBe(item.conversationRef);
      expect(capture.turns).toHaveLength(item.expectedTurns);
      expect(capture.semanticEvidenceRefs.length).toBe(
        item.expectedTurns / 2,
      );
      expect(capture.observationEvidenceRefs.length).toBe(
        item.expectedTurns / 2,
      );
    }

    expect(JSON.stringify(result.value)).not.toContain("secret-system-a");
  });

  it("resets state between scenarios instead of leaking one conversation into the next", async () => {
    let currentItem = "";
    let seenTurns = 0;

    const arm: M19ObservedArm = {
      reset({ itemId }) {
        currentItem = itemId;
        seenTurns = 0;
        return ok(undefined);
      },
      respond({ itemId }) {
        expect(itemId).toBe(currentItem);
        const localTurn = seenTurns;
        seenTurns += 1;
        return ok({
          text: `Item ${itemId} local turn ${localTurn}.`,
          latencyMs: 1,
          costUnits: 0,
          semanticEvidenceRefs: [`semantic:${itemId}:${localTurn}`],
          observationEvidenceRefs: [`trace:${itemId}:${localTurn}`],
        });
      },
    };

    const result = await runM19ObservedArm({
      manifest,
      scenarios,
      armCode: "B",
      arm,
      observedAt: () => "2026-09-20T11:58:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const capture of result.value) {
      expect(capture.turns[1]?.text).toContain("local turn 0");
    }
  });

  it("rejects an arm code outside the preregistered blinded study", async () => {
    const arm: M19ObservedArm = {
      reset() {
        return ok(undefined);
      },
      respond() {
        return ok({
          text: "Observed.",
          latencyMs: 1,
          costUnits: 0,
          semanticEvidenceRefs: ["semantic:x"],
          observationEvidenceRefs: ["trace:x"],
        });
      },
    };

    const result = await runM19ObservedArm({
      manifest,
      scenarios,
      armCode: "SYSTEM-NAME",
      arm,
      observedAt: () => "2026-09-20T11:58:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EVAL_M19_ARM_CODE");
    }
  });

  it("fails closed when an observed response lacks evidence", async () => {
    const arm: M19ObservedArm = {
      reset() {
        return ok(undefined);
      },
      respond() {
        return ok({
          text: "Observed response without evidence.",
          latencyMs: 1,
          costUnits: 0,
          semanticEvidenceRefs: [],
          observationEvidenceRefs: [],
        });
      },
    };

    const result = await runM19ObservedArm({
      manifest,
      scenarios,
      armCode: "A",
      arm,
      observedAt: () => "2026-09-20T11:58:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EVAL_M19_ARM_RESPONSE");
    }
  });

  it("normalizes adapter failures without inventing fallback output", async () => {
    const arm: M19ObservedArm = {
      reset() {
        return ok(undefined);
      },
      respond() {
        return err(
          new StructuredError(
            "FIXTURE_PROVIDER_UNAVAILABLE",
            "Provider unavailable.",
          ),
        );
      },
    };

    const result = await runM19ObservedArm({
      manifest,
      scenarios,
      armCode: "A",
      arm,
      observedAt: () => "2026-09-20T11:58:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FIXTURE_PROVIDER_UNAVAILABLE");
    }
  });
});
