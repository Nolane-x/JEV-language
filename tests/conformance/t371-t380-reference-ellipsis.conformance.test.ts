import { describe, expect, it } from "vitest";
import type { SemanticId } from "../../packages/core-types/src/index.ts";
import {
  bridgingReferenceCandidates,
  cataphoraReferenceCandidate,
  constructSplitAntecedentCandidate,
  preserveReferenceAmbiguity,
  pruneReferenceCandidates,
  reconstructFragmentAnswer,
  type ExtendedReferenceCandidate,
} from "../../packages/dialogue-state/src/index.ts";
import {
  runBenchmark,
  type DatasetManifest,
} from "../../packages/evaluation-core/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;

const candidate = (
  id: string,
  input: Partial<ExtendedReferenceCandidate> = {},
): ExtendedReferenceCandidate => ({
  id,
  referentRefs: [sid(`entity:${id}`)],
  kind: "personal-pronoun",
  relation: "identity",
  semanticType: "person",
  recencyRank: 0,
  salience: 0.8,
  topicMatch: true,
  semanticCompatibility: 1,
  ...input,
});

describe("T371-T380 reference and ellipsis conformance", () => {
  it("T371-T372 supports extended reference taxonomy and bridging candidates", () => {
    const result = bridgingReferenceCandidates({
      anchor: sid("entity:car"),
      semanticType: "physical-object",
      facts: [
        {
          source: sid("entity:car"),
          target: sid("entity:engine"),
          relation: "part-of",
          evidenceRef: "evidence:manual",
        },
        {
          source: sid("entity:car"),
          target: sid("entity:driver"),
          relation: "associated-with",
        },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.kind)).toEqual([
      "bridging",
      "bridging",
    ]);
    expect(result[0]?.relation).toBe("associated-with");
    expect(result[1]?.evidenceRefs).toEqual(["evidence:manual"]);
  });

  it("T373 models cataphora only when a future referent offset is explicit", () => {
    const valid = cataphoraReferenceCandidate({
      mentionId: "mention:before",
      futureReferent: sid("entity:alice"),
      semanticType: "person",
      mentionOffset: 3,
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.kind).toBe("cataphoric");
      expect(valid.value.mentionOffset).toBe(3);
    }

    expect(
      cataphoraReferenceCandidate({
        mentionId: "mention:bad",
        futureReferent: sid("entity:alice"),
        semanticType: "person",
        mentionOffset: 0,
      }).ok,
    ).toBe(false);
  });

  it("T374 constructs split-antecedent groups deterministically", () => {
    const result = constructSplitAntecedentCandidate({
      id: "group:alice-bob",
      members: [sid("entity:bob"), sid("entity:alice"), sid("entity:bob")],
      semanticType: "person-group",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("split-antecedent");
      expect(result.value.referentRefs).toEqual([
        sid("entity:alice"),
        sid("entity:bob"),
      ]);
    }
  });

  it("T375 deterministically prunes incompatible and unlicensed candidates", () => {
    const result = pruneReferenceCandidates({
      candidates: [
        candidate("good", { recencyRank: 1 }),
        candidate("wrong-type", { semanticCompatibility: 0.2 }),
        candidate("future", {
          kind: "cataphoric",
          mentionOffset: 2,
          salience: 0,
        }),
        candidate("stale", { salience: 0.1, recencyRank: 20 }),
      ],
      allowCataphora: false,
      minimumCompatibility: 0.5,
      minimumSalience: 0.2,
      maxCandidates: 2,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.retained.map((item) => item.id)).toEqual(["good"]);
      expect(result.value.rejected.map((item) => item.reason).sort()).toEqual([
        "cataphora-not-licensed",
        "low-salience",
        "semantic-incompatible",
      ]);
    }
  });

  it("T376 preserves ambiguity instead of forcing a winner", () => {
    const ambiguous = preserveReferenceAmbiguity([
      candidate("a"),
      candidate("b"),
    ]);
    expect(ambiguous.status).toBe("ambiguous");
    if (ambiguous.status === "ambiguous") {
      expect(ambiguous.candidates).toHaveLength(2);
    }

    const resolved = preserveReferenceAmbiguity([candidate("only")]);
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") {
      expect(resolved.resolved.id).toBe("only");
    }
  });

  it("T377-T379 reconstructs typed fragment answers with explicit reconstructed-origin provenance", () => {
    const result = reconstructFragmentAnswer({
      id: "ellipsis:answer-1",
      literalFragment: "Hải Phòng",
      answerRefs: [sid("location:hai-phong")],
      expectedAnswer: { kind: "location", locationKind: "physical" },
      questionId: "question:where",
      sourceTurnId: "turn:12",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("fragment-answer");
      expect(result.value.reconstructedRefs).toEqual([
        sid("location:hai-phong"),
      ]);
      expect(result.value.origin).toMatchObject({
        kind: "reconstructed",
        sourceTurnId: "turn:12",
        sourceFragment: "Hải Phòng",
        questionId: "question:where",
        method: "typed-fragment",
      });
    }
  });

  it("T380 runs an anaphora/bridging/ellipsis stress corpus without forced ambiguity collapse", async () => {
    const cases = [
      {
        id: "bridging-engine",
        run: () =>
          bridgingReferenceCandidates({
            anchor: sid("entity:car"),
            semanticType: "physical-object",
            facts: [
              {
                source: sid("entity:car"),
                target: sid("entity:engine"),
                relation: "part-of",
              },
            ],
          })[0]?.referentRefs[0] === sid("entity:engine"),
      },
      {
        id: "cataphora-preserved",
        run: () => {
          const result = cataphoraReferenceCandidate({
            mentionId: "mention:he",
            futureReferent: sid("entity:minh"),
            semanticType: "person",
            mentionOffset: 4,
          });
          return result.ok && result.value.kind === "cataphoric";
        },
      },
      {
        id: "split-antecedent",
        run: () => {
          const result = constructSplitAntecedentCandidate({
            id: "group:team",
            members: [sid("entity:a"), sid("entity:b")],
          });
          return result.ok && result.value.referentRefs.length === 2;
        },
      },
      {
        id: "ambiguity-preserved",
        run: () =>
          preserveReferenceAmbiguity([
            candidate("alice"),
            candidate("anna"),
          ]).status === "ambiguous",
      },
      {
        id: "fragment-provenance",
        run: () => {
          const result = reconstructFragmentAnswer({
            id: "ellipsis:stress",
            literalFragment: "Tomorrow",
            answerRefs: [sid("temporal:tomorrow")],
            expectedAnswer: { kind: "time", precision: "date" },
            questionId: "question:when",
            sourceTurnId: "turn:stress",
          });
          return (
            result.ok &&
            result.value.origin.kind === "reconstructed" &&
            result.value.origin.sourceTurnId === "turn:stress"
          );
        },
      },
    ];

    const dataset: DatasetManifest = {
      schemaVersion: "jl-eval-dataset-1",
      id: "t380-reference-ellipsis-stress",
      version: "1.0.0",
      domain: "dialogue",
      split: "test",
      itemCount: cases.length,
      contentDigest: "sha256:t380-reference-ellipsis-stress",
      labelsProvenance: "deterministic-derived",
      tags: ["T380", "anaphora", "bridging", "ellipsis", "stress"],
      heldOutCombinations: true,
    };

    const report = await runBenchmark({
      benchmarkId: "t380-reference-ellipsis-stress",
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
        cases: 5,
        passed: 5,
        failed: 0,
        unknown: 0,
        passRate: 1,
      });
    }
  });
});
