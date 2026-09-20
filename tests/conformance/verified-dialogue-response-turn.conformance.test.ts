import { describe, expect, it } from "vitest";
import { ok } from "../../packages/core-types/src/index.ts";
import {
  InMemoryDialogueState,
  type DialogueUpdate,
} from "../../packages/dialogue-state/src/index.ts";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import type {
  GraphSnapshot,
  QuantityNode,
} from "../../packages/semantic-graph/src/index.ts";
import {
  runVerifiedDialogueResponseTurn,
} from "../../packages/universal-expression/src/index.ts";

const provenance = ["prov:verified-dialogue-turn"] as ProvenanceRef[];

const snapshot = (): GraphSnapshot => {
  const node: QuantityNode = {
    id: "quantity:verified-dialogue-turn",
    kind: "quantity",
    schemaVersion: "0.1.0",
    ontologyVersion: "0.1.0",
    provenance: [...provenance],
    trust: "user-content",
    amount: 3,
    unit: "concept:test.file",
    comparator: "at-most",
    approximate: false,
  };
  return {
    schemaVersion: "0.1.0",
    ontologyVersion: "0.1.0",
    revision: "verified-dialogue-turn:3",
    nodes: [node],
  };
};

const commit = (
  dialogue: InMemoryDialogueState,
  update: DialogueUpdate,
) => {
  const result = dialogue.commit(dialogue.beginUpdate(update));
  if (!result.ok) throw result.error;
  return result.value;
};

const turn = (
  id: string,
  turnNumber: number,
  kind: "ASK" | "CORRECT",
): DialogueUpdate["turn"] => ({
  id,
  turnNumber,
  participant: "user",
  sourceRef: `source:${id}`,
  literal: id,
  parsedRoots: ["semantic:user-content"],
  dialogueActs: [
    {
      kind,
      contentRoots: ["semantic:user-content"],
    },
  ],
  introducedEntities: [],
  referencedEntities: [],
  commitmentChanges: [],
  topicChanges: [],
});

describe("verified dialogue response turn", () => {
  it("runs dialogue state through response planning, language proposals, certification and bounded selection", async () => {
    const dialogue = new InMemoryDialogueState([
      { id: "user" },
      { id: "assistant" },
    ]);
    const state = commit(dialogue, {
      turn: turn("turn:user:1", 1, "ASK"),
    });
    const source = snapshot();

    const result = await runVerifiedDialogueResponseTurn({
      state,
      responsePlan: {
        responseId: "response:dialogue:1",
        respondingToParticipantId: "user",
        targetLanguage: "en",
        requiredSemanticRefs: ["semantic:answer"],
        epistemic: {
          status: "certain",
          confidence: 0.95,
        },
        social: {
          relation: "peer",
          register: "casual",
          politeness: 0.4,
        },
        desiredLength: "concise",
        allowCodeSwitch: false,
        preserveOpaqueTerms: true,
      },
      candidateSetId: "candidate-set:dialogue:1",
      baseSurface: "I am checking it now and I will let you know.",
      sourceSemantics: source,
      parserIdentity: {
        id: "parser.en.dialogue-fixture",
        version: "1.0.0",
      },
      parser() {
        return ok(structuredClone(source));
      },
      ranker: {
        async rank() {
          return ok({
            choice: "response:dialogue:1:en:contracted",
            confidence: 0.95,
            probabilities: {
              "response:dialogue:1:en:contracted": 0.95,
              "response:dialogue:1:en:direct": 0.05,
            },
          });
        },
      },
      dialogueContext: {
        sourceTurn: "turn:user:1",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.dialogueAct).toBe("answer");
    expect(result.value.plan.annotations).toMatchObject({
      sourceTurnId: "turn:user:1",
      sourceDialogueActs: ["ASK"],
    });
    expect(result.value.turn.selection.selection.status).toBe("selected");
    if (result.value.turn.selection.selection.status === "selected") {
      expect(result.value.turn.selection.selection.candidate.surface).toBe(
        "I'm checking it now and I'll let you know.",
      );
    }
  });

  it("preserves a user correction into Vietnamese acknowledgement planning before ranking", async () => {
    const dialogue = new InMemoryDialogueState([
      { id: "user" },
      { id: "assistant" },
    ]);
    const state = commit(dialogue, {
      turn: turn("turn:user:correction", 1, "CORRECT"),
      corrections: [
        {
          id: "correction:trip:1",
          kind: "replace-proposition",
          turnId: "turn:user:correction",
          targetRefs: ["semantic:old-trip-plan"],
          replacementRefs: ["semantic:new-trip-plan"],
        },
      ],
    });
    const source = snapshot();

    const result = await runVerifiedDialogueResponseTurn({
      state,
      responsePlan: {
        responseId: "response:dialogue:vi-correction",
        respondingToParticipantId: "user",
        targetLanguage: "vi",
        requiredSemanticRefs: ["semantic:new-trip-plan"],
        epistemic: {
          status: "certain",
          confidence: 0.99,
        },
        social: {
          relation: "peer",
          register: "casual",
          politeness: 0.45,
          speakerFormHint: "mình",
          addresseeFormHint: "bạn",
        },
        desiredLength: "concise",
        allowCodeSwitch: true,
        preserveOpaqueTerms: true,
      },
      candidateSetId: "candidate-set:dialogue:vi-correction",
      baseSurface:
        "{{speaker}} hiểu rồi. {{speaker}} sẽ dùng lịch mới.",
      sourceSemantics: source,
      parserIdentity: {
        id: "parser.vi.dialogue-fixture",
        version: "1.0.0",
      },
      parser() {
        return ok(structuredClone(source));
      },
      ranker: {
        async rank(stateValue) {
          const ids = Object.keys(
            stateValue.candidates as Record<string, unknown>,
          );
          const selected = ids.find((id) =>
            id.endsWith(":casual-ack"),
          );
          expect(selected).toBeDefined();
          return ok({
            choice: selected!,
            confidence: 0.9,
            probabilities: Object.fromEntries(
              ids.map((id) => [id, id === selected ? 0.9 : 0.03]),
            ),
          });
        },
      },
      dialogueContext: {
        correction: true,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.dialogueAct).toBe("acknowledge");
    expect(result.value.plan.correctionOfRefs).toEqual([
      "semantic:old-trip-plan",
    ]);
    expect(result.value.turn.selection.selection.status).toBe("selected");
    if (result.value.turn.selection.selection.status === "selected") {
      expect(result.value.turn.selection.selection.candidate.surface).toBe(
        "Ừ, mình hiểu rồi. Mình sẽ dùng lịch mới.",
      );
    }
  });

  it("fails before parsing or ranking when there is no user turn to answer", async () => {
    const dialogue = new InMemoryDialogueState([
      { id: "user" },
      { id: "assistant" },
    ]);
    let parserCalls = 0;
    let rankerCalls = 0;

    const result = await runVerifiedDialogueResponseTurn({
      state: dialogue.snapshot(),
      responsePlan: {
        responseId: "response:dialogue:none",
        respondingToParticipantId: "user",
        targetLanguage: "en",
        requiredSemanticRefs: ["semantic:answer"],
        epistemic: {
          status: "unknown",
          confidence: 0,
        },
        social: {
          relation: "peer",
          register: "neutral",
          politeness: 0.5,
        },
        desiredLength: "minimal",
        allowCodeSwitch: false,
        preserveOpaqueTerms: true,
      },
      candidateSetId: "candidate-set:dialogue:none",
      baseSurface: "No response should be generated.",
      sourceSemantics: snapshot(),
      parserIdentity: {
        id: "parser.none",
        version: "1.0.0",
      },
      parser() {
        parserCalls += 1;
        return ok(snapshot());
      },
      ranker: {
        async rank() {
          rankerCalls += 1;
          return ok({
            choice: "unused",
            confidence: 1,
            probabilities: { unused: 1 },
          });
        },
      },
      dialogueContext: {},
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "DIALOGUE_RESPONSE_PLAN_SOURCE_TURN",
      );
    }
    expect(parserCalls).toBe(0);
    expect(rankerCalls).toBe(0);
  });
});
