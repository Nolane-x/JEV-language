import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  ConceptRef,
  RoleRef,
} from "../../ontology/src/index.ts";

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

export interface LexicalSense {
  concept: ConceptRef;
  senseId: SenseId;
  semanticConstraints?: SemanticConstraint[];
  selectionalPreferences?: SelectionalPreference[];
  pragmaticEffects?: PragmaticEffect[];
  examples?: string[];
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
  role: RoleRef;
  alternatives: ValencyRealization[];
  required?: boolean;
}

export interface ValencyFrame {
  id: string;
  semanticPredicate?: ConceptRef;
  slots: ValencySlot[];
  constraints?: SemanticConstraint[];
}

export interface CollocationRule {
  id: string;
  relation:
    | "precedes"
    | "follows"
    | "adjacent"
    | "within-window"
    | "construction";
  partnerLemma?: string;
  partnerPartOfSpeech?: PartOfSpeech;
  window?: number;
  preference: number;
  hard?: boolean;
}

export interface LexicalConstraint {
  kind: string;
  value?: JsonValue;
}

export interface Lexeme {
  id: LexemeId;
  language: LanguageTag;
  lemma: string;
  partOfSpeech: PartOfSpeech;
  senses: LexicalSense[];
  morphologyClass?: string;
  valencyFrames?: ValencyFrame[];
  register?: RegisterTag[];
  domains?: ConceptRef[];
  frequencyBand?: number;
  collocations?: CollocationRule[];
  constraints?: LexicalConstraint[];
}

export type MultiwordComponent =
  | { kind: "fixed"; surface: string }
  | {
      kind: "slot";
      name: string;
      partOfSpeech?: PartOfSpeech;
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

export interface LexicalCandidate {
  lexeme: Lexeme;
  sense: LexicalSense;
  match: "lemma" | "surface";
}

export interface OpaqueLexicalItem {
  kind: "unknown-lexeme";
  surface: string;
  normalized: string;
  caseFolded: string;
  language?: LanguageTag;
  partOfSpeechCandidates: PartOfSpeech[];
  confidence?: number;
}

export type LexicalLookup =
  | { kind: "known"; candidates: LexicalCandidate[] }
  | { kind: "unknown"; item: OpaqueLexicalItem };

export interface MultiwordMatch {
  expression: MultiwordExpression;
  start: number;
  end: number;
  slots: Record<string, string[]>;
}

export const normalizeLexicalSurface = (surface: string): string =>
  surface.normalize("NFC");

export const caseFoldLexicalSurface = (
  surface: string,
  language?: string,
): string => {
  const normalized = normalizeLexicalSurface(surface);
  if (language === undefined) return normalized.toLowerCase();
  try {
    return normalized.toLocaleLowerCase(language);
  } catch {
    return normalized.toLowerCase();
  }
};

const surfaceKey = (language: string, surface: string): string =>
  `${language}\u0000${caseFoldLexicalSurface(surface, language)}`;

const validateProbabilityLike = (
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

export const validateLexeme = (lexeme: Lexeme): Result<Lexeme> => {
  if (lexeme.lemma.trim().length === 0 || lexeme.language.trim().length === 0) {
    return err(
      new StructuredError(
        "LEXICON_EMPTY_IDENTITY",
        "Lexeme lemma and language are required.",
      ),
    );
  }
  if (lexeme.senses.length === 0) {
    return err(
      new StructuredError(
        "LEXICON_NO_SENSES",
        "A lexeme must expose at least one semantic sense.",
      ),
    );
  }
  const senseIds = new Set<string>();
  for (const sense of lexeme.senses) {
    if (sense.senseId.trim().length === 0 || senseIds.has(sense.senseId)) {
      return err(
        new StructuredError(
          "LEXICON_INVALID_SENSE_ID",
          `Lexeme has an empty or duplicate senseId: ${sense.senseId}.`,
        ),
      );
    }
    senseIds.add(sense.senseId);
    for (const preference of sense.selectionalPreferences ?? []) {
      const score = validateProbabilityLike(
        preference.strength,
        "selectional preference strength",
      );
      if (!score.ok) return score;
    }
  }
  const frequency = validateProbabilityLike(lexeme.frequencyBand, "frequencyBand");
  if (!frequency.ok) return frequency;
  for (const frame of lexeme.valencyFrames ?? []) {
    if (frame.id.trim().length === 0) {
      return err(
        new StructuredError(
          "LEXICON_INVALID_VALENCY",
          "Valency frame id cannot be empty.",
        ),
      );
    }
    const roles = new Set<string>();
    for (const slot of frame.slots) {
      if (roles.has(slot.role) || slot.alternatives.length === 0) {
        return err(
          new StructuredError(
            "LEXICON_INVALID_VALENCY",
            "Valency roles must be unique per frame and expose at least one syntactic realization.",
          ),
        );
      }
      roles.add(slot.role);
    }
  }
  for (const rule of lexeme.collocations ?? []) {
    if (!Number.isFinite(rule.preference)) {
      return err(
        new StructuredError(
          "LEXICON_INVALID_COLLOCATION",
          "Collocation preference must be finite.",
        ),
      );
    }
    if (
      rule.relation === "within-window" &&
      (rule.window === undefined || !Number.isInteger(rule.window) || rule.window < 1)
    ) {
      return err(
        new StructuredError(
          "LEXICON_INVALID_COLLOCATION",
          "within-window collocations require a positive integer window.",
        ),
      );
    }
  }
  return ok(structuredClone(lexeme));
};

export const validateMultiwordExpression = (
  expression: MultiwordExpression,
): Result<MultiwordExpression> => {
  if (
    expression.language.trim().length === 0 ||
    expression.components.length < 2
  ) {
    return err(
      new StructuredError(
        "LEXICON_INVALID_MWE",
        "A multiword expression requires a language and at least two components.",
      ),
    );
  }
  const slots = new Set<string>();
  let fixedCount = 0;
  for (const component of expression.components) {
    if (component.kind === "fixed") {
      if (component.surface.trim().length === 0) {
        return err(
          new StructuredError(
            "LEXICON_INVALID_MWE",
            "Fixed MWE components cannot be empty.",
          ),
        );
      }
      fixedCount += 1;
    } else {
      if (component.name.trim().length === 0 || slots.has(component.name)) {
        return err(
          new StructuredError(
            "LEXICON_INVALID_MWE",
            "MWE slot names must be non-empty and unique.",
          ),
        );
      }
      slots.add(component.name);
    }
  }
  if (fixedCount === 0) {
    return err(
      new StructuredError(
        "LEXICON_INVALID_MWE",
        "An MWE requires at least one fixed lexical component.",
      ),
    );
  }
  return ok(structuredClone(expression));
};

export class LexiconIndex {
  readonly #lexemes = new Map<LexemeId, Lexeme>();
  readonly #surface = new Map<string, Set<LexemeId>>();
  readonly #concepts = new Map<ConceptRef, Set<LexemeId>>();
  readonly #mwes = new Map<LexemeId, MultiwordExpression>();

  addLexeme(input: Lexeme): Result<void> {
    const validated = validateLexeme(input);
    if (!validated.ok) return validated;
    if (this.#lexemes.has(input.id) || this.#mwes.has(input.id)) {
      return err(
        new StructuredError(
          "LEXICON_DUPLICATE_ID",
          `Lexical id already exists: ${input.id}.`,
        ),
      );
    }

    const lexeme = validated.value;
    this.#lexemes.set(lexeme.id, lexeme);
    const key = surfaceKey(lexeme.language, lexeme.lemma);
    const bucket = this.#surface.get(key) ?? new Set<LexemeId>();
    bucket.add(lexeme.id);
    this.#surface.set(key, bucket);

    for (const sense of lexeme.senses) {
      const byConcept = this.#concepts.get(sense.concept) ?? new Set<LexemeId>();
      byConcept.add(lexeme.id);
      this.#concepts.set(sense.concept, byConcept);
    }
    return ok(undefined);
  }

  addMultiword(input: MultiwordExpression): Result<void> {
    const validated = validateMultiwordExpression(input);
    if (!validated.ok) return validated;
    if (this.#lexemes.has(input.id) || this.#mwes.has(input.id)) {
      return err(
        new StructuredError(
          "LEXICON_DUPLICATE_ID",
          `Lexical id already exists: ${input.id}.`,
        ),
      );
    }
    this.#mwes.set(input.id, validated.value);
    return ok(undefined);
  }

  get(id: LexemeId): Lexeme | undefined {
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

  allMultiwords(language?: string): MultiwordExpression[] {
    return [...this.#mwes.values()]
      .filter(
        (expression) =>
          language === undefined || expression.language === language,
      )
      .map((expression) => structuredClone(expression))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  lookupSurface(
    surface: string,
    input: { language: string; partOfSpeech?: PartOfSpeech },
  ): LexicalCandidate[] {
    const ids = this.#surface.get(surfaceKey(input.language, surface));
    if (ids === undefined) return [];
    const output: LexicalCandidate[] = [];
    for (const id of ids) {
      const lexeme = this.#lexemes.get(id);
      if (
        lexeme === undefined ||
        (input.partOfSpeech !== undefined &&
          lexeme.partOfSpeech !== input.partOfSpeech)
      ) {
        continue;
      }
      for (const sense of lexeme.senses) {
        output.push({
          lexeme: structuredClone(lexeme),
          sense: structuredClone(sense),
          match: "lemma",
        });
      }
    }
    return output.sort((a, b) => {
      const frequency =
        (b.lexeme.frequencyBand ?? 0) - (a.lexeme.frequencyBand ?? 0);
      return frequency !== 0
        ? frequency
        : a.sense.senseId.localeCompare(b.sense.senseId);
    });
  }

  lookupConcept(concept: ConceptRef, language?: string): Lexeme[] {
    const ids = this.#concepts.get(concept);
    if (ids === undefined) return [];
    return [...ids]
      .map((id) => this.#lexemes.get(id))
      .filter((lexeme): lexeme is Lexeme => lexeme !== undefined)
      .filter((lexeme) => language === undefined || lexeme.language === language)
      .map((lexeme) => structuredClone(lexeme))
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
      const candidates = this.lookupSurface(surface, {
        language: input.language,
      });
      if (candidates.length > 0) return { kind: "known", candidates };
    }

    const item: OpaqueLexicalItem = {
      kind: "unknown-lexeme",
      surface,
      normalized: normalizeLexicalSurface(surface),
      caseFolded: caseFoldLexicalSurface(surface, input.language),
      ...(input.language === undefined ? {} : { language: input.language }),
      partOfSpeechCandidates: [...(input.partOfSpeechCandidates ?? [])],
      ...(input.confidence === undefined
        ? {}
        : { confidence: input.confidence }),
    };
    return { kind: "unknown", item };
  }

  matchMultiword(
    tokens: readonly string[],
    start: number,
    language: string,
  ): MultiwordMatch[] {
    const output: MultiwordMatch[] = [];

    for (const expression of this.#mwes.values()) {
      if (expression.language !== language) continue;
      let cursor = start;
      const slots: Record<string, string[]> = {};
      let matched = true;

      for (const component of expression.components) {
        if (component.kind === "fixed") {
          const token = tokens[cursor];
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

        const token = tokens[cursor];
        if (token === undefined) {
          if (component.optional === true) continue;
          matched = false;
          break;
        }
        slots[component.name] = [token];
        cursor += 1;
      }

      if (matched) {
        output.push({
          expression: structuredClone(expression),
          start,
          end: cursor,
          slots,
        });
      }
    }

    return output.sort((a, b) => b.end - b.start - (a.end - a.start));
  }
}

const noun = (
  id: LexemeId,
  lemma: string,
  concept: ConceptRef,
  frequencyBand: number,
): Lexeme => ({
  id,
  language: "en",
  lemma,
  partOfSpeech: "noun",
  senses: [{ concept, senseId: `${id}.sense.1` }],
  morphologyClass: "en.regular-noun",
  frequencyBand,
});

const verb = (
  id: LexemeId,
  lemma: string,
  concept: ConceptRef,
  frame?: ValencyFrame,
): Lexeme => ({
  id,
  language: "en",
  lemma,
  partOfSpeech: "verb",
  senses: [{ concept, senseId: `${id}.sense.1` }],
  morphologyClass: "en.regular-verb",
  ...(frame === undefined ? {} : { valencyFrames: [frame] }),
  frequencyBand: 0.7,
});

export const createEnglishSeedLexicon = (): LexiconIndex => {
  const index = new LexiconIndex();
  const entries: Lexeme[] = [
    noun(
      "lexeme:en.service.n.1",
      "service",
      "concept:core.software-service",
      0.8,
    ),
    noun("lexeme:en.file.n.1", "file", "concept:core.file", 0.9),
    noun("lexeme:en.entity.n.1", "entity", "concept:core.entity", 0.6),
    verb(
      "lexeme:en.delete.v.1",
      "delete",
      "concept:core.delete",
      {
        id: "frame:en.delete.transitive",
        semanticPredicate: "concept:core.delete",
        slots: [
          {
            role: "role:core.agent",
            required: false,
            alternatives: [{ function: "subject" }],
          },
          {
            role: "role:core.theme",
            required: true,
            alternatives: [{ function: "direct-object" }],
          },
        ],
      },
    ),
    verb(
      "lexeme:en.require.v.1",
      "require",
      "concept:core.requirement",
    ),
    {
      id: "lexeme:en.active.adj.1",
      language: "en",
      lemma: "active",
      partOfSpeech: "adjective",
      senses: [
        {
          concept: "concept:core.state",
          senseId: "lexeme:en.active.adj.1.sense.1",
        },
      ],
      morphologyClass: "en.gradable-adjective",
      frequencyBand: 0.75,
    },
    {
      id: "lexeme:en.bank.n.1",
      language: "en",
      lemma: "bank",
      partOfSpeech: "noun",
      senses: [
        {
          concept: "concept:lex.finance-institution",
          senseId: "finance",
        },
        {
          concept: "concept:lex.river-bank",
          senseId: "river-edge",
        },
      ],
      morphologyClass: "en.regular-noun",
      frequencyBand: 0.7,
    },
  ];

  for (const entry of entries) {
    const result = index.addLexeme(entry);
    if (!result.ok) throw result.error;
  }

  const mwe: MultiwordExpression = {
    id: "lexeme:en.take-into-account.mwe.1",
    language: "en",
    components: [
      { kind: "fixed", surface: "take" },
      { kind: "fixed", surface: "into" },
      { kind: "fixed", surface: "account" },
    ],
    syntacticCategory: "verb",
    semanticMapping: {
      concept: "concept:lex.consider",
      senseId: "consider",
    },
    register: ["neutral"],
  };
  const added = index.addMultiword(mwe);
  if (!added.ok) throw added.error;

  return index;
};
