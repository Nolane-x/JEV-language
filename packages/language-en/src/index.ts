import {
  GrammarRegistry,
  type GrammarFeatures,
  type GrammarRule,
} from "../../grammar-core/src/index.ts";
import {
  parseControlledEnglishCorpus,
} from "../../grounding/src/index.ts";
import type {
  HumanLanguagePack,
  LanguageConformanceManifest,
  LanguagePackManifest,
  PunctuationProvider,
  type LanguagePackConformanceProfile,
  type LanguagePackFeatureManifest,
  type LocaleFormattingProfile,
  type NumberRenderingStrategy,
} from "../../language-pack-core/src/index.ts";
import {
  LanguageNeutralLexiconIndex,
  type Lexeme,
  type LexicalMatch,
} from "../../lexicon-core/src/index.ts";
import {
  buildPackedGrammarForest,
  type GrammarToken,
  type SyntaxForest,
} from "../../parser-core/src/index.ts";
import {
  realizeControlledEnglishCorpus,
} from "../../realizer-core/src/index.ts";
import {
  type MorphAnalysis,
  type MorphContext,
  type MorphFeatures,
  type MorphologyProvider,
} from "../../morphology-core/src/index.ts";

const require = (ok: { ok: boolean; error?: Error }): void => {
  if (!ok.ok) throw ok.error ?? new Error("English language-pack registration failed.");
};

type LexicalConcept = NonNullable<Lexeme["senses"][number]["concept"]>;

const noun = (
  id: string,
  lemma: string,
  concept: LexicalConcept,
  forms: string[] = [],
): Lexeme => ({
  id,
  language: "en",
  lemma,
  partOfSpeech: "noun",
  forms,
  senses: [{ id: `${id}.sense.1`, concept }],
});

const functionLexeme = (
  id: string,
  lemma: string,
  partOfSpeech: Lexeme["partOfSpeech"],
  semanticTag: string,
): Lexeme => ({
  id,
  language: "en",
  lemma,
  partOfSpeech,
  senses: [{ id: `${id}.sense.1`, semanticTag }],
});

export const createEnglishSeedLexicon = (): LanguageNeutralLexiconIndex => {
  const index = new LanguageNeutralLexiconIndex();

  const entries: Lexeme[] = [
    noun(
      "lexeme:en.service",
      "service",
      "concept:core.software-service",
      ["services"],
    ),
    noun("lexeme:en.file", "file", "concept:core.file", ["files"]),
    noun(
      "lexeme:en.instruction",
      "instruction",
      "concept:core.instruction",
      ["instructions"],
    ),
    functionLexeme(
      "lexeme:en.it",
      "it",
      "pronoun",
      "reference.anaphoric",
    ),
    {
      id: "lexeme:en.delete",
      language: "en",
      lemma: "delete",
      partOfSpeech: "verb",
      forms: ["deletes", "deleted", "deleting"],
      senses: [
        {
          id: "sense:en.delete.action",
          concept: "concept:core.delete",
          valencyFrames: [
            {
              id: "frame:en.delete.transitive",
              slots: [
                {
                  id: "agent",
                  role: "role:core.agent",
                  syntacticFunctions: ["subject"],
                  required: true,
                },
                {
                  id: "patient",
                  syntacticFunctions: ["direct-object"],
                  required: true,
                  expectedConcepts: ["concept:core.file"],
                },
              ],
            },
          ],
        },
      ],
    },
    functionLexeme("lexeme:en.must", "must", "auxiliary", "modality.required"),
    functionLexeme("lexeme:en.may", "may", "auxiliary", "modality.permitted"),
    functionLexeme("lexeme:en.can", "can", "auxiliary", "modality.possible"),
    {
      id: "lexeme:en.do",
      language: "en",
      lemma: "do",
      partOfSpeech: "auxiliary",
      forms: ["does", "did", "done", "doing"],
      senses: [
        {
          id: "lexeme:en.do.sense.1",
          semanticTag: "auxiliary.do-support",
        },
      ],
    },
    {
      id: "lexeme:en.be",
      language: "en",
      lemma: "be",
      partOfSpeech: "auxiliary",
      forms: ["am", "is", "are", "was", "were", "been", "being"],
      senses: [{ id: "lexeme:en.be.sense.1", semanticTag: "copula" }],
    },
    functionLexeme("lexeme:en.not", "not", "particle", "polarity.negative"),
    functionLexeme("lexeme:en.the", "the", "determiner", "definiteness.definite"),
    functionLexeme("lexeme:en.a", "a", "determiner", "definiteness.indefinite"),
    functionLexeme("lexeme:en.an", "an", "determiner", "definiteness.indefinite"),
    functionLexeme("lexeme:en.exactly", "exactly", "adverb", "quantity.exact"),
    functionLexeme("lexeme:en.today", "today", "adverb", "temporal.deictic"),
    functionLexeme("lexeme:en.active", "active", "adjective", "state.active"),
    {
      id: "lexeme:en.run",
      language: "en",
      lemma: "run",
      partOfSpeech: "verb",
      forms: ["runs", "ran", "running"],
      senses: [{ id: "lexeme:en.run.sense.1", semanticTag: "predicate.run" }],
    },
    functionLexeme("lexeme:en.if", "if", "conjunction", "condition.marker"),
    functionLexeme(
      "lexeme:en.because",
      "because",
      "conjunction",
      "causal.marker",
    ),
    functionLexeme("lexeme:en.and", "and", "conjunction", "coordination.and"),
    functionLexeme("lexeme:en.or", "or", "conjunction", "coordination.or"),
    functionLexeme("lexeme:en.more", "more", "adverb", "comparison.more"),
    functionLexeme("lexeme:en.than", "than", "particle", "comparison.boundary"),
    functionLexeme("lexeme:en.at", "at", "preposition", "comparison.boundary"),
    functionLexeme("lexeme:en.most", "most", "adverb", "comparison.maximum"),
    functionLexeme("lexeme:en.what", "what", "pronoun", "question.wh"),
    functionLexeme("lexeme:en.which", "which", "determiner", "question.wh"),
  ];

  for (const entry of entries) require(index.registerLexeme(entry));

  require(
    index.registerMultiword({
      id: "mwe:en.more-than",
      language: "en",
      components: [
        { kind: "fixed", surface: "more" },
        { kind: "fixed", surface: "than" },
      ],
      syntacticCategory: "COMPARATOR",
      semanticMapping: "comparison.more-than",
    }),
  );
  require(
    index.registerMultiword({
      id: "mwe:en.at-most",
      language: "en",
      components: [
        { kind: "fixed", surface: "at" },
        { kind: "fixed", surface: "most" },
      ],
      syntacticCategory: "COMPARATOR",
      semanticMapping: "comparison.at-most",
    }),
  );
  require(
    index.registerCollocation({
      id: "collocation:en.delete-file",
      relation: "prefers",
      left: "concept:core.delete",
      right: "concept:core.file",
      window: 4,
      domain: "software",
    }),
  );

  return index;
};

const uniqueAnalyses = (values: MorphAnalysis[]): MorphAnalysis[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify([
      value.lemma,
      value.partOfSpeech ?? "",
      value.features,
      value.source,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const analysesFromMatches = (
  surface: string,
  matches: readonly LexicalMatch[],
): MorphAnalysis[] =>
  matches.map((match) => ({
    surface,
    lemma: match.lemma,
    partOfSpeech: match.partOfSpeech,
    features: {},
    source: "lexicon" as const,
  }));

const pluralizeEnglish = (lemma: string): string => {
  if (/[^aeiou]y$/i.test(lemma)) return `${lemma.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(lemma)) return `${lemma}es`;
  return `${lemma}s`;
};

const pastEnglish = (lemma: string): string => {
  if (/e$/i.test(lemma)) return `${lemma}d`;
  if (/[^aeiou]y$/i.test(lemma)) return `${lemma.slice(0, -1)}ied`;
  return `${lemma}ed`;
};

const progressiveEnglish = (lemma: string): string => {
  if (/ie$/i.test(lemma)) return `${lemma.slice(0, -2)}ying`;
  if (/e$/i.test(lemma) && !/ee$/i.test(lemma)) {
    return `${lemma.slice(0, -1)}ing`;
  }
  return `${lemma}ing`;
};

export class EnglishMorphologyProvider implements MorphologyProvider {
  readonly id = "language-en.morphology.controlled-v1";
  readonly language = "en";
  readonly #lexicon: LanguageNeutralLexiconIndex;

  constructor(lexicon: LanguageNeutralLexiconIndex = createEnglishSeedLexicon()) {
    this.#lexicon = lexicon;
  }

  analyze(surface: string, context: MorphContext): MorphAnalysis[] {
    if (context.language !== "en") return [];
    const output = analysesFromMatches(
      surface,
      this.#lexicon.lookupSurface(surface, "en"),
    );

    const candidates: Array<{
      lemma: string;
      features: MorphFeatures;
      partOfSpeech: Lexeme["partOfSpeech"];
    }> = [];

    if (/ies$/i.test(surface) && surface.length > 3) {
      candidates.push({
        lemma: `${surface.slice(0, -3)}y`,
        features: { number: "plural" },
        partOfSpeech: "noun",
      });
    }
    if (/s$/i.test(surface) && surface.length > 1) {
      candidates.push({
        lemma: surface.slice(0, -1),
        features: { number: "plural" },
        partOfSpeech: "noun",
      });
      candidates.push({
        lemma: surface.slice(0, -1),
        features: { tense: "present", person: "third", number: "singular" },
        partOfSpeech: "verb",
      });
    }
    if (/ied$/i.test(surface) && surface.length > 3) {
      candidates.push({
        lemma: `${surface.slice(0, -3)}y`,
        features: { tense: "past" },
        partOfSpeech: "verb",
      });
    } else if (/ed$/i.test(surface) && surface.length > 2) {
      const stem = surface.slice(0, -2);
      candidates.push({
        lemma: stem,
        features: { tense: "past" },
        partOfSpeech: "verb",
      });
      candidates.push({
        lemma: `${stem}e`,
        features: { tense: "past" },
        partOfSpeech: "verb",
      });
    }
    if (/ing$/i.test(surface) && surface.length > 3) {
      const stem = surface.slice(0, -3);
      candidates.push({
        lemma: stem,
        features: { aspect: "progressive" },
        partOfSpeech: "verb",
      });
      candidates.push({
        lemma: `${stem}e`,
        features: { aspect: "progressive" },
        partOfSpeech: "verb",
      });
    }

    for (const candidate of candidates) {
      const matches = this.#lexicon.lookupSurface(candidate.lemma, "en");
      for (const match of matches) {
        if (match.partOfSpeech !== candidate.partOfSpeech) continue;
        output.push({
          surface,
          lemma: match.lemma,
          partOfSpeech: match.partOfSpeech,
          features: candidate.features,
          source: "rule",
        });
      }
    }

    return uniqueAnalyses(output);
  }

  realize(lexeme: Lexeme, features: MorphFeatures): string[] {
    if (lexeme.language !== "en") return [];
    if (
      lexeme.partOfSpeech === "noun" &&
      features.number === "plural"
    ) {
      return [
        ...(lexeme.irregularForms?.plural ?? []),
        pluralizeEnglish(lexeme.lemma),
      ].filter((value, index, values) => values.indexOf(value) === index);
    }

    if (lexeme.partOfSpeech === "verb") {
      if (features.tense === "past") {
        return [
          ...(lexeme.irregularForms?.past ?? []),
          pastEnglish(lexeme.lemma),
        ].filter((value, index, values) => values.indexOf(value) === index);
      }
      if (features.aspect === "progressive") {
        return [
          ...(lexeme.irregularForms?.progressive ?? []),
          progressiveEnglish(lexeme.lemma),
        ].filter((value, index, values) => values.indexOf(value) === index);
      }
      if (
        features.tense === "present" &&
        features.person === "third" &&
        features.number === "singular"
      ) {
        return [
          ...(lexeme.irregularForms?.["present-third"] ?? []),
          pluralizeEnglish(lexeme.lemma),
        ].filter((value, index, values) => values.indexOf(value) === index);
      }
    }

    return [lexeme.lemma];
  }
}

export const englishControlledCoverage = {
  language: "en",
  phenomena: {
    "simple-declaratives": "controlled",
    negation: "controlled",
    "yes-no-questions": "controlled",
    "wh-questions": "controlled",
    imperatives: "unsupported",
    "copular-clauses": "controlled",
    transitives: "controlled",
    intransitives: "controlled",
    coordination: "controlled",
    conditionals: "controlled",
    modals: "controlled",
    quantification: "controlled",
    "numbers-units": "controlled",
    "time-adjuncts": "controlled",
    "causal-adjuncts": "controlled",
    "dialogue-reference": "controlled",
    "instruction-as-content": "controlled",
  },
} as const;

const grammarRule = (
  id: string,
  lhs: string,
  rhs: GrammarRule["rhs"],
  priority = 0,
  resultFeatures?: GrammarRule["resultFeatures"],
): GrammarRule => ({
  id,
  language: "en",
  lhs,
  rhs,
  constraints: [],
  priority,
  ...(resultFeatures === undefined
    ? {}
    : { resultFeatures }),
});

export const createEnglishControlledGrammar = (): GrammarRegistry => {
  const registry = new GrammarRegistry();
  const rules: GrammarRule[] = [
    grammarRule(
      "grammar:en.np.noun",
      "NP",
      [{ kind: "lexical", partOfSpeech: "noun", capture: "head" }],
      30,
    ),
    grammarRule(
      "grammar:en.np.determiner-noun",
      "NP",
      [
        {
          kind: "lexical",
          partOfSpeech: "determiner",
          capture: "determiner",
        },
        { kind: "lexical", partOfSpeech: "noun", capture: "head" },
      ],
      35,
    ),
    grammarRule(
      "grammar:en.np.pronoun",
      "NP",
      [{ kind: "lexical", partOfSpeech: "pronoun", capture: "head" }],
      30,
    ),
    grammarRule(
      "grammar:en.adjp.adjective",
      "ADJP",
      [{ kind: "lexical", partOfSpeech: "adjective", capture: "head" }],
      25,
    ),
    grammarRule(
      "grammar:en.vp.intransitive",
      "VP",
      [{ kind: "lexical", partOfSpeech: "verb", capture: "predicate" }],
      20,
    ),
    grammarRule(
      "grammar:en.vp.transitive",
      "VP",
      [
        { kind: "lexical", partOfSpeech: "verb", capture: "predicate" },
        { kind: "category", category: "NP", capture: "object" },
      ],
      35,
    ),
    grammarRule(
      "grammar:en.vp.copula-adjective",
      "VP",
      [
        {
          kind: "lexical",
          partOfSpeech: "auxiliary",
          semanticTag: "copula",
          capture: "copula",
        },
        { kind: "category", category: "ADJP", capture: "predicate" },
      ],
      35,
      { mood: "indicative" },
    ),
    grammarRule(
      "grammar:en.vp.copula-nominal",
      "VP",
      [
        {
          kind: "lexical",
          partOfSpeech: "auxiliary",
          semanticTag: "copula",
          capture: "copula",
        },
        { kind: "category", category: "NP", capture: "predicate" },
      ],
      30,
      { mood: "indicative" },
    ),
    grammarRule(
      "grammar:en.vp.negation-do",
      "VP",
      [
        {
          kind: "lexical",
          partOfSpeech: "auxiliary",
          semanticTag: "auxiliary.do-support",
          capture: "auxiliary",
        },
        {
          kind: "lexical",
          partOfSpeech: "particle",
          semanticTag: "polarity.negative",
          capture: "negation",
        },
        { kind: "category", category: "VP", capture: "content" },
      ],
      45,
      { polarity: "negative" },
    ),
    grammarRule(
      "grammar:en.vp.negation-bare",
      "VP",
      [
        {
          kind: "lexical",
          partOfSpeech: "particle",
          semanticTag: "polarity.negative",
          capture: "negation",
        },
        { kind: "category", category: "VP", capture: "content" },
      ],
      25,
      { polarity: "negative" },
    ),
    grammarRule(
      "grammar:en.modal.required",
      "VP",
      [
        {
          kind: "lexical",
          partOfSpeech: "auxiliary",
          semanticTag: "modality.required",
          capture: "modal",
        },
        { kind: "category", category: "VP", capture: "content" },
      ],
      45,
      { modality: "required" },
    ),
    grammarRule(
      "grammar:en.modal.permitted",
      "VP",
      [
        {
          kind: "lexical",
          partOfSpeech: "auxiliary",
          semanticTag: "modality.permitted",
          capture: "modal",
        },
        { kind: "category", category: "VP", capture: "content" },
      ],
      45,
      { modality: "permitted" },
    ),
    grammarRule(
      "grammar:en.modal.possible",
      "VP",
      [
        {
          kind: "lexical",
          partOfSpeech: "auxiliary",
          semanticTag: "modality.possible",
          capture: "modal",
        },
        { kind: "category", category: "VP", capture: "content" },
      ],
      45,
      { modality: "possible" },
    ),
    grammarRule(
      "grammar:en.s.declarative",
      "S",
      [
        { kind: "category", category: "NP", capture: "subject" },
        { kind: "category", category: "VP", capture: "predicate" },
      ],
      40,
      { mood: "indicative" },
    ),
    grammarRule(
      "grammar:en.s.coordination-and",
      "S",
      [
        { kind: "category", category: "S", capture: "left" },
        { kind: "literal", surface: "and" },
        { kind: "category", category: "S", capture: "right" },
      ],
      15,
      { coordination: "and" },
    ),
    grammarRule(
      "grammar:en.s.coordination-or",
      "S",
      [
        { kind: "category", category: "S", capture: "left" },
        { kind: "literal", surface: "or" },
        { kind: "category", category: "S", capture: "right" },
      ],
      15,
      { coordination: "or" },
    ),
    grammarRule(
      "grammar:en.conditional.if",
      "S",
      [
        { kind: "literal", surface: "if" },
        { kind: "category", category: "S", capture: "condition" },
        { kind: "category", category: "S", capture: "consequence" },
      ],
      20,
      { mood: "conditional" },
    ),
    grammarRule(
      "grammar:en.causal.because",
      "S",
      [
        { kind: "category", category: "S", capture: "result" },
        { kind: "literal", surface: "because" },
        { kind: "category", category: "S", capture: "cause" },
      ],
      20,
      { relation: "cause" },
    ),
    grammarRule(
      "grammar:en.time.deictic",
      "TIME",
      [
        {
          kind: "lexical",
          partOfSpeech: "adverb",
          semanticTag: "temporal.deictic",
          capture: "time",
        },
      ],
      30,
      { temporal: "deictic" },
    ),
    grammarRule(
      "grammar:en.s.time-adjunct",
      "S",
      [
        { kind: "category", category: "S", capture: "clause" },
        { kind: "category", category: "TIME", capture: "time" },
      ],
      18,
      { temporal: "adjunct" },
    ),
    grammarRule(
      "grammar:en.quantity.exact",
      "QUANTITY",
      [
        { kind: "literal", surface: "exactly" },
        { kind: "lexical", partOfSpeech: "numeral", capture: "amount" },
      ],
      35,
      { comparator: "exact" },
    ),
    grammarRule(
      "grammar:en.quantity.at-most",
      "QUANTITY",
      [
        { kind: "literal", surface: "at" },
        { kind: "literal", surface: "most" },
        { kind: "lexical", partOfSpeech: "numeral", capture: "amount" },
      ],
      35,
      { comparator: "at-most" },
    ),
    grammarRule(
      "grammar:en.quantity.more-than",
      "QUANTITY",
      [
        { kind: "literal", surface: "more" },
        { kind: "literal", surface: "than" },
        { kind: "lexical", partOfSpeech: "numeral", capture: "amount" },
      ],
      35,
      { comparator: "more-than" },
    ),
    grammarRule(
      "grammar:en.np.quantified",
      "NP",
      [
        { kind: "category", category: "QUANTITY", capture: "quantity" },
        { kind: "category", category: "NP", capture: "unit" },
      ],
      40,
    ),
    grammarRule(
      "grammar:en.question.yes-no-do",
      "QUESTION",
      [
        {
          kind: "lexical",
          partOfSpeech: "auxiliary",
          semanticTag: "auxiliary.do-support",
          capture: "auxiliary",
        },
        { kind: "category", category: "NP", capture: "subject" },
        { kind: "category", category: "VP", capture: "predicate" },
      ],
      45,
      { question: "yes-no" },
    ),
    grammarRule(
      "grammar:en.question.yes-no-permission",
      "QUESTION",
      [
        {
          kind: "lexical",
          partOfSpeech: "auxiliary",
          semanticTag: "modality.permitted",
          capture: "modal",
        },
        { kind: "category", category: "NP", capture: "subject" },
        { kind: "category", category: "VP", capture: "predicate" },
      ],
      50,
      { question: "yes-no", modality: "permitted" },
    ),
    grammarRule(
      "grammar:en.question.yes-no-possibility",
      "QUESTION",
      [
        {
          kind: "lexical",
          partOfSpeech: "auxiliary",
          semanticTag: "modality.possible",
          capture: "modal",
        },
        { kind: "category", category: "NP", capture: "subject" },
        { kind: "category", category: "VP", capture: "predicate" },
      ],
      45,
      { question: "yes-no", modality: "possible" },
    ),
    grammarRule(
      "grammar:en.question.wh-do",
      "QUESTION",
      [
        {
          kind: "lexical",
          semanticTag: "question.wh",
          capture: "question-word",
        },
        {
          kind: "lexical",
          partOfSpeech: "auxiliary",
          semanticTag: "auxiliary.do-support",
          capture: "auxiliary",
        },
        { kind: "category", category: "NP", capture: "subject" },
        { kind: "category", category: "VP", capture: "predicate" },
      ],
      40,
      { question: "wh" },
    ),
    grammarRule(
      "grammar:en.question.wh",
      "QUESTION",
      [
        {
          kind: "lexical",
          semanticTag: "question.wh",
          capture: "question-word",
        },
        { kind: "category", category: "S", capture: "body" },
      ],
      30,
      { question: "wh" },
    ),
  ];

  for (const rule of rules) {
    const result = registry.register(rule);
    if (!result.ok) throw result.error;
  }
  return registry;
};

export interface EnglishToken {
  surface: string;
  normalized: string;
  start: number;
  end: number;
  kind: "word" | "number" | "punctuation" | "symbol";
}

export const tokenizeEnglish = (source: string): EnglishToken[] => {
  const normalized = source.normalize("NFC");
  const output: EnglishToken[] = [];
  const pattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,]\d+)?|[^\s]/gu;
  for (const match of normalized.matchAll(pattern)) {
    const surface = match[0];
    const start = match.index;
    if (start === undefined) continue;
    output.push({
      surface,
      normalized: surface.toLocaleLowerCase("en"),
      start,
      end: start + surface.length,
      kind: /^\d/u.test(surface)
        ? "number"
        : /^[A-Za-z]/u.test(surface)
          ? "word"
          : /^[.,!?;:()[\]{}"“”'‘’]$/u.test(surface)
            ? "punctuation"
            : "symbol",
    });
  }
  return output;
};


const scalarGrammarFeatures = (
  features: MorphFeatures,
): GrammarFeatures =>
  Object.fromEntries(
    Object.entries(features).filter(
      (
        entry,
      ): entry is [string, string | number | boolean] =>
        typeof entry[1] === "string" ||
        typeof entry[1] === "number" ||
        typeof entry[1] === "boolean",
    ),
  );

const lexicalKeyForGrammar = (match: LexicalMatch): string =>
  [
    match.lexemeId,
    match.senseId,
    match.language,
    match.lemma,
    match.partOfSpeech,
    match.semanticTag ?? "",
  ].join("\u0000");

export const englishGrammarTokens = (
  source: string,
): GrammarToken[] => {
  const lexicon = createEnglishSeedLexicon();
  const morphology = new EnglishMorphologyProvider(lexicon);

  return tokenizeEnglish(source)
    .filter(
      (token) =>
        token.kind !== "punctuation" ||
        !/^[.,!?;:]$/u.test(token.surface),
    )
    .map((token) => {
      const lexical = [
        ...lexicon.lookupSurface(token.surface, "en"),
      ];
      const analyses = morphology.analyze(token.surface, {
        language: "en",
      });

      for (const analysis of analyses) {
        for (const match of lexicon.lookupSurface(
          analysis.lemma,
          "en",
        )) {
          lexical.push({
            ...match,
            surface: token.surface,
          });
        }
      }

      if (token.kind === "number") {
        lexical.push({
          lexemeId: "lexeme:en.synthetic-number",
          senseId: "sense:en.synthetic-number",
          language: "en",
          lemma: token.normalized,
          partOfSpeech: "numeral",
          surface: token.surface,
          semanticTag: "quantity.number",
        });
      }

      const deduplicated = [
        ...new Map(
          lexical.map((match) => [
            lexicalKeyForGrammar(match),
            match,
          ]),
        ).values(),
      ];

      const features = analyses.reduce<GrammarFeatures>(
        (combined, analysis) => ({
          ...combined,
          ...scalarGrammarFeatures(analysis.features),
        }),
        {},
      );

      return {
        surface: token.surface,
        normalized: token.normalized,
        lexical: deduplicated,
        ...(Object.keys(features).length === 0
          ? {}
          : { features }),
      };
    });
};

export const parseEnglishSyntaxForest = (
  source: string,
) =>
  buildPackedGrammarForest(englishGrammarTokens(source), {
    language: "en",
    rules: createEnglishControlledGrammar().rulesFor("en"),
    rootCategories: ["S", "QUESTION"],
    version: "1.0.0",
  });

export interface EnglishGrammarSemanticParse {
  forest: SyntaxForest;
  semantic: Extract<
    ReturnType<typeof parseControlledEnglishCorpus>,
    { ok: true }
  >["value"];
}

export const parseEnglishGrammarToJsg = (
  source: string,
):
  | { ok: true; value: EnglishGrammarSemanticParse }
  | {
      ok: false;
      error: Extract<
        ReturnType<typeof parseControlledEnglishCorpus>,
        { ok: false }
      >["error"];
    } => {
  const syntax = parseEnglishSyntaxForest(source);
  if (!syntax.ok) {
    return {
      ok: false,
      error: syntax.error,
    };
  }

  const semantic = parseControlledEnglishCorpus(source);
  if (!semantic.ok) return semantic;

  return {
    ok: true,
    value: {
      forest: syntax.value,
      semantic: semantic.value,
    },
  };
};

export const englishLanguagePackManifest: LanguagePackManifest = {
  id: "language.en",
  languageTag: "en",
  version: "0.1.0",
  schemaVersion: "jl-language-pack-1",
  maturity: "experimental",
  capabilities: {
    parsing: true,
    realization: true,
    morphology: true,
    mixedLanguage: true,
  },
  coverage: {
    grammarProfile: "language-en.controlled-m6",
    lexiconEntries: "dynamic",
  },
  requires: {
    semanticSchema: ">=0.1 <1.0",
  },
};

export const englishLanguageFeatureManifest: LanguagePackFeatureManifest = {
  schemaVersion: "jl-language-features-1",
  language: "en",
  version: "1.0.0",
  features: {
    declaratives: {
      parse: "controlled",
      generate: "controlled",
      evidenceRefs: ["tests/conformance/m5-controlled-roundtrip.conformance.test.ts"],
    },
    negation: {
      parse: "controlled",
      generate: "controlled",
      evidenceRefs: ["tests/conformance/m6-bidirectional-variants.conformance.test.ts"],
    },
    questions: {
      parse: "controlled",
      generate: "controlled",
      evidenceRefs: ["tests/conformance/m18-grammar-parser.conformance.test.ts"],
    },
    conditionals: {
      parse: "controlled",
      generate: "controlled",
      evidenceRefs: ["tests/conformance/m6-bidirectional-variants.conformance.test.ts"],
    },
    modality: {
      parse: "controlled",
      generate: "controlled",
      evidenceRefs: ["tests/conformance/t321-t330-event-time-modality.conformance.test.ts"],
    },
    attribution: {
      parse: "controlled",
      generate: "controlled",
      evidenceRefs: ["tests/conformance/t331-t340-deixis-attitudes-evidence.conformance.test.ts"],
    },
    "mixed-language": {
      parse: "partial",
      generate: "partial",
      evidenceRefs: ["tests/conformance/t401-t410-language-typology.conformance.test.ts"],
    },
    "open-vocabulary": {
      parse: "partial",
      generate: "partial",
      evidenceRefs: ["tests/conformance/t391-t400-lexicon-open-vocabulary.conformance.test.ts"],
    },
  },
  constructions: [
    {
      id: "construction:shared:declarative",
      scope: "shared",
      semanticContract: "proposition -> declarative utterance",
      parse: true,
      generate: true,
    },
    {
      id: "construction:en:do-support",
      scope: "language-specific",
      language: "en",
      semanticContract: "English finite negation/question auxiliary support",
      parse: true,
      generate: true,
    },
  ],
  semanticExtensions: [
    {
      id: "semantic-extension:en:syntax",
      language: "en",
      namespace: "lang:en:syntax",
      extensionKeys: ["do-support"],
    },
  ],
  localeProfileIds: ["locale:en-US", "locale:en-GB"],
  mixedLanguage: {
    mode: "evidence-based",
    defaultLanguage: "en",
    allowedLanguages: ["en", "vi"],
    preserveOpaqueTerms: true,
    maxSwitches: 4,
  },
  lexicalFallback: {
    order: ["preserve", "borrow", "transliterate"],
    preserveOriginal: true,
    allowBorrowing: true,
    allowTransliteration: true,
    requireProvenance: true,
  },
};

export const englishLocaleProfiles: LocaleFormattingProfile[] = [
  {
    id: "locale:en-US",
    locale: "en-US",
    languageHint: "en",
    decimalSeparator: ".",
    groupSeparator: ",",
    groupSize: 3,
    dateOrder: "mdy",
    dateSeparator: "/",
    timeSeparator: ":",
    timezoneDisplay: "preserve",
  },
  {
    id: "locale:en-GB",
    locale: "en-GB",
    languageHint: "en",
    decimalSeparator: ".",
    groupSeparator: ",",
    groupSize: 3,
    dateOrder: "dmy",
    dateSeparator: "/",
    timeSeparator: ":",
    timezoneDisplay: "preserve",
  },
];

export const englishNumberStrategies: NumberRenderingStrategy[] = [
  {
    id: "number:en:decimal",
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
    useGrouping: true,
  },
  {
    id: "number:en:percent",
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: false,
  },
];

export const englishLanguageConformanceProfile = {
  featureManifest: englishLanguageFeatureManifest,
  locales: englishLocaleProfiles,
  numberStrategies: englishNumberStrategies,
} satisfies LanguagePackConformanceProfile;

export type EnglishSocialRelation = "formal" | "peer" | "intimate" | "unknown";

export interface EnglishAddressStrategy {
  speakerForm: "I";
  addresseeForm: "you";
  register: "formal" | "neutral" | "intimate";
}

export const chooseEnglishAddressStrategy = (
  relation: EnglishSocialRelation,
): EnglishAddressStrategy => ({
  speakerForm: "I",
  addresseeForm: "you",
  register:
    relation === "formal"
      ? "formal"
      : relation === "intimate"
        ? "intimate"
        : "neutral",
});

export const englishPunctuation: PunctuationProvider = {
  id: "language-en.punctuation.v1",
  language: "en",
  terminal(kind) {
    return kind === "question" ? "?" : kind === "exclamation" ? "!" : ".";
  },
  join(tokens) {
    return tokens.join(" ").replace(/\s+([.,!?;:])/gu, "$1");
  },
};

export const englishConformanceManifest: LanguageConformanceManifest = {
  id: "language-en.conformance.m6",
  language: "en",
  corpusRefs: [
    "tests/conformance/m5-controlled-roundtrip.conformance.test.ts",
    "tests/conformance/m6-bidirectional-variants.conformance.test.ts",
    "tests/conformance/m9-multilingual-semantic-equivalence.conformance.test.ts",
  ],
  requiredPhenomena: [
    "negation",
    "questions",
    "conditionals",
    "causality",
    "modality",
    "attribution",
    "dialogue-reference",
    "instruction-as-content",
  ],
  determinism: "D0",
};

export const englishLanguagePack = {
  manifest: englishLanguagePackManifest,
  featureManifest: englishLanguageFeatureManifest,
  tokenizer: {
    id: "language-en.tokenizer.controlled-v1",
    language: "en",
    tokenize: tokenizeEnglish,
  },
  lexicon: {
    id: "language-en.lexicon.controlled-v1",
    language: "en",
    create: createEnglishSeedLexicon,
  },
  morphology: new EnglishMorphologyProvider(),
  grammar: {
    id: "language-en.grammar.controlled-v1",
    language: "en",
    coverage: englishControlledCoverage,
    create: createEnglishControlledGrammar,
  },
  parserHooks: {
    id: "language-en.parser-hooks.controlled-v1",
    language: "en",
    parse: parseControlledEnglishCorpus,
  },
  realizationHooks: {
    id: "language-en.realization-hooks.controlled-v1",
    language: "en",
    realize: realizeControlledEnglishCorpus,
  },
  punctuation: englishPunctuation,
  discourse: {
    id: "language-en.discourse.address-v1",
    language: "en",
    choose: chooseEnglishAddressStrategy,
  },
  tests: englishConformanceManifest,
  // Compatibility aliases for existing callers; the common ABI uses
  // parserHooks/realizationHooks as the normative provider surface.
  parse: parseControlledEnglishCorpus,
  realize: realizeControlledEnglishCorpus,
} satisfies HumanLanguagePack<
  EnglishToken,
  string,
  ReturnType<typeof parseControlledEnglishCorpus>,
  Parameters<typeof realizeControlledEnglishCorpus>[0],
  ReturnType<typeof realizeControlledEnglishCorpus>,
  EnglishSocialRelation,
  EnglishAddressStrategy
>;
