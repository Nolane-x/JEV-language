import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type { LexicalMatch } from "../../lexicon-core/src/index.ts";
import type { GraphOperation } from "../../semantic-graph/src/index.ts";

export const STANDARD_GRAMMAR_CATEGORIES = [
  "S",
  "CLAUSE",
  "NP",
  "VP",
  "PP",
  "ADJP",
  "ADVP",
  "QUESTION",
  "COORD",
  "QUANTITY",
  "TIME",
  "MODAL",
  "COPULA",
] as const;

export type StandardGrammarCategory =
  (typeof STANDARD_GRAMMAR_CATEGORIES)[number];

export type GrammarCategory =
  | StandardGrammarCategory
  | (string & {});

export const STANDARD_GRAMMAR_FEATURES = [
  "number",
  "person",
  "tense",
  "aspect",
  "mood",
  "voice",
  "polarity",
  "modality",
  "question",
  "wh",
  "case",
  "definiteness",
  "animacy",
  "comparator",
  "temporal",
] as const;

export type GrammarFeatureValue = string | number | boolean;
export type GrammarFeatures = Record<string, GrammarFeatureValue>;

export interface GrammarFeatureConstraint {
  feature: string;
  equals?: GrammarFeatureValue;
  oneOf?: GrammarFeatureValue[];
  present?: boolean;
}

interface GrammarPatternFeatures {
  featureConstraints?: GrammarFeatureConstraint[];
}

export type GrammarPattern = (
  | {
      kind: "category";
      category: GrammarCategory;
      capture?: string;
      optional?: boolean;
      repeat?: "zero-or-more" | "one-or-more";
    }
  | {
      kind: "literal";
      surface: string;
      caseSensitive?: boolean;
      capture?: string;
    }
  | {
      kind: "lexical";
      partOfSpeech?: string;
      semanticTag?: string;
      capture?: string;
    }) &
  GrammarPatternFeatures;

export interface GrammarBinding {
  categories: Record<string, string[]>;
  surfaces: Record<string, string[]>;
  lexical: Record<string, LexicalMatch[]>;
  features: Record<string, JsonValue>;
  featureSets?: Record<string, GrammarFeatures>;
}

export interface GrammarConstraintContext {
  language: string;
  ruleId: string;
  binding: GrammarBinding;
}

export interface GrammarConstraint {
  id: string;
  description: string;
  check(context: GrammarConstraintContext): boolean;
}

export interface GrammarSemanticConstruction {
  id: string;
  construct(binding: GrammarBinding): Result<GraphOperation[]>;
}

export interface RealizationPlan {
  id: string;
  description: string;
  order: string[];
  featureFlow?: Array<{
    from: string;
    to: string;
    features: string[];
  }>;
}

export interface GrammarRule {
  id: string;
  language: string;
  lhs: GrammarCategory;
  rhs: GrammarPattern[];
  constraints: GrammarConstraint[];
  semanticConstruction?: GrammarSemanticConstruction;
  realizationPlan?: RealizationPlan;
  priority?: number;
  resultFeatures?: GrammarFeatures;
  annotations?: Record<string, JsonValue>;
}

export interface GrammarConflict {
  leftRuleId: string;
  rightRuleId: string;
  reason: "same-signature" | "same-id";
}

export interface GrammarCoverageMatrix {
  language: string;
  phenomena: Record<
    string,
    "unsupported" | "partial" | "controlled" | "broad"
  >;
  notes?: Record<string, string>;
}

const normalizedFeatureConstraints = (
  constraints: GrammarFeatureConstraint[] | undefined,
): JsonValue[] =>
  [...(constraints ?? [])]
    .sort((a, b) => a.feature.localeCompare(b.feature))
    .map((constraint) => ({
      feature: constraint.feature,
      equals: constraint.equals ?? null,
      oneOf: [...(constraint.oneOf ?? [])],
      present: constraint.present ?? null,
    }));

export const grammarFeaturesSatisfy = (
  features: GrammarFeatures,
  constraints: readonly GrammarFeatureConstraint[] | undefined,
): boolean =>
  (constraints ?? []).every((constraint) => {
    const value = features[constraint.feature];
    if (constraint.present === true && value === undefined) return false;
    if (constraint.present === false && value !== undefined) return false;
    if (
      constraint.equals !== undefined &&
      value !== constraint.equals
    ) {
      return false;
    }
    if (
      constraint.oneOf !== undefined &&
      (value === undefined || !constraint.oneOf.includes(value))
    ) {
      return false;
    }
    return true;
  });

const patternSignature = (pattern: GrammarPattern): JsonValue => {
  if (pattern.kind === "category") {
    return {
      kind: pattern.kind,
      category: pattern.category,
      optional: pattern.optional ?? false,
      repeat: pattern.repeat ?? "",
      featureConstraints: normalizedFeatureConstraints(
        pattern.featureConstraints,
      ),
    };
  }
  if (pattern.kind === "literal") {
    return {
      kind: pattern.kind,
      surface: pattern.caseSensitive === true
        ? pattern.surface
        : pattern.surface.toLocaleLowerCase(),
      caseSensitive: pattern.caseSensitive ?? false,
      featureConstraints: normalizedFeatureConstraints(
        pattern.featureConstraints,
      ),
    };
  }
  return {
    kind: pattern.kind,
    partOfSpeech: pattern.partOfSpeech ?? "",
    semanticTag: pattern.semanticTag ?? "",
    featureConstraints: normalizedFeatureConstraints(
      pattern.featureConstraints,
    ),
  };
};

export const grammarRuleSignature = (rule: GrammarRule): string =>
  JSON.stringify({
    language: rule.language,
    lhs: rule.lhs,
    rhs: rule.rhs.map(patternSignature),
  });

const cloneGrammarRule = (rule: GrammarRule): GrammarRule => ({
  ...rule,
  rhs: rule.rhs.map((pattern) => structuredClone(pattern)),
  constraints: [...rule.constraints],
  ...(rule.semanticConstruction === undefined
    ? {}
    : { semanticConstruction: rule.semanticConstruction }),
  ...(rule.realizationPlan === undefined
    ? {}
    : { realizationPlan: structuredClone(rule.realizationPlan) }),
  ...(rule.resultFeatures === undefined
    ? {}
    : { resultFeatures: structuredClone(rule.resultFeatures) }),
  ...(rule.annotations === undefined
    ? {}
    : { annotations: structuredClone(rule.annotations) }),
});

export const validateGrammarRule = (
  rule: GrammarRule,
): Result<GrammarRule> => {
  if (
    rule.id.trim() === "" ||
    rule.language.trim() === "" ||
    rule.lhs.trim() === ""
  ) {
    return err(
      new StructuredError(
        "GRAMMAR_RULE_REQUIRED",
        "Grammar rule id, language, and lhs are required.",
      ),
    );
  }
  if (rule.rhs.length === 0) {
    return err(
      new StructuredError(
        "GRAMMAR_RULE_EMPTY_RHS",
        `Grammar rule ${rule.id} must contain at least one RHS pattern.`,
      ),
    );
  }
  const captures = new Set<string>();
  for (const pattern of rule.rhs) {
    for (const constraint of pattern.featureConstraints ?? []) {
      if (constraint.feature.trim() === "") {
        return err(
          new StructuredError(
            "GRAMMAR_FEATURE_NAME",
            `Grammar rule ${rule.id} contains an empty feature constraint name.`,
          ),
        );
      }
      if (
        constraint.equals !== undefined &&
        constraint.oneOf !== undefined &&
        !constraint.oneOf.includes(constraint.equals)
      ) {
        return err(
          new StructuredError(
            "GRAMMAR_FEATURE_CONSTRAINT",
            `Grammar rule ${rule.id} has incompatible equals/oneOf constraints for ${constraint.feature}.`,
          ),
        );
      }
    }
    const capture = pattern.capture;
    if (capture === undefined) continue;
    if (capture.trim() === "" || captures.has(capture)) {
      return err(
        new StructuredError(
          "GRAMMAR_CAPTURE_DUPLICATE",
          `Grammar rule ${rule.id} contains an empty or duplicate capture ${capture}.`,
        ),
      );
    }
    captures.add(capture);
  }
  return ok(cloneGrammarRule(rule));
};

export class GrammarRegistry {
  readonly #rules = new Map<string, GrammarRule>();
  readonly #signatures = new Map<string, string>();

  register(rule: GrammarRule): Result<void> {
    const valid = validateGrammarRule(rule);
    if (!valid.ok) return valid;
    if (this.#rules.has(rule.id)) {
      return err(
        new StructuredError(
          "GRAMMAR_RULE_DUPLICATE",
          `Grammar rule already registered: ${rule.id}.`,
        ),
      );
    }
    const signature = grammarRuleSignature(rule);
    const existing = this.#signatures.get(signature);
    if (existing !== undefined) {
      return err(
        new StructuredError(
          "GRAMMAR_RULE_STRUCTURAL_DUPLICATE",
          `Grammar rule ${rule.id} duplicates the structure of ${existing}.`,
        ),
      );
    }
    this.#rules.set(rule.id, cloneGrammarRule(rule));
    this.#signatures.set(signature, rule.id);
    return ok(undefined);
  }

  get(id: string): GrammarRule | undefined {
    const value = this.#rules.get(id);
    return value === undefined ? undefined : cloneGrammarRule(value);
  }

  rulesFor(
    language: string,
    lhs?: GrammarCategory,
  ): GrammarRule[] {
    return [...this.#rules.values()]
      .filter(
        (rule) =>
          rule.language === language &&
          (lhs === undefined || rule.lhs === lhs),
      )
      .map((rule) => cloneGrammarRule(rule))
      .sort(
        (left, right) =>
          (right.priority ?? 0) - (left.priority ?? 0) ||
          left.id.localeCompare(right.id),
      );
  }

  conflicts(rule: GrammarRule): GrammarConflict[] {
    const output: GrammarConflict[] = [];
    if (this.#rules.has(rule.id)) {
      output.push({
        leftRuleId: rule.id,
        rightRuleId: rule.id,
        reason: "same-id",
      });
    }
    const existing = this.#signatures.get(grammarRuleSignature(rule));
    if (existing !== undefined && existing !== rule.id) {
      output.push({
        leftRuleId: rule.id,
        rightRuleId: existing,
        reason: "same-signature",
      });
    }
    return output;
  }

  size(): number {
    return this.#rules.size;
  }
}

export const evaluateGrammarConstraints = (
  rule: GrammarRule,
  binding: GrammarBinding,
): boolean =>
  rule.constraints.every((constraint) =>
    constraint.check({
      language: rule.language,
      ruleId: rule.id,
      binding,
    }),
  );
