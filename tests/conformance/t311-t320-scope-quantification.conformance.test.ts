import { describe, expect, it } from "vitest";
import type { SemanticId } from "../../packages/core-types/src/index.ts";
import type { DatasetManifest } from "../../packages/evaluation-core/src/index.ts";
import { runBenchmark } from "../../packages/evaluation-core/src/index.ts";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import {
  createUnresolvedScopeConstraint,
  resolveScopeConstraints,
  validateScopeGraph,
  type EntityNode,
  type GraphSnapshot,
  type NegationNode,
  type PropositionNode,
  type QuantifierNode,
  type QuantityConstraint,
  type ScopeConstraintNode,
  type ScopeNode,
  type ScopeRelation,
} from "../../packages/semantic-graph/src/index.ts";
import { validateSnapshot } from "../../packages/semantic-validator/src/index.ts";
import {
  filterScopeSafeGenerationCandidates,
  planScopeRealization,
} from "../../packages/realizer-core/src/index.ts";
import {
  verifySemanticPreservation,
} from "../../packages/verifier-core/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;
const provenance = ["prov:t311"] as ProvenanceRef[];

const common = {
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance,
  trust: "user-content" as const,
};

const entity = (id: SemanticId): EntityNode => ({
  ...common,
  provenance: [...provenance],
  id,
  kind: "entity",
  concept: sid("concept:test.entity"),
  attributes: [],
  memberships: [],
});

const proposition = (id: SemanticId): PropositionNode => ({
  ...common,
  provenance: [...provenance],
  id,
  kind: "proposition",
  predicate: sid("concept:test.approve"),
  arguments: [],
  polarity: "positive",
});

const scope = (
  id: SemanticId,
  operatorRef: SemanticId,
  bodyRef?: SemanticId,
): ScopeNode => ({
  ...common,
  provenance: [...provenance],
  id,
  kind: "scope",
  operatorRef,
  ...(bodyRef === undefined ? {} : { bodyRef }),
});

const quantifier = (
  id: SemanticId,
  scopeId: SemanticId,
  restrictor: SemanticId,
  body: SemanticId,
  input: Partial<QuantifierNode> = {},
): QuantifierNode => ({
  ...common,
  provenance: [...provenance],
  id,
  kind: "quantifier",
  quantifierKind: "universal",
  restrictor,
  body,
  scope: scopeId,
  ...input,
});

const negation = (
  id: SemanticId,
  scopeId: SemanticId,
  body: SemanticId,
): NegationNode => ({
  ...common,
  provenance: [...provenance],
  id,
  kind: "negation",
  body,
  scope: scopeId,
});

const constraint = (
  id: SemanticId,
  left: SemanticId,
  relation: ScopeRelation,
  right: SemanticId,
  status: ScopeConstraintNode["status"] = "asserted",
): ScopeConstraintNode => ({
  ...common,
  provenance: [...provenance],
  id,
  kind: "scope-constraint",
  left,
  relation,
  right,
  status,
});

const snapshot = (
  nodes: GraphSnapshot["nodes"],
  revision = "rev:t311",
): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision,
  nodes,
});

const ambiguousQuantifierNegationGraph = (): GraphSnapshot => {
  const restrictor = entity(sid("entity:reviewers"));
  const body = proposition(sid("proposition:approve"));
  const qId = sid("quantifier:every");
  const negId = sid("negation:not");
  const qScope = sid("scope:quantifier");
  const negScope = sid("scope:negation");
  const q = quantifier(qId, qScope, restrictor.id, body.id);
  const neg = negation(negId, negScope, body.id);

  return snapshot([
    restrictor,
    body,
    q,
    neg,
    scope(qScope, q.id, body.id),
    scope(negScope, neg.id, body.id),
    createUnresolvedScopeConstraint({
      id: sid("scope-constraint:q-vs-neg"),
      left: qScope,
      right: negScope,
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      provenance,
      trust: "user-content",
    }),
  ]);
};

describe("T311-T320 scope and quantification conformance", () => {
  it("T311-T313 represents explicit and unresolved relative scope without forcing a reading", () => {
    const graph = ambiguousQuantifierNegationGraph();
    expect(validateScopeGraph(graph)).toEqual([]);
    expect(validateSnapshot(graph)).toEqual([]);

    const unresolved = graph.nodes.find(
      (node): node is ScopeConstraintNode =>
        node.kind === "scope-constraint",
    );
    expect(unresolved).toMatchObject({
      relation: "unknown",
      status: "candidate",
    });

    const resolved = resolveScopeConstraints(graph, []);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.unresolvedConstraintIds).toEqual([
        sid("scope-constraint:q-vs-neg"),
      ]);
      expect(resolved.value.trace).toEqual([]);
      expect(resolved.value.constraints[0]?.relation).toBe("unknown");
    }
  });

  it("T312 rejects contradictory hard outscope cycles and incompatible hard relations", () => {
    const base = ambiguousQuantifierNegationGraph();
    const withoutUnknown = base.nodes.filter(
      (node) => node.kind !== "scope-constraint",
    );
    const qScope = sid("scope:quantifier");
    const negScope = sid("scope:negation");

    const cyclic = snapshot([
      ...withoutUnknown,
      constraint(
        sid("scope-constraint:q-wide"),
        qScope,
        "outscopes",
        negScope,
      ),
      constraint(
        sid("scope-constraint:neg-wide"),
        negScope,
        "outscopes",
        qScope,
      ),
    ]);
    expect(validateScopeGraph(cyclic).map((item) => item.code)).toContain(
      "JSG062_SCOPE_OUTSCOPES_CYCLE",
    );

    const conflicting = snapshot([
      ...withoutUnknown,
      constraint(
        sid("scope-constraint:same"),
        qScope,
        "same-scope",
        negScope,
      ),
      constraint(
        sid("scope-constraint:disjoint"),
        qScope,
        "disjoint",
        negScope,
      ),
    ]);
    expect(validateScopeGraph(conflicting).map((item) => item.code)).toContain(
      "JSG067_SCOPE_CONSTRAINT_CONFLICT",
    );
  });

  it("T314-T316 supports generalized quantifiers, cardinality constraints, and distributivity ambiguity", () => {
    const restrictor = entity(sid("entity:engineers"));
    const body = proposition(sid("proposition:lift"));
    const cases: Array<{
      kind: QuantifierNode["quantifierKind"];
      cardinality?: QuantityConstraint;
    }> = [
      { kind: "existential" },
      { kind: "universal" },
      { kind: "negative" },
      { kind: "cardinal", cardinality: { kind: "exact", value: 3 } },
      { kind: "proportional", cardinality: { kind: "proportion", value: 0.7 } },
      { kind: "comparative", cardinality: { kind: "comparative", operator: "more-than", value: 3 } },
      { kind: "approximate", cardinality: { kind: "approximate", value: 10, tolerance: 2 } },
      { kind: "most" },
      { kind: "few" },
      { kind: "many" },
      { kind: "exactly-N", cardinality: { kind: "exact", value: 3 } },
      { kind: "at-least-N", cardinality: { kind: "at-least", value: 3 } },
      { kind: "at-most-N", cardinality: { kind: "at-most", value: 3 } },
      { kind: "between-N-M", cardinality: { kind: "between", minimum: 2, maximum: 5 } },
    ];

    for (const [index, entry] of cases.entries()) {
      const qId = sid(`quantifier:case-${index}`);
      const scopeId = sid(`scope:case-${index}`);
      const q = quantifier(qId, scopeId, restrictor.id, body.id, {
        quantifierKind: entry.kind,
        ...(entry.cardinality === undefined
          ? {}
          : { cardinality: entry.cardinality }),
        distributivity: "ambiguous",
      });
      const graph = snapshot([
        restrictor,
        body,
        q,
        scope(scopeId, q.id, body.id),
      ]);
      expect(validateScopeGraph(graph), entry.kind).toEqual([]);
    }

    const invalidId = sid("quantifier:invalid-between");
    const invalidScope = sid("scope:invalid-between");
    const invalid = quantifier(
      invalidId,
      invalidScope,
      restrictor.id,
      body.id,
      {
        quantifierKind: "between-N-M",
        cardinality: { kind: "between", minimum: 5, maximum: 2 },
      },
    );
    expect(
      validateScopeGraph(
        snapshot([
          restrictor,
          body,
          invalid,
          scope(invalidScope, invalid.id, body.id),
        ]),
      ).map((item) => item.code),
    ).toContain("JSG066_QUANTIFIER_CARDINALITY_INVALID");
  });

  it("T317 requires negation to own a matching explicit scope object", () => {
    const body = proposition(sid("proposition:body"));
    const neg = negation(
      sid("negation:outer"),
      sid("scope:outer"),
      body.id,
    );
    const good = snapshot([
      body,
      neg,
      scope(sid("scope:outer"), neg.id, body.id),
    ]);
    expect(validateScopeGraph(good)).toEqual([]);

    const bad = snapshot([
      body,
      neg,
      scope(sid("scope:outer"), sid("negation:other"), body.id),
    ]);
    expect(validateScopeGraph(bad).map((item) => item.code)).toContain(
      "JSG068_NEGATION_SCOPE_INVALID",
    );
  });

  it("T318 resolves by the declared evidence tier order and preserves unresolved cases", () => {
    const graph = ambiguousQuantifierNegationGraph();
    const calls: string[] = [];
    const result = resolveScopeConstraints(graph, [
      {
        id: "context:last",
        tier: "contextual",
        kind: "deterministic",
        resolve() {
          calls.push("contextual");
          return "same-scope";
        },
      },
      {
        id: "lexical:first-decisive",
        tier: "explicit-lexical",
        kind: "deterministic",
        resolve() {
          calls.push("lexical");
          return "outscopes";
        },
      },
      {
        id: "grammar-no-evidence",
        tier: "hard-grammar",
        kind: "deterministic",
        resolve() {
          calls.push("grammar");
          return undefined;
        },
      },
      {
        id: "jev-last",
        tier: "jev-judgment",
        kind: "jev",
        resolve() {
          calls.push("jev");
          return "disjoint";
        },
      },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.constraints[0]).toMatchObject({
        relation: "outscopes",
        status: "derived",
      });
      expect(result.value.trace[0]).toMatchObject({
        ruleId: "lexical:first-decisive",
        tier: "explicit-lexical",
      });
      expect(result.value.unresolvedConstraintIds).toEqual([]);
    }
    expect(calls).toEqual(["grammar", "lexical"]);

    const preserved = resolveScopeConstraints(graph, [
      {
        id: "grammar-none",
        tier: "hard-grammar",
        kind: "deterministic",
        resolve: () => undefined,
      },
    ]);
    expect(preserved.ok).toBe(true);
    if (preserved.ok) {
      expect(preserved.value.unresolvedConstraintIds).toEqual([
        sid("scope-constraint:q-vs-neg"),
      ]);
    }
  });

  it("T318 rejects same-tier rule disagreement instead of choosing an arbitrary reading", () => {
    const result = resolveScopeConstraints(
      ambiguousQuantifierNegationGraph(),
      [
        {
          id: "grammar:a",
          tier: "hard-grammar",
          kind: "deterministic",
          resolve: () => "outscopes",
        },
        {
          id: "grammar:b",
          tier: "hard-grammar",
          kind: "deterministic",
          resolve: () => "same-scope",
        },
      ],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("JSG_SCOPE_RESOLUTION_CONFLICT");
    }
  });

  it("T319 filters generation candidates that silently collapse unresolved scope", () => {
    const graph = ambiguousQuantifierNegationGraph();
    expect(planScopeRealization(graph)).toMatchObject({
      strategy: "preserve-ambiguity",
      unresolvedConstraintIds: [sid("scope-constraint:q-vs-neg")],
    });

    const qScope = sid("scope:quantifier");
    const negScope = sid("scope:negation");
    const filtered = filterScopeSafeGenerationCandidates(graph, [
      {
        id: "surface:neutral",
        value: "scope-neutral-surface",
      },
      {
        id: "surface:q-wide",
        value: "quantifier-wide-surface",
        scopeCommitments: [
          { left: qScope, relation: "outscopes", right: negScope },
        ],
      },
    ]);
    expect(filtered.ok).toBe(true);
    if (filtered.ok) {
      expect(filtered.value.map((candidate) => candidate.id)).toEqual([
        "surface:neutral",
      ]);
    }

    const onlyCommitting = filterScopeSafeGenerationCandidates(graph, [
      {
        id: "surface:neg-wide",
        value: "negation-wide-surface",
        scopeCommitments: [
          { left: negScope, relation: "outscopes", right: qScope },
        ],
      },
    ]);
    expect(onlyCommitting.ok).toBe(false);
    if (!onlyCommitting.ok) {
      expect(onlyCommitting.error.code).toBe(
        "REALIZE_SCOPE_AMBIGUITY_LOST",
      );
    }
  });

  it("verification detects changes to explicit scope, quantifier, and negation semantics", () => {
    const source = ambiguousQuantifierNegationGraph();
    const candidate = structuredClone(source);
    const constraintNode = candidate.nodes.find(
      (node): node is ScopeConstraintNode =>
        node.kind === "scope-constraint",
    );
    expect(constraintNode).toBeDefined();
    if (constraintNode === undefined) return;
    constraintNode.relation = "outscopes";
    constraintNode.status = "derived";

    const report = verifySemanticPreservation(source, candidate);
    expect(report.ok).toBe(false);
    expect(report.violations.map((violation) => violation.code)).toContain(
      "SEM_SCOPE_CONSTRAINT_CHANGED",
    );
  });

  it("T320 executes an adversarial quantifier/negation benchmark", async () => {
    const base = ambiguousQuantifierNegationGraph();
    const bare = base.nodes.filter((node) => node.kind !== "scope-constraint");
    const qScope = sid("scope:quantifier");
    const negScope = sid("scope:negation");

    const invalidProportionalId = sid("quantifier:bad-proportion");
    const invalidProportionalScope = sid("scope:bad-proportion");
    const body = proposition(sid("proposition:proportion-body"));
    const restrictor = entity(sid("entity:proportion-restrictor"));
    const badProportion = quantifier(
      invalidProportionalId,
      invalidProportionalScope,
      restrictor.id,
      body.id,
      {
        quantifierKind: "proportional",
        cardinality: { kind: "proportion", value: 1.5 },
      },
    );

    const cases = [
      {
        id: "unresolved-universal-vs-negation",
        graph: base,
        expectedValid: true,
      },
      {
        id: "resolved-universal-wide",
        graph: snapshot([
          ...bare,
          constraint(
            sid("scope-constraint:resolved-q-wide"),
            qScope,
            "outscopes",
            negScope,
          ),
        ]),
        expectedValid: true,
      },
      {
        id: "hard-outscope-cycle",
        graph: snapshot([
          ...bare,
          constraint(
            sid("scope-constraint:a"),
            qScope,
            "outscopes",
            negScope,
          ),
          constraint(
            sid("scope-constraint:b"),
            negScope,
            "outscopes",
            qScope,
          ),
        ]),
        expectedValid: false,
      },
      {
        id: "invalid-proportion",
        graph: snapshot([
          restrictor,
          body,
          badProportion,
          scope(
            invalidProportionalScope,
            badProportion.id,
            body.id,
          ),
        ]),
        expectedValid: false,
      },
      {
        id: "same-vs-disjoint",
        graph: snapshot([
          ...bare,
          constraint(
            sid("scope-constraint:same-bench"),
            qScope,
            "same-scope",
            negScope,
          ),
          constraint(
            sid("scope-constraint:disjoint-bench"),
            qScope,
            "disjoint",
            negScope,
          ),
        ]),
        expectedValid: false,
      },
    ];

    const dataset: DatasetManifest = {
      schemaVersion: "jl-eval-dataset-1",
      id: "t320-scope-quantification-adversarial",
      version: "1.0.0",
      domain: "semantic",
      split: "test",
      itemCount: cases.length,
      contentDigest: "sha256:t320-scope-quantification",
      labelsProvenance: "deterministic-derived",
      tags: ["T320", "scope", "quantifier", "negation"],
      heldOutCombinations: true,
    };

    const report = await runBenchmark({
      benchmarkId: "t320-scope-quantification-adversarial",
      benchmarkVersion: "1.0.0",
      dataset,
      cases,
      evaluate(benchmarkCase) {
        const invalid = validateScopeGraph(benchmarkCase.graph).some(
          (diagnostic) =>
            diagnostic.severity === "error" ||
            diagnostic.severity === "fatal",
        );
        const observedValid = !invalid;
        return {
          status:
            observedValid === benchmarkCase.expectedValid ? "pass" : "fail",
          metrics: {
            correctDiagnosis:
              observedValid === benchmarkCase.expectedValid ? 1 : 0,
          },
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
