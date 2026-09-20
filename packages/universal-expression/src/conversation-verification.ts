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

export interface ConversationSurfaceParserIdentity {
  id: string;
  version: string;
}

export type ConversationSurfaceParser = (
  surface: string,
  language: string,
) =>
  | Result<GraphSnapshot>
  | Promise<Result<GraphSnapshot>>;

export interface ParserBoundConversationCertificationInput {
  draft: UnverifiedConversationSurfaceDraft;
  sourceSemantics: GraphSnapshot;
  parser: ConversationSurfaceParser;
  parserIdentity: ConversationSurfaceParserIdentity;
  profile?: PreservationProfile;
  additionalEvidenceRefs?: string[];
}

export interface ParserBoundConversationCertification
  extends ConversationSemanticCertification {
  parser: ConversationSurfaceParserIdentity;
}

export const certifyConversationSurfaceDraftFromParser = async (
  input: ParserBoundConversationCertificationInput,
): Promise<Result<ParserBoundConversationCertification>> => {
  if (
    !nonEmpty(input.draft.surface) ||
    !nonEmpty(input.draft.language) ||
    !nonEmpty(input.parserIdentity.id) ||
    !nonEmpty(input.parserIdentity.version)
  ) {
    return err(
      new StructuredError(
        "EXPRESSION_CONVERSATION_PARSER_CERTIFICATION_INPUT",
        "Parser-bound conversation certification requires a surface, language, parser id, and parser version.",
      ),
    );
  }

  let recovered: Result<GraphSnapshot>;
  try {
    recovered = await input.parser(
      input.draft.surface,
      input.draft.language,
    );
  } catch (error) {
    return err(
      new StructuredError(
        "EXPRESSION_CONVERSATION_PARSE_THROW",
        "The conversation surface parser threw before semantic certification could run.",
        {
          parserId: input.parserIdentity.id,
          parserVersion: input.parserIdentity.version,
          cause: error instanceof Error ? error.message : String(error),
        },
      ),
    );
  }

  if (!recovered.ok) {
    return err(
      new StructuredError(
        "EXPRESSION_CONVERSATION_PARSE_FAILED",
        "The exact conversation surface could not be parsed back to semantics, so it cannot be certified.",
        {
          parserId: input.parserIdentity.id,
          parserVersion: input.parserIdentity.version,
          cause: recovered.error.code,
        },
      ),
    );
  }

  const parserEvidenceRef =
    "evidence:conversation-parser:" +
    input.parserIdentity.id +
    "@" +
    input.parserIdentity.version;

  const certified = certifyConversationSurfaceDraft({
    draft: input.draft,
    sourceSemantics: input.sourceSemantics,
    recoveredCandidateSemantics: recovered.value,
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    additionalEvidenceRefs: [
      parserEvidenceRef,
      ...(input.additionalEvidenceRefs ?? []),
    ],
  });
  if (!certified.ok) return certified;

  return ok({
    ...certified.value,
    parser: structuredClone(input.parserIdentity),
  });
};
