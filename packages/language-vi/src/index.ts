import {
  GrammarRegistry,
  type GrammarCoverageMatrix,
  type GrammarRule,
} from "../../grammar-core/src/index.ts";
import type {
  HumanLanguagePack,
  LanguageConformanceManifest,
  PunctuationProvider,
} from "../../language-pack-core/src/index.ts";
import {
  LanguageNeutralLexiconIndex,
  type Lexeme,
} from "../../lexicon-core/src/index.ts";
import type {
  MorphAnalysis,
  MorphContext,
  MorphFeatures,
  MorphologyProvider,
} from "../../morphology-core/src/index.ts";
import { parseControlledVietnameseCorpus } from "../../grounding/src/index.ts";
import { realizeControlledVietnameseCorpus } from "../../realizer-core/src/index.ts";

export interface VietnameseLanguagePackManifest {
  id: "language.vi";
  languageTag: "vi";
  version: string;
  schemaVersion: "jl-language-pack-1";
  maturity: "experimental" | "candidate";
  capabilities: {
    parsing: boolean;
    realization: boolean;
    morphology: boolean;
    mixedLanguage: boolean;
  };
  coverage: {
    grammarProfile: string;
    lexiconEntries: "dynamic";
  };
  requires: {
    semanticSchema: string;
  };
}

export const vietnameseLanguagePackManifest: VietnameseLanguagePackManifest = {
  id: "language.vi",
  languageTag: "vi",
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
    grammarProfile: "language-vi.controlled-m8",
    lexiconEntries: "dynamic",
  },
  requires: {
    semanticSchema: ">=0.1 <1.0",
  },
};

const lexeme = (
  id: string,
  lemma: string,
  partOfSpeech: Lexeme["partOfSpeech"],
  input: {
    concept?: NonNullable<Lexeme["senses"][number]["concept"]>;
    semanticTag?: string;
    forms?: string[];
  },
): Lexeme => ({
  id,
  language: "vi",
  lemma,
  partOfSpeech,
  ...(input.forms === undefined ? {} : { forms: input.forms }),
  senses: [
    {
      id: id + ".sense.1",
      ...(input.concept === undefined ? {} : { concept: input.concept }),
      ...(input.semanticTag === undefined
        ? {}
        : { semanticTag: input.semanticTag }),
    },
  ],
});

const requireRegistration = (ok: { ok: boolean; error?: Error }): void => {
  if (!ok.ok) {
    throw ok.error ?? new Error("Vietnamese language-pack registration failed.");
  }
};

export const createVietnameseSeedLexicon =
  (): LanguageNeutralLexiconIndex => {
    const index = new LanguageNeutralLexiconIndex();
    const entries: Lexeme[] = [
      lexeme("lexeme:vi.dich-vu", "dịch vụ", "noun", {
        concept: "concept:core.software-service",
      }),
      lexeme("lexeme:vi.tep", "tệp", "noun", {
        concept: "concept:core.file",
        forms: ["tệp tin", "file"],
      }),
      lexeme("lexeme:vi.xoa", "xóa", "verb", {
        concept: "concept:core.delete",
      }),
      lexeme("lexeme:vi.khong", "không", "particle", {
        semanticTag: "polarity.negative",
      }),
      lexeme("lexeme:vi.phai", "phải", "auxiliary", {
        semanticTag: "modality.required",
      }),
      lexeme("lexeme:vi.duoc", "được", "auxiliary", {
        semanticTag: "modality.permitted",
      }),
      lexeme("lexeme:vi.phep", "phép", "noun", {
        semanticTag: "permission.marker",
      }),
      lexeme("lexeme:vi.da", "đã", "particle", {
        semanticTag: "aspect.completed",
      }),
      lexeme("lexeme:vi.dang", "đang", "particle", {
        semanticTag: "aspect.ongoing",
      }),
      lexeme("lexeme:vi.se", "sẽ", "particle", {
        semanticTag: "aspect.planned",
      }),
      lexeme("lexeme:vi.neu", "nếu", "conjunction", {
        semanticTag: "condition.marker",
      }),
      lexeme("lexeme:vi.vi", "vì", "conjunction", {
        semanticTag: "cause.marker",
      }),
      lexeme("lexeme:vi.cai", "cái", "other", {
        semanticTag: "classifier.generic-artifact",
      }),
      lexeme("lexeme:vi.co", "có", "particle", {
        semanticTag: "question.polarity-open",
      }),
      lexeme("lexeme:vi.nao", "nào", "pronoun", {
        semanticTag: "question.indefinite",
      }),
    ];

    for (const entry of entries) {
      requireRegistration(index.registerLexeme(entry));
    }

    requireRegistration(
      index.registerMultiword({
        id: "mwe:vi.khong-duoc-phep",
        language: "vi",
        components: [
          { kind: "fixed", surface: "không" },
          { kind: "fixed", surface: "được" },
          { kind: "fixed", surface: "phép" },
        ],
        syntacticCategory: "MODAL_NEG",
        semanticMapping: "modality.prohibition",
      }),
    );
    requireRegistration(
      index.registerMultiword({
        id: "mwe:vi.duoc-phep",
        language: "vi",
        components: [
          { kind: "fixed", surface: "được" },
          { kind: "fixed", surface: "phép" },
        ],
        syntacticCategory: "MODAL",
        semanticMapping: "modality.permission",
      }),
    );

    return index;
  };

export interface VietnameseToken {
  surface: string;
  normalized: string;
  start: number;
  end: number;
  kind: "word" | "number" | "punctuation" | "symbol";
}

export const tokenizeVietnamese = (source: string): VietnameseToken[] => {
  const normalized = source.normalize("NFC");
  const tokens: VietnameseToken[] = [];
  const pattern = /[\p{L}\p{M}_-]+|\d+(?:[.,]\d+)?|[^\s]/gu;
  for (const match of normalized.matchAll(pattern)) {
    const surface = match[0];
    const start = match.index;
    if (start === undefined) continue;
    const kind: VietnameseToken["kind"] =
      /^\d/u.test(surface)
        ? "number"
        : /^[\p{L}\p{M}_-]+$/u.test(surface)
          ? "word"
          : /^[.,!?;:()[\]{}"“”'‘’]$/u.test(surface)
            ? "punctuation"
            : "symbol";
    tokens.push({
      surface,
      normalized: surface.toLocaleLowerCase("vi"),
      start,
      end: start + surface.length,
      kind,
    });
  }
  return tokens;
};

export class VietnameseMorphologyProvider implements MorphologyProvider {
  readonly id = "language-vi.morphology.analytic-v1";
  readonly language = "vi";
  readonly #lexicon: LanguageNeutralLexiconIndex;

  constructor(lexicon: LanguageNeutralLexiconIndex = createVietnameseSeedLexicon()) {
    this.#lexicon = lexicon;
  }

  analyze(surface: string, context: MorphContext): MorphAnalysis[] {
    if (context.language !== "vi") return [];
    return this.#lexicon.lookupSurface(surface, "vi").map((match) => ({
      surface,
      lemma: match.lemma,
      partOfSpeech: match.partOfSpeech,
      features: {},
      source: "lexicon" as const,
    }));
  }

  realize(lexemeValue: Lexeme, _features: MorphFeatures): string[] {
    if (lexemeValue.language !== "vi") return [];
    return [lexemeValue.lemma];
  }
}

const rule = (
  id: string,
  lhs: string,
  rhs: GrammarRule["rhs"],
  priority = 0,
): GrammarRule => ({
  id,
  language: "vi",
  lhs,
  rhs,
  constraints: [],
  priority,
});

export const createVietnameseControlledGrammar = (): GrammarRegistry => {
  const registry = new GrammarRegistry();
  const rules: GrammarRule[] = [
    rule(
      "grammar:vi.np.service",
      "NP",
      [{ kind: "lexical", partOfSpeech: "noun", capture: "head" }],
      20,
    ),
    rule(
      "grammar:vi.quantity.file",
      "QUANTITY",
      [
        { kind: "lexical", partOfSpeech: "numeral", capture: "amount" },
        { kind: "category", category: "NP", capture: "unit" },
      ],
      20,
    ),
    rule(
      "grammar:vi.quantity.file-classifier",
      "QUANTITY",
      [
        { kind: "lexical", partOfSpeech: "numeral", capture: "amount" },
        { kind: "literal", surface: "cái", capture: "classifier" },
        { kind: "category", category: "NP", capture: "unit" },
      ],
      21,
    ),
    rule(
      "grammar:vi.aspect.event",
      "VP",
      [
        { kind: "lexical", partOfSpeech: "particle", capture: "aspect" },
        { kind: "lexical", partOfSpeech: "verb", capture: "predicate" },
        { kind: "category", category: "QUANTITY", capture: "quantity" },
      ],
      30,
    ),
    rule(
      "grammar:vi.negation",
      "VP",
      [
        {
          kind: "lexical",
          partOfSpeech: "particle",
          semanticTag: "polarity.negative",
          capture: "negation",
        },
        { kind: "lexical", partOfSpeech: "verb", capture: "predicate" },
        { kind: "category", category: "QUANTITY", capture: "quantity" },
      ],
      30,
    ),
    rule(
      "grammar:vi.question.co-khong",
      "QUESTION",
      [
        { kind: "category", category: "NP", capture: "actor" },
        { kind: "literal", surface: "có" },
        { kind: "category", category: "VP", capture: "content" },
        { kind: "literal", surface: "không" },
      ],
      30,
    ),
    rule(
      "grammar:vi.conditional.neu",
      "S",
      [
        { kind: "literal", surface: "nếu" },
        { kind: "category", category: "S", capture: "condition" },
        { kind: "category", category: "S", capture: "consequence" },
      ],
      10,
    ),
    rule(
      "grammar:vi.cause.vi",
      "S",
      [
        { kind: "category", category: "S", capture: "result" },
        { kind: "literal", surface: "vì" },
        { kind: "category", category: "S", capture: "cause" },
      ],
      10,
    ),
  ];

  for (const grammarRule of rules) {
    const registered = registry.register(grammarRule);
    if (!registered.ok) throw registered.error;
  }
  return registry;
};

export const vietnameseCoverage: GrammarCoverageMatrix = {
  language: "vi",
  phenomena: {
    declaratives: "controlled",
    negation: "controlled",
    questions: "controlled",
    classifiers: "controlled",
    aspect: "controlled",
    conditionals: "controlled",
    causality: "controlled",
    modality: "controlled",
    attribution: "controlled",
    "mixed-technical-vocabulary": "partial",
    "serial-verb-constructions": "unsupported",
    "topic-prominent-structures": "partial",
    reduplication: "unsupported",
  },
  notes: {
    morphology:
      "Vietnamese is treated as analytic in the M8 subset; aspect/modal particles are syntax/realization choices rather than inflected tense.",
  },
};

export interface VietnameseClassifierChoice {
  surface?: string;
  required: boolean;
  reason: string;
}

export const selectVietnameseClassifier = (
  concept: string,
  options: { explicitGenericClassifier?: boolean } = {},
): VietnameseClassifierChoice => {
  if (
    concept === "concept:core.file" &&
    options.explicitGenericClassifier === true
  ) {
    return {
      surface: "cái",
      required: false,
      reason:
        "M8 supports an explicit generic-artifact classifier variant while canonical file counts omit it.",
    };
  }
  return {
    required: false,
    reason:
      "No classifier is required by the controlled lexical convention for this concept.",
  };
};

export type VietnameseAspect = "completed" | "ongoing" | "planned";

export const vietnameseAspectMarker = (
  aspect: VietnameseAspect,
): "đã" | "đang" | "sẽ" =>
  aspect === "completed" ? "đã" : aspect === "ongoing" ? "đang" : "sẽ";

export type VietnameseSocialRelation =
  | "formal"
  | "peer"
  | "intimate"
  | "unknown";

export interface VietnameseAddressStrategy {
  speakerForm: string;
  addresseeForm: string;
  politeness: "formal" | "neutral" | "intimate";
}

export const chooseVietnameseAddressStrategy = (
  relation: VietnameseSocialRelation,
): VietnameseAddressStrategy => {
  switch (relation) {
    case "formal":
      return {
        speakerForm: "tôi",
        addresseeForm: "quý vị",
        politeness: "formal",
      };
    case "intimate":
      return {
        speakerForm: "mình",
        addresseeForm: "bạn",
        politeness: "intimate",
      };
    case "peer":
      return {
        speakerForm: "tôi",
        addresseeForm: "bạn",
        politeness: "neutral",
      };
    case "unknown":
      return {
        speakerForm: "tôi",
        addresseeForm: "bạn",
        politeness: "neutral",
      };
  }
};

export const vietnamesePunctuation: PunctuationProvider = {
  id: "language-vi.punctuation.v1",
  language: "vi",
  terminal(kind) {
    return kind === "question" ? "?" : kind === "exclamation" ? "!" : ".";
  },
  join(tokens) {
    return tokens
      .join(" ")
      .replace(/\s+([.,!?;:])/gu, "$1")
      .normalize("NFC");
  },
};

export const vietnameseConformanceManifest: LanguageConformanceManifest = {
  id: "language-vi.conformance.m8",
  language: "vi",
  corpusRefs: [
    "tests/conformance/m8-vietnamese-language-pack.conformance.test.ts",
    "tests/conformance/m8-cross-lingual-equivalence.conformance.test.ts",
  ],
  requiredPhenomena: [
    "negation",
    "questions",
    "classifiers",
    "aspect",
    "conditionals",
    "causality",
    "modality",
    "attribution",
  ],
  determinism: "D0",
};

export const vietnameseLanguagePack = {
  manifest: vietnameseLanguagePackManifest,
  tokenizer: {
    id: "language-vi.tokenizer.controlled-v1",
    language: "vi",
    tokenize: tokenizeVietnamese,
  },
  lexicon: {
    id: "language-vi.lexicon.controlled-v1",
    language: "vi",
    create: createVietnameseSeedLexicon,
  },
  morphology: new VietnameseMorphologyProvider(),
  grammar: {
    id: "language-vi.grammar.controlled-v1",
    language: "vi",
    coverage: vietnameseCoverage,
    create: createVietnameseControlledGrammar,
  },
  parserHooks: {
    id: "language-vi.parser-hooks.controlled-v1",
    language: "vi",
    parse: parseControlledVietnameseCorpus,
  },
  realizationHooks: {
    id: "language-vi.realization-hooks.controlled-v1",
    language: "vi",
    realize: realizeControlledVietnameseCorpus,
  },
  punctuation: vietnamesePunctuation,
  discourse: {
    id: "language-vi.discourse.address-v1",
    language: "vi",
    choose: chooseVietnameseAddressStrategy,
  },
  tests: vietnameseConformanceManifest,
  // Compatibility aliases retained for the M8 public surface; the common ABI
  // routes new integrations through parserHooks/realizationHooks.
  parse: parseControlledVietnameseCorpus,
  realize: realizeControlledVietnameseCorpus,
} satisfies HumanLanguagePack<
  VietnameseToken,
  string,
  ReturnType<typeof parseControlledVietnameseCorpus>,
  Parameters<typeof realizeControlledVietnameseCorpus>[0],
  ReturnType<typeof realizeControlledVietnameseCorpus>,
  VietnameseSocialRelation,
  VietnameseAddressStrategy
>;

export const vietnameseLanguageExtensions = {
  classifier: selectVietnameseClassifier,
  aspectMarker: vietnameseAspectMarker,
  address: chooseVietnameseAddressStrategy,
} as const;
