import {
  canonicalJson,
  err,
  ok,
  sha256,
  StructuredError,
  type Digest,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import {
  createM19BlindedBundle,
  reportM19NaturalConversation,
  validateM19HumanRatings,
  validateM19StudyManifest,
  type M19BlindedBundle,
  type M19FailureRecord,
  type M19HumanRating,
  type M19NaturalConversationReport,
  type M19StudyManifest,
  type M19TemplateJudgment,
} from "./natural-conversation.ts";

export interface M19RatingContext {
  itemId: string;
  context: string;
}

export interface M19RatingWorksheetRow {
  itemId: string;
  armCode: string;
  context: string;
  output: string;
  naturalness: number | null;
  semanticAccuracy: number | null;
  multiTurnCoherence: number | null;
  templateJudgment: M19TemplateJudgment | null;
}

export interface M19RatingWorksheet {
  schemaVersion: "jl-m19-rating-worksheet-1";
  studyId: string;
  blinded: true;
  evaluatorId: string;
  rows: M19RatingWorksheetRow[];
}

export interface M19HumanStudyEvidence {
  schemaVersion: "jl-m19-human-study-evidence-1";
  studyId: string;
  frozenAt: string;
  measurementComplete: boolean;
  status: M19NaturalConversationReport["status"];
  ratingCount: number;
  evaluatorCount: number;
  digests: {
    manifest: Digest;
    blindedBundle: Digest;
    contexts: Digest;
    ratings: Digest;
    failures: Digest;
    report: Digest;
  };
  report: M19NaturalConversationReport;
}

const asJson = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

const nonEmpty = (value: string): boolean => value.trim() !== "";

export const validateM19RatingContexts = (
  manifest: M19StudyManifest,
  contexts: readonly M19RatingContext[],
): Result<M19RatingContext[]> => {
  const validManifest = validateM19StudyManifest(manifest);
  if (!validManifest.ok) return err(validManifest.error);

  const expectedIds = new Set(validManifest.value.items.map((item) => item.id));
  const observedIds = new Set<string>();
  const normalized: M19RatingContext[] = [];

  for (const entry of contexts) {
    if (
      !expectedIds.has(entry.itemId) ||
      observedIds.has(entry.itemId) ||
      !nonEmpty(entry.context)
    ) {
      return err(
        new StructuredError(
          "EVAL_M19_WORKSHEET_CONTEXT",
          "M19 evaluator context requires exactly one non-empty context for every preregistered study item.",
        ),
      );
    }
    observedIds.add(entry.itemId);
    normalized.push({
      itemId: entry.itemId,
      context: entry.context,
    });
  }

  if (
    observedIds.size !== expectedIds.size ||
    [...expectedIds].some((itemId) => !observedIds.has(itemId))
  ) {
    return err(
      new StructuredError(
        "EVAL_M19_WORKSHEET_CONTEXT",
        "M19 evaluator context requires exactly one non-empty context for every preregistered study item.",
      ),
    );
  }

  return ok(
    normalized
      .map((entry) => structuredClone(entry))
      .sort((a, b) => a.itemId.localeCompare(b.itemId)),
  );
};

const sortRatings = (
  ratings: readonly M19HumanRating[],
): M19HumanRating[] =>
  ratings
    .map((rating) => structuredClone(rating))
    .sort(
      (a, b) =>
        a.evaluatorId.localeCompare(b.evaluatorId) ||
        a.itemId.localeCompare(b.itemId) ||
        a.armCode.localeCompare(b.armCode),
    );

const sortFailures = (
  failures: readonly M19FailureRecord[],
): M19FailureRecord[] =>
  failures
    .map((failure) => structuredClone(failure))
    .sort(
      (a, b) =>
        a.itemId.localeCompare(b.itemId) ||
        a.armCode.localeCompare(b.armCode) ||
        a.category.localeCompare(b.category) ||
        a.description.localeCompare(b.description),
    );

export const createM19RatingWorksheet = (
  manifest: M19StudyManifest,
  bundle: M19BlindedBundle,
  contexts: readonly M19RatingContext[],
): Result<M19RatingWorksheet> => {
  const validManifest = validateM19StudyManifest(manifest);
  if (!validManifest.ok) return err(validManifest.error);

  if (
    bundle.schemaVersion !== "jl-m19-blinded-bundle-1" ||
    bundle.studyId !== validManifest.value.id ||
    bundle.blinded !== true
  ) {
    return err(
      new StructuredError(
        "EVAL_M19_WORKSHEET_BUNDLE",
        "M19 rating worksheet requires the matching blinded study bundle.",
      ),
    );
  }

  const rebuilt = createM19BlindedBundle(
    validManifest.value,
    bundle.stimuli,
  );
  if (!rebuilt.ok) return err(rebuilt.error);

  const validContexts = validateM19RatingContexts(
    validManifest.value,
    contexts,
  );
  if (!validContexts.ok) return err(validContexts.error);
  const contextByItem = new Map(
    validContexts.value.map((entry) => [entry.itemId, entry.context] as const),
  );

  return ok({
    schemaVersion: "jl-m19-rating-worksheet-1",
    studyId: validManifest.value.id,
    blinded: true,
    evaluatorId: "",
    rows: rebuilt.value.stimuli.map((stimulus) => ({
      itemId: stimulus.itemId,
      armCode: stimulus.armCode,
      context: contextByItem.get(stimulus.itemId)!,
      output: stimulus.output,
      naturalness: null,
      semanticAccuracy: null,
      multiTurnCoherence: null,
      templateJudgment: null,
    })),
  });
};

export const importM19RatingWorksheets = (
  manifest: M19StudyManifest,
  bundle: M19BlindedBundle,
  contexts: readonly M19RatingContext[],
  worksheets: readonly M19RatingWorksheet[],
): Result<M19HumanRating[]> => {
  const validContexts = validateM19RatingContexts(manifest, contexts);
  if (!validContexts.ok) return err(validContexts.error);
  const contextByItem = new Map(
    validContexts.value.map((entry) => [entry.itemId, entry.context] as const),
  );
  const ratings: M19HumanRating[] = [];

  for (const worksheet of worksheets) {
    if (
      worksheet.schemaVersion !== "jl-m19-rating-worksheet-1" ||
      worksheet.studyId !== manifest.id ||
      worksheet.blinded !== true ||
      !nonEmpty(worksheet.evaluatorId)
    ) {
      return err(
        new StructuredError(
          "EVAL_M19_WORKSHEET",
          "Each M19 worksheet must match the blinded study and use a non-empty pseudonymous evaluator id.",
        ),
      );
    }

    const expectedPairs = new Set(
      bundle.stimuli.map(
        (stimulus) => `${stimulus.itemId}\u0000${stimulus.armCode}`,
      ),
    );
    const observedPairs = new Set<string>();

    for (const row of worksheet.rows) {
      const pair = `${row.itemId}\u0000${row.armCode}`;
      if (
        !expectedPairs.has(pair) ||
        observedPairs.has(pair) ||
        !nonEmpty(row.context) ||
        row.context !== contextByItem.get(row.itemId) ||
        row.naturalness === null ||
        row.semanticAccuracy === null ||
        row.multiTurnCoherence === null ||
        row.templateJudgment === null
      ) {
        return err(
          new StructuredError(
            "EVAL_M19_WORKSHEET_ROW",
            "Completed M19 worksheets require exactly one fully rated row for every blinded stimulus.",
          ),
        );
      }
      observedPairs.add(pair);
      ratings.push({
        evaluatorId: worksheet.evaluatorId,
        itemId: row.itemId,
        armCode: row.armCode,
        naturalness: row.naturalness,
        semanticAccuracy: row.semanticAccuracy,
        multiTurnCoherence: row.multiTurnCoherence,
        templateJudgment: row.templateJudgment,
      });
    }

    if (
      observedPairs.size !== expectedPairs.size ||
      [...expectedPairs].some((pair) => !observedPairs.has(pair))
    ) {
      return err(
        new StructuredError(
          "EVAL_M19_WORKSHEET_COVERAGE",
          "Completed M19 worksheets must rate every blinded stimulus exactly once.",
        ),
      );
    }
  }

  return validateM19HumanRatings(manifest, bundle, ratings);
};

export const freezeM19HumanStudyEvidence = (input: {
  manifest: M19StudyManifest;
  bundle: M19BlindedBundle;
  contexts: readonly M19RatingContext[];
  ratings: readonly M19HumanRating[];
  failures: readonly M19FailureRecord[];
  frozenAt: string;
}): Result<M19HumanStudyEvidence> => {
  if (
    !nonEmpty(input.frozenAt) ||
    Number.isNaN(Date.parse(input.frozenAt))
  ) {
    return err(
      new StructuredError(
        "EVAL_M19_FREEZE_TIME",
        "M19 evidence freeze requires an explicit parseable timestamp.",
      ),
    );
  }

  const contexts = validateM19RatingContexts(
    input.manifest,
    input.contexts,
  );
  if (!contexts.ok) return err(contexts.error);

  const report = reportM19NaturalConversation({
    manifest: input.manifest,
    bundle: input.bundle,
    ratings: input.ratings,
    failures: input.failures,
  });
  if (!report.ok) return err(report.error);

  const ratings = sortRatings(input.ratings);
  const failures = sortFailures(input.failures);

  return ok({
    schemaVersion: "jl-m19-human-study-evidence-1",
    studyId: input.manifest.id,
    frozenAt: input.frozenAt,
    measurementComplete: report.value.measurementComplete,
    status: report.value.status,
    ratingCount: ratings.length,
    evaluatorCount: new Set(ratings.map((rating) => rating.evaluatorId)).size,
    digests: {
      manifest: sha256(canonicalJson(asJson(input.manifest))),
      blindedBundle: sha256(canonicalJson(asJson(input.bundle))),
      contexts: sha256(canonicalJson(asJson(contexts.value))),
      ratings: sha256(canonicalJson(asJson(ratings))),
      failures: sha256(canonicalJson(asJson(failures))),
      report: sha256(canonicalJson(asJson(report.value))),
    },
    report: report.value,
  });
};
