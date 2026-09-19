import { describe, expect, it } from "vitest";
import {
  analyzeMixedLanguageTokens,
  chooseBorrowingStrategy,
  createOpenWorldLexicalResolverFromPacks,
  OpenWorldLexicalResolver,
} from "../../packages/language-pack-core/src/index.ts";
import {
  LanguageNeutralLexiconIndex,
  preserveUnknownLexicalItem,
  validateLexeme,
  type Lexeme,
} from "../../packages/lexicon-core/src/index.ts";
import {
  EnglishMorphologyProvider,
  createEnglishSeedLexicon,
  englishLanguagePack,
} from "../../packages/language-en/src/index.ts";
import {
  createVietnameseSeedLexicon,
  vietnameseLanguagePack,
} from "../../packages/language-vi/src/index.ts";

describe("M18.1 open-world lexicon and code-switching", () => {
  it("verifies T098-T103 lexeme senses, valency, collocation, index, English seed and morphology foundations", () => {
    const lexicon = createEnglishSeedLexicon();
    const size = lexicon.size();

    expect(size.lexemes).toBeGreaterThanOrEqual(10);
    expect(size.senses).toBeGreaterThanOrEqual(size.lexemes);
    expect(size.multiwords).toBeGreaterThanOrEqual(2);
    expect(size.collocations).toBeGreaterThanOrEqual(1);

    const deleteMatches = lexicon.lookupSurface("delete", "en");
    expect(deleteMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lexemeId: "lexeme:en.delete",
          concept: "concept:core.delete",
          partOfSpeech: "verb",
        }),
      ]),
    );

    const deleteLexeme = lexicon.getLexeme("lexeme:en.delete");
    expect(deleteLexeme?.senses[0]?.valencyFrames?.[0]).toMatchObject({
      id: "frame:en.delete.transitive",
      slots: expect.arrayContaining([
        expect.objectContaining({
          id: "agent",
          role: "role:core.agent",
          required: true,
        }),
        expect.objectContaining({
          id: "patient",
          required: true,
        }),
      ]),
    });

    expect(lexicon.collocations()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collocation:en.delete-file",
          relation: "prefers",
          left: "concept:core.delete",
          right: "concept:core.file",
        }),
      ]),
    );

    const custom = new LanguageNeutralLexiconIndex();
    const deploy: Lexeme = {
      id: "lexeme:en.deploy",
      language: "en",
      lemma: "deploy",
      partOfSpeech: "verb",
      senses: [
        {
          id: "sense:en.deploy.action",
          semanticTag: "software.deploy",
        },
      ],
    };
    expect(custom.registerLexeme(deploy).ok).toBe(true);

    const morphology = new EnglishMorphologyProvider(custom);
    expect(
      morphology.analyze("deployed", {
        language: "en",
        partOfSpeech: "verb",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lemma: "deploy",
          partOfSpeech: "verb",
          features: { tense: "past" },
          source: "rule",
        }),
      ]),
    );
    expect(
      morphology.realize(deploy, { tense: "past" }),
    ).toContain("deployed");
  });

  it("verifies T104 unknown-token preservation without semantic fabrication", () => {
    expect(
      preserveUnknownLexicalItem("FlexNode-Zeta", "en"),
    ).toEqual({
      kind: "unknown-lexical-item",
      language: "en",
      surface: "FlexNode-Zeta",
      preservedExact: true,
    });

    const invalid = validateLexeme({
      id: "lexeme:invalid",
      language: "en",
      lemma: "mystery",
      partOfSpeech: "noun",
      senses: [{ id: "sense:invalid" }],
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe(
        "LEXICON_SENSE_SEMANTICS",
      );
    }
  });

  it("verifies T105 multiword-expression matching", () => {
    const lexicon = createEnglishSeedLexicon();
    expect(
      lexicon.matchMultiword(
        ["delete", "at", "most", "3", "files"],
        "en",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expressionId: "mwe:en.at-most",
          start: 1,
          end: 3,
          semanticMapping: "comparison.at-most",
        }),
      ]),
    );
  });

  it("follows Section 209 order while retaining all evidence-rich alternatives", () => {
    const resolver =
      createOpenWorldLexicalResolverFromPacks([
        englishLanguagePack,
        vietnameseLanguagePack,
      ]);

    const exact = resolver.resolve("service", "en");
    expect(exact.selectedStage).toBe("exact");
    expect(exact.candidates[0]).toMatchObject({
      stage: "exact",
      language: "en",
      confidence: 1,
    });

    const foreign = resolver.resolve("delete", "vi");
    expect(foreign.selectedStage).toBe("foreign");
    expect(foreign.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "foreign",
          language: "en",
          preservedExact: true,
        }),
      ]),
    );

    const compound = resolver.resolve("file-service", "en");
    expect(compound.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "compound",
          language: "en",
          compound: expect.objectContaining({
            separator: "-",
            components: [
              expect.objectContaining({
                surface: "file",
                language: "en",
              }),
              expect.objectContaining({
                surface: "service",
                language: "en",
              }),
            ],
          }),
        }),
      ]),
    );

    const unknown = resolver.resolve(
      "FlexNode-Zeta",
      "en",
      {
        partOfSpeechHint: "noun",
        provisionalParentConcepts: [
          "concept:core.abstract-object",
        ],
      },
    );
    expect(unknown.selectedStage).toBe("named-opaque");
    expect(unknown.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "named-opaque",
          surface: "FlexNode-Zeta",
          preservedExact: true,
        }),
        expect.objectContaining({
          stage: "provisional",
          provisional: expect.objectContaining({
            surface: "FlexNode-Zeta",
            status: "provisional",
            partOfSpeechCandidates: ["noun"],
            parentConceptCandidates: [
              "concept:core.abstract-object",
            ],
          }),
        }),
        expect.objectContaining({
          stage: "opaque",
          preservedExact: true,
        }),
      ]),
    );
  });

  it("marks mixed English/Vietnamese lexical segments without changing shared semantics", () => {
    const resolver =
      createOpenWorldLexicalResolverFromPacks([
        englishLanguagePack,
        vietnameseLanguagePack,
      ]);
    const analysis = analyzeMixedLanguageTokens(
      resolver,
      [
        { surface: "nó", start: 0, end: 2 },
        { surface: "delete", start: 3, end: 9 },
        { surface: "service", start: 10, end: 17 },
      ],
      "vi",
    );

    expect(analysis.codeSwitched).toBe(true);
    expect(analysis.languages).toEqual(["en", "vi"]);
    expect(analysis.tokens.map((token) => token.selectedLanguage)).toEqual([
      "vi",
      "en",
      "en",
    ]);
    expect(analysis.segments).toEqual([
      expect.objectContaining({
        startToken: 0,
        endToken: 1,
        language: "vi",
        tokenSurfaces: ["nó"],
      }),
      expect.objectContaining({
        startToken: 1,
        endToken: 3,
        language: "en",
        tokenSurfaces: ["delete", "service"],
      }),
    ]);
  });

  it("does not accidentally switch language when lexical coverage is missing", () => {
    const targetLexicon = createVietnameseSeedLexicon();
    const sourceLexicon = createEnglishSeedLexicon();

    const targetMatches = targetLexicon.lookupSurface(
      "delete",
      "vi",
    );
    const foreignMatches = sourceLexicon.lookupSurface(
      "delete",
      "en",
    );

    expect(
      chooseBorrowingStrategy({
        surface: "delete",
        targetLanguage: "vi",
        targetMatches,
        foreignMatches,
        permitBorrowing: false,
      }),
    ).toMatchObject({
      strategy: "unsupported",
      surface: "delete",
      targetLanguage: "vi",
    });

    expect(
      chooseBorrowingStrategy({
        surface: "delete",
        targetLanguage: "vi",
        targetMatches,
        foreignMatches,
        permitBorrowing: true,
      }),
    ).toMatchObject({
      strategy: "borrow-source",
      sourceLanguage: "en",
      surface: "delete",
    });

    expect(
      chooseBorrowingStrategy({
        surface: "FlexNode-Zeta",
        targetLanguage: "vi",
        targetMatches: [],
        technicalSymbol: true,
      }),
    ).toMatchObject({
      strategy: "retain-technical-symbol",
      surface: "FlexNode-Zeta",
    });
  });

  it("rejects mixed provider identity instead of silently routing morphology through another language", () => {
    const resolver = new OpenWorldLexicalResolver();
    expect(() =>
      resolver.register({
        language: "vi",
        lexicon: createVietnameseSeedLexicon(),
        morphology: new EnglishMorphologyProvider(),
      }),
    ).toThrow(/does not match lexical provider/u);
  });
});
