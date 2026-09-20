import { describe, expect, it } from "vitest";
import {
  resultEnvelopeError,
  resultEnvelopeOk,
  validateResultEnvelope,
} from "../../packages/core-types/src/index.ts";
import {
  validateActionIr,
  validateCapabilityRegistry,
  type ActionIR,
  type CapabilityDefinition,
} from "../../packages/action-ir/src/index.ts";
import {
  validateDataIr,
  validateLogicIr,
  validateMathIr,
  validateQueryIr,
  validateSchemaIr,
  type LogicIr,
  type MathIr,
  type QueryIr,
  type SchemaIr,
} from "../../packages/formal-ir/src/index.ts";
import {
  compareSemanticJson,
} from "../../packages/semantic-graph/src/index.ts";
import {
  evidenceAncestors,
  validateEvidenceGraph,
  type EvidenceGraph,
} from "../../packages/verifier-core/src/index.ts";
import {
  buildV04ConformanceDashboard,
  transitionLearningProposal,
  validateLearningProposal,
  type LearningProposal,
} from "../../packages/evaluation-core/src/index.ts";

describe("T491-T500 formal/action/evidence closure", () => {
  it("T491 confirms Logic IR core validation for compositional Boolean/modal structure", () => {
    const logic: LogicIr = {
      kind: "implies",
      antecedent: {
        kind: "and",
        values: [
          { kind: "boolean", value: true },
          { kind: "not", value: { kind: "boolean", value: false } },
        ],
      },
      consequent: {
        kind: "modal",
        operator: "required",
        body: { kind: "boolean", value: true },
      },
    };
    expect(validateLogicIr(logic).ok).toBe(true);
    expect(
      validateLogicIr({ kind: "and", values: [{ kind: "boolean", value: true }] }).ok,
    ).toBe(false);
  });

  it("T492 confirms Math IR core validation for relations and structured expressions", () => {
    const math: MathIr = {
      kind: "relation",
      relation: "eq",
      left: {
        kind: "sum",
        terms: [
          { kind: "symbol", name: "x" },
          { kind: "constant", value: 1 },
        ],
      },
      right: { kind: "constant", value: 2 },
    };
    expect(validateMathIr(math).ok).toBe(true);
    expect(
      validateMathIr({
        kind: "derivative",
        variable: "x",
        expression: { kind: "symbol", name: "x" },
        order: 0,
      }).ok,
    ).toBe(false);
  });

  it("T493 confirms Query IR core validation for typed read queries", () => {
    const query: QueryIr = {
      id: "query:user-by-id",
      mode: "read",
      source: {
        id: "source:users",
        kind: "named",
        name: "users",
        alias: "u",
      },
      projection: [
        {
          expression: { kind: "field", sourceAlias: "u", path: ["name"] },
          alias: "name",
        },
      ],
      filter: {
        kind: "operator",
        operator: "eq",
        args: [
          { kind: "field", sourceAlias: "u", path: ["id"] },
          { kind: "parameter", name: "id" },
        ],
      },
      parameters: [
        {
          name: "id",
          schema: { kind: "primitive", type: "string" },
        },
      ],
    };
    expect(validateQueryIr(query).ok).toBe(true);
    expect(
      validateQueryIr({ id: "query:bad", mode: "mutation" }).ok,
    ).toBe(false);
  });

  it("T494 confirms Schema/Data IR cores reject malformed structural values", () => {
    const schema: SchemaIr = {
      kind: "object",
      fields: [
        {
          name: "count",
          schema: {
            kind: "primitive",
            type: "integer",
            constraints: [{ kind: "min", value: 0 }],
          },
          required: true,
        },
      ],
      additionalProperties: false,
    };
    expect(validateSchemaIr(schema).ok).toBe(true);
    expect(
      validateDataIr({
        kind: "object",
        fields: [
          { key: "x", value: { kind: "number", value: 1 } },
          { key: "x", value: { kind: "number", value: 2 } },
        ],
      }).ok,
    ).toBe(false);
  });

  it("T495 refines Action IR capability schema with version, execution, risk, dependency and evidence gates", () => {
    const capabilities: CapabilityDefinition[] = [
      {
        id: "capability.read-file",
        version: "1.0.0",
        input: {
          kind: "object",
          fields: [
            { name: "path", schema: { kind: "string" }, required: true },
          ],
          additionalProperties: false,
        },
        output: { kind: "string" },
        sideEffect: "read",
        executionMode: "external-tool",
        riskLevel: "low",
        evidenceRefs: ["docs:read-file-adapter"],
      },
      {
        id: "capability.summarize-file",
        version: "1.0.0",
        input: { kind: "string" },
        output: { kind: "string" },
        sideEffect: "none",
        executionMode: "deterministic",
        riskLevel: "low",
        requiresCapabilities: ["capability.read-file"],
      },
    ];
    expect(validateCapabilityRegistry(capabilities).ok).toBe(true);

    const action: ActionIR = {
      actionType: "capability.read-file",
      parameters: {
        kind: "structured",
        fields: {
          path: {
            kind: "string",
            value: {
              kind: "surface-literal",
              value: "/tmp/a.txt",
              origin: "configured",
            },
          },
        },
      },
      provenance: ["prov:action" as never],
    };
    expect(
      validateActionIr(action, { capabilities }).ok,
    ).toBe(true);

    expect(
      validateCapabilityRegistry([
        {
          ...capabilities[0]!,
          evidenceRefs: [],
        },
      ]).ok,
    ).toBe(false);
  });

  it("T496 provides a common ResultEnvelope that cannot conflate success and failure", () => {
    const success = resultEnvelopeOk({
      value: { answer: 42 },
      evidenceRefs: ["test:answer"],
    });
    expect(validateResultEnvelope(success).ok).toBe(true);

    const failure = resultEnvelopeError({
      code: "BROKEN",
      message: "failure",
      evidenceRefs: ["test:failure"],
    });
    expect(validateResultEnvelope(failure).ok).toBe(true);

    expect(
      validateResultEnvelope({
        schemaVersion: "jl-result-envelope-1",
        status: "ok",
        error: { code: "BAD", message: "conflict" },
        evidenceRefs: [],
        diagnostics: [],
      }).ok,
    ).toBe(false);
  });

  it("T497 validates evidence graph identity, references and acyclic derivation", () => {
    const graph: EvidenceGraph = {
      schemaVersion: "jl-evidence-graph-1",
      nodes: [
        {
          id: "evidence:source",
          kind: "observation",
          grade: "structured-heuristic-evidence",
        },
        {
          id: "evidence:test",
          kind: "test",
          grade: "executable-test-evidence",
        },
        {
          id: "evidence:proof",
          kind: "formal-proof",
          grade: "formal-deterministic-proof",
        },
      ],
      edges: [
        {
          id: "edge:test-source",
          from: "evidence:test",
          to: "evidence:source",
          relation: "derived-from",
        },
        {
          id: "edge:proof-test",
          from: "evidence:proof",
          to: "evidence:test",
          relation: "supports",
        },
      ],
    };
    expect(validateEvidenceGraph(graph).ok).toBe(true);
    expect(evidenceAncestors(graph, "evidence:proof")).toEqual({
      ok: true,
      value: ["evidence:source", "evidence:test"],
    });

    const cyclic: EvidenceGraph = {
      ...structuredClone(graph),
      edges: [
        {
          id: "edge:a",
          from: "evidence:test",
          to: "evidence:proof",
          relation: "derived-from",
        },
        {
          id: "edge:b",
          from: "evidence:proof",
          to: "evidence:test",
          relation: "derived-from",
        },
      ],
    };
    expect(validateEvidenceGraph(cyclic).ok).toBe(false);
  });

  it("T498 exposes explicit semantic equality modes instead of one hidden equivalence rule", () => {
    const left = { b: 2, a: 1 };
    const right = { a: 1, b: 2 };
    expect(
      compareSemanticJson(left, right, { mode: "exact-json" }),
    ).toMatchObject({ ok: true, value: { equal: false } });
    expect(
      compareSemanticJson(left, right, { mode: "canonical" }),
    ).toMatchObject({ ok: true, value: { equal: true } });

    expect(
      compareSemanticJson(
        { values: [1, 2, 3] },
        { values: [3, 2, 1] },
        { mode: "set-like-arrays" },
      ),
    ).toMatchObject({ ok: true, value: { equal: true } });

    expect(
      compareSemanticJson(
        { value: 1, metadata: { trace: "a" } },
        { value: 1, metadata: { trace: "b" } },
        { mode: "ignore-metadata" },
      ),
    ).toMatchObject({ ok: true, value: { equal: true } });
  });

  it("T499 enforces evidence-gated learning proposal evaluation and promotion lifecycle", () => {
    let proposal: LearningProposal = {
      schemaVersion: "jl-learning-proposal-1",
      id: "learning:rule-1",
      target: "grammar:rule-1",
      change: { operation: "tighten", value: 1 },
      status: "proposed",
      evidenceRefs: [],
      evaluationRefs: [],
      history: [],
    };
    expect(validateLearningProposal(proposal).ok).toBe(true);

    const evaluated = transitionLearningProposal(proposal, {
      to: "evaluated",
      evidenceRefs: ["eval:run-1"],
      evaluationRefs: ["eval:run-1"],
      rationale: "held-out evaluation completed",
    });
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    proposal = evaluated.value;

    const approved = transitionLearningProposal(proposal, {
      to: "approved",
      evidenceRefs: ["review:approval"],
      rationale: "evaluation thresholds satisfied",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const promoted = transitionLearningProposal(approved.value, {
      to: "promoted",
      evidenceRefs: ["release:promotion"],
      rationale: "promotion gate passed",
    });
    expect(promoted.ok).toBe(true);
    expect(
      transitionLearningProposal(
        {
          schemaVersion: "jl-learning-proposal-1",
          id: "learning:direct",
          target: "grammar:x",
          change: null,
          status: "proposed",
          evidenceRefs: [],
          evaluationRefs: [],
          history: [],
        },
        {
          to: "promoted",
          evidenceRefs: ["bad:direct"],
          rationale: "skip gates",
        },
      ).ok,
    ).toBe(false);
  });

  it("T500 builds a cross-layer dashboard where implemented is never silently treated as verified", () => {
    const ids = Array.from({ length: 10 }, (_, index) => `T${491 + index}`);
    const pass = buildV04ConformanceDashboard({
      zeroGenerativePassed: true,
      entries: ids.map((id) => ({
        id,
        layer: id === "T495" ? "action" : id === "T500" ? "evaluation" : "formal-evidence",
        required: true,
        status: "verified" as const,
        evidenceRefs: [`test:${id}`],
      })),
    });
    expect(pass.ok).toBe(true);
    if (pass.ok) {
      expect(pass.value.status).toBe("pass");
      expect(pass.value.verifiedRequired).toBe(10);
    }

    const incomplete = buildV04ConformanceDashboard({
      zeroGenerativePassed: true,
      entries: [
        {
          id: "T500",
          layer: "evaluation",
          required: true,
          status: "implemented",
          evidenceRefs: [],
        },
      ],
    });
    expect(incomplete).toMatchObject({
      ok: true,
      value: {
        status: "incomplete",
        implementedNotVerified: ["T500"],
      },
    });

    const zeroGenFailure = buildV04ConformanceDashboard({
      zeroGenerativePassed: false,
      entries: [
        {
          id: "T500",
          layer: "evaluation",
          required: true,
          status: "verified",
          evidenceRefs: ["test:T500"],
        },
      ],
    });
    expect(zeroGenFailure).toMatchObject({
      ok: true,
      value: { status: "fail" },
    });
  });
});
