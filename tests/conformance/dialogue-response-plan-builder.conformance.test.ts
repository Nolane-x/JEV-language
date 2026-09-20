import { describe, expect, it } from "vitest";
import {
  buildResponseSemanticPlanFromDialogueState,
  InMemoryDialogueState,
  type DialogueUpdate,
} from "../../packages/dialogue-state/src/index.ts";

const social = {
  relation: "peer" as const,
  register: "casual" as const,
  politeness: 0.45,
  speakerFormHint: "mình",
  addresseeFormHint: "bạn",
};

const commit = (
  dialogue: InMemoryDialogueState,
  update: DialogueUpdate,
) => {
  const result = dialogue.commit(dialogue.beginUpdate(update));
  if (!result.ok) throw result.error;
  return result.value;
};

const userTurn = (
  id: string,
  turnNumber: number,
  kind: "ASSERT" | "ASK" | "CORRECT" | "CONTINUE",
  options: {
    parsedRoots?: Array<`${string}:${string}`>;
    introducedEntities?: Array<`${string}:${string}`>;
    referencedEntities?: Array<`${string}:${string}`>;
    topicChanges?: DialogueUpdate["turn"]["topicChanges"];
    literal?: string;
  } = {},
): DialogueUpdate["turn"] => ({
  id,
  turnNumber,
  participant: "user",
  sourceRef: `source:${id}`,
  literal: options.literal ?? id,
  parsedRoots: options.parsedRoots ?? [],
  dialogueActs: [
    {
      kind,
      contentRoots: options.parsedRoots ?? [],
    },
  ],
  introducedEntities: options.introducedEntities ?? [],
  referencedEntities: options.referencedEntities ?? [],
  commitmentChanges: [],
  topicChanges: options.topicChanges ?? [],
});

describe("dialogue-state response semantic plan builder", () => {
  it("turns the latest user question into an answer plan with active-topic and reference context", () => {
    const dialogue = new InMemoryDialogueState([
      { id: "user" },
      { id: "assistant" },
    ]);

    commit(dialogue, {
      turn: userTurn("turn:1", 1, "ASSERT", {
        parsedRoots: ["semantic:oriole-cache"],
        introducedEntities: ["entity:r17"],
        topicChanges: [
          {
            kind: "push",
            topic: {
              id: "topic:oriole-cache",
              rootConcepts: ["OrioleCache"],
              relatedEntities: ["entity:r17"],
              introducedTurn: 0,
              lastActiveTurn: 0,
            },
          },
        ],
      }),
      entityMentions: [
        {
          id: "entity:r17",
          semanticType: "request",
          labels: ["R17"],
          introduced: true,
        },
      ],
    });

    const state = commit(dialogue, {
      turn: userTurn("turn:2", 2, "ASK", {
        parsedRoots: ["semantic:question-r17"],
        referencedEntities: ["entity:r17"],
        literal: "What happened to that request?",
      }),
    });

    const result = buildResponseSemanticPlanFromDialogueState({
      state,
      responseId: "response:turn-2",
      respondingToParticipantId: "user",
      targetLanguage: "en",
      requiredSemanticRefs: ["semantic:answer-r17"],
      optionalSemanticRefs: ["semantic:detail-r17"],
      epistemic: {
        status: "certain",
        confidence: 0.95,
        evidenceRefs: ["evidence:state:r17"],
      },
      social,
      desiredLength: "concise",
      allowCodeSwitch: false,
      preserveOpaqueTerms: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dialogueAct).toBe("answer");
    expect(result.value.activeTopicRefs).toEqual(["entity:r17"]);
    expect(result.value.referenceBindings).toEqual([
      {
        mentionId: "turn:2:reference:1",
        semanticRef: "entity:r17",
        confidence: 1,
        source: "dialogue-state",
      },
    ]);
    expect(result.value.annotations).toMatchObject({
      sourceTurnId: "turn:2",
      sourceTurnNumber: 2,
      activeTopicId: "topic:oriole-cache",
      correctionCount: 0,
    });
  });

  it("acknowledges a user correction and carries the corrected target refs into the response plan", () => {
    const dialogue = new InMemoryDialogueState([
      { id: "user" },
      { id: "assistant" },
    ]);

    const state = commit(dialogue, {
      turn: userTurn("turn:1", 1, "CORRECT", {
        parsedRoots: ["semantic:new-plan"],
        literal: "No, the river walk is Friday.",
      }),
      corrections: [
        {
          id: "correction:1",
          kind: "replace-proposition",
          turnId: "turn:1",
          targetRefs: ["semantic:old-plan"],
          replacementRefs: ["semantic:new-plan"],
        },
      ],
    });

    const result = buildResponseSemanticPlanFromDialogueState({
      state,
      responseId: "response:correction-1",
      respondingToParticipantId: "user",
      targetLanguage: "en",
      requiredSemanticRefs: ["semantic:new-plan"],
      epistemic: {
        status: "certain",
        confidence: 0.99,
      },
      social,
      desiredLength: "concise",
      allowCodeSwitch: false,
      preserveOpaqueTerms: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dialogueAct).toBe("acknowledge");
    expect(result.value.correctionOfRefs).toEqual(["semantic:old-plan"]);
    expect(result.value.annotations).toMatchObject({
      correctionCount: 1,
      sourceDialogueActs: ["CORRECT"],
    });
  });

  it("supports explicit correction-response override only when correction targets actually exist", () => {
    const dialogue = new InMemoryDialogueState([
      { id: "user" },
      { id: "assistant" },
    ]);
    const state = commit(dialogue, {
      turn: userTurn("turn:1", 1, "ASK"),
    });

    const result = buildResponseSemanticPlanFromDialogueState({
      state,
      responseId: "response:invalid-correct",
      respondingToParticipantId: "user",
      targetLanguage: "en",
      requiredSemanticRefs: ["semantic:answer"],
      epistemic: {
        status: "probable",
        confidence: 0.8,
      },
      social,
      desiredLength: "normal",
      allowCodeSwitch: false,
      preserveOpaqueTerms: true,
      dialogueActOverride: "correct",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "DIR_RESPONSE_PLAN_CORRECTION_TARGET",
      );
    }
  });

  it("derives continuation from the latest retained user turn even when assistant turns are newer", () => {
    const dialogue = new InMemoryDialogueState([
      { id: "user" },
      { id: "assistant" },
    ]);

    commit(dialogue, {
      turn: userTurn("turn:user-1", 1, "CONTINUE", {
        parsedRoots: ["semantic:topic-return"],
      }),
    });

    const state = commit(dialogue, {
      turn: {
        id: "turn:assistant-2",
        turnNumber: 2,
        participant: "assistant",
        sourceRef: "source:assistant-2",
        literal: "Previous assistant reply.",
        parsedRoots: ["semantic:assistant-reply"],
        dialogueActs: [
          {
            kind: "ASSERT",
            contentRoots: ["semantic:assistant-reply"],
          },
        ],
        introducedEntities: [],
        referencedEntities: [],
        commitmentChanges: [],
        topicChanges: [],
      },
    });

    const result = buildResponseSemanticPlanFromDialogueState({
      state,
      responseId: "response:continue",
      respondingToParticipantId: "user",
      targetLanguage: "en",
      requiredSemanticRefs: ["semantic:topic-return"],
      epistemic: {
        status: "certain",
        confidence: 0.95,
      },
      social,
      desiredLength: "concise",
      allowCodeSwitch: false,
      preserveOpaqueTerms: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dialogueAct).toBe("continue");
    expect(result.value.annotations).toMatchObject({
      sourceTurnId: "turn:user-1",
      sourceTurnNumber: 1,
    });
  });

  it("fails closed when the participant has no retained source turn", () => {
    const dialogue = new InMemoryDialogueState([
      { id: "user" },
      { id: "assistant" },
    ]);

    const result = buildResponseSemanticPlanFromDialogueState({
      state: dialogue.snapshot(),
      responseId: "response:none",
      respondingToParticipantId: "user",
      targetLanguage: "vi",
      requiredSemanticRefs: [],
      epistemic: {
        status: "unknown",
        confidence: 0,
      },
      social,
      desiredLength: "minimal",
      allowCodeSwitch: true,
      preserveOpaqueTerms: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "DIALOGUE_RESPONSE_PLAN_SOURCE_TURN",
      );
    }
  });
});
