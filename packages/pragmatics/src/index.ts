import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  ContentCandidate,
  DiscoursePlan,
  DiscourseRelationKind,
} from "../../discourse-ir/src/index.ts";

export interface StyleProfile {
  verbosity?: number;
  formality?: number;
  technicalDensity?: number;
  sentenceComplexity?: number;
  directness?: number;
  warmth?: number;
  explanationMode?: string;
  preferredTerms?: Record<string, string>;
  formatting?: Record<string, JsonValue>;
}

export interface StyleLayer {
  id: string;
  priority: number;
  profile: StyleProfile;
}

const styleDimensions = [
  "verbosity",
  "formality",
  "technicalDensity",
  "sentenceComplexity",
  "directness",
  "warmth",
] as const;

const validateStyleProfile = (profile: StyleProfile): Result<void> => {
  for (const key of styleDimensions) {
    const value = profile[key];
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < 0 || value > 1)
    ) {
      return err(
        new StructuredError(
          "PRAG_STYLE_RANGE",
          `Style dimension ${key} must be a finite value in [0, 1].`,
        ),
      );
    }
  }
  return ok(undefined);
};

export const mergeStyleProfiles = (
  layers: readonly StyleLayer[],
): Result<StyleProfile> => {
  const ordered = [...layers].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );
  const merged: StyleProfile = {};

  for (const layer of ordered) {
    if (layer.id.trim() === "" || !Number.isFinite(layer.priority)) {
      return err(
        new StructuredError(
          "PRAG_STYLE_LAYER",
          "Style layers require a non-empty id and finite priority.",
        ),
      );
    }
    const valid = validateStyleProfile(layer.profile);
    if (!valid.ok) return valid;

    for (const key of styleDimensions) {
      const value = layer.profile[key];
      if (value !== undefined) merged[key] = value;
    }
    if (layer.profile.explanationMode !== undefined) {
      merged.explanationMode = layer.profile.explanationMode;
    }
    if (layer.profile.preferredTerms !== undefined) {
      merged.preferredTerms = {
        ...(merged.preferredTerms ?? {}),
        ...structuredClone(layer.profile.preferredTerms),
      };
    }
    if (layer.profile.formatting !== undefined) {
      merged.formatting = {
        ...(merged.formatting ?? {}),
        ...structuredClone(layer.profile.formatting),
      };
    }
  }

  return ok(merged);
};

export type RepetitionKind =
  | "lexical-item"
  | "sentence-opening"
  | "connective"
  | "reference-form"
  | "discourse-pattern"
  | "example";

export interface RepetitionObservation {
  kind: RepetitionKind;
  key: string;
}

export class RepetitionTracker {
  readonly #windowSize: number;
  readonly #history: RepetitionObservation[] = [];

  constructor(windowSize = 32) {
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      throw new StructuredError(
        "PRAG_REPETITION_WINDOW",
        "Repetition window size must be a positive integer.",
      );
    }
    this.#windowSize = windowSize;
  }

  record(observation: RepetitionObservation): void {
    if (observation.key.trim() === "") {
      throw new StructuredError(
        "PRAG_REPETITION_KEY",
        "Repetition observations require a non-empty key.",
      );
    }
    this.#history.push(structuredClone(observation));
    if (this.#history.length > this.#windowSize) this.#history.shift();
  }

  count(kind: RepetitionKind, key: string): number {
    return this.#history.filter(
      (entry) => entry.kind === kind && entry.key === key,
    ).length;
  }

  penalty(kind: RepetitionKind, key: string): number {
    return Math.min(1, this.count(kind, key) / Math.max(1, this.#windowSize / 4));
  }

  snapshot(): RepetitionObservation[] {
    return structuredClone(this.#history);
  }
}

export type ExplanationStrategy =
  | "direct"
  | "cause-first"
  | "evidence-first"
  | "definition-first"
  | "stepwise"
  | "contrastive";

export interface AudienceProfile {
  expertise: number;
  desiredDetail: number;
  urgency?: number;
  knownSemanticRefs?: string[];
}

const validateAudience = (audience: AudienceProfile): Result<void> => {
  for (const [key, value] of Object.entries({
    expertise: audience.expertise,
    desiredDetail: audience.desiredDetail,
    urgency: audience.urgency ?? 0,
  })) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return err(
        new StructuredError(
          "PRAG_AUDIENCE_RANGE",
          `Audience dimension ${key} must be in [0, 1].`,
        ),
      );
    }
  }
  return ok(undefined);
};

const relationKinds = (plan: DiscoursePlan): Set<DiscourseRelationKind> =>
  new Set(plan.relations.map((relation) => relation.kind));

export const proposeExplanationStrategies = (
  plan: DiscoursePlan,
  audience: AudienceProfile,
): Result<ExplanationStrategy[]> => {
  const valid = validateAudience(audience);
  if (!valid.ok) return valid;

  const relations = relationKinds(plan);
  const output: ExplanationStrategy[] = ["direct"];

  if (
    relations.has("cause") ||
    relations.has("explains") ||
    relations.has("result-of")
  ) {
    output.push("cause-first");
  }
  if (relations.has("evidence") || relations.has("supports")) {
    output.push("evidence-first");
  }
  if (
    plan.units.some((unit) => unit.kind === "definition") ||
    audience.expertise < 0.35
  ) {
    output.push("definition-first");
  }
  if (plan.units.length >= 3 && audience.desiredDetail >= 0.55) {
    output.push("stepwise");
  }
  if (
    relations.has("contrast") ||
    plan.units.some((unit) => unit.kind === "contrast")
  ) {
    output.push("contrastive");
  }

  return ok([...new Set(output)]);
};

export interface AudienceDetailSelection {
  selected: ContentCandidate[];
  omitted: ContentCandidate[];
  budget: number;
}

export const selectAudienceAwareDetail = (
  candidates: readonly ContentCandidate[],
  audience: AudienceProfile,
): Result<AudienceDetailSelection> => {
  const valid = validateAudience(audience);
  if (!valid.ok) return valid;
  for (const candidate of candidates) {
    for (const value of [
      candidate.relevance,
      candidate.novelty,
      candidate.evidenceStrength,
      candidate.uncertainty,
    ]) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        return err(
          new StructuredError(
            "PRAG_CONTENT_SCORE",
            "Audience detail selection requires normalized candidate scores.",
          ),
        );
      }
    }
  }

  const required = candidates.filter((candidate) => candidate.required === true);
  const optional = candidates
    .filter((candidate) => candidate.required !== true)
    .sort(
      (a, b) =>
        b.relevance +
          b.evidenceStrength -
          b.uncertainty -
          (a.relevance + a.evidenceStrength - a.uncertainty) ||
        String(a.semanticRef).localeCompare(String(b.semanticRef)),
    );

  const detailBudget = Math.max(
    required.length,
    Math.min(
      candidates.length,
      Math.ceil(
        candidates.length *
          Math.max(0.1, audience.desiredDetail * (1 - (audience.urgency ?? 0) * 0.5)),
      ),
    ),
  );
  const selected = [
    ...required,
    ...optional.slice(0, Math.max(0, detailBudget - required.length)),
  ];
  const selectedRefs = new Set(selected.map((item) => item.semanticRef));

  return ok({
    selected: structuredClone(selected),
    omitted: structuredClone(
      candidates.filter((item) => !selectedRefs.has(item.semanticRef)),
    ),
    budget: detailBudget,
  });
};

const normalizeSurface = (value: string): string =>
  value
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\p{P}\p{S}]+/gu, "")
    .trim();

const structuralTemplateKey = (value: string): string =>
  normalizeSurface(
    value
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<date>")
      .replace(/\b\d+(?:\.\d+)?\b/g, "<number>"),
  );

const openingKey = (value: string, words = 4): string =>
  normalizeSurface(value).split(" ").slice(0, words).join(" ");

export interface TemplateLeakageSample {
  id: string;
  text: string;
  semanticSignature?: string;
}

export interface TemplateLeakageThresholds {
  maxKnownTemplateRate: number;
  maxKnownStructuralTemplateRate: number;
  maxDuplicateSurfaceRate: number;
  maxStructuralTemplateReuseRate: number;
  maxRepeatedOpeningRate: number;
}

export interface TemplateLeakageReport {
  sampleCount: number;
  knownTemplateMatches: number;
  knownStructuralTemplateMatches: number;
  duplicateSurfaces: number;
  structuralTemplateRepeats: number;
  repeatedOpenings: number;
  knownTemplateRate: number;
  knownStructuralTemplateRate: number;
  duplicateSurfaceRate: number;
  structuralTemplateReuseRate: number;
  repeatedOpeningRate: number;
  passed: boolean;
  thresholds: TemplateLeakageThresholds;
}

const validateRate = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

export const evaluateTemplateLeakage = (
  samples: readonly TemplateLeakageSample[],
  knownTemplates: readonly string[] = [],
  thresholds: TemplateLeakageThresholds = {
    maxKnownTemplateRate: 0.1,
    maxKnownStructuralTemplateRate: 0.25,
    maxDuplicateSurfaceRate: 0.25,
    maxStructuralTemplateReuseRate: 0.4,
    maxRepeatedOpeningRate: 0.5,
  },
): Result<TemplateLeakageReport> => {
  if (
    !validateRate(thresholds.maxKnownTemplateRate) ||
    !validateRate(thresholds.maxKnownStructuralTemplateRate) ||
    !validateRate(thresholds.maxDuplicateSurfaceRate) ||
    !validateRate(thresholds.maxStructuralTemplateReuseRate) ||
    !validateRate(thresholds.maxRepeatedOpeningRate)
  ) {
    return err(
      new StructuredError(
        "PRAG_TEMPLATE_THRESHOLD",
        "Template-leakage thresholds must be rates in [0, 1].",
      ),
    );
  }
  if (samples.some((sample) => sample.id.trim() === "" || sample.text.trim() === "")) {
    return err(
      new StructuredError(
        "PRAG_TEMPLATE_SAMPLE",
        "Template-leakage samples require non-empty ids and text.",
      ),
    );
  }

  const known = new Set(knownTemplates.map(normalizeSurface));
  const knownStructural = new Set(
    knownTemplates.map(structuralTemplateKey),
  );
  const normalized = samples.map((sample) => normalizeSurface(sample.text));
  const structural = samples.map((sample) =>
    structuralTemplateKey(sample.text),
  );
  const counts = new Map<string, number>();
  const structuralCounts = new Map<string, number>();
  const openings = new Map<string, number>();
  let knownTemplateMatches = 0;
  let knownStructuralTemplateMatches = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    const surface = normalized[index] ?? "";
    const structure = structural[index] ?? "";
    if (known.has(surface)) knownTemplateMatches += 1;
    if (knownStructural.has(structure)) {
      knownStructuralTemplateMatches += 1;
    }
    counts.set(surface, (counts.get(surface) ?? 0) + 1);
    structuralCounts.set(
      structure,
      (structuralCounts.get(structure) ?? 0) + 1,
    );
    const opening = openingKey(surface);
    if (opening !== "") openings.set(opening, (openings.get(opening) ?? 0) + 1);
  }

  const duplicateSurfaces = [...counts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  const structuralTemplateRepeats = [...structuralCounts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  const repeatedOpenings = [...openings.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  const divisor = Math.max(1, samples.length);
  const report: TemplateLeakageReport = {
    sampleCount: samples.length,
    knownTemplateMatches,
    knownStructuralTemplateMatches,
    duplicateSurfaces,
    structuralTemplateRepeats,
    repeatedOpenings,
    knownTemplateRate: knownTemplateMatches / divisor,
    knownStructuralTemplateRate:
      knownStructuralTemplateMatches / divisor,
    duplicateSurfaceRate: duplicateSurfaces / divisor,
    structuralTemplateReuseRate:
      structuralTemplateRepeats / divisor,
    repeatedOpeningRate: repeatedOpenings / divisor,
    passed:
      knownTemplateMatches / divisor <= thresholds.maxKnownTemplateRate &&
      knownStructuralTemplateMatches / divisor <=
        thresholds.maxKnownStructuralTemplateRate &&
      duplicateSurfaces / divisor <= thresholds.maxDuplicateSurfaceRate &&
      structuralTemplateRepeats / divisor <=
        thresholds.maxStructuralTemplateReuseRate &&
      repeatedOpenings / divisor <= thresholds.maxRepeatedOpeningRate,
    thresholds: structuredClone(thresholds),
  };
  return ok(report);
};

export interface HumanEvalItem {
  id: string;
  inputRef: string;
  output: string;
  semanticConstraints: string[];
  dimensions: Array<
    "faithfulness" | "grammar" | "clarity" | "naturalness" | "appropriateness" | "repetition"
  >;
  metadata?: Record<string, JsonValue>;
}

export interface HumanEvalBundle {
  schemaVersion: "jev-human-eval-1";
  blinded: true;
  items: HumanEvalItem[];
}

export const createHumanEvalBundle = (
  items: readonly HumanEvalItem[],
): Result<HumanEvalBundle> => {
  const ids = new Set<string>();
  for (const item of items) {
    if (
      item.id.trim() === "" ||
      item.inputRef.trim() === "" ||
      item.output.trim() === "" ||
      item.dimensions.length === 0 ||
      ids.has(item.id)
    ) {
      return err(
        new StructuredError(
          "PRAG_HUMAN_EVAL_ITEM",
          "Human-eval items require unique ids, input refs, output and dimensions.",
        ),
      );
    }
    ids.add(item.id);
  }
  return ok({
    schemaVersion: "jev-human-eval-1",
    blinded: true,
    items: items.map((item) => structuredClone(item)),
  });
};

export const exportHumanEvalJsonl = (
  bundle: HumanEvalBundle,
): string =>
  bundle.items
    .map((item) =>
      JSON.stringify({
        schemaVersion: bundle.schemaVersion,
        blinded: bundle.blinded,
        ...item,
      }),
    )
    .join("\n");

export * from "./presupposition.ts";
