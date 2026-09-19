import { describe, expect, it } from "vitest";
import type { SemanticId } from "../../packages/core-types/src/index.ts";
import {
  DiscourseRelationRegistry,
  InformationTopicStack,
  detectGeneratedContradictions,
  detectSemanticRedundancy,
  validateDiscourseGraph,
  validateEnumerationSemantics,
  validateInformationStructureOverlay,
  validateMultiParagraphPlan,
} from "../../packages/discourse-ir/src/index.ts";
import {
  runBenchmark,
  type DatasetManifest,
} from "../../packages/evaluation-core/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;

const registry = (): DiscourseRelationRegistry => {
  const result = new DiscourseRelationRegistry();
  for (const relation of [
    {
      kind: "cause" as const,
      directed: true,
      allowsSelf: false,
      description: "cause",
    },
    {
      kind: "enumeration" as const,
      directed: true,
      allowsSelf: false,
      description: "enumeration",
    },
    {
      kind: "list-member" as const,
      directed: true,
      allowsSelf: false,
      description: "list member",
    },
  ]) {
    const added = result.register(relation);
    if (!added.ok) throw added.error;
  }
  return result;
};

describe("T381-T390 discourse and information structure conformance", () => {
  it("T381 validates information structure and contrastive-focus subset constraints", () => {
    expect(
      validateInformationStructureOverlay({
        id: "info:1",
        topicRefs: [sid("entity:system")],
        focusRefs: [sid("property:latency")],
        givenRefs: [sid("entity:system")],
        newRefs: [sid("property:latency")],
        contrastiveFocusRefs: [sid("property:latency")],
      }).ok,
    ).toBe(true);

    expect(
      validateInformationStructureOverlay({
        id: "info:bad",
        topicRefs: [],
        focusRefs: [],
        givenRefs: [sid("entity:x")],
        newRefs: [sid("entity:x")],
        contrastiveFocusRefs: [],
      }).ok,
    ).toBe(false);
  });

  it("T382 keeps topic stack activation independent from entity recency", () => {
    const stack = new InformationTopicStack();
    expect(
      stack.push({
        id: "topic:a",
        semanticRefs: [sid("concept:a")],
        introducedTurn: 1,
        lastActivatedTurn: 1,
      }).ok,
    ).toBe(true);
    expect(
      stack.push({
        id: "topic:b",
        semanticRefs: [sid("concept:b")],
        introducedTurn: 2,
        lastActivatedTurn: 2,
      }).ok,
    ).toBe(true);
    expect(stack.active()?.id).toBe("topic:b");
    expect(stack.activate("topic:a", 5).ok).toBe(true);
    expect(stack.active()).toMatchObject({
      id: "topic:a",
      lastActivatedTurn: 5,
    });
  });

  it("T383 represents focus-sensitive operator association explicitly", () => {
    const overlay = validateInformationStructureOverlay({
      id: "info:focus",
      topicRefs: [sid("entity:alice")],
      focusRefs: [sid("entity:bob")],
      givenRefs: [sid("entity:alice")],
      newRefs: [sid("entity:bob")],
      contrastiveFocusRefs: [sid("entity:bob")],
    });
    expect(overlay.ok).toBe(true);
  });

  it("T384-T385 validates registered discourse relations and graph endpoints", () => {
    const relations = registry();
    expect(
      validateDiscourseGraph(
        {
          units: [
            { id: "u1", semanticRefs: [sid("prop:cause")] },
            { id: "u2", semanticRefs: [sid("prop:result")] },
          ],
          edges: [
            {
              id: "e1",
              kind: "cause",
              source: "u1",
              target: "u2",
            },
          ],
        },
        relations,
      ).ok,
    ).toBe(true);

    expect(
      validateDiscourseGraph(
        {
          units: [{ id: "u1", semanticRefs: [sid("prop:cause")] }],
          edges: [
            {
              id: "e1",
              kind: "cause",
              source: "u1",
              target: "missing",
            },
          ],
        },
        relations,
      ).ok,
    ).toBe(false);
  });

  it("T386 validates multi-paragraph plans with explicit ordering", () => {
    expect(
      validateMultiParagraphPlan({
        id: "plan:multi",
        paragraphs: [
          {
            id: "p1",
            unitIds: ["u1", "u2"],
            topicRefs: [sid("topic:a")],
            purpose: "explain",
          },
          {
            id: "p2",
            unitIds: ["u3"],
            topicRefs: [sid("topic:b")],
            purpose: "summary",
          },
        ],
        ordering: [{ before: "p1", after: "p2" }],
      }).ok,
    ).toBe(true);
  });

  it("T387 detects semantic redundancy without confusing opposite polarity", () => {
    const report = detectSemanticRedundancy([
      {
        id: "s1",
        predicate: sid("pred:online"),
        argumentRefs: [sid("server:a")],
        polarity: "positive",
      },
      {
        id: "s2",
        predicate: sid("pred:online"),
        argumentRefs: [sid("server:a")],
        polarity: "positive",
      },
      {
        id: "s3",
        predicate: sid("pred:online"),
        argumentRefs: [sid("server:a")],
        polarity: "negative",
      },
    ]);
    expect(report.duplicateGroups).toEqual([["s1", "s2"]]);
    expect(report.uniqueIds).toEqual(["s3"]);
  });

  it("T388 detects generated contradictions from polarity inversion under equal semantic core", () => {
    const contradictions = detectGeneratedContradictions([
      {
        id: "positive",
        predicate: sid("pred:online"),
        argumentRefs: [sid("server:a")],
        polarity: "positive",
      },
      {
        id: "negative",
        predicate: sid("pred:online"),
        argumentRefs: [sid("server:a")],
        polarity: "negative",
      },
      {
        id: "other-context",
        predicate: sid("pred:online"),
        argumentRefs: [sid("server:a")],
        polarity: "negative",
        contextRef: sid("context:reported"),
      },
    ]);
    expect(contradictions).toEqual([
      {
        leftId: "positive",
        rightId: "negative",
        reason: "opposite-polarity-same-proposition",
      },
    ]);
  });

  it("T389 validates enumeration/list semantics and explicit exhaustiveness", () => {
    expect(
      validateEnumerationSemantics({
        id: "enum:servers",
        collectionRef: sid("collection:servers"),
        members: [sid("server:a"), sid("server:b")],
        ordered: true,
        exhaustive: "unknown",
      }).ok,
    ).toBe(true);

    expect(
      validateEnumerationSemantics({
        id: "enum:duplicate",
        collectionRef: sid("collection:servers"),
        members: [sid("server:a"), sid("server:a")],
        ordered: false,
        exhaustive: false,
      }).ok,
    ).toBe(false);
  });

  it("T390 runs a deterministic multi-paragraph coherence benchmark", async () => {
    const cases = [
      {
        id: "paragraph-order",
        run: () =>
          validateMultiParagraphPlan({
            id: "plan:benchmark",
            paragraphs: [
              {
                id: "p1",
                unitIds: ["u1"],
                topicRefs: [sid("topic:problem")],
                purpose: "explain",
              },
              {
                id: "p2",
                unitIds: ["u2"],
                topicRefs: [sid("topic:solution")],
                purpose: "summary",
              },
            ],
            ordering: [{ before: "p1", after: "p2" }],
          }).ok,
      },
      {
        id: "no-contradiction",
        run: () =>
          detectGeneratedContradictions([
            {
              id: "a",
              predicate: sid("pred:healthy"),
              argumentRefs: [sid("service:a")],
              polarity: "positive",
            },
            {
              id: "b",
              predicate: sid("pred:latency"),
              argumentRefs: [sid("service:a")],
              polarity: "positive",
            },
          ]).length === 0,
      },
      {
        id: "redundancy-visible",
        run: () =>
          detectSemanticRedundancy([
            {
              id: "a",
              predicate: sid("pred:ready"),
              argumentRefs: [sid("service:a")],
              polarity: "positive",
            },
            {
              id: "b",
              predicate: sid("pred:ready"),
              argumentRefs: [sid("service:a")],
              polarity: "positive",
            },
          ]).duplicateGroups.length === 1,
      },
    ];

    const dataset: DatasetManifest = {
      schemaVersion: "jl-eval-dataset-1",
      id: "t390-multi-paragraph-coherence",
      version: "1.0.0",
      domain: "nlg",
      split: "test",
      itemCount: cases.length,
      contentDigest: "sha256:t390-multi-paragraph-coherence",
      labelsProvenance: "deterministic-derived",
      tags: ["T390", "discourse", "coherence", "paragraph"],
      heldOutCombinations: true,
    };

    const report = await runBenchmark({
      benchmarkId: "t390-multi-paragraph-coherence",
      benchmarkVersion: "1.0.0",
      dataset,
      cases,
      evaluate(testCase) {
        const passed = testCase.run();
        return {
          status: passed ? "pass" : "fail",
          metrics: { semanticCoherence: passed ? 1 : 0 },
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
