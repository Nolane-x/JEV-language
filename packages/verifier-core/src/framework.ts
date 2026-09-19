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
  const determinate = results.filter(
    (result) => result.status === "pass" || result.status === "fail",
  );
  if (determinate.length === 0) return results[0];

  const deterministic = determinate.find(
    (result) => result.verifier.mode === "deterministic",
  );
  if (deterministic !== undefined) return deterministic;

  const external = determinate.find(
    (result) => result.verifier.mode === "external-tool",
  );
  if (external !== undefined) return external;

  return determinate[0];
};
