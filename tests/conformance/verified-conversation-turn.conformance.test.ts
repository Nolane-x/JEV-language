import { describe, expect, it } from "vitest";
import { ok } from "../../packages/core-types/src/index.ts";
import type { ResponseSemanticPlan } from "../../packages/discourse-ir/src/index.ts";
import { createConversationStyleMemory } from "../../packages/realizer-core/src/index.ts";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import type {
  GraphSnapshot,
  QuantityNode,
} from "../../packages/semantic-graph/src/index.ts";
import {
  runVerifiedConversationTurn,
} from "../../packages/universal-expression/src/index.ts";

const provenance = ["prov:verified-turn"] as ProvenanceRef[];

const snapshot = (amount: number): GraphSnapshot => {
  const node: QuantityNode = {
    id: "quantity:verified-turn",
    kind: "quantity",
    schemaVersion: "0.1.0",
    ontologyVersion: "0.1.0",
    provenance: [...provenance],
    trust: "user-content",
    amount,
    unit: "concept:test.file",
    comparator: "at-most",
    approximate: false,
  };
  return {
    schemaVersion: "0.1.0",
    ontologyVersion: "0.1.0",
    revision: `verified-turn:${amount}`,
    nodes: [node],
  };
};

const plan = (
  overrides: Partial<ResponseSemanticPlan> = {},
): ResponseSemanticPlan => ({
  schemaVersion: "jl-response-semantic-plan-1",
  id: "response:verified-turn",
  dialogueAct: "answer",
  targetLanguage: "en",
  requiredSemanticRefs: ["semantic:answer"],
  optionalSemanticRefs: [],
  activeTopicRefs: ["semantic:topic"],
  referenceBindings: [],
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
  ...overrides,
});

describe("verified conversation turn pipeline", () => {
  it("routes, reparses, certifies and ranks conversational surfaces before selecting one", async () => {
    const source = snapshot(3);
    const result = await runVerifiedConversationTurn({
      candidateSetId: "candidate-set:verified-turn",
      plan: plan(),
      baseSurface: "I am checking it now and I will let you know.",
      sourceSemantics: source,
      parserIdentity: {
        id: "parser.en.fixture",
        version: "1.0.0",
      },
      parser() {
        return ok(structuredClone(source));
      },
      ranker: {
        async rank(state) {
          const candidates = state.candidates as Record<string, unknown>;
          expect(Object.keys(candidates)).toEqual(
            expect.arrayContaining([
              "response:verified-turn:en:direct",
              "response:verified-turn:en:contracted",
            ]),
          );
          return ok({
            choice: "response:verified-turn:en:contracted",
            confidence: 0.95,
            probabilities: {
              "response:verified-turn:en:contracted": 0.95,
              "response:verified-turn:en:direct": 0.05,
            },
          });
        },
      },
      dialogueContext: {
        previousTurn: "Can you check it?",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.languageFamily).toBe("en");
    expect(result.value.proposalCount).toBeGreaterThanOrEqual(2);
    expect(result.value.certifiedCount).toBe(
      result.value.proposalCount,
    );
    expect(result.value.certificationRejections).toEqual([]);
    expect(result.value.selection.selection.status).toBe("selected");
    if (result.value.selection.selection.status === "selected") {
      expect(result.value.selection.selection.candidate.surface).toBe(
        "I'm checking it now and I'll let you know.",
      );
      expect(
        result.value.selection.selection.candidate.semanticEvidenceRefs,
      ).toEqual(
        expect.arrayContaining([
          "evidence:conversation-parser:parser.en.fixture@1.0.0",
        ]),
      );
    }
  });

  it("fails closed when exact-surface certification leaves fewer than two candidates", async () => {
    const source = snapshot(3);
    const result = await runVerifiedConversationTurn({
      candidateSetId: "candidate-set:drift",
      plan: plan(),
      baseSurface: "I am checking it now and I will let you know.",
      sourceSemantics: source,
      parserIdentity: {
        id: "parser.en.fixture",
        version: "1.0.0",
      },
      parser(surface) {
        return ok(surface.startsWith("I'm") ? snapshot(4) : snapshot(3));
      },
      ranker: {
        async rank() {
          throw new Error("Ranker must not run when certified recall fails.");
        },
      },
      dialogueContext: {},
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "EXPRESSION_CONVERSATION_TURN_CERTIFIED_RECALL",
      );
      expect(JSON.stringify(result.error.details)).toContain(
        "EXPRESSION_CONVERSATION_SEMANTIC_DRIFT",
      );
    }
  });

  it("preserves low-margin ambiguity after certification instead of forcing a fluent winner", async () => {
    const source = snapshot(3);
    const memory = createConversationStyleMemory();
    expect(memory.ok).toBe(true);
    if (!memory.ok) return;

    const result = await runVerifiedConversationTurn({
      candidateSetId: "candidate-set:ambiguous",
      plan: plan(),
      baseSurface: "I am checking it now and I will let you know.",
      sourceSemantics: source,
      parserIdentity: {
        id: "parser.en.fixture",
        version: "1.0.0",
      },
      parser() {
        return ok(structuredClone(source));
      },
      ranker: {
        async rank() {
          return ok({
            choice: "response:verified-turn:en:contracted",
            confidence: 0.55,
            probabilities: {
              "response:verified-turn:en:contracted": 0.55,
              "response:verified-turn:en:direct": 0.45,
            },
          });
        },
      },
      dialogueContext: {},
      styleMemory: memory.value,
      minConfidence: 0.5,
      minMargin: 0.2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selection.selection.status).toBe("ambiguous");
    expect(result.value.selection.trace.selectedCandidateId).toBeNull();
    expect(result.value.selection.trace.styleMemoryRecorded).toBe(false);
    expect(
      result.value.selection.updatedStyleMemory?.entries,
    ).toHaveLength(0);
  });

  it("uses Vietnamese response-plan context before semantic certification and ranking", async () => {
    const source = snapshot(3);
    const viPlan = plan({
      id: "response:verified-turn-vi",
      targetLanguage: "vi",
      social: {
        relation: "peer",
        register: "casual",
        politeness: 0.4,
        speakerFormHint: "mình",
        addresseeFormHint: "bạn",
      },
    });

    const result = await runVerifiedConversationTurn({
      candidateSetId: "candidate-set:vi",
      plan: viPlan,
      baseSurface: "{{speaker}} kiểm tra rồi, hiện chưa thấy lỗi nào.",
      sourceSemantics: source,
      parserIdentity: {
        id: "parser.vi.fixture",
        version: "1.0.0",
      },
      parser() {
        return ok(structuredClone(source));
      },
      ranker: {
        async rank(state) {
          const candidates = Object.keys(
            state.candidates as Record<string, unknown>,
          );
          const softener = candidates.find((id) =>
            id.endsWith(":peer-softener"),
          );
          expect(softener).toBeDefined();
          const probabilities = Object.fromEntries(
            candidates.map((id) => [id, id === softener ? 0.9 : 0.05]),
          );
          return ok({
            choice: softener!,
            confidence: 0.9,
            probabilities,
          });
        },
      },
      dialogueContext: {
        relation: "peer",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.languageFamily).toBe("vi");
    expect(result.value.selection.selection.status).toBe("selected");
    if (result.value.selection.selection.status === "selected") {
      expect(result.value.selection.selection.candidate.surface).toBe(
        "Mình kiểm tra rồi, hiện chưa thấy lỗi nào nhé.",
      );
    }
  });
});
