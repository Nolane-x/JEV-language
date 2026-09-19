import type { SelectionalPreference } from "./open-vocabulary.ts";
import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type { ConceptRef, RoleRef } from "../../ontology/src/index.ts";

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
  | "other";

export interface ValencySlot {
  id: string;
  role?: RoleRef;
  syntacticFunctions: string[];
  required: boolean;
  expectedConcepts?: ConceptRef[];
  selectionalPreference?: SelectionalPreference;
  prepositions?: string[];
}

export interface ValencyFrame {
  id: string;
  slots: ValencySlot[];
  voice?: string;
  notes?: string[];
}

export interface CollocationRule {
  id: string;
  relation:
    | "prefers"
    | "allows"
    | "discourages"
    | "forbids";
  left: string;
  right: string;
  window?: number;
  domain?: string;
  register?: string;
}

export interface LexicalSense {
  id: string;
  concept?: ConceptRef;
  semanticTag?: string;
  gloss?: string;
  valencyFrames?: ValencyFrame[];
  domains?: string[];
  register?: string;
  features?: Record<string, JsonValue>;
}

export interface Lexeme {
  id: string;
  language: string;
  lemma: string;
  partOfSpeech: PartOfSpeech;
  senses: LexicalSense[];
  forms?: string[];
  irregularForms?: Record<string, string[]>;
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
  id: string;
  language: string;
  components: MultiwordComponent[];
  syntacticCategory: string;
  semanticMapping: string;
  register?: string;
  domains?: string[];
}

export interface LexicalMatch {
  lexemeId: string;
  senseId: string;
  language: string;
  lemma: string;
  partOfSpeech: PartOfSpeech;
  surface: string;
  concept?: ConceptRef;
  semanticTag?: string;
}

export interface MultiwordMatch {
  expressionId: string;
  language: string;
  start: number;
  end: number;
  semanticMapping: string;
  slots: Record<string, string>;
}

export interface UnknownLexicalItem {
  kind: "unknown-lexical-item";
  language?: string;
  surface: string;
  preservedExact: true;
}

const normalizeKey = (value: string): string =>
  value.normalize("NFC").toLocaleLowerCase();

const lexicalKey = (language: string, surface: string): string =>
  `${language}\u0000${normalizeKey(surface)}`;

const validateSense = (sense: LexicalSense): Result<void> => {
  if (sense.id.trim() === "") {
    return err(
      new StructuredError(
        "LEXICON_SENSE_ID",
        "Lexical sense id must not be empty.",
      ),
    );
  }
  if (sense.concept === undefined && sense.semanticTag === undefined) {
    return err(
      new StructuredError(
        "LEXICON_SENSE_SEMANTICS",
        `Lexical sense ${sense.id} requires a concept or semanticTag.`,
      ),
    );
  }
  for (const frame of sense.valencyFrames ?? []) {
    const ids = new Set<string>();
    for (const slot of frame.slots) {
      if (slot.id.trim() === "" || ids.has(slot.id)) {
        return err(
          new StructuredError(
            "LEXICON_VALENCY_SLOT",
            `Valency frame ${frame.id} contains an empty or duplicate slot id.`,
          ),
        );
      }
      ids.add(slot.id);
      if (slot.syntacticFunctions.length === 0) {
        return err(
          new StructuredError(
            "LEXICON_VALENCY_FUNCTION",
            `Valency slot ${slot.id} requires at least one syntactic function.`,
          ),
        );
      }
    }
  }
  return ok(undefined);
};

export const validateLexeme = (lexeme: Lexeme): Result<Lexeme> => {
  if (
    lexeme.id.trim() === "" ||
    lexeme.language.trim() === "" ||
    lexeme.lemma.trim() === ""
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
        `Lexeme ${lexeme.id} requires at least one lexical sense.`,
      ),
    );
  }
  const seen = new Set<string>();
  for (const sense of lexeme.senses) {
    if (seen.has(sense.id)) {
      return err(
        new StructuredError(
          "LEXICON_DUPLICATE_SENSE",
          `Duplicate lexical sense id: ${sense.id}.`,
        ),
      );
    }
    seen.add(sense.id);
    const valid = validateSense(sense);
    if (!valid.ok) return valid;
  }
  return ok(structuredClone(lexeme));
};

export const validateMultiwordExpression = (
  expression: MultiwordExpression,
): Result<MultiwordExpression> => {
  if (
    expression.id.trim() === "" ||
    expression.language.trim() === "" ||
    expression.syntacticCategory.trim() === "" ||
    expression.semanticMapping.trim() === "" ||
    expression.components.length === 0
  ) {
    return err(
      new StructuredError(
        "LEXICON_MWE_REQUIRED",
        "Multiword expressions require id, language, components, category, and semantic mapping.",
      ),
    );
  }
  const slots = new Set<string>();
  for (const component of expression.components) {
    if (component.kind === "fixed" && component.surface.length === 0) {
      return err(
        new StructuredError(
          "LEXICON_MWE_FIXED",
          `Multiword expression ${expression.id} contains an empty fixed component.`,
        ),
      );
    }
    if (component.kind === "slot") {
      if (component.id.trim() === "" || slots.has(component.id)) {
        return err(
          new StructuredError(
            "LEXICON_MWE_SLOT",
            `Multiword expression ${expression.id} contains an empty or duplicate slot.`,
          ),
        );
      }
      slots.add(component.id);
    }
  }
  return ok(structuredClone(expression));
};

export class LanguageNeutralLexiconIndex {
  readonly #lexemes = new Map<string, Lexeme>();
  readonly #surfaceIndex = new Map<string, Set<string>>();
  readonly #conceptIndex = new Map<ConceptRef, Set<string>>();
  readonly #mwes = new Map<string, MultiwordExpression>();
  readonly #collocations = new Map<string, CollocationRule>();

  registerLexeme(lexeme: Lexeme): Result<void> {
    const valid = validateLexeme(lexeme);
    if (!valid.ok) return valid;
    if (this.#lexemes.has(lexeme.id)) {
      return err(
        new StructuredError(
          "LEXICON_DUPLICATE_LEXEME",
          `Lexeme already registered: ${lexeme.id}.`,
        ),
      );
    }

    const stored = structuredClone(lexeme);
    this.#lexemes.set(stored.id, stored);
    for (const surface of new Set([stored.lemma, ...(stored.forms ?? [])])) {
      const key = lexicalKey(stored.language, surface);
      const bucket = this.#surfaceIndex.get(key) ?? new Set<string>();
      bucket.add(stored.id);
      this.#surfaceIndex.set(key, bucket);
    }
    for (const sense of stored.senses) {
      if (sense.concept === undefined) continue;
      const bucket = this.#conceptIndex.get(sense.concept) ?? new Set<string>();
      bucket.add(stored.id);
      this.#conceptIndex.set(sense.concept, bucket);
    }
    return ok(undefined);
  }

  registerMultiword(expression: MultiwordExpression): Result<void> {
    const valid = validateMultiwordExpression(expression);
    if (!valid.ok) return valid;
    if (this.#mwes.has(expression.id)) {
      return err(
        new StructuredError(
          "LEXICON_DUPLICATE_MWE",
          `Multiword expression already registered: ${expression.id}.`,
        ),
      );
    }
    this.#mwes.set(expression.id, structuredClone(expression));
    return ok(undefined);
  }

  registerCollocation(rule: CollocationRule): Result<void> {
    if (
      rule.id.trim() === "" ||
      rule.left.trim() === "" ||
      rule.right.trim() === ""
    ) {
      return err(
        new StructuredError(
          "LEXICON_COLLOCATION_REQUIRED",
          "Collocation rules require id, left, and right selectors.",
        ),
      );
    }
    if (this.#collocations.has(rule.id)) {
      return err(
        new StructuredError(
          "LEXICON_DUPLICATE_COLLOCATION",
          `Collocation rule already registered: ${rule.id}.`,
        ),
      );
    }
    this.#collocations.set(rule.id, structuredClone(rule));
    return ok(undefined);
  }

  getLexeme(id: string): Lexeme | undefined {
    const value = this.#lexemes.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  lookupSurface(surface: string, language: string): LexicalMatch[] {
    const ids = this.#surfaceIndex.get(lexicalKey(language, surface));
    if (ids === undefined) return [];
    const output: LexicalMatch[] = [];
    for (const id of [...ids].sort()) {
      const lexeme = this.#lexemes.get(id);
      if (lexeme === undefined) continue;
      for (const sense of lexeme.senses) {
        output.push({
          lexemeId: lexeme.id,
          senseId: sense.id,
          language: lexeme.language,
          lemma: lexeme.lemma,
          partOfSpeech: lexeme.partOfSpeech,
          surface,
          ...(sense.concept === undefined ? {} : { concept: sense.concept }),
          ...(sense.semanticTag === undefined
            ? {}
            : { semanticTag: sense.semanticTag }),
        });
      }
    }
    return output;
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

  matchMultiword(tokens: readonly string[], language: string): MultiwordMatch[] {
    const output: MultiwordMatch[] = [];
    for (const expression of this.#mwes.values()) {
      if (expression.language !== language) continue;
      for (let start = 0; start < tokens.length; start += 1) {
        const slots: Record<string, string> = {};
        let cursor = start;
        let matched = true;
        for (const component of expression.components) {
          const token = tokens[cursor];
          if (component.kind === "fixed") {
            if (
              token === undefined ||
              normalizeKey(token) !== normalizeKey(component.surface)
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
            semanticMapping: expression.semanticMapping,
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
      .map((value) => structuredClone(value))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  size(): { lexemes: number; senses: number; multiwords: number; collocations: number } {
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
): UnknownLexicalItem => ({
  kind: "unknown-lexical-item",
  surface,
  preservedExact: true,
  ...(language === undefined ? {} : { language }),
});

export * from "./open-vocabulary.ts";
