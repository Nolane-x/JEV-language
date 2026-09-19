import { describe, expect, it } from "vitest";
import type { SemanticId } from "../../packages/core-types/src/index.ts";
import {
  ParticipantCommitmentLedger,
  invalidateDependentDerivations,
  validateAnswerLink,
  validateMultiActUtterance,
  validateQuestionSemantics,
  type MultiActUtterance,
  type ParticipantCommitment,
  type SemanticDerivation,
} from "../../packages/dialogue-state/src/index.ts";
import {
  runBenchmark,
  type DatasetManifest,
} from "../../packages/evaluation-core/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;

describe("T361-T370 questions and dialogue acts conformance", () => {
  it("T361-T362 defines typed question semantics and expected-answer contracts", () => {
    expect(
      validateQuestionSemantics({
        kind: "polar",
        propositionRef: sid("prop:ready"),
        expectedAnswer: { kind: "boolean" },
      }).ok,
    ).toBe(true);

    expect(
      validateQuestionSemantics({
        kind: "wh",
        variable: "x",
        propositionRef: sid("prop:where"),
        expectedAnswer: { kind: "location", locationKind: "physical" },
      }).ok,
    ).toBe(true);

    expect(
      validateQuestionSemantics({
        kind: "alternative",
        alternatives: [sid("choice:a"), sid("choice:b")],
        expectedAnswer: {
          kind: "choice",
          optionRefs: [sid("choice:b"), sid("choice:a")],
        },
      }).ok,
    ).toBe(false);
  });

  it("T363 links answers to questions without pretending nonresponsive output is complete", () => {
    expect(
      validateAnswerLink({
        id: "answer:1",
        questionId: "question:1",
        answerRefs: [sid("entity:server-a")],
        status: "complete",
        expectedAnswer: { kind: "entity", semanticType: "server" },
      }).ok,
    ).toBe(true);

    expect(
      validateAnswerLink({
        id: "answer:empty",
        questionId: "question:1",
        answerRefs: [],
        status: "complete",
        expectedAnswer: { kind: "text" },
      }).ok,
    ).toBe(false);
  });

  it("T364-T366 validates directive inventory, multi-act utterances, and semantic segmentation", () => {
    const utterance: MultiActUtterance = {
      id: "utterance:1",
      participant: "user",
      source: "Check the logs, then restart the worker.",
      acts: [
        {
          kind: "directive",
          directive: "request",
          contentRoots: [sid("action:check-logs")],
          addressee: "agent",
        },
        {
          kind: "directive",
          directive: "command",
          contentRoots: [sid("action:restart-worker")],
          addressee: "agent",
        },
      ],
      segments: [
        { id: "segment:1", start: 0, end: 15, actIndexes: [0] },
        {
          id: "segment:2",
          start: 16,
          end: "Check the logs, then restart the worker.".length,
          actIndexes: [1],
        },
      ],
    };
    expect(validateMultiActUtterance(utterance).ok).toBe(true);

    expect(
      validateMultiActUtterance({
        ...utterance,
        segments: [{ id: "segment:bad", start: 0, end: 15, actIndexes: [0] }],
      }).ok,
    ).toBe(false);
  });

  it("T367-T368 maintains participant commitments and explicit supersession history", () => {
    const ledger = new ParticipantCommitmentLedger();
    const first: ParticipantCommitment = {
      id: "commitment:v1",
      participant: "agent",
      contentRefs: [sid("goal:finish-report")],
      status: "active",
      introducedTurn: 1,
    };
    expect(ledger.apply({ kind: "add", commitment: first }).ok).toBe(true);

    const replacement: ParticipantCommitment = {
      id: "commitment:v2",
      participant: "agent",
      contentRefs: [sid("goal:finish-report-revised")],
      status: "active",
      introducedTurn: 2,
    };
    expect(
      ledger.apply({
        kind: "supersede",
        commitmentId: first.id,
        replacement,
        turn: 2,
      }).ok,
    ).toBe(true);

    expect(ledger.active()).toMatchObject([
      { id: "commitment:v2", status: "active" },
    ]);
    expect(ledger.history()).toMatchObject([
      {
        id: "commitment:v1",
        status: "superseded",
        supersededBy: "commitment:v2",
        resolvedTurn: 2,
      },
    ]);
  });

  it("T369 invalidates dependent semantic derivations transitively after correction", () => {
    const derivations: SemanticDerivation[] = [
      {
        id: "derive:a",
        dependsOnRefs: [sid("claim:old")],
        producesRefs: [sid("claim:derived-a")],
        status: "active",
      },
      {
        id: "derive:b",
        dependsOnRefs: [sid("claim:derived-a")],
        producesRefs: [sid("claim:derived-b")],
        status: "active",
      },
      {
        id: "derive:independent",
        dependsOnRefs: [sid("claim:other")],
        producesRefs: [sid("claim:other-result")],
        status: "active",
      },
    ];

    const invalidated = invalidateDependentDerivations(derivations, {
      correctionId: "correction:1",
      invalidatedRefs: [sid("claim:old")],
    });
    expect(invalidated.ok).toBe(true);
    if (invalidated.ok) {
      expect(invalidated.value.map((item) => item.status)).toEqual([
        "invalidated",
        "invalidated",
        "active",
      ]);
      expect(invalidated.value[1]?.invalidatedBy).toBe("correction:1");
    }
  });

  it("T370 runs a deterministic dialogue-act and repair benchmark", async () => {
    const cases = [
      {
        id: "question-contract",
        run: () =>
          validateQuestionSemantics({
            kind: "wh" as const,
            variable: "x",
            propositionRef: sid("prop:who"),
            expectedAnswer: { kind: "entity" as const, semanticType: "person" },
          }).ok,
      },
      {
        id: "supersession",
        run: () => {
          const ledger = new ParticipantCommitmentLedger();
          const add = ledger.apply({
            kind: "add",
            commitment: {
              id: "commitment:a",
              participant: "agent",
              contentRefs: [sid("goal:a")],
              status: "active",
              introducedTurn: 1,
            },
          });
          const replace = ledger.apply({
            kind: "supersede",
            commitmentId: "commitment:a",
            replacement: {
              id: "commitment:b",
              participant: "agent",
              contentRefs: [sid("goal:b")],
              status: "active",
              introducedTurn: 2,
            },
            turn: 2,
          });
          return (
            add.ok &&
            replace.ok &&
            ledger.active()[0]?.id === "commitment:b" &&
            ledger.history()[0]?.status === "superseded"
          );
        },
      },
      {
        id: "repair-invalidation",
        run: () => {
          const result = invalidateDependentDerivations(
            [
              {
                id: "derive:1",
                dependsOnRefs: [sid("claim:old")],
                producesRefs: [sid("claim:derived")],
                status: "active" as const,
              },
            ],
            {
              correctionId: "correction:benchmark",
              invalidatedRefs: [sid("claim:old")],
            },
          );
          return result.ok && result.value[0]?.status === "invalidated";
        },
      },
    ];

    const dataset: DatasetManifest = {
      schemaVersion: "jl-eval-dataset-1",
      id: "t370-dialogue-act-repair",
      version: "1.0.0",
      domain: "dialogue",
      split: "test",
      itemCount: cases.length,
      contentDigest: "sha256:t370-dialogue-act-repair",
      labelsProvenance: "deterministic-derived",
      tags: ["T370", "dialogue-act", "repair"],
      heldOutCombinations: true,
    };

    const report = await runBenchmark({
      benchmarkId: "t370-dialogue-act-repair",
      benchmarkVersion: "1.0.0",
      dataset,
      cases,
      evaluate(testCase) {
        const passed = testCase.run();
        return {
          status: passed ? "pass" : "fail",
          metrics: { semanticCorrectness: passed ? 1 : 0 },
        };
      },
    });

    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.summary).toMatchObject({
        cases: 3,
        passed: 3,
        failed: 0,
        unknown: 0,
        passRate: 1,
      });
    }
  });
});
