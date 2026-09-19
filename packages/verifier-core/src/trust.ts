import type {
  SemanticId,
  TrustLabel,
} from "../../core-types/src/index.ts";
import type {
  Diagnostic,
  GraphSnapshot,
  JsgNode,
} from "../../semantic-graph/src/index.ts";
import type {
  VerificationObligation,
  VerificationResult,
  Verifier,
  VerifierManifest,
  VerifyContext,
} from "./framework.ts";

export interface TrustVerificationSubject {
  source: GraphSnapshot;
  candidate: GraphSnapshot;
}

export interface TrustViolation {
  code:
    | "TRUST_AUTHORITY_ESCALATION"
    | "TRUST_PROVENANCE_DROPPED"
    | "TRUST_PROVENANCE_MISSING";
  message: string;
  sourceNodeId?: SemanticId;
  candidateNodeId: SemanticId;
}

const authorityRank: Record<TrustLabel, number> = {
  "system-trusted": 6,
  "configured-trusted": 5,
  "user-instruction": 4,
  "user-content": 3,
  "external-content": 2,
  "untrusted-generated": 1,
  unknown: 0,
};

const missing = (
  expected: readonly string[],
  actual: readonly string[],
): string[] => {
  const set = new Set(actual);
  return expected.filter((value) => !set.has(value));
};

export const verifyTrustPropagation = (
  source: GraphSnapshot,
  candidate: GraphSnapshot,
): TrustViolation[] => {
  const sourceById = new Map<string, JsgNode>(
    source.nodes.map((node) => [node.id, node]),
  );
  const violations: TrustViolation[] = [];

  for (const candidateNode of candidate.nodes) {
    if (candidateNode.provenance.length === 0) {
      violations.push({
        code: "TRUST_PROVENANCE_MISSING",
        message:
          "A candidate semantic node has no provenance and therefore cannot justify its authority.",
        candidateNodeId: candidateNode.id,
      });
    }

    const sourceNode = sourceById.get(candidateNode.id);
    if (sourceNode === undefined) continue;

    if (authorityRank[candidateNode.trust] > authorityRank[sourceNode.trust]) {
      violations.push({
        code: "TRUST_AUTHORITY_ESCALATION",
        message:
          "Derived semantic content gained a stronger trust label than its source without an explicit authority-granting transformation.",
        sourceNodeId: sourceNode.id,
        candidateNodeId: candidateNode.id,
      });
    }

    const dropped = missing(sourceNode.provenance, candidateNode.provenance);
    if (dropped.length > 0) {
      violations.push({
        code: "TRUST_PROVENANCE_DROPPED",
        message:
          "Candidate semantics dropped source provenance required for conservative trust propagation.",
        sourceNodeId: sourceNode.id,
        candidateNodeId: candidateNode.id,
      });
    }
  }

  return violations;
};

const severityFor = (
  obligation: VerificationObligation,
): Diagnostic["severity"] =>
  obligation.severity === "required"
    ? "error"
    : obligation.severity === "recommended"
      ? "warning"
      : "info";

export class TrustVerifier implements Verifier<TrustVerificationSubject> {
  readonly manifest: VerifierManifest = {
    id: "verifier.trust-propagation",
    version: "1.0.0",
    description:
      "Deterministically checks conservative trust propagation and provenance retention.",
    mode: "deterministic",
    kinds: ["security-trust"],
  };

  canVerify(
    obligation: VerificationObligation,
    subject: TrustVerificationSubject,
  ): boolean {
    return (
      obligation.kind === "security-trust" &&
      Array.isArray(subject.source.nodes) &&
      Array.isArray(subject.candidate.nodes)
    );
  }

  async verify(
    obligation: VerificationObligation,
    subject: TrustVerificationSubject,
    _context: VerifyContext,
  ): Promise<VerificationResult> {
    const violations = verifyTrustPropagation(
      subject.source,
      subject.candidate,
    );
    const severity = severityFor(obligation);
    return {
      obligationId: obligation.id,
      status: violations.length === 0 ? "pass" : "fail",
      evidence: ["evidence:trust-propagation:v1"],
      diagnostics: violations.map((violation) => ({
        code: violation.code,
        severity,
        message: violation.message,
        nodeRefs: [
          ...(violation.sourceNodeId === undefined
            ? []
            : [violation.sourceNodeId]),
          violation.candidateNodeId,
        ],
      })),
      verifier: {
        id: this.manifest.id,
        version: this.manifest.version,
        mode: this.manifest.mode,
        evidenceGrade: "formal-deterministic-proof",
      },
    };
  }
}
