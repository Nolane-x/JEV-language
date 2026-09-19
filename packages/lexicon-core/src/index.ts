import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type { ConceptRef, RoleRef } from "../../ontology/src/index.ts";

export type LexemeId = SemanticId;
export type LanguageTag = string;
export type SenseId = string;

export type PartOfSpeech =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "pronoun"
  | "determiner"
  | "preposition"
  | "conjunction"
  | "particle"
  | "numeral"
  | "auxiliary"
  | "interjection"
  | "symbol"
  | `custom:${string}`;

export type RegisterTag =
  | "neutral"
  | "formal"
  | "informal"
  | "technical"
  | "literary"
  | "colloquial"
  | `custom:${string}`;

export interface SemanticConstraint {
  kind: string;
  value?: JsonValue;
}

export interface SelectionalPreference {
  role?: RoleRef;
  preferredConcepts: ConceptRef[];
  strength?: number;
}

export interface PragmaticEffect {
  kind: string;
  value?: JsonValue;
}

export type SyntacticFunction =
  | "subject"
  | "direct-object"
  | "indirect-object"
  | "prepositional-object"
  | "predicate-complement"
  | "oblique"
  | "modifier";

export interface ValencyRealization {
  function: SyntacticFunction;
  marker?: string;
  optional?: boolean;
}

export interface ValencySlot {
  id: string;
  role: RoleRef;
  alternatives: ValencyRealization[];
  required: boolean;
  expectedConcepts?: ConceptRef[];
}

export interface ValencyFrame {
  id: string;
  semanticPredicate?: ConceptRef;
  slots: ValencySlot[];
  voice?: string;
  constraints?: SemanticConstraint[];
}

export type LexicalSelector =
  | { kind: "lemma"; value: string }
  | { kind: "concept"; value: ConceptRef }
  | { kind: "part-of-speech"; value: PartOfSpeech };

export interface CollocationRule {
  id: string;
  relation: "prefers" | "allows" | "discourages" | "forbids";
  left: LexicalSelector;
  right: LexicalSelector;
  window?: number;
  domain?: ConceptRef;
  register?: RegisterTag;
  preference?: number;
}

export interface LexicalConstraint {
  kind: string;
  value?: JsonValue;
}

export interface LexicalSense {
  senseId: SenseId;
  concept: ConceptRef;
  semanticTag?: string;
  semanticConstraints?: SemanticConstraint[];
  selectionalPreferences?: SelectionalPreference[];
  pragmaticEffects?: PragmaticEffect[];
  valencyFrames?: ValencyFrame[];
  domains?: ConceptRef[];
  register?: RegisterTag;
  gloss?: string;
  examples?: string[];
  features?: Record<string, JsonValue>;
}

export interface Lexeme {
  id: LexemeId;
  language: LanguageTag;
  lemma: string;
  partOfSpeech: PartOfSpeech;
  senses: LexicalSense[];
  morphologyClass?: string;
  forms?: string[];
  irregularForms?: Record<string, string[]>;
  valencyFrames?: ValencyFrame[];
  register?: RegisterTag[];
  domains?: ConceptRef[];
  frequencyBand?: number;
  collocations?: CollocationRule[];
  constraints?: LexicalConstraint[];
  features?: Record<string, JsonValue>;
}

export type MultiwordComponent =
  | { kind: "fixed"; surface: string }
  | {
      kind: "slot";
      id: string;
      allowedPartOfSpeech?: PartOfSpeech[];
      optional?: boolean;
    };

export interface MultiwordExpression {
  id: LexemeId;
  language: LanguageTag;
  components: MultiwordComponent[];
  syntacticCategory: PartOfSpeech | `construction:${string}`;
  semanticMapping: {
    concept: ConceptRef;
    senseId: SenseId;
  };
  register?: RegisterTag[];
  domains?: ConceptRef[];
  constraints?: LexicalConstraint[];
}

export interface LexicalMatch {
  lexemeId: LexemeId;
  senseId: SenseId;
  language: LanguageTag;
  lemma: string;
  partOfSpeech: PartOfSpeech;
  surface: string;
  concept: ConceptRef;
  semanticTag?: string;
  frequencyBand?: number;
}

export interface MultiwordMatch {
  expressionId: LexemeId;
  language: LanguageTag;
  start: number;
  end: number;
  semanticMapping: MultiwordExpression["semanticMapping"];
  slots: Record<string, string>;
}

export interface UnknownLexicalItem {
  kind: "unknown-lexical-item";
  language?: LanguageTag;
  surface: string;
  normalized: string;
  caseFolded: string;
  preservedExact: true;
  partOfSpeechCandidates: PartOfSpeech[];
  confidence?: number;
}

export type LexicalLookup =
  | { kind: "known"; matches: LexicalMatch[] }
  | { kind: "unknown"; item: UnknownLexicalItem };

export const normalizeLexicalSurface = (value: string): string =>
  value.normalize("NFC");

export const caseFoldLexicalSurface = (
  value: string,
  language?: string,
): string => {
  const normalized = normalizeLexicalSurface(value);
  if (language === undefined) return normalized.toLowerCase();
  try {
    return normalized.toLocaleLowerCase(language);
  } catch {
    return normalized.toLowerCase();
  }
};

const lexicalKey = (language: string, surface: string): string =>
  `${language}\u0000${caseFoldLexicalSurface(surface, language)}`;

const scoreInUnitInterval = (
  value: number | undefined,
  field: string,
): Result<void> => {
  if (value === undefined) return ok(undefined);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return err(
      new StructuredError(
        "LEXICON_INVALID_SCORE",
        `${field} must be finite and within [0, 1].`,
      ),
    );
  }
  return ok(undefined);
};

const validateFrame = (frame: ValencyFrame): Result<void> => {
  if (frame.id.trim().length === 0) {
    return err(
      new StructuredError(
        "LEXICON_VALENCY_FRAME_ID",
        "Valency frame id must not be empty.",
      ),
    );
  }
  const slotIds = new Set<string>();
  const roles = new Set<RoleRef>();
  for (const slot of frame.slots) {
    if (
      slot.id.trim().length === 0 ||
      slotIds.has(slot.id) ||
      roles.has(slot.role) ||
      slot.alternatives.length === 0
    ) {
      return err(
        new StructuredError(
          "LEXICON_VALENCY_SLOT",
          "Valency slots require unique ids/roles and at least one syntactic realization.",
        ),
      );
    }
    slotIds.add(slot.id);
    roles.add(slot.role);
  }
  return ok(undefined);
};

const validateCollocation = (rule: CollocationRule): Result<void> => {
  if (rule.id.trim().length === 0) {
    return err(
      new StructuredError(
        "LEXICON_COLLOCATION_ID",
        "Collocation id must not be empty.",
      ),
    );
  }
  if (
    rule.window !== undefined &&
    (!Number.isInteger(rule.window) || rule.window < 1)
  ) {
    return err(
      new StructuredError(
        "LEXICON_COLLOCATION_WINDOW",
        "Collocation window must be a positive integer when supplied.",
      ),
    );
  }
  const preference = scoreInUnitInterval(
    rule.preference,
    "collocation preference",
  );
  if (!preference.ok) return preference;
  return ok(undefined);
};

export const validateLexeme = (lexeme: Lexeme): Result<Lexeme> => {
  if (
    lexeme.id.trim().length === 0 ||
    lexeme.language.trim().length === 0 ||
    lexeme.lemma.trim().length === 0
  ) {
    return err(
      new StructuredError(
        "LEXICON_LEXEME_REQUIRED",
        "Lexeme id, language, and lemma are required.",
      ),
    );
  }
  if (lexeme.senses.length === 0) {
    return err(
      new StructuredError(
        "LEXICON_NO_SENSES",
        `Lexeme ${lexeme.id} requires at least one semantic sense.`,
      ),
    );
  }

  const senseIds = new Set<string>();
  for (const sense of lexeme.senses) {
    if (
      sense.senseId.trim().length === 0 ||
      senseIds.has(sense.senseId)
    ) {
      return err(
        new StructuredError(
          "LEXICON_INVALID_SENSE_ID",
          `Lexeme ${lexeme.id} contains an empty or duplicate sense id.`,
        ),
      );
    }
    senseIds.add(sense.senseId);
    for (const preference of sense.selectionalPreferences ?? []) {
      const valid = scoreInUnitInterval(
        preference.strength,
        "selectional preference strength",
      );
      if (!valid.ok) return valid;
    }
    for (const frame of sense.valencyFrames ?? []) {
      const valid = validateFrame(frame);
      if (!valid.ok) return valid;
    }
  }

  for (const frame of lexeme.valencyFrames ?? []) {
    const valid = validateFrame(frame);
    if (!valid.ok) return valid;
  }
  for (const rule of lexeme.collocations ?? []) {
    const valid = validateCollocation(rule);
    if (!valid.ok) return valid;
  }
  const frequency = scoreInUnitInterval(lexeme.frequencyBand, "frequencyBand");
  if (!frequency.ok) return frequency;

  return ok(structuredClone(lexeme));
};

export const validateMultiwordExpression = (
  expression: MultiwordExpression,
): Result<MultiwordExpression> => {
  if (
    expression.id.trim().length === 0 ||
    expression.language.trim().length === 0 ||
    expression.components.length < 2
  ) {
    return err(
      new StructuredError(
        "LEXICON_MWE_REQUIRED",
        "Multiword expressions require id, language, and at least two components.",
      ),
    );
  }

  const slots = new Set<string>();
  let fixedComponents = 0;
  for (const component of expression.components) {
    if (component.kind === "fixed") {
      if (component.surface.trim().length === 0) {
        return err(
          new StructuredError(
            "LEXICON_MWE_FIXED",
            "Fixed multiword components cannot be empty.",
          ),
        );
      }
      fixedComponents += 1;
      continue;
    }
    if (component.id.trim().length === 0 || slots.has(component.id)) {
      return err(
        new StructuredError(
          "LEXICON_MWE_SLOT",
          "Multiword slot ids must be non-empty and unique.",
        ),
      );
    }
    slots.add(component.id);
  }
  if (fixedComponents === 0) {
    return err(
      new StructuredError(
        "LEXICON_MWE_FIXED",
        "A multiword expression requires at least one fixed component.",
      ),
    );
  }
  return ok(structuredClone(expression));
};

export class LanguageNeutralLexiconIndex {
  readonly #lexemes = new Map<LexemeId, Lexeme>();
  readonly #surfaceIndex = new Map<string, Set<LexemeId>>();
  readonly #conceptIndex = new Map<ConceptRef, Set<LexemeId>>();
  readonly #mwes = new Map<LexemeId, MultiwordExpression>();
  readonly #collocations = new Map<string, CollocationRule>();

  registerLexeme(input: Lexeme): Result<void> {
    const valid = validateLexeme(input);
    if (!valid.ok) return valid;
    if (this.#lexemes.has(input.id) || this.#mwes.has(input.id)) {
      return err(
        new StructuredError(
          "LEXICON_DUPLICATE_ID",
          `Lexical id already exists: ${input.id}.`,
        ),
      );
    }

    const lexeme = valid.value;
    this.#lexemes.set(lexeme.id, lexeme);
    for (const surface of new Set([lexeme.lemma, ...(lexeme.forms ?? [])])) {
      const key = lexicalKey(lexeme.language, surface);
      const bucket = this.#surfaceIndex.get(key) ?? new Set<LexemeId>();
      bucket.add(lexeme.id);
      this.#surfaceIndex.set(key, bucket);
    }
    for (const sense of lexeme.senses) {
      const bucket = this.#conceptIndex.get(sense.concept) ?? new Set<LexemeId>();
      bucket.add(lexeme.id);
      this.#conceptIndex.set(sense.concept, bucket);
    }
    for (const rule of lexeme.collocations ?? []) {
      const registered = this.registerCollocation(rule);
      if (!registered.ok) {
        this.#lexemes.delete(lexeme.id);
        return registered;
      }
    }
    return ok(undefined);
  }

  registerMultiword(input: MultiwordExpression): Result<void> {
    const valid = validateMultiwordExpression(input);
    if (!valid.ok) return valid;
    if (this.#lexemes.has(input.id) || this.#mwes.has(input.id)) {
      return err(
        new StructuredError(
          "LEXICON_DUPLICATE_ID",
          `Lexical id already exists: ${input.id}.`,
        ),
      );
    }
    this.#mwes.set(input.id, valid.value);
    return ok(undefined);
  }

  registerCollocation(rule: CollocationRule): Result<void> {
    const valid = validateCollocation(rule);
    if (!valid.ok) return valid;
    if (this.#collocations.has(rule.id)) {
      return err(
        new StructuredError(
          "LEXICON_DUPLICATE_COLLOCATION",
          `Collocation already exists: ${rule.id}.`,
        ),
      );
    }
    this.#collocations.set(rule.id, structuredClone(rule));
    return ok(undefined);
  }

  getLexeme(id: LexemeId): Lexeme | undefined {
    const value = this.#lexemes.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  getMultiword(id: LexemeId): MultiwordExpression | undefined {
    const value = this.#mwes.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  allLexemes(language?: string): Lexeme[] {
    return [...this.#lexemes.values()]
      .filter((lexeme) => language === undefined || lexeme.language === language)
      .map((lexeme) => structuredClone(lexeme))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  lookupSurface(surface: string, language: string): LexicalMatch[] {
    const ids = this.#surfaceIndex.get(lexicalKey(language, surface));
    if (ids === undefined) return [];
    const output: LexicalMatch[] = [];
    for (const id of ids) {
      const lexeme = this.#lexemes.get(id);
      if (lexeme === undefined) continue;
      for (const sense of lexeme.senses) {
        output.push({
          lexemeId: lexeme.id,
          senseId: sense.senseId,
          language: lexeme.language,
          lemma: lexeme.lemma,
          partOfSpeech: lexeme.partOfSpeech,
          surface,
          concept: sense.concept,
          ...(sense.semanticTag === undefined
            ? {}
            : { semanticTag: sense.semanticTag }),
          ...(lexeme.frequencyBand === undefined
            ? {}
            : { frequencyBand: lexeme.frequencyBand }),
        });
      }
    }
    return output.sort(
      (a, b) =>
        (b.frequencyBand ?? 0) - (a.frequencyBand ?? 0) ||
        a.senseId.localeCompare(b.senseId),
    );
  }

  lookupConcept(concept: ConceptRef, language?: string): Lexeme[] {
    const ids = this.#conceptIndex.get(concept);
    if (ids === undefined) return [];
    return [...ids]
      .map((id) => this.#lexemes.get(id))
      .filter((value): value is Lexeme => value !== undefined)
      .filter((value) => language === undefined || value.language === language)
      .map((value) => structuredClone(value))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  lookupOrPreserve(
    surface: string,
    input: {
      language?: string;
      partOfSpeechCandidates?: PartOfSpeech[];
      confidence?: number;
    } = {},
  ): LexicalLookup {
    if (input.language !== undefined) {
      const matches = this.lookupSurface(surface, input.language);
      if (matches.length > 0) return { kind: "known", matches };
    }
    return {
      kind: "unknown",
      item: preserveUnknownLexicalItem(surface, input.language, {
        partOfSpeechCandidates: input.partOfSpeechCandidates,
        confidence: input.confidence,
      }),
    };
  }

  matchMultiword(
    tokens: readonly string[],
    language: string,
    startAt?: number,
  ): MultiwordMatch[] {
    const output: MultiwordMatch[] = [];
    const starts =
      startAt === undefined
        ? [...tokens.keys()]
        : startAt >= 0 && startAt < tokens.length
          ? [startAt]
          : [];

    for (const expression of this.#mwes.values()) {
      if (expression.language !== language) continue;
      for (const start of starts) {
        const slots: Record<string, string> = {};
        let cursor = start;
        let matched = true;
        for (const component of expression.components) {
          const token = tokens[cursor];
          if (component.kind === "fixed") {
            if (
              token === undefined ||
              caseFoldLexicalSurface(token, language) !==
                caseFoldLexicalSurface(component.surface, language)
            ) {
              matched = false;
              break;
            }
            cursor += 1;
            continue;
          }

          if (token === undefined) {
            if (component.optional === true) continue;
            matched = false;
            break;
          }
          slots[component.id] = token;
          cursor += 1;
        }

        if (matched && cursor > start) {
          output.push({
            expressionId: expression.id,
            language,
            start,
            end: cursor,
            semanticMapping: structuredClone(expression.semanticMapping),
            slots,
          });
        }
      }
    }

    return output.sort(
      (a, b) =>
        a.start - b.start ||
        b.end - b.start - (a.end - a.start) ||
        a.expressionId.localeCompare(b.expressionId),
    );
  }

  collocations(): CollocationRule[] {
    return [...this.#collocations.values()]
      .map((rule) => structuredClone(rule))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  size(): {
    lexemes: number;
    senses: number;
    multiwords: number;
    collocations: number;
  } {
    let senses = 0;
    for (const lexeme of this.#lexemes.values()) senses += lexeme.senses.length;
    return {
      lexemes: this.#lexemes.size,
      senses,
      multiwords: this.#mwes.size,
      collocations: this.#collocations.size,
    };
  }
}

export const preserveUnknownLexicalItem = (
  surface: string,
  language?: string,
  input: {
    partOfSpeechCandidates?: PartOfSpeech[];
    confidence?: number;
  } = {},
): UnknownLexicalItem => ({
  kind: "unknown-lexical-item",
  ...(language === undefined ? {} : { language }),
  surface,
  normalized: normalizeLexicalSurface(surface),
  caseFolded: caseFoldLexicalSurface(surface, language),
  preservedExact: true,
  partOfSpeechCandidates: [...(input.partOfSpeechCandidates ?? [])],
  ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
});
