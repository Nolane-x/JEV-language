import { describe, expect, it } from "vitest";
import {
  LexiconIndex,
  createEnglishSeedLexicon,
  type Lexeme,
} from "../../packages/lexicon-core/src/index.ts";
import {
  EnglishMorphologyProvider,
} from "../../packages/morphology-core/src/index.ts";
import {
  groundSource,
  type GroundingLexiconProvider,
} from "../../packages/grounding/src/index.ts";
import type { GroundingSource } from "../../packages/open-world-values/src/index.ts";

describe("M5 lexicon and morphology conformance", () => {
  it("keeps lexeme identity separate from semantic senses", () => {
    const lexicon = createEnglishSeedLexicon();
    const bank = lexicon.lookupSurface("bank", { language: "en" });

    expect(bank).toHaveLength(2);
    expect(new Set(bank.map((candidate) => candidate.lexeme.id)).size).toBe(1);
    expect(new Set(bank.map((candidate) => candidate.sense.concept)).size).toBe(2);
  });

  it("indexes concepts without collapsing multiple lexical realizations", () => {
    const lexicon = createEnglishSeedLexicon();
    const entries = lexicon.lookupConcept("concept:core.file", "en");

    expect(entries.map((entry) => entry.lemma)).toEqual(["file"]);
    expect(entries[0]?.id).toBe("lexeme:en.file.n.1");
  });

  it("preserves unknown lexical items instead of failing or inventing a sense", () => {
    const lexicon = createEnglishSeedLexicon();
    const result = lexicon.lookupOrPreserve("ZéroCopyNova", {
      language: "en",
      partOfSpeechCandidates: ["noun"],
    });

    expect(result.kind).toBe("unknown");
    if (result.kind !== "unknown") return;
    expect(result.item.surface).toBe("ZéroCopyNova");
    expect(result.item.normalized).toBe("ZéroCopyNova");
    expect(result.item.caseFolded).toBe("zérocopyNova".toLowerCase());
    expect(result.item.partOfSpeechCandidates).toEqual(["noun"]);
  });

  it("matches a registered multiword expression as one lexical unit", () => {
    const lexicon = createEnglishSeedLexicon();
    const matches = lexicon.matchMultiword(
      ["please", "take", "into", "account", "latency"],
      1,
      "en",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.expression.semanticMapping.senseId).toBe("consider");
    expect(matches[0]).toMatchObject({ start: 1, end: 4 });
  });

  it("validates valency and collocation rules before indexing", () => {
    const lexicon = new LexiconIndex();
    const invalid: Lexeme = {
      id: "lexeme:en.invalid.v.1",
      language: "en",
      lemma: "invalid",
      partOfSpeech: "verb",
      senses: [
        {
          concept: "concept:core.action",
          senseId: "one",
        },
      ],
      valencyFrames: [
        {
          id: "frame:duplicate-role",
          slots: [
            {
              role: "role:core.agent",
              alternatives: [{ function: "subject" }],
            },
            {
              role: "role:core.agent",
              alternatives: [{ function: "direct-object" }],
            },
          ],
        },
      ],
    };

    expect(lexicon.addLexeme(invalid).ok).toBe(false);
  });

  it("realizes deterministic English noun and verb inflection", () => {
    const lexicon = createEnglishSeedLexicon();
    const morphology = new EnglishMorphologyProvider(lexicon);

    expect(
      morphology.realize("lexeme:en.file.n.1", { number: "plural" })[0]?.surface,
    ).toBe("files");
    expect(
      morphology.realize("lexeme:en.delete.v.1", {
        person: 3,
        number: "singular",
        tense: "present",
      })[0]?.surface,
    ).toBe("deletes");
    expect(
      morphology.realize("lexeme:en.delete.v.1", { tense: "past" })[0]?.surface,
    ).toBe("deleted");
    expect(
      morphology.realize("lexeme:en.delete.v.1", {
        aspect: "progressive",
      })[0]?.surface,
    ).toBe("deleting");
  });

  it("analyzes realized forms back to typed morphological candidates", () => {
    const morphology = new EnglishMorphologyProvider(createEnglishSeedLexicon());

    const plural = morphology.analyze("files", {
      language: "en",
      expectedPartOfSpeech: "noun",
    });
    expect(plural).toContainEqual(
      expect.objectContaining({
        lexemeId: "lexeme:en.file.n.1",
        features: { number: "plural" },
      }),
    );

    const past = morphology.analyze("deleted", {
      language: "en",
      expectedPartOfSpeech: "verb",
    });
    expect(past.some((candidate) => candidate.features.verbForm === "past")).toBe(
      true,
    );
  });

  it("integrates through grounding's provider ABI without reversing package dependencies", () => {
    const lexicon = createEnglishSeedLexicon();
    const provider: GroundingLexiconProvider = {
      id: "test.lexicon.en",
      lookup(token, spans) {
        if (token.category !== "word") return [];
        const language =
          spans.find(
            (span) => token.start >= span.start && token.end <= span.end,
          )?.language ?? "en";
        return lexicon
          .lookupSurface(token.text, { language })
          .map((candidate) => ({
            tokenId: token.id,
            language,
            lemma: candidate.lexeme.lemma,
            conceptIds: [candidate.sense.concept],
            score: candidate.lexeme.frequencyBand ?? 0.5,
          }));
      },
    };

    const source: GroundingSource = {
      id: "source:m5",
      version: "1",
      mediaType: "text/plain",
      languageHint: "en",
      content: "service deletes QuuxNova",
      trust: "user-content",
    };
    const result = groundSource(source, { lexiconProviders: [provider] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.tokens.some((token) => token.text === "QuuxNova")).toBe(
      true,
    );
    expect(
      result.value.lexiconMatches.some((match) => match.lemma === "service"),
    ).toBe(true);
    expect(
      result.value.lexiconMatches.some((match) => match.lemma === "QuuxNova"),
    ).toBe(false);
  });
});
