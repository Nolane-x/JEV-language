import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  ClausePlan,
  ClauseType,
  DiscoursePlan,
  DiscourseUnitKind,
  PlannedRole,
} from "../../discourse-ir/src/index.ts";
import type {
  LanguageNeutralLexiconIndex,
  PartOfSpeech,
} from "../../lexicon-core/src/index.ts";
import type {
  MorphFeatures,
  MorphologyProvider,
} from "../../morphology-core/src/index.ts";
import type {
  ConceptRef,
  RoleRef,
} from "../../ontology/src/index.ts";
import type {
  ActionNode,
  ConstraintNode,
  GraphSnapshot,
  JsgNode,
  ModalitySpec,
  SemanticArgument,
  RoleBinding,
} from "../../semantic-graph/src/index.ts";

export interface LexicalCandidate {
  lexemeId: string;
  lemma: string;
  partOfSpeech: PartOfSpeech;
  concept: ConceptRef;
  senseIds: string[];
  deterministicRank: number;
}

export const generateLexicalCandidates = (
  lexicon: LanguageNeutralLexiconIndex,
  concept: ConceptRef,
  language: string,
): LexicalCandidate[] =>
  lexicon
    .lookupConcept(concept, language)
    .map((lexeme, index) => ({
      lexemeId: lexeme.id,
      lemma: lexeme.lemma,
      partOfSpeech: lexeme.partOfSpeech,
      concept,
      senseIds: lexeme.senses
        .filter((sense) => sense.concept === concept)
        .map((sense) => sense.id)
        .sort(),
      deterministicRank: index,
    }))
    .filter((candidate) => candidate.senseIds.length > 0);

export const realizeLexicalCandidate = (
  candidate: LexicalCandidate,
  lexicon: LanguageNeutralLexiconIndex,
  morphology: MorphologyProvider,
  features: MorphFeatures = {},
): Result<string[]> => {
  const lexeme = lexicon.getLexeme(candidate.lexemeId);
  if (lexeme === undefined) {
    return err(
      new StructuredError(
        "REALIZE_LEXEME_MISSING",
        `Lexical candidate references missing lexeme ${candidate.lexemeId}.`,
      ),
    );
  }
  if (lexeme.language !== morphology.language) {
    return err(
      new StructuredError(
        "REALIZE_MORPH_LANGUAGE",
        `Lexeme language ${lexeme.language} does not match morphology provider ${morphology.language}.`,
      ),
    );
  }
  const surfaces = morphology.realize(lexeme, features);
  if (surfaces.length === 0) {
    return err(
      new StructuredError(
        "REALIZE_MORPH_EMPTY",
        `Morphology provider produced no surfaces for ${lexeme.id}.`,
      ),
    );
  }
  return ok([...new Set(surfaces)]);
};

export interface RoleSyntaxRule {
  role: RoleRef;
  syntacticFunction: string;
  required?: boolean;
  priority?: number;
}

export interface SyntaxRoleBinding {
  role: RoleRef;
  syntacticFunction: string;
  plannedRole: PlannedRole;
}

export const mapRolesToSyntax = (
  roles: readonly PlannedRole[],
  rules: readonly RoleSyntaxRule[],
): Result<SyntaxRoleBinding[]> => {
  const byRole = new Map<RoleRef, RoleSyntaxRule[]>();
  for (const rule of rules) {
    const bucket = byRole.get(rule.role) ?? [];
    bucket.push(rule);
    byRole.set(rule.role, bucket);
  }

  for (const rule of rules.filter((entry) => entry.required === true)) {
    if (!roles.some((entry) => entry.role === rule.role)) {
      return err(
        new StructuredError(
          "REALIZE_REQUIRED_ROLE_MISSING",
          `Required semantic role ${rule.role} is absent from the clause plan.`,
        ),
      );
    }
  }

  const output: SyntaxRoleBinding[] = [];
  for (const role of roles) {
    const candidates = [...(byRole.get(role.role) ?? [])].sort(
      (a, b) =>
        (b.priority ?? 0) - (a.priority ?? 0) ||
        a.syntacticFunction.localeCompare(b.syntacticFunction),
    );
    const selected = candidates[0];
    if (selected === undefined) {
      return err(
        new StructuredError(
          "REALIZE_ROLE_UNMAPPED",
          `No syntax mapping exists for semantic role ${role.role}.`,
        ),
      );
    }
    output.push({
      role: role.role,
      syntacticFunction: selected.syntacticFunction,
      plannedRole: structuredClone(role),
    });
  }
  return ok(output);
};

export interface FeaturePropagationRule {
  from: string;
  to: string;
  feature: keyof MorphFeatures;
  required?: boolean;
}

export type FeatureEnvironment = Record<string, MorphFeatures>;

export const propagateMorphFeatures = (
  environment: FeatureEnvironment,
  rules: readonly FeaturePropagationRule[],
): Result<FeatureEnvironment> => {
  const output = structuredClone(environment);
  for (const rule of rules) {
    const source = output[rule.from];
    if (source === undefined) {
      if (rule.required === true) {
        return err(
          new StructuredError(
            "REALIZE_FEATURE_SOURCE_MISSING",
            `Feature propagation source ${rule.from} is missing.`,
          ),
        );
      }
      continue;
    }
    const value = source[rule.feature];
    if (value === undefined) {
      if (rule.required === true) {
        return err(
          new StructuredError(
            "REALIZE_FEATURE_MISSING",
            `Required feature ${String(rule.feature)} is absent on ${rule.from}.`,
          ),
        );
      }
      continue;
    }
    const target = output[rule.to] ?? {};
    const existing = target[rule.feature];
    if (existing !== undefined && existing !== value) {
      return err(
        new StructuredError(
          "REALIZE_FEATURE_CONFLICT",
          `Feature ${String(rule.feature)} conflicts while propagating ${rule.from} → ${rule.to}.`,
        ),
      );
    }
    output[rule.to] = { ...target, [rule.feature]: value };
  }
  return ok(output);
};

export interface BasicReferenceProfile {
  language: string;
  definiteArticle?: string;
  singularPronoun?: string;
  pluralPronoun?: string;
}

export interface BasicReferenceRequest {
  head: string;
  number?: "singular" | "plural";
  discourseStatus: "new" | "given" | "contrastive";
  allowPronoun?: boolean;
}

export interface BasicReferenceForm {
  surface: string;
  strategy: "full-definite" | "pronoun" | "bare";
}

export const generateBasicReference = (
  request: BasicReferenceRequest,
  profile: BasicReferenceProfile,
): Result<BasicReferenceForm> => {
  if (request.head.trim() === "" || profile.language.trim() === "") {
    return err(
      new StructuredError(
        "REALIZE_REFERENCE_REQUIRED",
        "Reference generation requires a non-empty head and language profile.",
      ),
    );
  }

  if (request.discourseStatus === "given" && request.allowPronoun === true) {
    const pronoun =
      request.number === "plural"
        ? profile.pluralPronoun
        : profile.singularPronoun;
    if (pronoun !== undefined && pronoun.trim() !== "") {
      return ok({ surface: pronoun, strategy: "pronoun" });
    }
  }

  if (profile.definiteArticle !== undefined && profile.definiteArticle !== "") {
    return ok({
      surface: `${profile.definiteArticle} ${request.head}`,
      strategy: "full-definite",
    });
  }
  return ok({ surface: request.head, strategy: "bare" });
};

export const formatControlledSentence = (
  surface: string,
  clauseType: ClauseType,
): Result<string> => {
  const trimmed = surface.trim().replace(/\s+/g, " ");
  if (trimmed === "") {
    return err(
      new StructuredError(
        "REALIZE_EMPTY_SURFACE",
        "Cannot format an empty controlled sentence.",
      ),
    );
  }
  const initial = trimmed.charAt(0).toLocaleUpperCase() + trimmed.slice(1);
  const body = initial.replace(/[.!?]+$/u, "");
  return ok(
    `${body}${clauseType === "yes-no-question" || clauseType === "wh-question" ? "?" : "."}`,
  );
};

export interface RealizationFallbackStage<T> {
  id: string;
  run(): Result<T>;
}

export interface RealizationFallbackResult<T> {
  value: T;
  stageId: string;
  failedStages: Array<{ id: string; code: string }>;
}

export const runRealizationFallback = <T>(
  stages: readonly RealizationFallbackStage<T>[],
): Result<RealizationFallbackResult<T>> => {
  if (stages.length === 0) {
    return err(
      new StructuredError(
        "REALIZE_FALLBACK_EMPTY",
        "Realization fallback ladder requires at least one stage.",
      ),
    );
  }
  const failedStages: Array<{ id: string; code: string }> = [];
  for (const stage of stages) {
    const result = stage.run();
    if (result.ok) {
      return ok({
        value: result.value,
        stageId: stage.id,
        failedStages,
      });
    }
    failedStages.push({ id: stage.id, code: result.error.code });
  }
  return err(
    new StructuredError(
      "REALIZE_FALLBACK_EXHAUSTED",
      "All configured realization fallback stages failed.",
      { failedStages },
    ),
  );
};

const roleBindingsToPlanned = (
  bindings: readonly (RoleBinding | SemanticArgument)[],
): PlannedRole[] =>
  bindings.map((binding) => ({
    role: binding.role,
    value: structuredClone(binding.value),
  }));

const modalityForConstraint = (
  node: ConstraintNode,
): ModalitySpec | undefined => {
  switch (node.constraintKind) {
    case "requirement":
      return { kind: "required" };
    case "permission":
      return { kind: "permitted" };
    case "prohibition":
      return { kind: "forbidden" };
    case "condition":
      return undefined;
  }
};

const unitKindForNode = (node: JsgNode): DiscourseUnitKind =>
  node.kind === "proposition" && node.epistemic?.status === "questioned"
    ? "question"
    : node.kind === "constraint" && node.constraintKind === "condition"
      ? "condition"
      : node.kind === "relation" && node.relation === "concept:core.cause"
        ? "explanation"
        : "claim";

export interface ControlledRealizationPlan {
  discourse: DiscoursePlan;
  clauses: ClausePlan[];
}

export const buildControlledRealizationPlan = (
  snapshot: GraphSnapshot,
  roots: readonly SemanticId[],
): Result<ControlledRealizationPlan> => {
  if (roots.length === 0) {
    return err(
      new StructuredError(
        "REALIZE_PLAN_NO_ROOTS",
        "Controlled realization planning requires at least one semantic root.",
      ),
    );
  }
  const rootNodes = roots
    .map((id) => snapshot.nodes.find((node) => node.id === id))
    .filter((node): node is JsgNode => node !== undefined);
  if (rootNodes.length !== roots.length) {
    return err(
      new StructuredError(
        "REALIZE_PLAN_ROOT_MISSING",
        "One or more controlled realization roots do not exist in the snapshot.",
      ),
    );
  }

  const units = rootNodes.map((node, index) => ({
    id: `unit:${index}`,
    kind: unitKindForNode(node),
    semanticRefs: [node.id],
    required: true,
    importance: 1,
  }));

  const discourse: DiscoursePlan = {
    id: "discourse:controlled-en",
    goal: {
      kind: rootNodes.some(
        (node) =>
          node.kind === "proposition" &&
          node.epistemic?.status === "questioned",
      )
        ? "ask"
        : "answer",
      semanticRoots: [...roots],
      targetLength: "minimal",
    },
    units,
    relations: [],
    orderingConstraints: units.slice(1).map((unit, index) => ({
      id: `order:${index}`,
      before: units[index]!.id,
      after: unit.id,
      kind: "logical-prerequisite" as const,
      hard: true,
    })),
  };

  const clauses: ClausePlan[] = [];
  for (const [index, node] of rootNodes.entries()) {
    if (node.kind === "event") {
      clauses.push({
        id: `clause:${index}`,
        sourceUnitId: units[index]!.id,
        predicate: node.predicate,
        roles: roleBindingsToPlanned(node.roles),
        clauseType: "declarative",
        polarity: node.polarity,
        ...(node.modality === undefined ? {} : { modality: node.modality }),
        ...(node.temporal === undefined
          ? {}
          : {
              tenseAspect: {
                tense: "language-default",
                temporalAnchor: node.temporal,
              },
            }),
      });
      continue;
    }
    if (node.kind === "proposition") {
      clauses.push({
        id: `clause:${index}`,
        sourceUnitId: units[index]!.id,
        predicate: node.predicate,
        roles: roleBindingsToPlanned(node.arguments),
        clauseType:
          node.epistemic?.status === "questioned"
            ? "yes-no-question"
            : "declarative",
        polarity: node.polarity,
        ...(node.modality === undefined ? {} : { modality: node.modality }),
      });
      continue;
    }
    if (node.kind === "constraint") {
      const action = snapshot.nodes.find(
        (candidate): candidate is ActionNode =>
          candidate.kind === "action" && candidate.id === node.subject,
      );
      if (action === undefined) continue;
      const modality = modalityForConstraint(node);
      clauses.push({
        id: `clause:${index}`,
        sourceUnitId: units[index]!.id,
        predicate: action.operation,
        roles: [
          ...(action.actor === undefined
            ? []
            : [
                {
                  role: "role:core.agent" as RoleRef,
                  value: { kind: "ref" as const, ref: action.actor },
                },
              ]),
          ...roleBindingsToPlanned(action.parameters),
        ],
        clauseType: "declarative",
        polarity:
          node.constraintKind === "prohibition" ||
          node.predicate === "concept:core.maximum-cardinality"
            ? "negative"
            : "positive",
        ...(modality === undefined ? {} : { modality }),
      });
    }
  }

  return ok({ discourse, clauses });
};
