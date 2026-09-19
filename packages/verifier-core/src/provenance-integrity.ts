import type {
  TrustLabel,
} from "../../core-types/src/index.ts";
import type {
  ProvenanceRecord,
  ProvenanceRef,
} from "../../provenance/src/index.ts";
import type { Diagnostic } from "../../semantic-graph/src/index.ts";
import type {
  VerificationObligation,
  VerificationResult,
  Verifier,
  VerifierManifest,
  VerifyContext,
} from "./framework.ts";

export interface ProvenanceIntegritySubject {
  requiredRefs: ProvenanceRef[];
  records: ProvenanceRecord[];
}

export type ProvenanceIntegrityViolationCode =
  | "PROVENANCE_REQUIRED_MISSING"
  | "PROVENANCE_SOURCE_MISSING"
  | "PROVENANCE_DUPLICATE_ID"
  | "PROVENANCE_CYCLE"
  | "PROVENANCE_TRUST_ESCALATION";

export interface ProvenanceIntegrityViolation {
  code: ProvenanceIntegrityViolationCode;
  message: string;
  ref?: ProvenanceRef;
  sourceRefs?: ProvenanceRef[];
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

export const verifyProvenanceIntegrity = (
  subject: ProvenanceIntegritySubject,
): ProvenanceIntegrityViolation[] => {
  const violations: ProvenanceIntegrityViolation[] = [];
  const byId = new Map<ProvenanceRef, ProvenanceRecord>();

  for (const record of subject.records) {
    if (byId.has(record.id)) {
      violations.push({
        code: "PROVENANCE_DUPLICATE_ID",
        message: `Duplicate provenance record id: ${record.id}.`,
        ref: record.id,
      });
      continue;
    }
    byId.set(record.id, record);
  }

  for (const ref of [...new Set(subject.requiredRefs)].sort()) {
    if (!byId.has(ref)) {
      violations.push({
        code: "PROVENANCE_REQUIRED_MISSING",
        message: `Required provenance reference is missing: ${ref}.`,
        ref,
      });
    }
  }

  for (const record of subject.records) {
    const presentSources: ProvenanceRecord[] = [];
    for (const sourceRef of record.sourceRefs) {
      const source = byId.get(sourceRef);
      if (source === undefined) {
        violations.push({
          code: "PROVENANCE_SOURCE_MISSING",
          message:
            `Provenance record ${record.id} references missing source ${sourceRef}.`,
          ref: sourceRef,
        });
        continue;
      }
      presentSources.push(source);
    }

    if (presentSources.length > 0) {
      const strongestSource = Math.max(
        ...presentSources.map((source) => authorityRank[source.trust]),
      );
      if (authorityRank[record.trust] > strongestSource) {
        violations.push({
          code: "PROVENANCE_TRUST_ESCALATION",
          message:
            `Provenance record ${record.id} has stronger trust than every declared source.`,
          ref: record.id,
          sourceRefs: presentSources.map((source) => source.id).sort(),
        });
      }
    }
  }

  const visiting = new Set<ProvenanceRef>();
  const visited = new Set<ProvenanceRef>();
  const cyclic = new Set<ProvenanceRef>();

  const visit = (id: ProvenanceRef): boolean => {
    if (visited.has(id)) return false;
    if (visiting.has(id)) {
      cyclic.add(id);
      return true;
    }

    const record = byId.get(id);
    if (record === undefined) return false;

    visiting.add(id);
    let hasCycle = false;
    for (const sourceRef of record.sourceRefs) {
      if (!byId.has(sourceRef)) continue;
      if (visit(sourceRef)) {
        cyclic.add(id);
        hasCycle = true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return hasCycle;
  };

  for (const id of [...byId.keys()].sort()) visit(id);
  for (const id of [...cyclic].sort()) {
    violations.push({
      code: "PROVENANCE_CYCLE",
      message: `Provenance ancestry must be acyclic; cycle includes ${id}.`,
      ref: id,
    });
  }

  return violations.sort(
    (a, b) =>
      a.code.localeCompare(b.code) ||
      (a.ref ?? "").localeCompare(b.ref ?? ""),
  );
};

const severityFor = (
  obligation: VerificationObligation,
): Diagnostic["severity"] =>
  obligation.severity === "required"
    ? "error"
    : obligation.severity === "recommended"
      ? "warning"
      : "info";

export class ProvenanceIntegrityVerifier
  implements Verifier<ProvenanceIntegritySubject>
{
  readonly manifest: VerifierManifest = {
    id: "verifier.provenance-integrity",
    version: "1.0.0",
    description:
      "Deterministically validates required provenance references, ancestry closure, trust monotonicity, unique identities, and acyclic source chains.",
    mode: "deterministic",
    kinds: ["provenance-integrity"],
  };

  canVerify(
    obligation: VerificationObligation,
    subject: ProvenanceIntegritySubject,
  ): boolean {
    return (
      obligation.kind === "provenance-integrity" &&
      Array.isArray(subject.requiredRefs) &&
      Array.isArray(subject.records)
    );
  }

  async verify(
    obligation: VerificationObligation,
    subject: ProvenanceIntegritySubject,
    _context: VerifyContext,
  ): Promise<VerificationResult> {
    const violations = verifyProvenanceIntegrity(subject);
    const severity = severityFor(obligation);

    return {
      obligationId: obligation.id,
      status: violations.length === 0 ? "pass" : "fail",
      evidence: [
        `evidence:provenance-integrity:records:${subject.records.length}`,
      ],
      diagnostics: violations.map((violation) => ({
        code: violation.code,
        severity,
        message: violation.message,
        ...(
          violation.ref === undefined &&
          violation.sourceRefs === undefined
            ? {}
            : {
                details: {
                  ...(violation.ref === undefined
                    ? {}
                    : { provenanceRef: violation.ref }),
                  ...(violation.sourceRefs === undefined
                    ? {}
                    : { sourceRefs: violation.sourceRefs }),
                },
              }
        ),
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
