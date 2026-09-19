import { describe, expect, it } from "vitest";
import {
  err,
  ok,
  StructuredError,
  type TrustLabel,
} from "../../packages/core-types/src/index.ts";
import { parseControlledRequirement } from "../../packages/grounding/src/index.ts";
import { realizeControlledEnglish } from "../../packages/realizer-core/src/index.ts";
import {
  GrammarVerifierAdapter,
  ProgramEvidenceVerifier,
  RequirementSatisfactionVerifier,
  RoundTripVerifier,
  TrustVerifier,
  buildRequirementSatisfactionReport,
  verifyControlledEquivalence,
  type GrammarEvidenceCheck,
  type VerificationKind,
  type VerificationObligation,
} from "../../packages/verifier-core/src/index.ts";
import { typecheckTypeScript } from "../../packages/code-backend-core/src/typescript.ts";

const obligation = (
  id: string,
  kind: VerificationKind,
): VerificationObligation => ({
  id,
  kind,
  subject: "artifact:test",
  severity: "required",
  verifierCandidates: [],
  provenance: [],
});

describe("M17 verification hardening conformance", () => {
  it("round-trips controlled language by semantic meaning rather than generated node IDs", async () => {
    const parsed = parseControlledRequirement(
      "The service must not delete more than 3 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const verifier = new RoundTripVerifier();
    const result = await verifier.verify(
      obligation("verify:round-trip", "round-trip"),
      {
        source: parsed.value.snapshot,
        realize: () => realizeControlledEnglish(parsed.value.snapshot),
        parse: (surface) => {
          const reparsed = parseControlledRequirement(surface);
          return reparsed.ok
            ? ok(reparsed.value.snapshot)
            : err(reparsed.error);
        },
        compareSemantics: (source, recovered) => ({
          equivalent: verifyControlledEquivalence(source, recovered).equivalent,
          evidence: ["evidence:controlled-equivalence:v1"],
        }),
      },
      {},
    );

    expect(result.status).toBe("pass");
    expect(result.verifier.evidenceGrade).toBe("executable-test-evidence");
  });

  it("reports parser limitations as unknown instead of semantic failure", async () => {
    const parsed = parseControlledRequirement(
      "The service must not delete more than 1 file.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await new RoundTripVerifier().verify(
      obligation("verify:parser-limit", "round-trip"),
      {
        source: parsed.value.snapshot,
        realize: () => realizeControlledEnglish(parsed.value.snapshot),
        parse: () =>
          err(
            new StructuredError(
              "TEST_PARSER_LIMITATION",
              "Deliberate parser limitation.",
            ),
          ),
        parserLimitations: ["controlled-test-fixture"],
      },
      {},
    );

    expect(result.status).toBe("unknown");
    expect(result.diagnostics[0]?.code).toBe("ROUND_TRIP_PARSE_FAILED");
  });

  it("rejects authority escalation and dropped provenance", async () => {
    const parsed = parseControlledRequirement(
      "The service must not delete more than 3 files.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const candidate = structuredClone(parsed.value.snapshot);
    const first = candidate.nodes[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    first.trust = "system-trusted" satisfies TrustLabel;
    first.provenance = [];

    const result = await new TrustVerifier().verify(
      obligation("verify:trust", "security-trust"),
      { source: parsed.value.snapshot, candidate },
      {},
    );

    expect(result.status).toBe("fail");
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "TRUST_AUTHORITY_ESCALATION",
        "TRUST_PROVENANCE_DROPPED",
        "TRUST_PROVENANCE_MISSING",
      ]),
    );
  });

  it("preserves per-requirement satisfied/failed/unknown/not-applicable states", async () => {
    const report = buildRequirementSatisfactionReport([
      {
        requirementId: "req:must-compile",
        mandatory: true,
        status: "satisfied",
        evidence: ["compiler:ts"],
        diagnostics: [],
      },
      {
        requirementId: "req:optional-doc",
        mandatory: false,
        status: "not-applicable",
        evidence: [],
        diagnostics: [],
      },
      {
        requirementId: "req:behavior",
        mandatory: true,
        status: "unknown",
        evidence: [],
        diagnostics: [],
      },
    ]);
    expect(report.status).toBe("unknown");
    expect(report.satisfied).toEqual(["req:must-compile"]);
    expect(report.unknown).toEqual(["req:behavior"]);
    expect(report.notApplicable).toEqual(["req:optional-doc"]);

    const result = await new RequirementSatisfactionVerifier().verify(
      obligation("verify:requirements", "requirement-satisfaction"),
      { checks: report.checks },
      {},
    );
    expect(result.status).toBe("unknown");
  });

  it("requires every grammar verification dimension instead of treating missing checks as pass", async () => {
    const pass = (
      kind: GrammarEvidenceCheck["kind"],
    ): GrammarEvidenceCheck => ({
      kind,
      status: "pass",
      evidence: [`grammar:${kind}`],
      diagnostics: [],
    });

    const checks: GrammarEvidenceCheck[] = [
      pass("internal-feature-consistency"),
      pass("morphological-agreement"),
      pass("language-pack-constraints"),
      pass("parse-back"),
      pass("forbidden-form"),
    ];
    const verifier = new GrammarVerifierAdapter();
    const passed = await verifier.verify(
      obligation("verify:grammar", "syntactic-validity"),
      { artifactRef: "text:1", language: "en", checks },
      {},
    );
    expect(passed.status).toBe("pass");

    const incomplete = await verifier.verify(
      obligation("verify:grammar-incomplete", "syntactic-validity"),
      {
        artifactRef: "text:1",
        language: "en",
        checks: checks.filter((check) => check.kind !== "parse-back"),
      },
      {},
    );
    expect(incomplete.status).toBe("unknown");
    expect(incomplete.diagnostics[0]?.code).toBe("GRAMMAR_CHECK_MISSING");
  });

  it("normalizes compiler and test evidence without converting missing tests into success", async () => {
    const diagnostics = typecheckTypeScript(
      "export const answer: number = 42;\n",
    );
    expect(diagnostics).toEqual([]);

    const verifier = new ProgramEvidenceVerifier();
    const passed = await verifier.verify(
      obligation("verify:program", "program-evidence"),
      {
        artifactRef: "code:1",
        compile: {
          status: "pass",
          tool: "typescript",
          diagnostics,
          evidenceRef: "compiler:typescript:test",
        },
        tests: {
          status: "pass",
          runner: "vitest",
          passed: 2,
          failed: 0,
          evidenceRef: "test:vitest:test",
        },
        requireTests: true,
      },
      {},
    );
    expect(passed.status).toBe("pass");

    const missingTests = await verifier.verify(
      obligation("verify:program-missing-tests", "program-evidence"),
      {
        artifactRef: "code:1",
        compile: {
          status: "pass",
          tool: "typescript",
          diagnostics: [],
        },
        requireTests: true,
      },
      {},
    );
    expect(missingTests.status).toBe("unknown");
    expect(missingTests.diagnostics[0]?.code).toBe(
      "PROGRAM_TEST_EVIDENCE_MISSING",
    );
  });
});
