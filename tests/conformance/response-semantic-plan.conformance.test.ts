import { describe, expect, it } from "vitest";
import {
  projectResponsePlanForSurfaceRanking,
  responsePlanToDiscourseGoal,
  validateResponseSemanticPlan,
  type ResponseSemanticPlan,
} from "../../packages/discourse-ir/src/index.ts";

const plan = (): ResponseSemanticPlan => ({
  schemaVersion: "jl-response-semantic-plan-1",
  id: "response:vi:peer:1",
  dialogueAct: "answer",
  targetLanguage: "vi",
  requiredSemanticRefs: ["semantic:answer"],
  optionalSemanticRefs: ["semantic:detail"],
  activeTopicRefs: ["semantic:topic"],
  referenceBindings: [
    {
      mentionId: "mention:report",
      semanticRef: "semantic:report",
      confidence: 0.94,
      source: "dialogue-state",
    },
  ],
  epistemic: {
    status: "probable",
    confidence: 0.78,
    evidenceRefs: ["evidence:log"],
  },
  social: {
    relation: "peer",
    register: "casual",
    politeness: 0.55,
    speakerFormHint: "mình",
    addresseeFormHint: "bạn",
  },
  desiredLength: "concise",
  allowCodeSwitch: true,
  preserveOpaqueTerms: true,
});

describe("response semantic plan", () => {
  it("validates a typed dialogue response contract and projects a discourse goal", () => {
    const valid = validateResponseSemanticPlan(plan());
    expect(valid.ok).toBe(true);

    const goal = responsePlanToDiscourseGoal(plan());
    expect(goal.ok).toBe(true);
    if (!goal.ok) return;

    expect(goal.value.kind).toBe("answer");
    expect(goal.value.semanticRoots).toEqual(["semantic:answer"]);
    expect(goal.value.targetLength).toBe("concise");
    expect(goal.value.annotations).toMatchObject({
      targetLanguage: "vi",
      responseRegister: "casual",
      responseSocialRelation: "peer",
      allowCodeSwitch: true,
      preserveOpaqueTerms: true,
    });
  });

  it("projects conversational context without leaking evidence text into the surface-ranker state", () => {
    const projected = projectResponsePlanForSurfaceRanking(plan());
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;

    expect(projected.value).toMatchObject({
      dialogueAct: "answer",
      targetLanguage: "vi",
      epistemic: {
        status: "probable",
        confidence: 0.78,
      },
      social: {
        relation: "peer",
        register: "casual",
        speakerFormHint: "mình",
        addresseeFormHint: "bạn",
      },
    });
    expect(JSON.stringify(projected.value)).not.toContain("evidence:log");
  });

  it("rejects semantic content that is simultaneously required and optional", () => {
    const invalid = plan();
    invalid.optionalSemanticRefs = ["semantic:answer"];
    const result = validateResponseSemanticPlan(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "DIR_RESPONSE_PLAN_REQUIRED_OPTIONAL_CONFLICT",
      );
    }
  });

  it("rejects certainty labels that contradict calibrated confidence", () => {
    const invalid = plan();
    invalid.epistemic = {
      status: "certain",
      confidence: 0.62,
    };
    const result = validateResponseSemanticPlan(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DIR_RESPONSE_PLAN_CERTAINTY_CONFLICT");
    }
  });

  it("requires explicit correction targets instead of silently overwriting dialogue state", () => {
    const correction = plan();
    correction.dialogueAct = "correct";
    correction.correctionOfRefs = [];
    const result = validateResponseSemanticPlan(correction);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DIR_RESPONSE_PLAN_CORRECTION_TARGET");
    }
  });

  it("keeps reference bindings explicit and refuses duplicate mention identities", () => {
    const invalid = plan();
    invalid.referenceBindings.push({
      mentionId: "mention:report",
      semanticRef: "semantic:other",
      confidence: 0.8,
      source: "resolved",
    });
    const result = validateResponseSemanticPlan(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DIR_RESPONSE_PLAN_REFERENCE_BINDING");
    }
  });
});
