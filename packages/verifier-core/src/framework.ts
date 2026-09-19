import type {
  ConfidenceValue,
  JsonValue,
  SemanticId,
} from "../../core-types/src/index.ts";
import type { ProvenanceRef } from "../../provenance/src/index.ts";
import type {
  Diagnostic,
  SemanticValue,
} from "../../semantic-graph/src/index.ts";

export type VerificationKind =
  | "syntactic-validity"
  | "structural-validity"
  | "semantic-preservation"
  | "round-trip"
  | "requirement-satisfaction"
  | "behavioral-evidence"
  | "naturalness-style"
  | "provenance-integrity"
  | "security-trust"
  | "program-evidence";

export type VerificationSeverity =
  | "required"
  | "recommended"
  | "informational";

export type ArtifactRef = string;
export type VerifierRef = string;
export type EvidenceRef = string;

export interface VerificationObligation {
  id: string;
  kind: VerificationKind;
  subject: ArtifactRef | SemanticId;
  expected?: SemanticValue;
  severity: VerificationSeverity;
  verifierCandidates: VerifierRef[];
  provenance: ProvenanceRef[];
}

export type VerificationStatus = "pass" | "fail" | "unknown" | "skipped";

export type VerifierExecutionMode =
  | "deterministic"
  | "jev-assisted"
  | "external-tool";

export type EvidenceGrade =
  | "formal-deterministic-proof"
  | "compiler-static-guarantee"
  | "executable-test-evidence"
  | "structured-heuristic-evidence"
  | "jev-judgment"
  | "unverified";

export interface VerifierManifest {
  id: string;
  version: string;
  description: string;
  mode: VerifierExecutionMode;
  kinds: VerificationKind[];
}

export interface VerifyContext {
  traceId?: string;
  signal?: AbortSignal;
  metadata?: Record<string, JsonValue>;
}

export interface VerificationResult {
  obligationId: string;
  status: VerificationStatus;
  confidence?: ConfidenceValue;
  evidence: EvidenceRef[];
  diagnostics: Diagnostic[];
  verifier: {
    id: string;
    version: string;
    mode: VerifierExecutionMode;
    evidenceGrade: EvidenceGrade;
  };
}

export interface Verifier<T> {
  readonly manifest: VerifierManifest;
  canVerify(obligation: VerificationObligation, subject: T): boolean;
  verify(
    obligation: VerificationObligation,
    subject: T,
    context: VerifyContext,
  ): Promise<VerificationResult>;
}

const evidenceStrength: Record<EvidenceGrade, number> = {
  "formal-deterministic-proof": 5,
  "compiler-static-guarantee": 4,
  "executable-test-evidence": 3,
  "structured-heuristic-evidence": 2,
  "jev-judgment": 1,
  unverified: 0,
};

export const strongestEvidenceGrade = (
  grades: readonly EvidenceGrade[],
): EvidenceGrade => {
  let strongest: EvidenceGrade = "unverified";
  for (const grade of grades) {
    if (evidenceStrength[grade] > evidenceStrength[strongest]) {
      strongest = grade;
    }
  }
  return strongest;
};

export const weakestEvidenceGrade = (
  grades: readonly EvidenceGrade[],
): EvidenceGrade => {
  if (grades.length === 0) return "unverified";
  let weakest = grades[0]!;
  for (const grade of grades.slice(1)) {
    if (evidenceStrength[grade] < evidenceStrength[weakest]) {
      weakest = grade;
    }
  }
  return weakest;
};

export const verificationSatisfiesObligation = (
  obligation: VerificationObligation,
  result: VerificationResult,
): boolean => {
  if (result.obligationId !== obligation.id) return false;
  if (obligation.severity === "informational") {
    return result.status !== "fail";
  }
  return result.status === "pass";
};

export const selectAuthoritativeResult = (
  results: readonly VerificationResult[],
): VerificationResult | undefined => {
  const ordered = [...results].sort((a, b) =>
    a.verifier.id.localeCompare(b.verifier.id),
  );
  for (const mode of [
    "deterministic",
    "external-tool",
    "jev-assisted",
  ] as const) {
    const tier = ordered.filter(
      (result) =>
        result.verifier.mode === mode &&
        (result.status === "pass" || result.status === "fail"),
    );
    if (tier.length === 0) continue;
    return tier.find((result) => result.status === "fail") ?? tier[0];
  }
  return (
    ordered.find((result) => result.status === "unknown") ??
    ordered.find((result) => result.status === "skipped") ??
    ordered[0]
  );
};
