import {
  GrammarRegistry,
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
} from "../../language-pack-core/src/index.ts";
import {
  LanguageNeutralLexiconIndex,
  type Lexeme,
  type LexicalMatch,
} from "../../lexicon-core/src/index.ts";
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
    functionLexeme("lexeme:en.not", "not", "particle", "polarity.negative"),
    functionLexeme("lexeme:en.be", "be", "auxiliary", "copula"),
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
    "simple-declaratives": "partial",
    negation: "controlled",
    "yes-no-questions": "unsupported",
    "wh-questions": "unsupported",
    imperatives: "unsupported",
    "copular-clauses": "partial",
    transitives: "controlled",
    intransitives: "unsupported",
    coordination: "partial",
    conditionals: "partial",
    modals: "controlled",
    quantification: "partial",
    "numbers-units": "controlled",
    "causal-adjuncts": "partial",
  },
} as const;


const grammarRule = (
  id: string,
  lhs: string,
  rhs: GrammarRule["rhs"],
  priority = 0,
): GrammarRule => ({
  id,
  language: "en",
  lhs,
  rhs,
  constraints: [],
  priority,
});

export const createEnglishControlledGrammar = (): GrammarRegistry => {
  const registry = new GrammarRegistry();
  const rules: GrammarRule[] = [
    grammarRule(
      "grammar:en.np.noun",
      "NP",
      [{ kind: "lexical", partOfSpeech: "noun", capture: "head" }],
      20,
    ),
    grammarRule(
      "grammar:en.vp.transitive",
      "VP",
      [
        { kind: "lexical", partOfSpeech: "verb", capture: "predicate" },
        { kind: "category", category: "NP", capture: "object" },
      ],
      20,
    ),
    grammarRule(
      "grammar:en.s.declarative",
      "S",
      [
        { kind: "category", category: "NP", capture: "subject" },
        { kind: "category", category: "VP", capture: "predicate" },
      ],
      20,
    ),
    grammarRule(
      "grammar:en.modal.required-negative",
      "VP",
      [
        {
          kind: "lexical",
          partOfSpeech: "auxiliary",
          semanticTag: "modality.required",
          capture: "modal",
        },
        {
          kind: "lexical",
          partOfSpeech: "particle",
          semanticTag: "polarity.negative",
          capture: "negation",
        },
        { kind: "category", category: "VP", capture: "content" },
      ],
      30,
    ),
    grammarRule(
      "grammar:en.coordination.and",
      "COORD",
      [
        { kind: "category", category: "S", capture: "left" },
        { kind: "literal", surface: "and" },
        { kind: "category", category: "S", capture: "right" },
      ],
      10,
    ),
    grammarRule(
      "grammar:en.conditional.if",
      "S",
      [
        { kind: "literal", surface: "if" },
        { kind: "category", category: "S", capture: "condition" },
        { kind: "category", category: "S", capture: "consequence" },
      ],
      10,
    ),
    grammarRule(
      "grammar:en.causal.because",
      "S",
      [
        { kind: "category", category: "S", capture: "result" },
        { kind: "literal", surface: "because" },
        { kind: "category", category: "S", capture: "cause" },
      ],
      10,
    ),
    grammarRule(
      "grammar:en.quantity.more-than",
      "QUANTITY",
      [
        { kind: "literal", surface: "more" },
        { kind: "literal", surface: "than" },
        { kind: "lexical", partOfSpeech: "numeral", capture: "amount" },
        { kind: "category", category: "NP", capture: "unit" },
      ],
      20,
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
      10,
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
  ],
  requiredPhenomena: [
    "negation",
    "questions",
    "conditionals",
    "causality",
    "modality",
    "attribution",
  ],
  determinism: "D0",
};

export const englishLanguagePack = {
  manifest: englishLanguagePackManifest,
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
} satisfies HumanLanguagePack<
  EnglishToken,
  string,
  ReturnType<typeof parseControlledEnglishCorpus>,
  Parameters<typeof realizeControlledEnglishCorpus>[0],
  ReturnType<typeof realizeControlledEnglishCorpus>,
  EnglishSocialRelation,
  EnglishAddressStrategy
>;
