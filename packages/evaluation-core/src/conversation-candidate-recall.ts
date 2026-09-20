import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";

export interface ConversationRecallCandidate {
  id: string;
  surfaceId: string;
  sourceFamily: string;
  semanticVerified: boolean;
}

export interface ConversationCandidateRecallCase {
  id: string;
  language: string;
  generated: ConversationRecallCandidate[];
  referenceAcceptableSurfaceIds: string[];
  referencePreferredSurfaceIds?: string[];
}

export interface ConversationCandidateRecallCaseResult {
  id: string;
  language: string;
  generatedCount: number;
  verifiedGeneratedCount: number;
  representedFamilies: number;
  acceptableHit: boolean;
  preferredHit?: boolean;
  acceptableCoverage: number;
  hitAcceptableSurfaceIds: string[];
  hitPreferredSurfaceIds: string[];
  missingAcceptableSurfaceIds: string[];
}

export interface ConversationCandidateRecallReport {
  schemaVersion: "jl-conversation-candidate-recall-report-1";
  caseCount: number;
  acceptableHitRate: number;
  preferredHitRate?: number;
  meanAcceptableCoverage: number;
  meanGeneratedCount: number;
  meanVerifiedGeneratedCount: number;
  meanRepresentedFamilies: number;
  cases: ConversationCandidateRecallCaseResult[];
  misses: Array<{
    id: string;
    language: string;
    kind: "no-acceptable-candidate" | "no-preferred-candidate";
  }>;
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;
const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.length > 0 &&
  values.every(nonEmpty) &&
  new Set(values).size === values.length;

const round = (value: number): number =>
  Math.round(value * 10_000) / 10_000;

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const validateCase = (
  item: ConversationCandidateRecallCase,
): Result<void> => {
  if (
    !nonEmpty(item.id) ||
    !nonEmpty(item.language) ||
    item.generated.length === 0 ||
    !uniqueNonEmpty(item.referenceAcceptableSurfaceIds)
  ) {
    return err(
      new StructuredError(
        "EVAL_CONVERSATION_RECALL_CASE",
        "Conversation candidate-recall cases require id, language, generated candidates, and at least one unique acceptable reference surface id.",
      ),
    );
  }

  if (
    item.referencePreferredSurfaceIds !== undefined &&
    !uniqueNonEmpty(item.referencePreferredSurfaceIds)
  ) {
    return err(
      new StructuredError(
        "EVAL_CONVERSATION_RECALL_PREFERRED",
        "Preferred reference surface ids must be unique and non-empty when supplied.",
      ),
    );
  }

  const acceptable = new Set(item.referenceAcceptableSurfaceIds);
  if (
    (item.referencePreferredSurfaceIds ?? []).some(
      (surfaceId) => !acceptable.has(surfaceId),
    )
  ) {
    return err(
      new StructuredError(
        "EVAL_CONVERSATION_RECALL_PREFERRED_SUBSET",
        "Preferred reference surfaces must be a subset of acceptable reference surfaces.",
      ),
    );
  }

  const candidateIds = new Set<string>();
  for (const candidate of item.generated) {
    if (
      !nonEmpty(candidate.id) ||
      candidateIds.has(candidate.id) ||
      !nonEmpty(candidate.surfaceId) ||
      !nonEmpty(candidate.sourceFamily)
    ) {
      return err(
        new StructuredError(
          "EVAL_CONVERSATION_RECALL_CANDIDATE",
          "Generated recall candidates require unique ids, surface ids, and source families.",
        ),
      );
    }
    candidateIds.add(candidate.id);
  }

  return ok(undefined);
};

export const reportConversationCandidateRecall = (
  cases: readonly ConversationCandidateRecallCase[],
): Result<ConversationCandidateRecallReport> => {
  if (cases.length === 0) {
    return err(
      new StructuredError(
        "EVAL_CONVERSATION_RECALL_EMPTY",
        "Conversation candidate-recall evaluation requires at least one case.",
      ),
    );
  }

  const caseIds = new Set<string>();
  for (const item of cases) {
    if (caseIds.has(item.id)) {
      return err(
        new StructuredError(
          "EVAL_CONVERSATION_RECALL_DUPLICATE_CASE",
          `Duplicate conversation candidate-recall case id: ${item.id}.`,
        ),
      );
    }
    caseIds.add(item.id);
    const valid = validateCase(item);
    if (!valid.ok) return valid;
  }

  const results: ConversationCandidateRecallCaseResult[] = cases.map((item) => {
    const verified = item.generated.filter(
      (candidate) => candidate.semanticVerified,
    );
    const verifiedSurfaceIds = new Set(
      verified.map((candidate) => candidate.surfaceId),
    );
    const acceptable = item.referenceAcceptableSurfaceIds;
    const preferred = item.referencePreferredSurfaceIds ?? [];

    const hitAcceptableSurfaceIds = acceptable.filter((surfaceId) =>
      verifiedSurfaceIds.has(surfaceId),
    );
    const hitPreferredSurfaceIds = preferred.filter((surfaceId) =>
      verifiedSurfaceIds.has(surfaceId),
    );

    return {
      id: item.id,
      language: item.language,
      generatedCount: item.generated.length,
      verifiedGeneratedCount: verified.length,
      representedFamilies: new Set(
        verified.map((candidate) => candidate.sourceFamily),
      ).size,
      acceptableHit: hitAcceptableSurfaceIds.length > 0,
      ...(preferred.length === 0
        ? {}
        : { preferredHit: hitPreferredSurfaceIds.length > 0 }),
      acceptableCoverage: round(
        hitAcceptableSurfaceIds.length / acceptable.length,
      ),
      hitAcceptableSurfaceIds,
      hitPreferredSurfaceIds,
      missingAcceptableSurfaceIds: acceptable.filter(
        (surfaceId) => !verifiedSurfaceIds.has(surfaceId),
      ),
    };
  });

  const preferredCases = results.filter(
    (item) => item.preferredHit !== undefined,
  );
  const misses: ConversationCandidateRecallReport["misses"] = [];
  for (const item of results) {
    if (!item.acceptableHit) {
      misses.push({
        id: item.id,
        language: item.language,
        kind: "no-acceptable-candidate",
      });
    }
    if (item.preferredHit === false) {
      misses.push({
        id: item.id,
        language: item.language,
        kind: "no-preferred-candidate",
      });
    }
  }

  return ok({
    schemaVersion: "jl-conversation-candidate-recall-report-1",
    caseCount: results.length,
    acceptableHitRate: round(
      results.filter((item) => item.acceptableHit).length / results.length,
    ),
    ...(preferredCases.length === 0
      ? {}
      : {
          preferredHitRate: round(
            preferredCases.filter((item) => item.preferredHit === true).length /
              preferredCases.length,
          ),
        }),
    meanAcceptableCoverage: round(
      mean(results.map((item) => item.acceptableCoverage)),
    ),
    meanGeneratedCount: round(
      mean(results.map((item) => item.generatedCount)),
    ),
    meanVerifiedGeneratedCount: round(
      mean(results.map((item) => item.verifiedGeneratedCount)),
    ),
    meanRepresentedFamilies: round(
      mean(results.map((item) => item.representedFamilies)),
    ),
    cases: results,
    misses,
  });
};
