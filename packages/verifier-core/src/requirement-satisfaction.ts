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

export type RequirementCheckStatus =
  | "satisfied"
  | "failed"
  | "unknown"
  | "not-applicable";

export interface RequirementCheck {
  requirementId: string;
  mandatory: boolean;
  status: RequirementCheckStatus;
  evidence: string[];
  diagnostics: Diagnostic[];
}

export interface RequirementSatisfactionReport {
  status: "pass" | "fail" | "unknown";
  satisfied: string[];
  failed: string[];
  unknown: string[];
  notApplicable: string[];
  checks: RequirementCheck[];
}

export const buildRequirementSatisfactionReport = (
  checks: readonly RequirementCheck[],
): RequirementSatisfactionReport => {
  const cloned = checks.map((check) => structuredClone(check));
  const mandatoryFailure = cloned.some(
    (check) =>
      check.mandatory &&
      (check.status === "failed" || check.status === "not-applicable"),
  );
  const mandatoryUnknown = cloned.some(
    (check) => check.mandatory && check.status === "unknown",
  );

  return {
    status: mandatoryFailure ? "fail" : mandatoryUnknown ? "unknown" : "pass",
    satisfied: cloned
      .filter((check) => check.status === "satisfied")
      .map((check) => check.requirementId),
    failed: cloned
      .filter(
        (check) =>
          check.status === "failed" ||
          (check.mandatory && check.status === "not-applicable"),
      )
      .map((check) => check.requirementId),
    unknown: cloned
      .filter((check) => check.status === "unknown")
      .map((check) => check.requirementId),
    notApplicable: cloned
      .filter((check) => check.status === "not-applicable")
      .map((check) => check.requirementId),
    checks: cloned,
  };
};

export interface RequirementSatisfactionSubject {
  checks: RequirementCheck[];
}

const evidenceGradeFor = (
  checks: readonly RequirementCheck[],
): EvidenceGrade =>
  checks.some((check) => check.evidence.some((evidence) => evidence.startsWith("test:")))
    ? "executable-test-evidence"
    : checks.some((check) =>
          check.evidence.some((evidence) => evidence.startsWith("compiler:")),
        )
      ? "compiler-static-guarantee"
      : checks.some((check) => check.evidence.length > 0)
        ? "structured-heuristic-evidence"
        : "unverified";

export class RequirementSatisfactionVerifier
  implements Verifier<RequirementSatisfactionSubject>
{
  readonly manifest: VerifierManifest = {
    id: "verifier.requirement-satisfaction",
    version: "1.0.0",
    description:
      "Aggregates per-requirement satisfied/failed/unknown/not-applicable evidence without collapsing unknown into pass.",
    mode: "deterministic",
    kinds: ["requirement-satisfaction"],
  };

  canVerify(
    obligation: VerificationObligation,
    subject: RequirementSatisfactionSubject,
  ): boolean {
    return (
      obligation.kind === "requirement-satisfaction" &&
      Array.isArray(subject.checks)
    );
  }

  async verify(
    obligation: VerificationObligation,
    subject: RequirementSatisfactionSubject,
    _context: VerifyContext,
  ): Promise<VerificationResult> {
    const report = buildRequirementSatisfactionReport(subject.checks);
    const status: VerificationStatus =
      report.status === "pass"
        ? "pass"
        : report.status === "fail"
          ? "fail"
          : "unknown";
    return {
      obligationId: obligation.id,
      status,
      evidence: [...new Set(report.checks.flatMap((check) => check.evidence))],
      diagnostics: report.checks.flatMap((check) => check.diagnostics),
      verifier: {
        id: this.manifest.id,
        version: this.manifest.version,
        mode: this.manifest.mode,
        evidenceGrade: evidenceGradeFor(report.checks),
      },
    };
  }
}
