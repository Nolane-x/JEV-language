import { describe, expect, it } from "vitest";
import {
  STANDARD_GRAMMAR_CATEGORIES,
  STANDARD_GRAMMAR_FEATURES,
  validateGrammarRule,
  type GrammarRule,
} from "../../packages/grammar-core/src/index.ts";
import {
  buildPackedGrammarForest,
  type GrammarToken,
} from "../../packages/parser-core/src/index.ts";
import {
  createEnglishControlledGrammar,
  englishControlledCoverage,
  englishGrammarTokens,
  parseEnglishGrammarToJsg,
  parseEnglishSyntaxForest,
} from "../../packages/language-en/src/index.ts";

const nounMatch = {
  lexemeId: "lexeme:test.service",
  senseId: "sense:test.service",
  language: "en",
  lemma: "service",
  partOfSpeech: "noun" as const,
  surface: "service",
  concept: "concept:core.software-service",
};

const ruleIds = (
  forest: Extract<
    ReturnType<typeof parseEnglishSyntaxForest>,
    { ok: true }
  >["value"],
): Set<string> =>
  new Set(
    forest.nodes.flatMap((node) =>
      node.alternatives.map((alternative) => alternative.ruleId),
    ),
  );

describe("M18.2 grammar/parser expansion conformance", () => {
  it("defines reusable grammar categories/features and validates feature constraints", () => {
    expect(STANDARD_GRAMMAR_CATEGORIES).toEqual(
      expect.arrayContaining([
        "S",
        "NP",
        "VP",
        "QUESTION",
        "QUANTITY",
        "TIME",
      ]),
    );
    expect(STANDARD_GRAMMAR_FEATURES).toEqual(
      expect.arrayContaining([
        "number",
        "tense",
        "polarity",
        "modality",
        "question",
        "comparator",
        "temporal",
      ]),
    );

    const valid = validateGrammarRule({
      id: "grammar:test.plural-noun",
      language: "en",
      lhs: "NP",
      rhs: [
        {
          kind: "lexical",
          partOfSpeech: "noun",
          featureConstraints: [
            { feature: "number", equals: "plural" },
          ],
        },
      ],
      constraints: [],
      resultFeatures: { number: "plural" },
    });
    expect(valid.ok).toBe(true);

    const invalid = validateGrammarRule({
      id: "grammar:test.invalid-feature",
      language: "en",
      lhs: "NP",
      rhs: [
        {
          kind: "lexical",
          partOfSpeech: "noun",
          featureConstraints: [
            {
              feature: "number",
              equals: "plural",
              oneOf: ["singular"],
            },
          ],
        },
      ],
      constraints: [],
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe(
        "GRAMMAR_FEATURE_CONSTRAINT",
      );
    }
  });

  it("enforces token feature constraints in the packed chart parser", () => {
    const tokens: GrammarToken[] = [
      {
        surface: "services",
        normalized: "services",
        lexical: [
          {
            ...nounMatch,
            surface: "services",
          },
        ],
        features: { number: "plural" },
      },
    ];
    const pluralRule: GrammarRule = {
      id: "grammar:test.np.plural",
      language: "en",
      lhs: "NP",
      rhs: [
        {
          kind: "lexical",
          partOfSpeech: "noun",
          featureConstraints: [
            { feature: "number", equals: "plural" },
          ],
        },
      ],
      constraints: [],
    };
    const singularRule: GrammarRule = {
      id: "grammar:test.np.singular",
      language: "en",
      lhs: "NP",
      rhs: [
        {
          kind: "lexical",
          partOfSpeech: "noun",
          featureConstraints: [
            { feature: "number", equals: "singular" },
          ],
        },
      ],
      constraints: [],
    };

    const parsed = buildPackedGrammarForest(tokens, {
      language: "en",
      rules: [pluralRule, singularRule],
      rootCategories: ["NP"],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const root = parsed.value.nodes.find(
      (node) => node.id === parsed.value.roots[0],
    );
    expect(root?.alternatives.map((alt) => alt.ruleId)).toEqual([
      "grammar:test.np.plural",
    ]);
  });

  it("packs syntactic ambiguity into one span/category node with multiple alternatives", () => {
    const tokens: GrammarToken[] = [
      {
        surface: "service",
        normalized: "service",
        lexical: [nounMatch],
      },
    ];
    const rules: GrammarRule[] = [
      {
        id: "grammar:test.np.analysis-a",
        language: "en",
        lhs: "NP",
        rhs: [{ kind: "lexical", partOfSpeech: "noun" }],
        constraints: [],
        priority: 2,
      },
      {
        id: "grammar:test.np.analysis-b",
        language: "en",
        lhs: "NP",
        rhs: [{ kind: "lexical", partOfSpeech: "noun" }],
        constraints: [],
        priority: 1,
      },
    ];

    const parsed = buildPackedGrammarForest(tokens, {
      language: "en",
      rules,
      rootCategories: ["NP"],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.roots).toHaveLength(1);
    const root = parsed.value.nodes.find(
      (node) => node.id === parsed.value.roots[0],
    );
    expect(root?.alternatives.map((alt) => alt.ruleId)).toEqual([
      "grammar:test.np.analysis-a",
      "grammar:test.np.analysis-b",
    ]);
  });

  it.each([
    [
      "The service is active.",
      "grammar:en.vp.copula-adjective",
      "copular clause",
    ],
    [
      "The service runs.",
      "grammar:en.vp.intransitive",
      "intransitive clause",
    ],
    [
      "The service deletes files.",
      "grammar:en.vp.transitive",
      "transitive clause",
    ],
    [
      "The service does not delete files.",
      "grammar:en.vp.negation-do",
      "negation",
    ],
    [
      "The service may delete files.",
      "grammar:en.modal.permitted",
      "modal clause",
    ],
    [
      "Does the service delete files?",
      "grammar:en.question.yes-no-do",
      "yes/no question",
    ],
    [
      "What does the service delete files?",
      "grammar:en.question.wh-do",
      "wh question",
    ],
    [
      "The service runs and the service runs.",
      "grammar:en.s.coordination-and",
      "coordination",
    ],
    [
      "If the service runs the service runs.",
      "grammar:en.conditional.if",
      "conditional",
    ],
    [
      "The service runs because the service runs.",
      "grammar:en.causal.because",
      "causal clause",
    ],
    [
      "The service deletes exactly 2 files.",
      "grammar:en.quantity.exact",
      "quantity adjunct",
    ],
    [
      "The service runs today.",
      "grammar:en.s.time-adjunct",
      "time adjunct",
    ],
  ])(
    "parses %s and exposes the expected grammar construction (%s)",
    (source, expectedRule) => {
      const parsed = parseEnglishSyntaxForest(source);
      expect(parsed.ok, source).toBe(true);
      if (!parsed.ok) return;
      expect(ruleIds(parsed.value).has(expectedRule)).toBe(true);
    },
  );

  it("keeps every M18.2 English phenomenon truthfully marked controlled or unsupported", () => {
    expect(englishControlledCoverage.phenomena).toMatchObject({
      "simple-declaratives": "controlled",
      negation: "controlled",
      "yes-no-questions": "controlled",
      "wh-questions": "controlled",
      "copular-clauses": "controlled",
      transitives: "controlled",
      intransitives: "controlled",
      coordination: "controlled",
      conditionals: "controlled",
      modals: "controlled",
      quantification: "controlled",
      "time-adjuncts": "controlled",
      "causal-adjuncts": "controlled",
      imperatives: "unsupported",
    });

    const grammar = createEnglishControlledGrammar();
    expect(grammar.size()).toBeGreaterThanOrEqual(20);
  });

  it.each([
    [
      "The service deletes exactly 2 files.",
      ["simple-event", "exact-quantity"],
    ],
    [
      "The service must not delete more than 3 files.",
      ["requirement", "negation", "comparison"],
    ],
    [
      "May the service delete exactly 2 files?",
      ["question", "permission", "exact-quantity"],
    ],
  ])(
    "maps supported syntax to JSG without discarding syntax evidence: %s",
    (source, phenomena) => {
      const parsed = parseEnglishGrammarToJsg(source);
      expect(parsed.ok, source).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.forest.roots.length).toBeGreaterThan(0);
      expect(parsed.value.semantic.roots.length).toBeGreaterThan(0);
      expect(parsed.value.semantic.phenomena).toEqual(
        expect.arrayContaining(phenomena),
      );
    },
  );

  it("does not invent JSG semantics for syntax whose semantic construction is not implemented", () => {
    const syntax = parseEnglishSyntaxForest("The service runs.");
    expect(syntax.ok).toBe(true);

    const semantic = parseEnglishGrammarToJsg(
      "The service runs.",
    );
    expect(semantic.ok).toBe(false);
  });

  it("produces lexical and morphology evidence for English grammar tokens", () => {
    const tokens = englishGrammarTokens(
      "The services delete exactly 2 files.",
    );
    expect(tokens.map((token) => token.normalized)).toEqual([
      "the",
      "services",
      "delete",
      "exactly",
      "2",
      "files",
    ]);
    expect(
      tokens[1]?.lexical.some(
        (match) =>
          match.lemma === "service" &&
          match.partOfSpeech === "noun",
      ),
    ).toBe(true);
    expect(tokens[1]?.features?.number).toBe("plural");
    expect(tokens[4]?.lexical[0]).toMatchObject({
      partOfSpeech: "numeral",
      semanticTag: "quantity.number",
    });
  });
});
