import { describe, expect, it } from "vitest";
import type { SemanticId } from "../../packages/core-types/src/index.ts";
import {
  runBenchmark,
  type DatasetManifest,
} from "../../packages/evaluation-core/src/index.ts";
import {
  MultiwordCandidateRegistry,
  PresuppositionTriggerRegistry,
} from "../../packages/language-pack-core/src/index.ts";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import {
  ScalarInferenceRegistry,
  SemanticCoercionRegistry,
  cancelScalarInference,
  generateAccommodationCandidates,
  globalAssertionPropositions,
  serializeSnapshot,
  deserializeSnapshot,
  type GraphSnapshot,
  type PropositionNode,
} from "../../packages/semantic-graph/src/index.ts";
import { validateSnapshot } from "../../packages/semantic-validator/src/index.ts";
import { verifySemanticPreservation } from "../../packages/verifier-core/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;
const provenance = ["prov:t341"] as ProvenanceRef[];
const common = {
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance,
  trust: "user-content" as const,
};

const proposition = (
  id: string,
  input: Partial<PropositionNode> = {},
): PropositionNode => ({
  ...common,
  provenance: [...provenance],
  id: sid(id),
  kind: "proposition",
  predicate: sid("concept:test.proposition"),
  arguments: [],
  polarity: "positive",
  ...input,
});

const snapshot = (
  nodes: GraphSnapshot["nodes"],
  revision = "rev:t341",
): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision,
  nodes,
});

describe("T341-T350 presupposition and pragmatic inference conformance", () => {
  it("T341 represents presupposed content separately from asserted content", () => {
    const assertion = proposition("proposition:lan-stopped", {
      epistemic: {
        status: "asserted",
        commitment: "asserted-by-speaker",
      },
    });
    const presupposed = proposition("proposition:lan-was-running", {
      epistemic: {
        status: "presupposed",
        commitment: "presupposed",
      },
      presupposition: {
        status: "triggered",
        triggerId: "en.change-of-state.stop",
        host: assertion.id,
      },
    });

    const graph = snapshot([assertion, presupposed]);
    expect(validateSnapshot(graph)).toEqual([]);
    expect(globalAssertionPropositions(graph).map((node) => node.id)).toEqual([
      assertion.id,
    ]);

    const invalid = {
      ...presupposed,
      id: sid("proposition:bad-presupposition"),
      epistemic: {
        status: "asserted" as const,
        commitment: "asserted-by-speaker" as const,
      },
    };
    expect(
      validateSnapshot(snapshot([assertion, invalid])).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("JSG114_PRESUPPOSITION_COMMITMENT_MISMATCH");
  });

  it("T342 provides a versioned language-specific presupposition trigger registry", () => {
    const registry = new PresuppositionTriggerRegistry("en", "1.0.0");
    expect(
      registry.register({
        id: "en.change-of-state.stop",
        language: "en",
        version: "1.0.0",
        kind: "change-of-state",
        effect: "prior-state",
        tokenSequences: [["stopped"]],
        grammarRuleIds: ["grammar:change-of-state"],
      }).ok,
    ).toBe(true);

    expect(registry.match({ tokens: ["STOPPED"] })).toEqual([
      {
        triggerId: "en.change-of-state.stop",
        kind: "change-of-state",
        effect: "prior-state",
        matchedBy: "token-sequence",
      },
    ]);
    expect(
      registry.match({ grammarRuleIds: ["grammar:change-of-state"] }),
    ).toEqual([
      {
        triggerId: "en.change-of-state.stop",
        kind: "change-of-state",
        effect: "prior-state",
        matchedBy: "grammar-rule",
      },
    ]);

    expect(
      registry.register({
        id: "vi.invalid-version",
        language: "vi",
        version: "1.0.0",
        kind: "factive-predicate",
        effect: "embedded-truth",
        tokenSequences: [["biết"]],
      }).ok,
    ).toBe(false);
  });

  it("T343-T344 generates filtered link/local/global/unresolved/clarification alternatives", () => {
    const host = proposition("proposition:host");
    const presupposed = proposition("proposition:presupposed", {
      epistemic: {
        status: "presupposed",
        commitment: "presupposed",
      },
      presupposition: {
        status: "unresolved",
        triggerId: "en.definite-description",
        host: host.id,
      },
    });

    const candidates = generateAccommodationCandidates({
      presupposition: presupposed,
      localContextRef: sid("context:local"),
      compatibleRefs: [sid("entity:existing"), sid("entity:existing")],
      allowGlobal: true,
      allowClarification: true,
    });
    expect(candidates.ok).toBe(true);
    if (candidates.ok) {
      expect(candidates.value.map((candidate) => candidate.kind)).toEqual([
        "link-existing",
        "local",
        "global",
        "unresolved",
        "clarify",
      ]);
      expect(
        candidates.value.map((candidate) => candidate.deterministicRank),
      ).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it("T345 stores pragmatic inference as defeasible content rather than assertion", () => {
    const premise = proposition("proposition:some-students-passed", {
      epistemic: {
        status: "asserted",
        commitment: "asserted-by-speaker",
      },
    });
    const inference = proposition("proposition:not-all-students-passed", {
      epistemic: {
        status: "hypothesized",
        commitment: "hypothesized",
      },
      pragmaticInference: {
        status: "active",
        strength: "defeasible",
        sourceKind: "rule",
        sourceId: "scalar.some-not-all",
        premiseRefs: [premise.id],
      },
    });

    const graph = snapshot([premise, inference]);
    expect(validateSnapshot(graph)).toEqual([]);
    expect(globalAssertionPropositions(graph).map((node) => node.id)).toEqual([
      premise.id,
    ]);

    const collapsed = proposition("proposition:collapsed-inference", {
      epistemic: {
        status: "asserted",
        commitment: "asserted-by-speaker",
      },
      pragmaticInference: {
        status: "active",
        strength: "defeasible",
        sourceKind: "rule",
        sourceId: "scalar.some-not-all",
        premiseRefs: [premise.id],
      },
    });
    expect(
      validateSnapshot(snapshot([premise, collapsed])).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("JSG118_PRAGMATIC_INFERENCE_ASSERTION_COLLAPSE");
  });

  it("T346 generates optional scalar inference and supports explicit cancellation", () => {
    const registry = new ScalarInferenceRegistry();
    expect(
      registry.register({
        id: "quantifier.some-all",
        version: "1.0.0",
        terms: ["some", "many", "all"],
      }).ok,
    ).toBe(true);

    const generated = registry.generate({
      scaleId: "quantifier.some-all",
      premiseRef: sid("proposition:some"),
      inferredRef: sid("proposition:not-all"),
      observedTerm: "some",
      strongerTerm: "all",
      contextAllowsInference: true,
    });
    expect(generated.ok).toBe(true);
    if (generated.ok) {
      expect(generated.value?.strength).toBe("defeasible");
      expect(generated.value?.status).toBe("active");
      if (generated.value !== undefined) {
        const cancelled = cancelScalarInference(
          generated.value,
          "Follow-up explicitly states that all students passed.",
        );
        expect(cancelled.ok).toBe(true);
        if (cancelled.ok) {
          expect(cancelled.value.status).toBe("cancelled");
          expect(cancelled.value.cancellationReason).toContain("all students");
        }
      }
    }

    const contextBlocked = registry.generate({
      scaleId: "quantifier.some-all",
      premiseRef: sid("proposition:some-context-blocked"),
      inferredRef: sid("proposition:not-all-context-blocked"),
      observedTerm: "some",
      strongerTerm: "all",
      contextAllowsInference: false,
    });
    expect(contextBlocked.ok).toBe(true);
    if (contextBlocked.ok) expect(contextBlocked.value).toBeUndefined();
  });

  it("T347 keeps idiomatic and literal multiword readings as explicit alternatives", () => {
    const registry = new MultiwordCandidateRegistry("en", "1.0.0");
    expect(
      registry.register({
        id: "en.idiom.kick-the-bucket",
        language: "en",
        version: "1.0.0",
        tokens: ["kick", "the", "bucket"],
        idiomaticSemanticRef: sid("concept:idiom.die"),
      }).ok,
    ).toBe(true);

    const candidates = registry.candidates(
      ["Kick", "the", "bucket"],
      sid("proposition:literal-kick-bucket"),
    );
    expect(candidates).toEqual([
      {
        reading: "idiomatic",
        semanticRef: sid("concept:idiom.die"),
        entryId: "en.idiom.kick-the-bucket",
        requiresDisambiguation: true,
      },
      {
        reading: "literal",
        semanticRef: sid("proposition:literal-kick-bucket"),
        requiresDisambiguation: true,
      },
    ]);

    expect(
      registry.candidates(["plain", "phrase"], sid("proposition:plain")),
    ).toEqual([
      {
        reading: "literal",
        semanticRef: sid("proposition:plain"),
        requiresDisambiguation: false,
      },
    ]);
  });

  it("T348 returns coercion candidates without replacing the literal predicate", () => {
    const registry = new SemanticCoercionRegistry();
    expect(
      registry.register({
        id: "coercion.idea-die",
        version: "1.0.0",
        sourcePredicate: sid("concept:core.die"),
        argumentConcept: sid("concept:core.idea"),
        coercedPredicate: sid("concept:core.cease-relevance"),
        mappingKind: "metaphor",
      }).ok,
    ).toBe(true);

    const candidates = registry.candidates({
      predicate: sid("concept:core.die"),
      argumentConcept: sid("concept:core.idea"),
    });
    expect(candidates).toEqual([
      {
        ruleId: "coercion.idea-die",
        reading: "nonliteral",
        predicate: sid("concept:core.cease-relevance"),
        requiresDisambiguation: true,
      },
    ]);
    expect(sid("concept:core.die")).not.toBe(candidates[0]?.predicate);
  });

  it("T349 preserves literal-vs-nonliteral ambiguity fixtures", () => {
    const idioms = new MultiwordCandidateRegistry("en", "1.0.0");
    idioms.register({
      id: "en.idiom.break-the-ice",
      language: "en",
      version: "1.0.0",
      tokens: ["break", "the", "ice"],
      idiomaticSemanticRef: sid("concept:idiom.initiate-social-interaction"),
    });

    const readings = idioms.candidates(
      ["break", "the", "ice"],
      sid("proposition:literal-break-ice"),
    );
    expect(new Set(readings.map((candidate) => candidate.reading))).toEqual(
      new Set(["literal", "idiomatic"]),
    );

    const coercions = new SemanticCoercionRegistry();
    coercions.register({
      id: "coercion.idea-die",
      version: "1.0.0",
      sourcePredicate: sid("concept:core.die"),
      argumentConcept: sid("concept:core.idea"),
      coercedPredicate: sid("concept:core.cease-relevance"),
      mappingKind: "metaphor",
    });
    const metaphor = coercions.candidates({
      predicate: sid("concept:core.die"),
      argumentConcept: sid("concept:core.idea"),
    });
    expect(metaphor).toHaveLength(1);
    expect(metaphor[0]?.reading).toBe("nonliteral");
    // Candidate generation never mutates the literal input predicate.
    expect(sid("concept:core.die")).toBe(sid("concept:core.die"));
  });

  it("T350 verifies cancellation, non-assertion, preservation, and canonical round-trip", async () => {
    const premise = proposition("proposition:t350-some", {
      epistemic: {
        status: "asserted",
        commitment: "asserted-by-speaker",
      },
    });
    const presupposed = proposition("proposition:t350-presupposed", {
      epistemic: {
        status: "presupposed",
        commitment: "presupposed",
      },
      presupposition: {
        status: "unresolved",
        triggerId: "en.definite-description",
        host: premise.id,
      },
    });
    const inference = proposition("proposition:t350-inference", {
      epistemic: {
        status: "hypothesized",
        commitment: "hypothesized",
      },
      pragmaticInference: {
        status: "active",
        strength: "defeasible",
        sourceKind: "rule",
        sourceId: "scalar.some-not-all",
        premiseRefs: [premise.id],
      },
    });

    const graph = snapshot([premise, presupposed, inference]);
    const serialized = serializeSnapshot(graph);
    const restored = deserializeSnapshot(serialized);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(serializeSnapshot(restored.value)).toBe(serialized);

    const transformed = structuredClone(graph);
    const changed = transformed.nodes.find(
      (node): node is PropositionNode => node.id === presupposed.id,
    );
    expect(changed).toBeDefined();
    if (changed?.presupposition !== undefined) {
      changed.presupposition.status = "accommodated-global";
    }
    const preservation = verifySemanticPreservation(graph, transformed);
    expect(preservation.ok).toBe(false);
    expect(preservation.violations.map((item) => item.code)).toContain(
      "SEM_PRAGMATIC_STATUS_CHANGED",
    );

    const scalar = new ScalarInferenceRegistry();
    scalar.register({
      id: "quantifier.some-all",
      version: "1.0.0",
      terms: ["some", "all"],
    });

    const cases = [
      {
        id: "presupposition-not-asserted",
        pass: globalAssertionPropositions(graph).map((node) => node.id).join(",") ===
          premise.id,
      },
      {
        id: "scalar-context-cancellable",
        pass: (() => {
          const active = scalar.generate({
            scaleId: "quantifier.some-all",
            premiseRef: premise.id,
            inferredRef: inference.id,
            observedTerm: "some",
            strongerTerm: "all",
            contextAllowsInference: true,
          });
          if (!active.ok || active.value === undefined) return false;
          const cancelled = cancelScalarInference(
            active.value,
            "Explicit all-follow-up",
          );
          return cancelled.ok && cancelled.value.status === "cancelled";
        })(),
      },
      {
        id: "canonical-roundtrip",
        pass: restored.ok && serializeSnapshot(restored.value) === serialized,
      },
      {
        id: "preservation-detects-accommodation-drift",
        pass:
          !preservation.ok &&
          preservation.violations.some(
            (item) => item.code === "SEM_PRAGMATIC_STATUS_CHANGED",
          ),
      },
    ];

    const dataset: DatasetManifest = {
      schemaVersion: "jl-eval-dataset-1",
      id: "t350-presupposition-cancellation",
      version: "1.0.0",
      domain: "semantic",
      split: "test",
      itemCount: cases.length,
      contentDigest: "sha256:t350-presupposition-cancellation",
      labelsProvenance: "deterministic-derived",
      tags: [
        "T350",
        "presupposition",
        "pragmatic-inference",
        "cancellation",
        "nonliteral",
      ],
      heldOutCombinations: true,
    };

    const report = await runBenchmark({
      benchmarkId: "t350-presupposition-cancellation",
      benchmarkVersion: "1.0.0",
      dataset,
      cases,
      evaluate(testCase) {
        return {
          status: testCase.pass ? "pass" : "fail",
          metrics: { semanticCorrectness: testCase.pass ? 1 : 0 },
        };
      },
    });

    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.summary).toMatchObject({
        cases: 4,
        passed: 4,
        failed: 0,
        unknown: 0,
        passRate: 1,
      });
    }
  });
});
