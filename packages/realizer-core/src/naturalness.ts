import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  CollocationRule,
} from "../../lexicon-core/src/index.ts";

export type ParaphraseDimension =
  | "discourse-order"
  | "syntactic-construction"
  | "lexical-choice"
  | "connective-choice"
  | "reference-form"
  | "aggregation"
  | "discourse-marker";

export interface ParaphraseChoice {
  id: string;
  dimension: ParaphraseDimension;
  value: JsonValue;
  semanticJustificationRuleIds: string[];
  cost: number;
  incompatibleWith?: string[];
  annotations?: Record<string, JsonValue>;
}

export interface ParaphraseLattice {
  id: string;
  dimensions: ParaphraseDimension[];
  choices: ParaphraseChoice[];
}

export interface ParaphrasePath {
  choiceIds: string[];
  cost: number;
  semanticJustificationRuleIds: string[];
}

export const validateParaphraseLattice = (
  lattice: ParaphraseLattice,
): Result<ParaphraseLattice> => {
  if (lattice.id.trim() === "" || lattice.dimensions.length === 0) {
    return err(
      new StructuredError(
        "REALIZE_LATTICE_REQUIRED",
        "Paraphrase lattice requires an id and at least one dimension.",
      ),
    );
  }
  if (new Set(lattice.dimensions).size !== lattice.dimensions.length) {
    return err(
      new StructuredError(
        "REALIZE_LATTICE_DIMENSION_DUPLICATE",
        "Paraphrase lattice dimensions must be unique.",
      ),
    );
  }

  const ids = new Set<string>();
  for (const choice of lattice.choices) {
    if (
      choice.id.trim() === "" ||
      ids.has(choice.id) ||
      !lattice.dimensions.includes(choice.dimension) ||
      !Number.isFinite(choice.cost) ||
      choice.cost < 0 ||
      choice.semanticJustificationRuleIds.length === 0
    ) {
      return err(
        new StructuredError(
          "REALIZE_LATTICE_CHOICE",
          "Every paraphrase choice requires a unique id, declared dimension, non-negative finite cost, and semantic justification.",
        ),
      );
    }
    ids.add(choice.id);
  }

  for (const choice of lattice.choices) {
    for (const conflict of choice.incompatibleWith ?? []) {
      if (!ids.has(conflict)) {
        return err(
          new StructuredError(
            "REALIZE_LATTICE_CONFLICT_UNKNOWN",
            `Paraphrase choice ${choice.id} references unknown incompatible choice ${conflict}.`,
          ),
        );
      }
    }
  }
  return ok(structuredClone(lattice));
};

const choicesForDimension = (
  lattice: ParaphraseLattice,
  dimension: ParaphraseDimension,
): ParaphraseChoice[] =>
  lattice.choices
    .filter((choice) => choice.dimension === dimension)
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));

const compatible = (
  selected: readonly ParaphraseChoice[],
  candidate: ParaphraseChoice,
): boolean => {
  const selectedIds = new Set(selected.map((choice) => choice.id));
  if (
    (candidate.incompatibleWith ?? []).some((id) => selectedIds.has(id))
  ) {
    return false;
  }
  return selected.every(
    (choice) => !(choice.incompatibleWith ?? []).includes(candidate.id),
  );
};

export const enumerateParaphrasePaths = (
  lattice: ParaphraseLattice,
  maxPaths: number,
): Result<ParaphrasePath[]> => {
  const valid = validateParaphraseLattice(lattice);
  if (!valid.ok) return valid;
  if (!Number.isInteger(maxPaths) || maxPaths < 1 || maxPaths > 10_000) {
    return err(
      new StructuredError(
        "REALIZE_LATTICE_BUDGET",
        "Paraphrase enumeration maxPaths must be an integer in [1, 10000].",
      ),
    );
  }

  const dimensions = valid.value.dimensions;
  const output: ParaphrasePath[] = [];

  const visit = (
    dimensionIndex: number,
    selected: ParaphraseChoice[],
  ): void => {
    if (output.length >= maxPaths) return;
    if (dimensionIndex >= dimensions.length) {
      output.push({
        choiceIds: selected.map((choice) => choice.id),
        cost: selected.reduce((sum, choice) => sum + choice.cost, 0),
        semanticJustificationRuleIds: [
          ...new Set(
            selected.flatMap(
              (choice) => choice.semanticJustificationRuleIds,
            ),
          ),
        ].sort(),
      });
      return;
    }

    const dimension = dimensions[dimensionIndex];
    if (dimension === undefined) return;
    const candidates = choicesForDimension(valid.value, dimension);
    if (candidates.length === 0) {
      visit(dimensionIndex + 1, selected);
      return;
    }

    for (const candidate of candidates) {
      if (!compatible(selected, candidate)) continue;
      visit(dimensionIndex + 1, [...selected, candidate]);
      if (output.length >= maxPaths) break;
    }
  };

  visit(0, []);
  return ok(
    output.sort(
      (a, b) =>
        a.cost - b.cost ||
        a.choiceIds.join("\u0000").localeCompare(b.choiceIds.join("\u0000")),
    ),
  );
};

export interface CollocationContribution {
  ruleId: string;
  relation: CollocationRule["relation"];
  score: number;
}

export interface CollocationScore {
  allowed: boolean;
  score: number;
  contributions: CollocationContribution[];
}

const relationScore = (
  relation: CollocationRule["relation"],
): number => {
  switch (relation) {
    case "prefers":
      return 1;
    case "allows":
      return 0.25;
    case "discourages":
      return -0.5;
    case "forbids":
      return Number.NEGATIVE_INFINITY;
  }
};

export const scoreCollocation = (
  head: string,
  object: string,
  rules: readonly CollocationRule[],
  context: {
    domain?: string;
    register?: string;
  } = {},
): CollocationScore => {
  const contributions = rules
    .filter(
      (rule) =>
        rule.left === head &&
        rule.right === object &&
        (rule.domain === undefined ||
          context.domain === undefined ||
          rule.domain === context.domain) &&
        (rule.register === undefined ||
          context.register === undefined ||
          rule.register === context.register),
    )
    .map((rule) => ({
      ruleId: rule.id,
      relation: rule.relation,
      score: relationScore(rule.relation),
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  if (
    contributions.some(
      (contribution) => contribution.relation === "forbids",
    )
  ) {
    return {
      allowed: false,
      score: Number.NEGATIVE_INFINITY,
      contributions,
    };
  }
  return {
    allowed: true,
    score: contributions.reduce(
      (sum, contribution) => sum + contribution.score,
      0,
    ),
    contributions,
  };
};
