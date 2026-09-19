import {
  GrammarRegistry,
  type GrammarRule,
} from "../../grammar-core/src/index.ts";
import {
  LanguageNeutralLexiconIndex,
  caseFoldLexicalSurface,
  type CollocationRule,
  type Lexeme,
  type LexemeId,
  type LexicalMatch,
  type ValencyFrame,
} from "../../lexicon-core/src/index.ts";
import {
  type MorphAnalysis,
  type MorphContext,
  type MorphFeatures,
  type MorphologyProvider,
  type SurfaceCandidate,
} from "../../morphology-core/src/index.ts";

const requireOk = (result: { ok: boolean; error?: Error }): void => {
  if (!result.ok) {
    throw result.error ?? new Error("English language-pack registration failed.");
  }
};

const deleteFrame: ValencyFrame = {
  id: "frame:en.delete.transitive",
  semanticPredicate: "concept:core.delete",
  slots: [
    {
      id: "agent",
      role: "role:core.agent",
      alternatives: [{ function: "subject" }],
      required: false,
    },
    {
      id: "theme",
      role: "role:core.theme",
      alternatives: [{ function: "direct-object" }],
      required: true,
      expectedConcepts: ["concept:core.file"],
    },
  ],
};

const deleteFileCollocation: CollocationRule = {
  id: "collocation:en.delete-file",
  relation: "prefers",
  left: { kind: "concept", value: "concept:core.delete" },
  right: { kind: "concept", value: "concept:core.file" },
  window: 4,
  domain: "concept:core.software-service",
  preference: 0.9,
};

const noun = (
  id: LexemeId,
  lemma: string,
  concept: Lexeme["senses"][number]["concept"],
  forms: string[] = [],
): Lexeme => ({
  id,
  language: "en",
  lemma,
  partOfSpeech: "noun",
  forms,
  senses: [{ senseId: `${id}.sense.1`, concept }],
  morphologyClass: "en.regular-noun",
  frequencyBand: 0.75,
});

const functionLexeme = (
  id: LexemeId,
  lemma: string,
  partOfSpeech: Lexeme["partOfSpeech"],
  concept: Lexeme["senses"][number]["concept"],
  semanticTag: string,
): Lexeme => ({
  id,
  language: "en",
  lemma,
  partOfSpeech,
  senses: [
    {
      senseId: `${id}.sense.1`,
      concept,
      semanticTag,
    },
  ],
  frequencyBand: 0.8,
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
    noun("lexeme:en.entity", "entity", "concept:core.entity", ["entities"]),
    {
      id: "lexeme:en.delete",
      language: "en",
      lemma: "delete",
      partOfSpeech: "verb",
      forms: ["deletes", "deleted", "deleting"],
      senses: [
        {
          senseId: "sense:en.delete.action",
          concept: "concept:core.delete",
        },
      ],
      morphologyClass: "en.regular-verb",
      valencyFrames: [deleteFrame],
      collocations: [deleteFileCollocation],
      frequencyBand: 0.8,
    },
    {
      id: "lexeme:en.bank",
      language: "en",
      lemma: "bank",
      partOfSpeech: "noun",
      senses: [
        {
          senseId: "sense:en.bank.finance",
          concept: "concept:lex.finance-institution",
          gloss: "financial institution",
        },
        {
          senseId: "sense:en.bank.river",
          concept: "concept:lex.river-bank",
          gloss: "edge of a river",
        },
      ],
      morphologyClass: "en.regular-noun",
      frequencyBand: 0.65,
    },
    functionLexeme(
      "lexeme:en.must",
      "must",
      "auxiliary",
      "concept:core.requirement",
      "modality.required",
    ),
    functionLexeme(
      "lexeme:en.not",
      "not",
      "particle",
      "concept:core.negation",
      "polarity.negative",
    ),
    functionLexeme(
      "lexeme:en.be",
      "be",
      "auxiliary",
      "concept:core.equivalence",
      "copula",
    ),
    functionLexeme(
      "lexeme:en.if",
      "if",
      "conjunction",
      "concept:core.condition",
      "condition.marker",
    ),
    functionLexeme(
      "lexeme:en.because",
      "because",
      "conjunction",
      "concept:core.causality",
      "causal.marker",
    ),
    functionLexeme(
      "lexeme:en.and",
      "and",
      "conjunction",
      "concept:core.coordination",
      "coordination.and",
    ),
    functionLexeme(
      "lexeme:en.or",
      "or",
      "conjunction",
      "concept:core.coordination",
      "coordination.or",
    ),
    functionLexeme(
      "lexeme:en.more",
      "more",
      "adverb",
      "concept:core.comparison",
      "comparison.more",
    ),
    functionLexeme(
      "lexeme:en.than",
      "than",
      "particle",
      "concept:core.comparison",
      "comparison.boundary",
    ),
    functionLexeme(
      "lexeme:en.at",
      "at",
      "preposition",
      "concept:core.comparison",
      "comparison.boundary",
    ),
    functionLexeme(
      "lexeme:en.most",
      "most",
      "adverb",
      "concept:core.comparison",
      "comparison.maximum",
    ),
    functionLexeme(
      "lexeme:en.what",
      "what",
      "pronoun",
      "concept:core.question",
      "question.wh",
    ),
    functionLexeme(
      "lexeme:en.which",
      "which",
      "determiner",
      "concept:core.question",
      "question.wh",
    ),
  ];

  for (const entry of entries) requireOk(index.registerLexeme(entry));

  requireOk(
    index.registerMultiword({
      id: "mwe:en.more-than",
      language: "en",
      components: [
        { kind: "fixed", surface: "more" },
        { kind: "fixed", surface: "than" },
      ],
      syntacticCategory: "construction:comparator",
      semanticMapping: {
        concept: "concept:core.comparison",
        senseId: "comparison.more-than",
      },
    }),
  );
  requireOk(
    index.registerMultiword({
      id: "mwe:en.at-most",
      language: "en",
      components: [
        { kind: "fixed", surface: "at" },
        { kind: "fixed", surface: "most" },
      ],
      syntacticCategory: "construction:comparator",
      semanticMapping: {
        concept: "concept:core.comparison",
        senseId: "comparison.at-most",
      },
    }),
  );

  return index;
};

interface IrregularVerbForms {
  third?: string;
  past: string;
  pastParticiple: string;
  progressive?: string;
}

const irregularNounPlural: Readonly<Record<string, string>> = {
  child: "children",
  person: "people",
  mouse: "mice",
  foot: "feet",
  tooth: "teeth",
  man: "men",
  woman: "women",
};

const irregularVerbs: Readonly<Record<string, IrregularVerbForms>> = {
  be: { third: "is", past: "was", pastParticiple: "been", progressive: "being" },
  have: { third: "has", past: "had", pastParticiple: "had", progressive: "having" },
  do: { third: "does", past: "did", pastParticiple: "done", progressive: "doing" },
  go: { third: "goes", past: "went", pastParticiple: "gone", progressive: "going" },
  take: { past: "took", pastParticiple: "taken", progressive: "taking" },
  give: { past: "gave", pastParticiple: "given", progressive: "giving" },
  build: { past: "built", pastParticiple: "built", progressive: "building" },
};

const pluralizeEnglish = (lemma: string): string => {
  const irregular = irregularNounPlural[lemma.toLowerCase()];
  if (irregular !== undefined) return irregular;
  if (/[^aeiou]y$/i.test(lemma)) return `${lemma.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(lemma)) return `${lemma}es`;
  return `${lemma}s`;
};

const thirdPersonEnglish = (lemma: string): string => {
  const irregular = irregularVerbs[lemma.toLowerCase()]?.third;
  if (irregular !== undefined) return irregular;
  if (/[^aeiou]y$/i.test(lemma)) return `${lemma.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh|o)$/i.test(lemma)) return `${lemma}es`;
  return `${lemma}s`;
};

const regularPast = (lemma: string): string => {
  if (/e$/i.test(lemma)) return `${lemma}d`;
  if (/[^aeiou]y$/i.test(lemma)) return `${lemma.slice(0, -1)}ied`;
  return `${lemma}ed`;
};

const pastEnglish = (lemma: string): string =>
  irregularVerbs[lemma.toLowerCase()]?.past ?? regularPast(lemma);

const pastParticipleEnglish = (lemma: string): string =>
  irregularVerbs[lemma.toLowerCase()]?.pastParticiple ?? regularPast(lemma);

const progressiveEnglish = (lemma: string): string => {
  const irregular = irregularVerbs[lemma.toLowerCase()]?.progressive;
  if (irregular !== undefined) return irregular;
  if (/ie$/i.test(lemma)) return `${lemma.slice(0, -2)}ying`;
  if (/[^e]e$/i.test(lemma)) return `${lemma.slice(0, -1)}ing`;
  return `${lemma}ing`;
};

const degreeEnglish = (lemma: string, degree: string): string => {
  if (degree === "positive") return lemma;
  if (lemma.length > 6 || lemma.includes("-")) {
    return degree === "comparative" ? `more ${lemma}` : `most ${lemma}`;
  }
  if (/y$/i.test(lemma)) {
    return degree === "comparative"
      ? `${lemma.slice(0, -1)}ier`
      : `${lemma.slice(0, -1)}iest`;
  }
  if (/e$/i.test(lemma)) {
    return degree === "comparative" ? `${lemma}r` : `${lemma}st`;
  }
  return degree === "comparative" ? `${lemma}er` : `${lemma}est`;
};

const realizeSurface = (
  lexeme: Lexeme,
  features: MorphFeatures,
): string => {
  if (lexeme.partOfSpeech === "noun") {
    return features.number === "plural"
      ? lexeme.irregularForms?.plural?.[0] ?? pluralizeEnglish(lexeme.lemma)
      : lexeme.lemma;
  }

  if (lexeme.partOfSpeech === "verb" || lexeme.partOfSpeech === "auxiliary") {
    if (features.aspect === "progressive" || features.verbForm === "present-participle") {
      return lexeme.irregularForms?.progressive?.[0] ?? progressiveEnglish(lexeme.lemma);
    }
    if (features.aspect === "perfect" || features.verbForm === "past-participle") {
      return lexeme.irregularForms?.["past-participle"]?.[0] ??
        pastParticipleEnglish(lexeme.lemma);
    }
    if (features.tense === "past" || features.verbForm === "past") {
      return lexeme.irregularForms?.past?.[0] ?? pastEnglish(lexeme.lemma);
    }
    if (
      features.verbForm === "third-person-singular" ||
      (
        features.tense === "present" &&
        (features.person === "third" || features.person === 3) &&
        features.number === "singular"
      )
    ) {
      return lexeme.irregularForms?.["present-third"]?.[0] ??
        thirdPersonEnglish(lexeme.lemma);
    }
    return lexeme.lemma;
  }

  if (
    (lexeme.partOfSpeech === "adjective" || lexeme.partOfSpeech === "adverb") &&
    features.degree !== undefined
  ) {
    return degreeEnglish(lexeme.lemma, String(features.degree));
  }

  return lexeme.lemma;
};

const featureCandidates = (lexeme: Lexeme): MorphFeatures[] => {
  if (lexeme.partOfSpeech === "noun") {
    return [{ number: "singular" }, { number: "plural" }];
  }
  if (lexeme.partOfSpeech === "verb" || lexeme.partOfSpeech === "auxiliary") {
    return [
      { verbForm: "base" },
      {
        verbForm: "third-person-singular",
        tense: "present",
        person: "third",
        number: "singular",
      },
      { verbForm: "past", tense: "past" },
      { verbForm: "past-participle", aspect: "perfect" },
      { verbForm: "present-participle", aspect: "progressive" },
    ];
  }
  if (lexeme.partOfSpeech === "adjective" || lexeme.partOfSpeech === "adverb") {
    return [
      { degree: "positive" },
      { degree: "comparative" },
      { degree: "superlative" },
    ];
  }
  return [{}];
};

export class EnglishMorphologyProvider implements MorphologyProvider {
  readonly id = "language-en.morphology.controlled-v2";
  readonly language = "en";
  readonly #lexicon: LanguageNeutralLexiconIndex;

  constructor(lexicon: LanguageNeutralLexiconIndex = createEnglishSeedLexicon()) {
    this.#lexicon = lexicon;
  }

  analyze(surface: string, context: MorphContext): MorphAnalysis[] {
    if (context.language !== "en") return [];
    const expected = context.partOfSpeech;
    const normalized = caseFoldLexicalSurface(surface, "en");
    const output: MorphAnalysis[] = [];
    const seen = new Set<string>();

    for (const lexeme of this.#lexicon.allLexemes("en")) {
      if (expected !== undefined && lexeme.partOfSpeech !== expected) continue;
      for (const features of featureCandidates(lexeme)) {
        const candidate = realizeSurface(lexeme, features);
        if (caseFoldLexicalSurface(candidate, "en") !== normalized) continue;
        const key = `${lexeme.id}\u0000${JSON.stringify(features)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({
          surface,
          lexemeId: lexeme.id,
          lemma: lexeme.lemma,
          partOfSpeech: lexeme.partOfSpeech,
          features,
          confidence: 1,
          source: "rule",
        });
      }
    }

    for (const match of this.#lexicon.lookupSurface(surface, "en")) {
      const key = `${match.lexemeId}\u0000exact`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        surface,
        lexemeId: match.lexemeId,
        lemma: match.lemma,
        partOfSpeech: match.partOfSpeech,
        features: {},
        confidence: 1,
        source: "lexicon",
      });
    }

    return output.sort((a, b) =>
      (a.lexemeId ?? "").localeCompare(b.lexemeId ?? "") ||
      JSON.stringify(a.features).localeCompare(JSON.stringify(b.features))
    );
  }

  realize(lemma: LexemeId, features: MorphFeatures): SurfaceCandidate[] {
    const lexeme = this.#lexicon.getLexeme(lemma);
    if (lexeme === undefined || lexeme.language !== "en") return [];
    return [
      {
        surface: realizeSurface(lexeme, features),
        lexemeId: lexeme.id,
        features: structuredClone(features),
        confidence: 1,
        source: "rule",
      },
    ];
  }
}

export const englishControlledCoverage = {
  language: "en",
  phenomena: {
    "simple-declaratives": "partial",
    negation: "controlled",
    "yes-no-questions": "partial",
    "wh-questions": "partial",
    imperatives: "unsupported",
    "copular-clauses": "partial",
    transitives: "controlled",
    intransitives: "partial",
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
      "grammar:en.vp.intransitive",
      "VP",
      [{ kind: "lexical", partOfSpeech: "verb", capture: "predicate" }],
      10,
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
