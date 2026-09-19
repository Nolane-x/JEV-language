import { describe, expect, it } from "vitest";
import {
  createSemanticId,
  ok,
  sha256,
  type TrustLabel,
} from "../../packages/core-types/src/index.ts";
import {
  typecheckTypeScript,
} from "../../packages/code-backend-core/src/typescript.ts";
import {
  parseControlledRequirement,
} from "../../packages/grounding/src/index.ts";
import {
  realizeControlledEnglish,
} from "../../packages/realizer-core/src/index.ts";
import type {
  ProvenanceRecord,
} from "../../packages/provenance/src/index.ts";
import {
  GrammarVerifierAdapter,
  ProgramEvidenceVerifier,
  ProvenanceIntegrityVerifier,
  RequirementSatisfactionVerifier,
  RoundTripVerifier,
  SemanticPreservationVerifier,
  TrustVerifier,
  VerificationRegistry,
  runVerificationPlan,
  verifyControlledEquivalence,
  verifyProvenanceIntegrity,
  verifyVerificationReplay,
  type GrammarEvidenceCheck,
  type VerificationKind,
  type VerificationObligation,
  type VerificationResult,
  type Verifier,
  type VerifierExecutionMode,
} from "../../packages/verifier-core/src/index.ts";

const obligation = (
  id: string,
  kind: VerificationKind,
  verifierCandidates: string[],
  provenance: ReturnType<typeof createSemanticId>[] = [],
): VerificationObligation => ({
  id,
  kind,
  subject: `artifact:${id}`,
  severity: "required",
  verifierCandidates,
  provenance,
});

const grammarChecks = (): GrammarEvidenceCheck[] =>
  [
    "internal-feature-consistency",
    "morphological-agreement",
    "language-pack-constraints",
    "parse-back",
    "forbidden-form",
  ].map((kind) => ({
    kind,
    status: "pass",
    evidence: [`grammar:${kind}`],
    diagnostics: [],
  }));

const fixedVerifier = (
  id: string,
  status: "pass" | "fail",
  mode: VerifierExecutionMode,
): Verifier<{ fixture: true }> => ({
  manifest: {
    id,
    version: "1.0.0",
    description: `fixture verifier ${id}`,
    mode,
    kinds: ["structural-validity"],
  },
  canVerify(check) {
    return check.kind === "structural-validity";
  },
  async verify(check): Promise<VerificationResult> {
    return {
      obligationId: check.id,
      status,
      evidence: [`evidence:${id}:${status}`],
      diagnostics:
        status === "fail"
          ? [
              {
                code: "FIXTURE_FAIL",
                severity: "error",
                message: `${id} deliberately fails.`,
              },
            ]
          : [],
      verifier: {
        id,
        version: "1.0.0",
        mode,
        evidenceGrade:
          mode === "jev-assisted"
            ? "jev-judgment"
            : "formal-deterministic-proof",
      },
    };
  },
});

describe("M17 integrated verification hardening gate", () => {
  it("orchestrates all Section-427 verification families and emits self-verifying replay evidence", async () => {
    const surface =
      "The service must not delete more than 3 files.";
    const parsed = parseControlledRequirement(surface);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const provenanceId = createSemanticId("prov");
    const source = structuredClone(parsed.value.snapshot);
    for (const node of source.nodes) {
      node.provenance = [provenanceId];
      node.trust = "user-content" satisfies TrustLabel;
    }
    const candidate = structuredClone(source);

    const records: ProvenanceRecord[] = [
      {
        id: provenanceId,
        originType: "user-input",
        sourceRefs: [],
        trust: "user-content",
      },
    ];

    const registry = new VerificationRegistry();
    expect(
      registry.register(new SemanticPreservationVerifier()).ok,
    ).toBe(true);
    expect(registry.register(new RoundTripVerifier()).ok).toBe(true);
    expect(
      registry.register(new ProvenanceIntegrityVerifier()).ok,
    ).toBe(true);
    expect(registry.register(new TrustVerifier()).ok).toBe(true);
    expect(
      registry.register(new RequirementSatisfactionVerifier()).ok,
    ).toBe(true);
    expect(
      registry.register(new GrammarVerifierAdapter()).ok,
    ).toBe(true);
    expect(
      registry.register(new ProgramEvidenceVerifier()).ok,
    ).toBe(true);

    const compileDiagnostics = typecheckTypeScript(
      "export const answer: number = 42;\n",
    );
    expect(compileDiagnostics).toEqual([]);

    const result = await runVerificationPlan({
      registry,
      items: [
        {
          obligation: obligation(
            "m17:semantic",
            "semantic-preservation",
            ["verifier.semantic-preservation"],
            [provenanceId],
          ),
          subject: { source, candidate },
        },
        {
          obligation: obligation(
            "m17:round-trip",
            "round-trip",
            ["verifier.round-trip"],
            [provenanceId],
          ),
          subject: {
            source,
            realize: () => realizeControlledEnglish(source),
            parse: (text: string) => {
              const reparsed = parseControlledRequirement(text);
              return reparsed.ok
                ? ok(reparsed.value.snapshot)
                : reparsed;
            },
            compareSemantics: (
              original: typeof source,
              recovered: typeof source,
            ) => ({
              equivalent: verifyControlledEquivalence(
                original,
                recovered,
              ).equivalent,
              evidence: [
                "evidence:m17:controlled-semantic-equivalence",
              ],
            }),
          },
        },
        {
          obligation: obligation(
            "m17:provenance",
            "provenance-integrity",
            ["verifier.provenance-integrity"],
            [provenanceId],
          ),
          subject: {
            requiredRefs: [provenanceId],
            records,
          },
        },
        {
          obligation: obligation(
            "m17:trust",
            "security-trust",
            ["verifier.trust-propagation"],
            [provenanceId],
          ),
          subject: { source, candidate },
        },
        {
          obligation: obligation(
            "m17:requirements",
            "requirement-satisfaction",
            ["verifier.requirement-satisfaction"],
            [provenanceId],
          ),
          subject: {
            checks: [
              {
                requirementId: "req:delete-limit",
                mandatory: true,
                status: "satisfied",
                evidence: ["test:req:delete-limit"],
                diagnostics: [],
              },
            ],
          },
        },
        {
          obligation: obligation(
            "m17:grammar",
            "syntactic-validity",
            ["verifier.grammar-adapter"],
            [provenanceId],
          ),
          subject: {
            artifactRef: "text:m17",
            language: "en",
            checks: grammarChecks(),
          },
        },
        {
          obligation: obligation(
            "m17:program",
            "program-evidence",
            ["verifier.program-evidence-adapter"],
            [provenanceId],
          ),
          subject: {
            artifactRef: "code:m17",
            compile: {
              status: "pass",
              tool: "typescript",
              diagnostics: compileDiagnostics,
              evidenceRef: "compiler:m17:typescript",
            },
            tests: {
              status: "pass",
              runner: "vitest",
              passed: 3,
              failed: 0,
              evidenceRef: "test:m17:vitest",
            },
            requireTests: true,
          },
        },
      ],
      replay: {
        determinism: "D0",
        inputSourceDigests: [sha256(surface)],
        graphRevisions: [source.revision],
        languagePackVersions: { en: "controlled-m17" },
        schemaVersions: { verification: "1.0.0" },
        featureFlags: ["m17-integrated-gate"],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("pass");
    expect(result.value.entries).toHaveLength(7);
    expect(result.value.requiredSatisfied).toHaveLength(7);
    expect(result.value.requiredFailed).toEqual([]);
    expect(result.value.requiredUnknown).toEqual([]);
    expect(result.value.evidenceGrade).toBe(
      "formal-deterministic-proof",
    );
    expect(result.value.requiredEvidenceFloor).toBe(
      "executable-test-evidence",
    );

    const replay = verifyVerificationReplay(result.value);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;

    expect(replay.value.bundleDigest).toBe(
      result.value.replay.bundleDigest,
    );
    expect(
      result.value.replay.events.some(
        (event) => event.stage === "verification-plan",
      ),
    ).toBe(true);
    expect(
      result.value.replay.events.filter(
        (event) => event.stage === "verification-authoritative",
      ),
    ).toHaveLength(7);
    expect(
      result.value.replay.manifest.annotations,
    ).toMatchObject({
      suiteStatus: "pass",
      requiredEvidenceFloor: "executable-test-evidence",
    });
  });

  it("refuses to convert conflicting deterministic verifier results into pass", async () => {
    const registry = new VerificationRegistry();
    expect(
      registry.register(
        fixedVerifier(
          "verifier.fixture.pass",
          "pass",
          "deterministic",
        ),
      ).ok,
    ).toBe(true);
    expect(
      registry.register(
        fixedVerifier(
          "verifier.fixture.fail",
          "fail",
          "deterministic",
        ),
      ).ok,
    ).toBe(true);

    const result = await runVerificationPlan({
      registry,
      items: [
        {
          obligation: obligation(
            "m17:conflict",
            "structural-validity",
            [
              "verifier.fixture.pass",
              "verifier.fixture.fail",
            ],
          ),
          subject: { fixture: true },
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("unknown");
    expect(result.value.entries[0]?.conflict).toBe(true);
    expect(
      result.value.entries[0]?.authoritative.diagnostics[0]?.code,
    ).toBe("VERIFIER_AUTHORITATIVE_CONFLICT");
  });

  it("never allows Jev judgment to override a deterministic failure", async () => {
    const registry = new VerificationRegistry();
    expect(
      registry.register(
        fixedVerifier(
          "verifier.fixture.deterministic-fail",
          "fail",
          "deterministic",
        ),
      ).ok,
    ).toBe(true);
    expect(
      registry.register(
        fixedVerifier(
          "verifier.fixture.jev-pass",
          "pass",
          "jev-assisted",
        ),
      ).ok,
    ).toBe(true);

    const result = await runVerificationPlan({
      registry,
      items: [
        {
          obligation: obligation(
            "m17:precedence",
            "structural-validity",
            [
              "verifier.fixture.deterministic-fail",
              "verifier.fixture.jev-pass",
            ],
          ),
          subject: { fixture: true },
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("fail");
    expect(
      result.value.entries[0]?.authoritative.verifier.id,
    ).toBe("verifier.fixture.deterministic-fail");
  });

  it("downgrades malformed verifier passes instead of trusting their claimed success", async () => {
    const registry = new VerificationRegistry();
    const malformed: Verifier<{ fixture: true }> = {
      manifest: {
        id: "verifier.fixture.no-evidence",
        version: "1.0.0",
        description: "deliberately malformed verifier",
        mode: "deterministic",
        kinds: ["structural-validity"],
      },
      canVerify(check) {
        return check.kind === "structural-validity";
      },
      async verify(check) {
        return {
          obligationId: check.id,
          status: "pass",
          evidence: [],
          diagnostics: [],
          verifier: {
            id: this.manifest.id,
            version: this.manifest.version,
            mode: this.manifest.mode,
            evidenceGrade: "formal-deterministic-proof",
          },
        };
      },
    };
    expect(registry.register(malformed).ok).toBe(true);

    const result = await runVerificationPlan({
      registry,
      items: [
        {
          obligation: obligation(
            "m17:no-evidence",
            "structural-validity",
            [malformed.manifest.id],
          ),
          subject: { fixture: true },
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("unknown");
    expect(
      result.value.entries[0]?.authoritative.diagnostics[0]?.code,
    ).toBe("VERIFIER_PASS_WITHOUT_EVIDENCE");
  });

  it("detects missing, duplicated, cyclic, and authority-escalating provenance", () => {
    const root = createSemanticId("prov");
    const escalated = createSemanticId("prov");
    const cycleA = createSemanticId("prov");
    const cycleB = createSemanticId("prov");
    const orphan = createSemanticId("prov");
    const missing = createSemanticId("prov");
    const requiredMissing = createSemanticId("prov");

    const violations = verifyProvenanceIntegrity({
      requiredRefs: [root, requiredMissing],
      records: [
        {
          id: root,
          originType: "user-input",
          sourceRefs: [],
          trust: "user-content",
        },
        {
          id: root,
          originType: "user-input",
          sourceRefs: [],
          trust: "user-content",
        },
        {
          id: escalated,
          originType: "deterministic-derivation",
          sourceRefs: [root],
          trust: "system-trusted",
        },
        {
          id: cycleA,
          originType: "deterministic-derivation",
          sourceRefs: [cycleB],
          trust: "user-content",
        },
        {
          id: cycleB,
          originType: "deterministic-derivation",
          sourceRefs: [cycleA],
          trust: "user-content",
        },
        {
          id: orphan,
          originType: "deterministic-derivation",
          sourceRefs: [missing],
          trust: "external-content",
        },
      ],
    });

    expect(violations.map((violation) => violation.code)).toEqual(
      expect.arrayContaining([
        "PROVENANCE_REQUIRED_MISSING",
        "PROVENANCE_SOURCE_MISSING",
        "PROVENANCE_DUPLICATE_ID",
        "PROVENANCE_CYCLE",
        "PROVENANCE_TRUST_ESCALATION",
      ]),
    );
  });

  it("detects replay tampering instead of accepting modified verification evidence", async () => {
    const registry = new VerificationRegistry();
    expect(
      registry.register(
        fixedVerifier(
          "verifier.fixture.replay",
          "pass",
          "deterministic",
        ),
      ).ok,
    ).toBe(true);

    const result = await runVerificationPlan({
      registry,
      items: [
        {
          obligation: obligation(
            "m17:replay-tamper",
            "structural-validity",
            ["verifier.fixture.replay"],
          ),
          subject: { fixture: true },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tampered = structuredClone(result.value);
    const event = tampered.replay.events[0];
    expect(event).toBeDefined();
    if (event === undefined) return;
    event.stage = "tampered-stage";

    const replay = verifyVerificationReplay(tampered);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.error.code).toBe(
        "REPLAY_BUNDLE_DIGEST_MISMATCH",
      );
    }
  });
});
