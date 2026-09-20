import {
  canonicalJson,
  err,
  ok,
  sha256,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  GraphSnapshot,
} from "../../semantic-graph/src/index.ts";
import type {
  ConversationSurfaceDraft,
} from "../../realizer-core/src/index.ts";
import {
  criticalSemanticPreservationProfile,
  verifySemanticPreservation,
  type PreservationProfile,
  type PreservationReport,
} from "../../verifier-core/src/index.ts";

export type UnverifiedConversationSurfaceDraft = Omit<
  ConversationSurfaceDraft,
  "semanticPreservationVerified" | "semanticEvidenceRefs"
>;

export interface ConversationSemanticCertificationInput {
  draft: UnverifiedConversationSurfaceDraft;
  sourceSemantics: GraphSnapshot;
  recoveredCandidateSemantics: GraphSnapshot;
  profile?: PreservationProfile;
  additionalEvidenceRefs?: string[];
}

export interface ConversationSemanticCertification {
  draft: ConversationSurfaceDraft;
  report: PreservationReport;
  digests: {
    sourceSemantics: string;
    recoveredCandidateSemantics: string;
    surface: string;
  };
}

const asJson = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

const nonEmpty = (value: string): boolean => value.trim().length > 0;

const digestSnapshot = (snapshot: GraphSnapshot): string =>
  sha256(canonicalJson(asJson(snapshot)));

export const certifyConversationSurfaceDraft = (
  input: ConversationSemanticCertificationInput,
): Result<ConversationSemanticCertification> => {
  if (
    !nonEmpty(input.draft.id) ||
    !nonEmpty(input.draft.surface) ||
    !nonEmpty(input.draft.language) ||
    !nonEmpty(input.draft.sourceFamily) ||
    input.draft.constructionIds.length === 0 ||
    input.draft.constructionIds.some((id) => !nonEmpty(id)) ||
    new Set(input.draft.constructionIds).size !==
      input.draft.constructionIds.length ||
    (input.additionalEvidenceRefs ?? []).some((ref) => !nonEmpty(ref))
  ) {
    return err(
      new StructuredError(
        "EXPRESSION_CONVERSATION_CERTIFICATION_INPUT",
        "Conversation semantic certification requires a complete unverified draft, unique construction ids, and valid optional evidence references.",
      ),
    );
  }

  const profile = input.profile ?? criticalSemanticPreservationProfile;
  const report = verifySemanticPreservation(
    input.sourceSemantics,
    input.recoveredCandidateSemantics,
    profile,
  );

  if (!report.ok) {
    return err(
      new StructuredError(
        "EXPRESSION_CONVERSATION_SEMANTIC_DRIFT",
        "Conversation surface candidate failed deterministic semantic-preservation certification.",
        {
          profile: {
            id: report.profile.id,
            version: report.profile.version,
          },
          violations: report.violations.map((violation) => ({
            invariant: violation.invariant,
            code: violation.code,
            message: violation.message,
            sourceNodeId: violation.sourceNodeId ?? null,
            candidateNodeId: violation.candidateNodeId ?? null,
          })),
        },
      ),
    );
  }

  const sourceDigest = digestSnapshot(input.sourceSemantics);
  const candidateDigest = digestSnapshot(input.recoveredCandidateSemantics);
  const surfaceDigest = sha256(input.draft.surface.normalize("NFC"));

  const semanticEvidenceRefs = [
    `evidence:semantic-preservation:${report.profile.id}@${report.profile.version}`,
    `evidence:conversation-source-jsg:${sourceDigest}`,
    `evidence:conversation-recovered-jsg:${candidateDigest}`,
    `evidence:conversation-surface:${surfaceDigest}`,
    ...(input.additionalEvidenceRefs ?? []),
  ];

  return ok({
    draft: {
      ...structuredClone(input.draft),
      semanticPreservationVerified: true,
      semanticEvidenceRefs: [...new Set(semanticEvidenceRefs)],
      annotations: {
        ...(input.draft.annotations ?? {}),
        semanticCertificationProfile:
          `${report.profile.id}@${report.profile.version}`,
        semanticCertificationSourceDigest: sourceDigest,
        semanticCertificationRecoveredDigest: candidateDigest,
        semanticCertificationSurfaceDigest: surfaceDigest,
      },
    },
    report,
    digests: {
      sourceSemantics: sourceDigest,
      recoveredCandidateSemantics: candidateDigest,
      surface: surfaceDigest,
    },
  });
};
