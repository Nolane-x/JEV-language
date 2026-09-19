import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type { LexicalMatch } from "../../lexicon-core/src/index.ts";
import type { GraphOperation } from "../../semantic-graph/src/index.ts";

export type GrammarCategory = string;

export type GrammarPattern =
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
    };

export interface GrammarBinding {
  categories: Record<string, string[]>;
  surfaces: Record<string, string[]>;
  lexical: Record<string, LexicalMatch[]>;
  features: Record<string, JsonValue>;
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

const patternSignature = (pattern: GrammarPattern): JsonValue => {
  if (pattern.kind === "category") {
    return {
      kind: pattern.kind,
      category: pattern.category,
      optional: pattern.optional ?? false,
      repeat: pattern.repeat ?? "",
    };
  }
  if (pattern.kind === "literal") {
    return {
      kind: pattern.kind,
      surface: pattern.caseSensitive === true
        ? pattern.surface
        : pattern.surface.toLocaleLowerCase(),
      caseSensitive: pattern.caseSensitive ?? false,
    };
  }
  return {
    kind: pattern.kind,
    partOfSpeech: pattern.partOfSpeech ?? "",
    semanticTag: pattern.semanticTag ?? "",
  };
};

export const grammarRuleSignature = (rule: GrammarRule): string =>
  JSON.stringify({
    language: rule.language,
    lhs: rule.lhs,
    rhs: rule.rhs.map(patternSignature),
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
  return ok(structuredClone(rule));
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
    this.#rules.set(rule.id, structuredClone(rule));
    this.#signatures.set(signature, rule.id);
    return ok(undefined);
  }

  get(id: string): GrammarRule | undefined {
    const value = this.#rules.get(id);
    return value === undefined ? undefined : structuredClone(value);
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
      .map((rule) => structuredClone(rule))
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
