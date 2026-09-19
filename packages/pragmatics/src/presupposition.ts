import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";

export type PresuppositionStatus =
  | "triggered"
  | "accommodation-candidate"
  | "accommodated"
  | "cancelled"
  | "rejected";

export interface PresuppositionRecord {
  id: string;
  contentRef: SemanticId;
  triggerId: string;
  status: PresuppositionStatus;
  /**
   * Presupposed content is never promoted to an assertion merely because a
   * trigger was detected or accommodation was proposed.
   */
  assertionStatus: "not-asserted";
  language?: string;
  triggerSurface?: string;
  localContextRef?: SemanticId;
  notes?: string[];
}

const nonEmpty = (value: string): boolean => value.trim() !== "";

export const validatePresupposition = (
  input: PresuppositionRecord,
): Result<PresuppositionRecord> => {
  if (
    !nonEmpty(input.id) ||
    !nonEmpty(input.contentRef) ||
    !nonEmpty(input.triggerId) ||
    input.assertionStatus !== "not-asserted"
  ) {
    return err(
      new StructuredError(
        "PRAG_PRESUPPOSITION_SCHEMA",
        "Presuppositions require stable ids, semantic content, trigger identity, and non-asserted status.",
      ),
    );
  }
  if (
    input.language !== undefined &&
    !nonEmpty(input.language)
  ) {
    return err(
      new StructuredError(
        "PRAG_PRESUPPOSITION_LANGUAGE",
        "Presupposition language must be non-empty when supplied.",
      ),
    );
  }
  return ok(structuredClone(input));
};

export type AccommodationScope =
  | { kind: "local"; scopeRef: SemanticId }
  | { kind: "global" };

export interface AccommodationCandidate {
  id: string;
  presuppositionId: string;
  scope: AccommodationScope;
  status: "candidate";
  assertionStatus: "not-asserted";
  rationale: string;
}

export interface AccommodationContext {
  localScopes?: readonly SemanticId[];
  allowGlobal?: boolean;
  blockedScopes?: readonly SemanticId[];
}

const scopeKey = (scope: AccommodationScope): string =>
  scope.kind === "global" ? "global" : `local:${scope.scopeRef}`;

export const generateAccommodationCandidates = (
  presupposition: PresuppositionRecord,
  context: AccommodationContext = {},
): Result<AccommodationCandidate[]> => {
  const valid = validatePresupposition(presupposition);
  if (!valid.ok) return valid;

  if (
    presupposition.status === "cancelled" ||
    presupposition.status === "rejected"
  ) {
    return ok([]);
  }

  const blocked = new Set(context.blockedScopes ?? []);
  const localScopes = [...new Set(context.localScopes ?? [])]
    .filter((scope) => nonEmpty(scope) && !blocked.has(scope))
    .sort((a, b) => a.localeCompare(b));

  const scopes: AccommodationScope[] = localScopes.map((scopeRef) => ({
    kind: "local",
    scopeRef,
  }));
  if (context.allowGlobal !== false) scopes.push({ kind: "global" });

  return ok(
    scopes.map((scope) => ({
      id: `accommodation:${presupposition.id}:${scopeKey(scope)}`,
      presuppositionId: presupposition.id,
      scope,
      status: "candidate",
      assertionStatus: "not-asserted",
      rationale:
        scope.kind === "global"
          ? "Global accommodation remains an explicit alternative."
          : "Local accommodation keeps the presupposition inside an available semantic scope.",
    })),
  );
};

export type PragmaticInferenceStatus =
  | "candidate"
  | "supported"
  | "cancelled"
  | "rejected";

export type PragmaticInferenceKind =
  | "scalar"
  | "idiom"
  | "coercion"
  | "other";

export interface PragmaticInference {
  id: string;
  kind: PragmaticInferenceKind;
  status: PragmaticInferenceStatus;
  assertionStatus: "not-asserted";
  sourceRefs: SemanticId[];
  cancellable: boolean;
  payload: JsonValue;
  cancellationReasons?: string[];
}

export interface ScalarScale {
  id: string;
  /**
   * Values are ordered from weaker to stronger.
   */
  orderedValues: string[];
}

export interface ScalarInferenceInput {
  scale: ScalarScale;
  assertedValue: string;
  sourceRef: SemanticId;
  cancellationSignals?: readonly string[];
}

export const generateScalarInferences = (
  input: ScalarInferenceInput,
): Result<PragmaticInference[]> => {
  if (
    !nonEmpty(input.scale.id) ||
    input.scale.orderedValues.length < 2 ||
    input.scale.orderedValues.some((value) => !nonEmpty(value)) ||
    new Set(input.scale.orderedValues).size !== input.scale.orderedValues.length
  ) {
    return err(
      new StructuredError(
        "PRAG_SCALAR_SCALE",
        "Scalar scales require a stable id and at least two unique non-empty ordered values.",
      ),
    );
  }
  const assertedIndex = input.scale.orderedValues.indexOf(input.assertedValue);
  if (assertedIndex < 0) {
    return err(
      new StructuredError(
        "PRAG_SCALAR_ASSERTION",
        "The asserted scalar value must belong to its declared scale.",
      ),
    );
  }

  const cancellationReasons = [...new Set(input.cancellationSignals ?? [])]
    .filter(nonEmpty)
    .sort();
  const status: PragmaticInferenceStatus =
    cancellationReasons.length === 0 ? "candidate" : "cancelled";

  return ok(
    input.scale.orderedValues
      .slice(assertedIndex + 1)
      .map((strongerAlternative) => ({
        id: `scalar:${input.scale.id}:${input.assertedValue}:not:${strongerAlternative}`,
        kind: "scalar" as const,
        status,
        assertionStatus: "not-asserted" as const,
        sourceRefs: [input.sourceRef],
        cancellable: true,
        payload: {
          scaleId: input.scale.id,
          assertedValue: input.assertedValue,
          excludedStrongerAlternative: strongerAlternative,
        },
        ...(cancellationReasons.length === 0
          ? {}
          : { cancellationReasons: [...cancellationReasons] }),
      })),
  );
};

export interface IdiomEntry {
  id: string;
  language: string;
  tokens: string[];
  semanticRef: SemanticId;
  gloss?: string;
}

export interface MultiwordInterpretationCandidate {
  id: string;
  kind: "literal" | "idiom";
  language: string;
  tokens: string[];
  assertionStatus: "not-asserted";
  status: "candidate";
  semanticRef?: SemanticId;
  idiomId?: string;
}

const normalizeToken = (value: string): string =>
  value.normalize("NFKC").toLocaleLowerCase().trim();

const normalizedTokens = (tokens: readonly string[]): string[] =>
  tokens.map(normalizeToken);

export class IdiomRegistry {
  readonly #entries = new Map<string, IdiomEntry>();

  register(entry: IdiomEntry): Result<void> {
    const tokens = normalizedTokens(entry.tokens);
    if (
      !nonEmpty(entry.id) ||
      !nonEmpty(entry.language) ||
      tokens.length < 2 ||
      tokens.some((token) => token === "") ||
      !nonEmpty(entry.semanticRef)
    ) {
      return err(
        new StructuredError(
          "PRAG_IDIOM_SCHEMA",
          "Idiom entries require id, language, at least two tokens, and semantic reference.",
        ),
      );
    }
    if (this.#entries.has(entry.id)) {
      return err(
        new StructuredError(
          "PRAG_IDIOM_DUPLICATE",
          `Duplicate idiom id ${entry.id}.`,
        ),
      );
    }
    this.#entries.set(entry.id, {
      ...structuredClone(entry),
      tokens,
    });
    return ok(undefined);
  }

  entries(): IdiomEntry[] {
    return [...this.#entries.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((entry) => structuredClone(entry));
  }

  candidates(
    tokens: readonly string[],
    language: string,
  ): Result<MultiwordInterpretationCandidate[]> {
    const normalized = normalizedTokens(tokens);
    if (
      !nonEmpty(language) ||
      normalized.length === 0 ||
      normalized.some((token) => token === "")
    ) {
      return err(
        new StructuredError(
          "PRAG_IDIOM_INPUT",
          "Multiword interpretation requires language and non-empty tokens.",
        ),
      );
    }

    const candidates: MultiwordInterpretationCandidate[] = [
      {
        id: `literal:${language}:${normalized.join("_")}`,
        kind: "literal",
        language,
        tokens: [...normalized],
        assertionStatus: "not-asserted",
        status: "candidate",
      },
    ];

    for (const entry of this.entries()) {
      if (
        entry.language === language &&
        entry.tokens.length === normalized.length &&
        entry.tokens.every((token, index) => token === normalized[index])
      ) {
        candidates.push({
          id: `idiom:${entry.id}`,
          kind: "idiom",
          language,
          tokens: [...normalized],
          assertionStatus: "not-asserted",
          status: "candidate",
          semanticRef: entry.semanticRef,
          idiomId: entry.id,
        });
      }
    }

    return ok(candidates);
  }
}

export interface SemanticCoercionRule {
  id: string;
  sourceType: string;
  targetType: string;
  resultSemanticRef: SemanticId;
  requiredContextTags?: string[];
  description: string;
}

export interface SemanticCoercionInput {
  sourceRef: SemanticId;
  sourceType: string;
  targetType: string;
  contextTags?: readonly string[];
}

export interface SemanticCoercionCandidate {
  id: string;
  ruleId: string;
  sourceRef: SemanticId;
  sourceType: string;
  targetType: string;
  resultSemanticRef: SemanticId;
  status: "candidate";
  assertionStatus: "not-asserted";
}

export class SemanticCoercionRuleRegistry {
  readonly #rules = new Map<string, SemanticCoercionRule>();

  register(rule: SemanticCoercionRule): Result<void> {
    const tags = [...new Set(rule.requiredContextTags ?? [])].filter(nonEmpty);
    if (
      !nonEmpty(rule.id) ||
      !nonEmpty(rule.sourceType) ||
      !nonEmpty(rule.targetType) ||
      !nonEmpty(rule.resultSemanticRef) ||
      !nonEmpty(rule.description)
    ) {
      return err(
        new StructuredError(
          "PRAG_COERCION_SCHEMA",
          "Coercion rules require stable source/target types, semantic result, and description.",
        ),
      );
    }
    if (this.#rules.has(rule.id)) {
      return err(
        new StructuredError(
          "PRAG_COERCION_DUPLICATE",
          `Duplicate coercion rule id ${rule.id}.`,
        ),
      );
    }
    this.#rules.set(rule.id, {
      ...structuredClone(rule),
      ...(tags.length === 0 ? {} : { requiredContextTags: tags.sort() }),
    });
    return ok(undefined);
  }

  propose(input: SemanticCoercionInput): Result<SemanticCoercionCandidate[]> {
    if (
      !nonEmpty(input.sourceRef) ||
      !nonEmpty(input.sourceType) ||
      !nonEmpty(input.targetType)
    ) {
      return err(
        new StructuredError(
          "PRAG_COERCION_INPUT",
          "Coercion proposal requires source ref and explicit source/target types.",
        ),
      );
    }
    const contextTags = new Set(input.contextTags ?? []);

    const candidates = [...this.#rules.values()]
      .filter(
        (rule) =>
          rule.sourceType === input.sourceType &&
          rule.targetType === input.targetType &&
          (rule.requiredContextTags ?? []).every((tag) => contextTags.has(tag)),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((rule) => ({
        id: `coercion:${rule.id}:${input.sourceRef}`,
        ruleId: rule.id,
        sourceRef: input.sourceRef,
        sourceType: input.sourceType,
        targetType: input.targetType,
        resultSemanticRef: rule.resultSemanticRef,
        status: "candidate" as const,
        assertionStatus: "not-asserted" as const,
      }));

    return ok(candidates);
  }
}
