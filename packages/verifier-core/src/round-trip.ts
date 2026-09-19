import {
  sha256,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  Diagnostic,
  GraphSnapshot,
} from "../../semantic-graph/src/index.ts";
import type {
  VerificationObligation,
  VerificationResult,
  Verifier,
  VerifierManifest,
  VerifyContext,
} from "./framework.ts";
import {
  criticalSemanticPreservationProfile,
  verifySemanticPreservation,
  type PreservationProfile,
} from "./semantic-preservation.ts";

type MaybePromise<T> = T | Promise<T>;

export interface RoundTripSubject {
  source: GraphSnapshot;
  realize(): MaybePromise<Result<string>>;
  parse(surface: string): MaybePromise<Result<GraphSnapshot>>;
  profile?: PreservationProfile;
  parserLimitations?: string[];
}

const severityFor = (
  obligation: VerificationObligation,
): Diagnostic["severity"] =>
  obligation.severity === "required"
    ? "error"
    : obligation.severity === "recommended"
      ? "warning"
      : "info";

export class RoundTripVerifier implements Verifier<RoundTripSubject> {
  readonly manifest: VerifierManifest = {
    id: "verifier.round-trip",
    version: "1.0.0",
    description:
      "Executes semantic graph -> surface -> semantic graph round-trip verification while preserving parser failure as unknown.",
    mode: "deterministic",
    kinds: ["round-trip"],
  };

  canVerify(
    obligation: VerificationObligation,
    subject: RoundTripSubject,
  ): boolean {
    return (
      obligation.kind === "round-trip" &&
      Array.isArray(subject.source.nodes) &&
      typeof subject.realize === "function" &&
      typeof subject.parse === "function"
    );
  }

  async verify(
    obligation: VerificationObligation,
    subject: RoundTripSubject,
    _context: VerifyContext,
  ): Promise<VerificationResult> {
    const severity = severityFor(obligation);
    const realized = await subject.realize();
    if (!realized.ok) {
      return {
        obligationId: obligation.id,
        status: "unknown",
        evidence: [],
        diagnostics: [
          {
            code: "ROUND_TRIP_REALIZE_FAILED",
            severity,
            message:
              "Round-trip verification could not realize the source semantics.",
            details: { cause: realized.error.code },
          },
        ],
        verifier: {
          id: this.manifest.id,
          version: this.manifest.version,
          mode: this.manifest.mode,
          evidenceGrade: "unverified",
        },
      };
    }

    const recovered = await subject.parse(realized.value);
    if (!recovered.ok) {
      return {
        obligationId: obligation.id,
        status: "unknown",
        evidence: [
          `evidence:round-trip-surface:${sha256(realized.value)}`,
        ],
        diagnostics: [
          {
            code: "ROUND_TRIP_PARSE_FAILED",
            severity,
            message:
              "Parse-back failed; this is reported as unknown rather than proof that the realized sentence is semantically wrong.",
            details: {
              cause: recovered.error.code,
              parserLimitations: subject.parserLimitations ?? [],
            },
          },
        ],
        verifier: {
          id: this.manifest.id,
          version: this.manifest.version,
          mode: this.manifest.mode,
          evidenceGrade: "structured-heuristic-evidence",
        },
      };
    }

    const report = verifySemanticPreservation(
      subject.source,
      recovered.value,
      subject.profile ?? criticalSemanticPreservationProfile,
    );
    return {
      obligationId: obligation.id,
      status: report.ok ? "pass" : "fail",
      evidence: [
        `evidence:round-trip-surface:${sha256(realized.value)}`,
        `evidence:round-trip-profile:${report.profile.id}@${report.profile.version}`,
      ],
      diagnostics: report.violations.map((violation) => ({
        code: `ROUND_TRIP_${violation.code}`,
        severity,
        message: violation.message,
        nodeRefs: [
          ...(violation.sourceNodeId === undefined
            ? []
            : [violation.sourceNodeId]),
          ...(violation.candidateNodeId === undefined
            ? []
            : [violation.candidateNodeId]),
        ] as SemanticId[],
        details: { invariant: violation.invariant },
      })),
      verifier: {
        id: this.manifest.id,
        version: this.manifest.version,
        mode: this.manifest.mode,
        evidenceGrade: "executable-test-evidence",
      },
    };
  }
}
