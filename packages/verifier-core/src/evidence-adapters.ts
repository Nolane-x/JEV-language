import type { Diagnostic } from "../../semantic-graph/src/index.ts";
import type {
  EvidenceGrade,
  VerificationObligation,
  VerificationResult,
  VerificationStatus,
  Verifier,
  VerifierManifest,
  VerifyContext,
} from "./framework.ts";

export type GrammarCheckKind =
  | "internal-feature-consistency"
  | "morphological-agreement"
  | "language-pack-constraints"
  | "parse-back"
  | "forbidden-form";

export interface GrammarEvidenceCheck {
  kind: GrammarCheckKind;
  status: VerificationStatus;
  evidence: string[];
  diagnostics: Diagnostic[];
}

export interface GrammarValidationSubject {
  artifactRef: string;
  language: string;
  checks: GrammarEvidenceCheck[];
}

const requiredGrammarChecks: readonly GrammarCheckKind[] = [
  "internal-feature-consistency",
  "morphological-agreement",
  "language-pack-constraints",
  "parse-back",
  "forbidden-form",
];

const diagnosticSeverity = (
  obligation: VerificationObligation,
): Diagnostic["severity"] =>
  obligation.severity === "required"
    ? "error"
    : obligation.severity === "recommended"
      ? "warning"
      : "info";

export class GrammarVerifierAdapter
  implements Verifier<GrammarValidationSubject>
{
  readonly manifest: VerifierManifest = {
    id: "verifier.grammar-adapter",
    version: "1.0.0",
    description:
      "Normalizes deterministic grammar, morphology, language-pack, parse-back, and forbidden-form evidence.",
    mode: "deterministic",
    kinds: ["syntactic-validity"],
  };

  canVerify(
    obligation: VerificationObligation,
    subject: GrammarValidationSubject,
  ): boolean {
    return (
      obligation.kind === "syntactic-validity" &&
      subject.language.trim() !== "" &&
      Array.isArray(subject.checks)
    );
  }

  async verify(
    obligation: VerificationObligation,
    subject: GrammarValidationSubject,
    _context: VerifyContext,
  ): Promise<VerificationResult> {
    const byKind = new Map(subject.checks.map((check) => [check.kind, check]));
    const missing = requiredGrammarChecks.filter((kind) => !byKind.has(kind));
    const failed = subject.checks.some((check) => check.status === "fail");
    const unknown =
      missing.length > 0 ||
      subject.checks.some(
        (check) => check.status === "unknown" || check.status === "skipped",
      );
    const status: VerificationStatus = failed
      ? "fail"
      : unknown
        ? "unknown"
        : "pass";

    return {
      obligationId: obligation.id,
      status,
      evidence: [
        ...new Set(subject.checks.flatMap((check) => check.evidence)),
      ],
      diagnostics: [
        ...subject.checks.flatMap((check) => check.diagnostics),
        ...missing.map((kind) => ({
          code: "GRAMMAR_CHECK_MISSING",
          severity: diagnosticSeverity(obligation),
          message: `Required grammar verification dimension is missing: ${kind}.`,
          details: { artifactRef: subject.artifactRef, language: subject.language },
        }) satisfies Diagnostic),
      ],
      verifier: {
        id: this.manifest.id,
        version: this.manifest.version,
        mode: this.manifest.mode,
        evidenceGrade:
          status === "pass"
            ? "executable-test-evidence"
            : subject.checks.length > 0
              ? "structured-heuristic-evidence"
              : "unverified",
      },
    };
  }
}

export interface CompileEvidence {
  status: Exclude<VerificationStatus, "skipped">;
  tool: string;
  version?: string;
  diagnostics: string[];
  evidenceRef?: string;
}

export interface TestEvidence {
  status: Exclude<VerificationStatus, "skipped">;
  runner: string;
  passed: number;
  failed: number;
  skipped?: number;
  evidenceRef?: string;
}

export interface ProgramEvidenceSubject {
  artifactRef: string;
  compile?: CompileEvidence;
  tests?: TestEvidence;
  requireTests: boolean;
}

const programEvidenceGrade = (
  subject: ProgramEvidenceSubject,
): EvidenceGrade => {
  if (subject.compile?.status === "pass") {
    return "compiler-static-guarantee";
  }
  if (subject.tests?.status === "pass") {
    return "executable-test-evidence";
  }
  return subject.compile !== undefined || subject.tests !== undefined
    ? "structured-heuristic-evidence"
    : "unverified";
};

export class ProgramEvidenceVerifier
  implements Verifier<ProgramEvidenceSubject>
{
  readonly manifest: VerifierManifest = {
    id: "verifier.program-evidence-adapter",
    version: "1.0.0",
    description:
      "Normalizes compiler/type-check and executable-test evidence without treating missing evidence as success.",
    mode: "external-tool",
    kinds: ["program-evidence", "behavioral-evidence"],
  };

  canVerify(
    obligation: VerificationObligation,
    subject: ProgramEvidenceSubject,
  ): boolean {
    return (
      (obligation.kind === "program-evidence" ||
        obligation.kind === "behavioral-evidence") &&
      subject.artifactRef.trim() !== ""
    );
  }

  async verify(
    obligation: VerificationObligation,
    subject: ProgramEvidenceSubject,
    _context: VerifyContext,
  ): Promise<VerificationResult> {
    const compile = subject.compile;
    const tests = subject.tests;
    let status: VerificationStatus;

    if (compile?.status === "fail" || tests?.status === "fail") {
      status = "fail";
    } else if (
      compile === undefined ||
      compile.status === "unknown" ||
      (subject.requireTests &&
        (tests === undefined || tests.status === "unknown"))
    ) {
      status = "unknown";
    } else {
      status = "pass";
    }

    const severity = diagnosticSeverity(obligation);
    const diagnostics: Diagnostic[] = [
      ...(compile?.diagnostics.map((message) => ({
        code:
          compile.status === "fail"
            ? "PROGRAM_COMPILE_FAILED"
            : "PROGRAM_COMPILE_DIAGNOSTIC",
        severity,
        message,
        details: { tool: compile.tool, version: compile.version ?? "" },
      })) ?? []),
    ];

    if (subject.requireTests && tests === undefined) {
      diagnostics.push({
        code: "PROGRAM_TEST_EVIDENCE_MISSING",
        severity,
        message:
          "The verification profile requires test evidence, but no test result was supplied.",
      });
    }
    if (tests?.status === "fail") {
      diagnostics.push({
        code: "PROGRAM_TEST_FAILED",
        severity,
        message: `${tests.failed} test(s) failed under ${tests.runner}.`,
        details: {
          passed: tests.passed,
          failed: tests.failed,
          skipped: tests.skipped ?? 0,
        },
      });
    }

    return {
      obligationId: obligation.id,
      status,
      evidence: [
        ...(compile?.evidenceRef === undefined ? [] : [compile.evidenceRef]),
        ...(tests?.evidenceRef === undefined ? [] : [tests.evidenceRef]),
      ],
      diagnostics,
      verifier: {
        id: this.manifest.id,
        version: this.manifest.version,
        mode: this.manifest.mode,
        evidenceGrade: programEvidenceGrade(subject),
      },
    };
  }
}
