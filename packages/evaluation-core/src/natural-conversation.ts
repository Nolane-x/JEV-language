import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";

export type M19Phenomenon =
  | "unseen-topic"
  | "unseen-entity-name"
  | "compositional-novel-sentence"
  | "multi-turn-reference"
  | "varied-discourse-structure"
  | "correction"
  | "technical-content"
  | "casual-language"
  | "open-domain-unknown-term"
  | "blinded-template-detection";

export const M19_REQUIRED_PHENOMENA: readonly M19Phenomenon[] = [
  "unseen-topic",
  "unseen-entity-name",
  "compositional-novel-sentence",
  "multi-turn-reference",
  "varied-discourse-structure",
  "correction",
  "technical-content",
  "casual-language",
  "open-domain-unknown-term",
  "blinded-template-detection",
];

export interface M19StudyItem {
  id: string;
  conversationRef: string;
  phenomena: M19Phenomenon[];
  expectedTurns: number;
  languageTags: string[];
  notes?: string;
}

export interface M19StudyManifest {
  schemaVersion: "jl-m19-natural-conversation-1";
  id: string;
  version: string;
  blinded: true;
  armCodes: string[];
  minRatingsPerStimulus: number;
  items: M19StudyItem[];
  preregistrationRef: string;
}

export interface M19Stimulus {
  itemId: string;
  armCode: string;
  output: string;
  latencyMs: number;
  costUnits: number;
  semanticEvidenceRefs: string[];
}

export interface M19BlindedBundle {
  schemaVersion: "jl-m19-blinded-bundle-1";
  studyId: string;
  blinded: true;
  stimuli: M19Stimulus[];
}

export type M19TemplateJudgment = "template" | "not-template" | "unsure";

export interface M19HumanRating {
  evaluatorId: string;
  itemId: string;
  armCode: string;
  naturalness: number;
  semanticAccuracy: number;
  multiTurnCoherence: number;
  templateJudgment: M19TemplateJudgment;
}

export type M19FailureCategory =
  | "semantic-error"
  | "reference-error"
  | "correction-error"
  | "topic-coherence-error"
  | "template-like"
  | "repetition"
  | "style-mismatch"
  | "unknown-term-corruption"
  | "latency"
  | "other";

export interface M19FailureRecord {
  itemId: string;
  armCode: string;
  category: M19FailureCategory;
  description: string;
  evidenceRefs: string[];
}

export interface M19ArmSummary {
  armCode: string;
  stimulusCount: number;
  ratingCount: number;
  evaluatorCount: number;
  naturalnessMean?: number;
  semanticAccuracyMean?: number;
  multiTurnCoherenceMean?: number;
  templateDetectionRate?: number;
  responseDiversity: number;
  meanLatencyMs: number;
  meanCostUnits: number;
  failureCounts: Partial<Record<M19FailureCategory, number>>;
}

export interface M19NaturalConversationReport {
  schemaVersion: "jl-m19-natural-conversation-report-1";
  studyId: string;
  status:
    | "pending-human-data"
    | "incomplete-measurements"
    | "complete";
  /**
   * Completion means the pre-registered measurement protocol ran to
   * completion. It does not imply a positive naturalness result.
   */
  measurementComplete: boolean;
  humanRatingsObserved: boolean;
  coveredPhenomena: M19Phenomenon[];
  missingPhenomena: M19Phenomenon[];
  unratedStimulusIds: string[];
  arms: M19ArmSummary[];
  failureTaxonomy: Partial<Record<M19FailureCategory, number>>;
  diagnostics: string[];
}

const nonEmpty = (value: string): boolean => value.trim() !== "";

const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.every(nonEmpty) && new Set(values).size === values.length;

const validRating = (value: number): boolean =>
  Number.isFinite(value) && value >= 1 && value <= 5;

const mean = (values: readonly number[]): number | undefined =>
  values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const rounded = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : Math.round(value * 10_000) / 10_000;

export const validateM19StudyManifest = (
  manifest: M19StudyManifest,
): Result<M19StudyManifest> => {
  if (
    manifest.schemaVersion !== "jl-m19-natural-conversation-1" ||
    !nonEmpty(manifest.id) ||
    !nonEmpty(manifest.version) ||
    manifest.blinded !== true ||
    !uniqueNonEmpty(manifest.armCodes) ||
    manifest.armCodes.length < 1 ||
    !Number.isSafeInteger(manifest.minRatingsPerStimulus) ||
    manifest.minRatingsPerStimulus < 1 ||
    !nonEmpty(manifest.preregistrationRef) ||
    manifest.items.length === 0
  ) {
    return err(
      new StructuredError(
        "EVAL_M19_MANIFEST",
        "M19 study manifest requires blinded identity, arm codes, items, rating floor, and preregistration reference.",
      ),
    );
  }

  const itemIds = new Set<string>();
  const covered = new Set<M19Phenomenon>();
  for (const item of manifest.items) {
    if (
      !nonEmpty(item.id) ||
      itemIds.has(item.id) ||
      !nonEmpty(item.conversationRef) ||
      item.phenomena.length === 0 ||
      new Set(item.phenomena).size !== item.phenomena.length ||
      item.phenomena.some(
        (phenomenon) => !M19_REQUIRED_PHENOMENA.includes(phenomenon),
      ) ||
      !Number.isSafeInteger(item.expectedTurns) ||
      item.expectedTurns < 1 ||
      item.languageTags.length === 0 ||
      !uniqueNonEmpty(item.languageTags)
    ) {
      return err(
        new StructuredError(
          "EVAL_M19_ITEM",
          `Invalid M19 study item: ${item.id || "<empty>"}.`,
        ),
      );
    }
    itemIds.add(item.id);
    for (const phenomenon of item.phenomena) covered.add(phenomenon);
  }

  const missing = M19_REQUIRED_PHENOMENA.filter(
    (phenomenon) => !covered.has(phenomenon),
  );
  if (missing.length > 0) {
    return err(
      new StructuredError(
        "EVAL_M19_PHENOMENON_COVERAGE",
        `M19 manifest is missing required phenomena: ${missing.join(", ")}.`,
      ),
    );
  }

  return ok(structuredClone(manifest));
};

export const createM19BlindedBundle = (
  manifest: M19StudyManifest,
  stimuli: readonly M19Stimulus[],
): Result<M19BlindedBundle> => {
  const validManifest = validateM19StudyManifest(manifest);
  if (!validManifest.ok) return err(validManifest.error);

  const itemIds = new Set(manifest.items.map((item) => item.id));
  const arms = new Set(manifest.armCodes);
  const pairs = new Set<string>();

  for (const stimulus of stimuli) {
    const pair = `${stimulus.itemId}\u0000${stimulus.armCode}`;
    if (
      !itemIds.has(stimulus.itemId) ||
      !arms.has(stimulus.armCode) ||
      pairs.has(pair) ||
      !nonEmpty(stimulus.output) ||
      !Number.isFinite(stimulus.latencyMs) ||
      stimulus.latencyMs < 0 ||
      !Number.isFinite(stimulus.costUnits) ||
      stimulus.costUnits < 0 ||
      stimulus.semanticEvidenceRefs.length === 0 ||
      !uniqueNonEmpty(stimulus.semanticEvidenceRefs)
    ) {
      return err(
        new StructuredError(
          "EVAL_M19_STIMULUS",
          "M19 stimuli require unique study-item/arm pairs, output, non-negative latency/cost, and semantic evidence.",
        ),
      );
    }
    pairs.add(pair);
  }

  const expectedPairs = manifest.items.length * manifest.armCodes.length;
  if (pairs.size !== expectedPairs) {
    return err(
      new StructuredError(
        "EVAL_M19_STIMULUS_COVERAGE",
        "Blinded M19 bundle must contain exactly one stimulus for every preregistered item/arm pair.",
      ),
    );
  }

  return ok({
    schemaVersion: "jl-m19-blinded-bundle-1",
    studyId: manifest.id,
    blinded: true,
    stimuli: stimuli
      .map((stimulus) => structuredClone(stimulus))
      .sort(
        (a, b) =>
          a.itemId.localeCompare(b.itemId) ||
          a.armCode.localeCompare(b.armCode),
      ),
  });
};

export const validateM19HumanRatings = (
  manifest: M19StudyManifest,
  bundle: M19BlindedBundle,
  ratings: readonly M19HumanRating[],
): Result<M19HumanRating[]> => {
  const validManifest = validateM19StudyManifest(manifest);
  if (!validManifest.ok) return err(validManifest.error);
  if (bundle.studyId !== manifest.id || bundle.blinded !== true) {
    return err(
      new StructuredError(
        "EVAL_M19_BUNDLE_IDENTITY",
        "Human ratings must reference the same blinded M19 study.",
      ),
    );
  }

  const validPairs = new Set(
    bundle.stimuli.map(
      (stimulus) => `${stimulus.itemId}\u0000${stimulus.armCode}`,
    ),
  );
  const ratingKeys = new Set<string>();
  for (const rating of ratings) {
    const pair = `${rating.itemId}\u0000${rating.armCode}`;
    const key = `${rating.evaluatorId}\u0000${pair}`;
    if (
      !nonEmpty(rating.evaluatorId) ||
      !validPairs.has(pair) ||
      ratingKeys.has(key) ||
      !validRating(rating.naturalness) ||
      !validRating(rating.semanticAccuracy) ||
      !validRating(rating.multiTurnCoherence) ||
      !["template", "not-template", "unsure"].includes(
        rating.templateJudgment,
      )
    ) {
      return err(
        new StructuredError(
          "EVAL_M19_RATING",
          "M19 ratings require a unique evaluator/item/arm key, valid blinded stimulus, and 1-5 scores.",
        ),
      );
    }
    ratingKeys.add(key);
  }
  return ok(ratings.map((rating) => structuredClone(rating)));
};

const uniqueSurfaceRatio = (
  stimuli: readonly M19Stimulus[],
): number =>
  stimuli.length === 0
    ? 0
    : new Set(stimuli.map((stimulus) => stimulus.output.trim())).size /
      stimuli.length;

export const reportM19NaturalConversation = (input: {
  manifest: M19StudyManifest;
  bundle: M19BlindedBundle;
  ratings: readonly M19HumanRating[];
  failures: readonly M19FailureRecord[];
}): Result<M19NaturalConversationReport> => {
  const manifest = validateM19StudyManifest(input.manifest);
  if (!manifest.ok) return err(manifest.error);
  const ratings = validateM19HumanRatings(
    manifest.value,
    input.bundle,
    input.ratings,
  );
  if (!ratings.ok) return err(ratings.error);

  const stimulusPairs = new Set(
    input.bundle.stimuli.map(
      (stimulus) => `${stimulus.itemId}\u0000${stimulus.armCode}`,
    ),
  );
  for (const failure of input.failures) {
    if (
      !stimulusPairs.has(`${failure.itemId}\u0000${failure.armCode}`) ||
      !nonEmpty(failure.description) ||
      failure.evidenceRefs.length === 0 ||
      !uniqueNonEmpty(failure.evidenceRefs)
    ) {
      return err(
        new StructuredError(
          "EVAL_M19_FAILURE_RECORD",
          "Failure taxonomy records must reference a blinded stimulus and carry evidence.",
        ),
      );
    }
  }

  const covered = new Set<M19Phenomenon>();
  for (const item of manifest.value.items) {
    for (const phenomenon of item.phenomena) covered.add(phenomenon);
  }
  const missingPhenomena = M19_REQUIRED_PHENOMENA.filter(
    (phenomenon) => !covered.has(phenomenon),
  );

  const ratingCountByPair = new Map<string, number>();
  for (const rating of ratings.value) {
    const pair = `${rating.itemId}\u0000${rating.armCode}`;
    ratingCountByPair.set(pair, (ratingCountByPair.get(pair) ?? 0) + 1);
  }
  const unratedStimulusIds = input.bundle.stimuli
    .filter(
      (stimulus) =>
        (ratingCountByPair.get(
          `${stimulus.itemId}\u0000${stimulus.armCode}`,
        ) ?? 0) < manifest.value.minRatingsPerStimulus,
    )
    .map((stimulus) => `${stimulus.itemId}:${stimulus.armCode}`)
    .sort();

  const globalFailures: Partial<Record<M19FailureCategory, number>> = {};
  for (const failure of input.failures) {
    globalFailures[failure.category] =
      (globalFailures[failure.category] ?? 0) + 1;
  }

  const arms: M19ArmSummary[] = manifest.value.armCodes
    .map((armCode) => {
      const armStimuli = input.bundle.stimuli.filter(
        (stimulus) => stimulus.armCode === armCode,
      );
      const armRatings = ratings.value.filter(
        (rating) => rating.armCode === armCode,
      );
      const armFailures = input.failures.filter(
        (failure) => failure.armCode === armCode,
      );
      const failureCounts: Partial<Record<M19FailureCategory, number>> = {};
      for (const failure of armFailures) {
        failureCounts[failure.category] =
          (failureCounts[failure.category] ?? 0) + 1;
      }
      const naturalness = rounded(
        mean(armRatings.map((rating) => rating.naturalness)),
      );
      const semanticAccuracy = rounded(
        mean(armRatings.map((rating) => rating.semanticAccuracy)),
      );
      const coherence = rounded(
        mean(armRatings.map((rating) => rating.multiTurnCoherence)),
      );
      const templateRate = rounded(
        armRatings.length === 0
          ? undefined
          : armRatings.filter(
                (rating) => rating.templateJudgment === "template",
              ).length / armRatings.length,
      );
      return {
        armCode,
        stimulusCount: armStimuli.length,
        ratingCount: armRatings.length,
        evaluatorCount: new Set(
          armRatings.map((rating) => rating.evaluatorId),
        ).size,
        ...(naturalness === undefined
          ? {}
          : { naturalnessMean: naturalness }),
        ...(semanticAccuracy === undefined
          ? {}
          : { semanticAccuracyMean: semanticAccuracy }),
        ...(coherence === undefined
          ? {}
          : { multiTurnCoherenceMean: coherence }),
        ...(templateRate === undefined
          ? {}
          : { templateDetectionRate: templateRate }),
        responseDiversity: rounded(uniqueSurfaceRatio(armStimuli)) ?? 0,
        meanLatencyMs: rounded(
          mean(armStimuli.map((stimulus) => stimulus.latencyMs)),
        ) ?? 0,
        meanCostUnits: rounded(
          mean(armStimuli.map((stimulus) => stimulus.costUnits)),
        ) ?? 0,
        failureCounts,
      };
    })
    .sort((a, b) => a.armCode.localeCompare(b.armCode));

  const humanRatingsObserved = ratings.value.length > 0;
  const measurementComplete =
    missingPhenomena.length === 0 &&
    input.bundle.stimuli.length > 0 &&
    unratedStimulusIds.length === 0;

  const diagnostics: string[] = [];
  if (!humanRatingsObserved) diagnostics.push("HUMAN_RATINGS_NOT_OBSERVED");
  if (input.bundle.stimuli.length === 0) diagnostics.push("NO_STIMULI");
  diagnostics.push(
    ...missingPhenomena.map(
      (phenomenon) => `MISSING_PHENOMENON:${phenomenon}`,
    ),
  );
  diagnostics.push(
    ...unratedStimulusIds.map(
      (id) => `RATING_FLOOR_NOT_MET:${id}`,
    ),
  );

  return ok({
    schemaVersion: "jl-m19-natural-conversation-report-1",
    studyId: manifest.value.id,
    status: !humanRatingsObserved
      ? "pending-human-data"
      : measurementComplete
        ? "complete"
        : "incomplete-measurements",
    measurementComplete,
    humanRatingsObserved,
    coveredPhenomena: [...covered].sort(),
    missingPhenomena,
    unratedStimulusIds,
    arms,
    failureTaxonomy: globalFailures,
    diagnostics,
  });
};
