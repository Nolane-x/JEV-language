import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";

export type PresuppositionTriggerKind =
  | "definite-description"
  | "change-of-state"
  | "factive-predicate"
  | "iterative"
  | "cleft"
  | "possessive"
  | "temporal-clause";

export type PresuppositionEffect =
  | "existence"
  | "prior-state"
  | "embedded-truth"
  | "repeat-event"
  | "focus-background"
  | "possession"
  | "temporal-background";

export interface PresuppositionTriggerDefinition {
  id: string;
  language: string;
  version: string;
  kind: PresuppositionTriggerKind;
  effect: PresuppositionEffect;
  tokenSequences?: string[][];
  grammarRuleIds?: string[];
  enabled?: boolean;
}

export interface PresuppositionTriggerMatch {
  triggerId: string;
  kind: PresuppositionTriggerKind;
  effect: PresuppositionEffect;
  matchedBy: "token-sequence" | "grammar-rule";
}

const normalizedTokens = (tokens: readonly string[]): string[] =>
  tokens.map((token) => token.normalize("NFKC").toLocaleLowerCase());

const sameSequence = (
  source: readonly string[],
  candidate: readonly string[],
): boolean =>
  source.length === candidate.length &&
  source.every((token, index) => token === candidate[index]);

export class PresuppositionTriggerRegistry {
  readonly #triggers = new Map<string, PresuppositionTriggerDefinition>();

  constructor(
    readonly language: string,
    readonly version: string,
  ) {
    if (language.trim() === "" || version.trim() === "") {
      throw new StructuredError(
        "LANG_PRESUPPOSITION_REGISTRY_ID",
        "Presupposition trigger registry requires language and version.",
      );
    }
  }

  register(trigger: PresuppositionTriggerDefinition): Result<void> {
    if (
      trigger.id.trim() === "" ||
      trigger.language !== this.language ||
      trigger.version !== this.version ||
      ((trigger.tokenSequences?.length ?? 0) === 0 &&
        (trigger.grammarRuleIds?.length ?? 0) === 0)
    ) {
      return err(
        new StructuredError(
          "LANG_PRESUPPOSITION_TRIGGER_INVALID",
          "Trigger id/language/version must match the registry and declare a token sequence or grammar rule.",
        ),
      );
    }
    if (this.#triggers.has(trigger.id)) {
      return err(
        new StructuredError(
          "LANG_PRESUPPOSITION_TRIGGER_DUPLICATE",
          `Presupposition trigger already exists: ${trigger.id}`,
        ),
      );
    }
    this.#triggers.set(trigger.id, structuredClone(trigger));
    return ok(undefined);
  }

  list(): PresuppositionTriggerDefinition[] {
    return [...this.#triggers.values()]
      .map((trigger) => structuredClone(trigger))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  match(input: {
    tokens?: readonly string[];
    grammarRuleIds?: readonly string[];
  }): PresuppositionTriggerMatch[] {
    const tokens =
      input.tokens === undefined ? undefined : normalizedTokens(input.tokens);
    const rules = new Set(input.grammarRuleIds ?? []);
    const matches: PresuppositionTriggerMatch[] = [];

    for (const trigger of this.list()) {
      if (trigger.enabled === false) continue;
      if (
        tokens !== undefined &&
        (trigger.tokenSequences ?? []).some((sequence) =>
          sameSequence(tokens, normalizedTokens(sequence)),
        )
      ) {
        matches.push({
          triggerId: trigger.id,
          kind: trigger.kind,
          effect: trigger.effect,
          matchedBy: "token-sequence",
        });
      }
      if (
        (trigger.grammarRuleIds ?? []).some((rule) => rules.has(rule))
      ) {
        matches.push({
          triggerId: trigger.id,
          kind: trigger.kind,
          effect: trigger.effect,
          matchedBy: "grammar-rule",
        });
      }
    }

    return matches.sort(
      (a, b) =>
        a.triggerId.localeCompare(b.triggerId) ||
        a.matchedBy.localeCompare(b.matchedBy),
    );
  }
}

export interface MultiwordEntry {
  id: string;
  language: string;
  version: string;
  tokens: string[];
  idiomaticSemanticRef: SemanticId;
}

export interface MultiwordReadingCandidate {
  reading: "idiomatic" | "literal";
  semanticRef: SemanticId;
  entryId?: string;
  requiresDisambiguation: boolean;
}

export class MultiwordCandidateRegistry {
  readonly #entries = new Map<string, MultiwordEntry>();

  constructor(
    readonly language: string,
    readonly version: string,
  ) {
    if (language.trim() === "" || version.trim() === "") {
      throw new StructuredError(
        "LANG_MULTIWORD_REGISTRY_ID",
        "Multiword registry requires language and version.",
      );
    }
  }

  register(entry: MultiwordEntry): Result<void> {
    if (
      entry.id.trim() === "" ||
      entry.language !== this.language ||
      entry.version !== this.version ||
      entry.tokens.length === 0 ||
      entry.tokens.some((token) => token.trim() === "")
    ) {
      return err(
        new StructuredError(
          "LANG_MULTIWORD_ENTRY_INVALID",
          "Multiword entry must match registry language/version and contain non-empty tokens.",
        ),
      );
    }
    if (this.#entries.has(entry.id)) {
      return err(
        new StructuredError(
          "LANG_MULTIWORD_ENTRY_DUPLICATE",
          `Multiword entry already exists: ${entry.id}`,
        ),
      );
    }
    this.#entries.set(entry.id, structuredClone(entry));
    return ok(undefined);
  }

  candidates(
    tokens: readonly string[],
    literalSemanticRef: SemanticId,
  ): MultiwordReadingCandidate[] {
    const normalized = normalizedTokens(tokens);
    const idiomatic = [...this.#entries.values()]
      .filter((entry) =>
        sameSequence(normalized, normalizedTokens(entry.tokens)),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(
        (entry): MultiwordReadingCandidate => ({
          reading: "idiomatic",
          semanticRef: entry.idiomaticSemanticRef,
          entryId: entry.id,
          requiresDisambiguation: true,
        }),
      );

    return [
      ...idiomatic,
      {
        reading: "literal",
        semanticRef: literalSemanticRef,
        requiresDisambiguation: idiomatic.length > 0,
      },
    ];
  }
}

export interface LanguagePragmaticsProvider {
  readonly id: string;
  readonly language: string;
  readonly version: string;
  readonly presuppositionTriggers: PresuppositionTriggerRegistry;
  readonly multiwordCandidates?: MultiwordCandidateRegistry;
}
