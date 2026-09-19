import { describe, expect, it } from "vitest";
import {
  GrammarRegistry,
  grammarRuleSignature,
  type GrammarRule,
} from "../../packages/grammar-core/src/index.ts";
import {
  LanguageNeutralLexiconIndex,
  preserveUnknownLexicalItem,
  type Lexeme,
} from "../../packages/lexicon-core/src/index.ts";
import {
  createEnglishControlledGrammar,
  createEnglishSeedLexicon,
  EnglishMorphologyProvider,
} from "../../packages/language-en/src/index.ts";

describe("lexicon core", () => {
  it("indexes lexical senses by exact language/surface and concept", () => {
    const lexicon = createEnglishSeedLexicon();
    const service = lexicon.lookupSurface("service", "en");
    expect(service).toHaveLength(1);
    expect(service[0]?.concept).toBe("concept:core.software-service");

    const files = lexicon.lookupConcept("concept:core.file", "en");
    expect(files.map((entry) => entry.lemma)).toEqual(["file"]);
  });

  it("preserves lexical ambiguity instead of collapsing senses", () => {
    const lexicon = new LanguageNeutralLexiconIndex();
    const ambiguous: Lexeme = {
      id: "lexeme:test.bank",
      language: "en",
      lemma: "bank",
      partOfSpeech: "noun",
      senses: [
        {
          senseId: "sense:test.bank.storage",
          concept: "concept:core.entity",
          gloss: "a storage-like bank",
        },
        {
          senseId: "sense:test.bank.file",
          concept: "concept:core.file",
          gloss: "fixture second sense",
        },
      ],
    };
    expect(lexicon.registerLexeme(ambiguous).ok).toBe(true);
    expect(lexicon.lookupSurface("bank", "en")).toHaveLength(2);
  });

  it("matches multiword expressions compositionally", () => {
    const lexicon = createEnglishSeedLexicon();
    const matches = lexicon.matchMultiword(
      ["delete", "more", "than", "3", "files"],
      "en",
    );
    expect(matches).toContainEqual(
      expect.objectContaining({
        expressionId: "mwe:en.more-than",
        start: 1,
        end: 3,
        semanticMapping: {\n          concept: "concept:core.comparison",\n          senseId: "comparison.more-than",\n        },
      }),
    );
  });

  it("preserves unknown lexical items exactly", () => {
    expect(preserveUnknownLexicalItem("QuuxFlux_Node-7", "en")).toEqual({
      kind: "unknown-lexical-item",
      language: "en",
      surface: "QuuxFlux_Node-7",
      normalized: "QuuxFlux_Node-7",
      caseFolded: "quuxflux_node-7",
      preservedExact: true,
      partOfSpeechCandidates: [],
    });
  });

  it("retains valency and collocation engineering assets", () => {
    const lexicon = createEnglishSeedLexicon();
    const deletion = lexicon.getLexeme("lexeme:en.delete");
    expect(
      deletion?.valencyFrames?.[0]?.slots.map((slot) => ({
        id: slot.id,
        required: slot.required,
      })),
    ).toEqual([
      { id: "agent", required: false },
      { id: "theme", required: true },
    ]);
    expect(lexicon.collocations()).toContainEqual(
      expect.objectContaining({ id: "collocation:en.delete-file" }),
    );
  });
});

describe("controlled English morphology", () => {
  it("realizes deterministic noun and verb morphology", () => {
    const lexicon = createEnglishSeedLexicon();
    const morphology = new EnglishMorphologyProvider(lexicon);
    const file = lexicon.getLexeme("lexeme:en.file");
    const deletion = lexicon.getLexeme("lexeme:en.delete");
    expect(file).toBeDefined();
    expect(deletion).toBeDefined();
    if (file === undefined || deletion === undefined) return;

    expect(morphology.realize(file.id, { number: "plural" }).map((x) => x.surface)).toContain("files");
    expect(morphology.realize(deletion.id, { tense: "past" }).map((x) => x.surface)).toContain("deleted");
    expect(morphology.realize(deletion, { aspect: "progressive" })).toContain(
      "deleting",
    );
    expect(
      morphology.realize(deletion.id, {
        tense: "present",
        person: "third",
        number: "singular",
      }).map((x) => x.surface),
    ).toContain("deletes");
  });

  it("analyzes controlled inflections back to known lemmas", () => {
    const morphology = new EnglishMorphologyProvider();
    expect(
      morphology
        .analyze("files", { language: "en" })
        .some((analysis) => analysis.lemma === "file"),
    ).toBe(true);
    expect(
      morphology
        .analyze("deleted", { language: "en" })
        .some((analysis) => analysis.lemma === "delete"),
    ).toBe(true);
  });
});

describe("grammar core", () => {
  it("registers compositional rules and exposes controlled coverage", () => {
    const grammar = createEnglishControlledGrammar();
    expect(grammar.size()).toBeGreaterThanOrEqual(8);
    expect(grammar.rulesFor("en", "S").length).toBeGreaterThanOrEqual(3);
  });

  it("rejects structurally duplicate rules even with different IDs", () => {
    const registry = new GrammarRegistry();
    const first: GrammarRule = {
      id: "grammar:test.a",
      language: "x-test",
      lhs: "S",
      rhs: [
        { kind: "category", category: "NP" },
        { kind: "category", category: "VP" },
      ],
      constraints: [],
    };
    const second: GrammarRule = {
      ...first,
      id: "grammar:test.b",
    };

    expect(registry.register(first).ok).toBe(true);
    const duplicate = registry.register(second);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe("GRAMMAR_RULE_STRUCTURAL_DUPLICATE");
    }
    expect(grammarRuleSignature(first)).toBe(grammarRuleSignature(second));
  });

  it("preserves executable grammar constraints and semantic callbacks in registry clones", () => {
    const registry = new GrammarRegistry();
    const rule: GrammarRule = {
      id: "grammar:test.executable",
      language: "x-test",
      lhs: "S",
      rhs: [{ kind: "category", category: "NP", capture: "subject" }],
      constraints: [
        {
          id: "constraint:test.always",
          description: "fixture",
          check: () => true,
        },
      ],
      semanticConstruction: {
        id: "semantic:test.noop",
        construct: () => ({ ok: true, value: [] }),
      },
    };

    expect(registry.register(rule).ok).toBe(true);
    const loaded = registry.get(rule.id);
    expect(loaded?.constraints[0]?.check({
      language: "x-test",
      ruleId: rule.id,
      binding: {
        categories: {},
        surfaces: {},
        lexical: {},
        features: {},
      },
    })).toBe(true);
    expect(
      loaded?.semanticConstruction?.construct({
        categories: {},
        surfaces: {},
        lexical: {},
        features: {},
      }),
    ).toEqual({ ok: true, value: [] });
  });
});
