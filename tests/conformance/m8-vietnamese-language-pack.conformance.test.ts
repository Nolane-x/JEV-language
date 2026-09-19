import { describe, expect, it } from "vitest";
import {
  chooseVietnameseAddressStrategy,
  createVietnameseControlledGrammar,
  createVietnameseSeedLexicon,
  selectVietnameseClassifier,
  tokenizeVietnamese,
  vietnameseAspectMarker,
  vietnameseCoverage,
  vietnameseLanguagePack,
  vietnameseLanguagePackManifest,
  VietnameseMorphologyProvider,
} from "../../packages/language-vi/src/index.ts";

describe("M8 Vietnamese language-pack foundation", () => {
  it("declares an independent language-pack manifest and support matrix", () => {
    expect(vietnameseLanguagePackManifest).toMatchObject({
      id: "language.vi",
      languageTag: "vi",
      schemaVersion: "jl-language-pack-1",
      capabilities: {
        parsing: true,
        realization: true,
        morphology: true,
        mixedLanguage: true,
      },
    });
    expect(vietnameseCoverage.phenomena).toMatchObject({
      negation: "controlled",
      questions: "controlled",
      classifiers: "controlled",
      aspect: "controlled",
      conditionals: "controlled",
      causality: "controlled",
      modality: "controlled",
    });
    expect(vietnameseLanguagePack.parse).toBeTypeOf("function");
    expect(vietnameseLanguagePack.realize).toBeTypeOf("function");
  });

  it("tokenizes NFC Vietnamese without assuming one code point equals one user-visible word", () => {
    const decomposed = "Dịch vụ đang xóa 3 tệp.";
    const tokens = tokenizeVietnamese(decomposed);
    expect(tokens.map((token) => token.surface)).toEqual([
      "Dịch",
      "vụ",
      "đang",
      "xóa",
      "3",
      "tệp",
      ".",
    ]);
    expect(tokens.every((token) => token.end > token.start)).toBe(true);
  });

  it("seeds Vietnamese lexicon and treats morphology as analytic", () => {
    const lexicon = createVietnameseSeedLexicon();
    expect(lexicon.lookupSurface("dịch vụ", "vi")[0]?.concept).toBe(
      "concept:core.software-service",
    );
    expect(lexicon.lookupSurface("tệp tin", "vi")[0]?.concept).toBe(
      "concept:core.file",
    );
    expect(lexicon.lookupSurface("xóa", "vi")[0]?.concept).toBe(
      "concept:core.delete",
    );

    const morphology = new VietnameseMorphologyProvider(lexicon);
    const analysis = morphology.analyze("xóa", {
      language: "vi",
      partOfSpeech: "verb",
    });
    expect(analysis[0]).toMatchObject({
      lemma: "xóa",
      partOfSpeech: "verb",
      features: {},
    });

    const deleteLexeme = lexicon
      .lookupSurface("xóa", "vi")
      .map((match) => match.lexemeId)[0];
    expect(deleteLexeme).toBeDefined();
  });

  it("registers Vietnamese clause, negation, question, classifier, aspect, conditional and causal grammar alternatives", () => {
    const grammar = createVietnameseControlledGrammar();
    expect(grammar.rulesFor("vi", "QUANTITY").map((rule) => rule.id)).toEqual(
      expect.arrayContaining([
        "grammar:vi.quantity.file",
        "grammar:vi.quantity.file-classifier",
      ]),
    );
    expect(grammar.rulesFor("vi", "QUESTION")[0]?.id).toBe(
      "grammar:vi.question.co-khong",
    );
    expect(grammar.rulesFor("vi", "VP").map((rule) => rule.id)).toEqual(
      expect.arrayContaining([
        "grammar:vi.aspect.event",
        "grammar:vi.negation",
      ]),
    );
  });

  it("keeps classifier and aspect decisions language-specific", () => {
    expect(
      selectVietnameseClassifier("concept:core.file", {
        explicitGenericClassifier: true,
      }),
    ).toMatchObject({
      surface: "cái",
      required: false,
    });
    expect(
      selectVietnameseClassifier("concept:core.file"),
    ).toMatchObject({ required: false });

    expect(vietnameseAspectMarker("completed")).toBe("đã");
    expect(vietnameseAspectMarker("ongoing")).toBe("đang");
    expect(vietnameseAspectMarker("planned")).toBe("sẽ");
  });

  it("models address/politeness as a Vietnamese strategy rather than a universal pronoun constant", () => {
    expect(chooseVietnameseAddressStrategy("formal")).toEqual({
      speakerForm: "tôi",
      addresseeForm: "quý vị",
      politeness: "formal",
    });
    expect(chooseVietnameseAddressStrategy("peer")).toEqual({
      speakerForm: "tôi",
      addresseeForm: "bạn",
      politeness: "neutral",
    });
    expect(chooseVietnameseAddressStrategy("intimate")).toEqual({
      speakerForm: "mình",
      addresseeForm: "bạn",
      politeness: "intimate",
    });
  });
});
