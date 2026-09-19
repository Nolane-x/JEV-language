import { sha256 } from "../../core-types/src/index.ts";
import type {
  LanguageNeutralLexiconIndex,
  LexicalMatch,
  PartOfSpeech,
} from "../../lexicon-core/src/index.ts";
import type {
  MorphAnalysis,
  MorphologyProvider,
} from "../../morphology-core/src/index.ts";

export type LexicalResolutionStage =
  | "exact"
  | "named-opaque"
  | "morphology"
  | "compound"
  | "foreign"
  | "provisional"
  | "opaque";

export interface LexicalResolutionProvider {
  language: string;
  lexicon: LanguageNeutralLexiconIndex;
  morphology?: MorphologyProvider;
}

export interface ProvisionalLexicalSenseProposal {
  id: string;
  surface: string;
  language?: string;
  partOfSpeechCandidates: PartOfSpeech[];
  parentConceptCandidates: string[];
  status: "provisional";
  confidence: number;
  evidence: string[];
}

export interface CompoundLexicalResolution {
  separator: "-" | "/" | "_";
  components: Array<{
    surface: string;
    language: string;
    matches: LexicalMatch[];
  }>;
}

export interface LexicalResolutionCandidate {
  stage: LexicalResolutionStage;
  surface: string;
  language?: string;
  confidence: number;
  matches?: LexicalMatch[];
  morphology?: MorphAnalysis[];
  compound?: CompoundLexicalResolution;
  provisional?: ProvisionalLexicalSenseProposal;
  preservedExact: boolean;
  evidence: string[];
}

export interface OpenWorldLexicalResolution {
  surface: string;
  primaryLanguage: string;
  candidates: LexicalResolutionCandidate[];
  resolved: boolean;
  selectedStage: LexicalResolutionStage;
}

export interface ResolveLexicalOptions {
  partOfSpeechHint?: PartOfSpeech;
  provisionalParentConcepts?: string[];
  allowForeign?: boolean;
  allowCompound?: boolean;
}

const normalized = (value: string): string =>
  value.normalize("NFC").toLocaleLowerCase();

const properOrTechnicalSurface = (surface: string): boolean =>
  /[A-Z].*[A-Z]|^[A-Z][\p{L}\p{N}_-]*$|[._/-]/u.test(surface);

const lexicalMatchesForMorphology = (
  provider: LexicalResolutionProvider,
  surface: string,
  partOfSpeechHint?: PartOfSpeech,
): {
  analyses: MorphAnalysis[];
  matches: LexicalMatch[];
} => {
  if (provider.morphology === undefined) {
    return { analyses: [], matches: [] };
  }

  const analyses = provider.morphology
    .analyze(surface, {
      language: provider.language,
      ...(partOfSpeechHint === undefined
        ? {}
        : { partOfSpeech: partOfSpeechHint }),
    })
    .filter(
      (analysis) =>
        partOfSpeechHint === undefined ||
        analysis.partOfSpeech === undefined ||
        analysis.partOfSpeech === partOfSpeechHint,
    );

  const matches: LexicalMatch[] = [];
  const seen = new Set<string>();
  for (const analysis of analyses) {
    for (const match of provider.lexicon.lookupSurface(
      analysis.lemma,
      provider.language,
    )) {
      if (
        partOfSpeechHint !== undefined &&
        match.partOfSpeech !== partOfSpeechHint
      ) {
        continue;
      }
      const key = `${match.lexemeId}\u0000${match.senseId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(match);
    }
  }

  return { analyses, matches };
};

const splitCompound = (
  surface: string,
): {
  separator: "-" | "/" | "_";
  components: string[];
} | undefined => {
  for (const separator of ["-", "/", "_"] as const) {
    if (!surface.includes(separator)) continue;
    const components = surface
      .split(separator)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (components.length > 1) return { separator, components };
  }
  return undefined;
};

const exactOrMorphologicalMatches = (
  provider: LexicalResolutionProvider,
  surface: string,
  partOfSpeechHint?: PartOfSpeech,
): LexicalMatch[] => {
  const exact = provider.lexicon
    .lookupSurface(surface, provider.language)
    .filter(
      (match) =>
        partOfSpeechHint === undefined ||
        match.partOfSpeech === partOfSpeechHint,
    );
  if (exact.length > 0) return exact;
  return lexicalMatchesForMorphology(
    provider,
    surface,
    partOfSpeechHint,
  ).matches;
};

const provisionalProposal = (
  surface: string,
  language: string | undefined,
  options: ResolveLexicalOptions,
): ProvisionalLexicalSenseProposal => ({
  id: `provisional-lexical:${sha256(
    JSON.stringify([surface.normalize("NFC"), language ?? "und"]),
  ).slice(0, 24)}`,
  surface,
  ...(language === undefined ? {} : { language }),
  partOfSpeechCandidates:
    options.partOfSpeechHint === undefined
      ? []
      : [options.partOfSpeechHint],
  parentConceptCandidates: [
    ...(options.provisionalParentConcepts ?? []),
  ],
  status: "provisional",
  confidence:
    options.partOfSpeechHint === undefined &&
    (options.provisionalParentConcepts?.length ?? 0) === 0
      ? 0
      : 0.5,
  evidence: [
    "no-established-lexical-match",
    ...(options.partOfSpeechHint === undefined
      ? []
      : [`syntactic-pos-hint:${options.partOfSpeechHint}`]),
    ...(options.provisionalParentConcepts ?? []).map(
      (concept) => `context-parent-candidate:${concept}`,
    ),
  ],
});

export class OpenWorldLexicalResolver {
  readonly #providers = new Map<string, LexicalResolutionProvider>();

  constructor(providers: readonly LexicalResolutionProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: LexicalResolutionProvider): void {
    if (provider.language.trim() === "") {
      throw new Error("Lexical resolution provider language is required.");
    }
    if (this.#providers.has(provider.language)) {
      throw new Error(
        `Lexical resolution provider already registered for ${provider.language}.`,
      );
    }
    if (
      provider.morphology !== undefined &&
      provider.morphology.language !== provider.language
    ) {
      throw new Error(
        `Morphology provider language ${provider.morphology.language} does not match lexical provider ${provider.language}.`,
      );
    }
    this.#providers.set(provider.language, provider);
  }

  languages(): string[] {
    return [...this.#providers.keys()].sort();
  }

  resolve(
    surface: string,
    primaryLanguage: string,
    options: ResolveLexicalOptions = {},
  ): OpenWorldLexicalResolution {
    const primary = this.#providers.get(primaryLanguage);
    if (primary === undefined) {
      throw new Error(
        `No lexical resolution provider registered for ${primaryLanguage}.`,
      );
    }

    const candidates: LexicalResolutionCandidate[] = [];
    const exact = primary.lexicon
      .lookupSurface(surface, primaryLanguage)
      .filter(
        (match) =>
          options.partOfSpeechHint === undefined ||
          match.partOfSpeech === options.partOfSpeechHint,
      );

    if (exact.length > 0) {
      candidates.push({
        stage: "exact",
        surface,
        language: primaryLanguage,
        confidence: 1,
        matches: exact,
        preservedExact: true,
        evidence: ["primary-lexicon-exact"],
      });
      return {
        surface,
        primaryLanguage,
        candidates,
        resolved: true,
        selectedStage: "exact",
      };
    }

    if (properOrTechnicalSurface(surface)) {
      candidates.push({
        stage: "named-opaque",
        surface,
        confidence: 0.9,
        preservedExact: true,
        evidence: ["named-or-technical-surface-shape"],
      });
    }

    const morphological = lexicalMatchesForMorphology(
      primary,
      surface,
      options.partOfSpeechHint,
    );
    if (
      morphological.analyses.length > 0 &&
      morphological.matches.length > 0
    ) {
      candidates.push({
        stage: "morphology",
        surface,
        language: primaryLanguage,
        confidence: 0.85,
        matches: morphological.matches,
        morphology: morphological.analyses,
        preservedExact: true,
        evidence: ["primary-morphology-to-known-lemma"],
      });
    }

    if (options.allowCompound !== false) {
      const split = splitCompound(surface);
      if (split !== undefined) {
        const components = split.components.map((component) => ({
          surface: component,
          language: primaryLanguage,
          matches: exactOrMorphologicalMatches(
            primary,
            component,
            options.partOfSpeechHint,
          ),
        }));
        if (components.every((component) => component.matches.length > 0)) {
          candidates.push({
            stage: "compound",
            surface,
            language: primaryLanguage,
            confidence: 0.75,
            compound: {
              separator: split.separator,
              components,
            },
            preservedExact: true,
            evidence: ["primary-compound-decomposition"],
          });
        }
      }
    }

    if (options.allowForeign !== false) {
      for (const language of this.languages()) {
        if (language === primaryLanguage) continue;
        const provider = this.#providers.get(language);
        if (provider === undefined) continue;
        const matches = exactOrMorphologicalMatches(
          provider,
          surface,
          options.partOfSpeechHint,
        );
        if (matches.length === 0) continue;
        candidates.push({
          stage: "foreign",
          surface,
          language,
          confidence: 0.8,
          matches,
          preservedExact: true,
          evidence: [
            `foreign-code-switch-lexicon:${language}`,
          ],
        });
      }
    }

    const provisional = provisionalProposal(
      surface,
      primaryLanguage,
      options,
    );
    candidates.push({
      stage: "provisional",
      surface,
      language: primaryLanguage,
      confidence: provisional.confidence,
      provisional,
      preservedExact: true,
      evidence: [...provisional.evidence],
    });

    candidates.push({
      stage: "opaque",
      surface,
      confidence: 0,
      preservedExact: true,
      evidence: ["unresolved-exact-surface-preservation"],
    });

    const selected =
      candidates.find((candidate) =>
        [
          "named-opaque",
          "morphology",
          "compound",
          "foreign",
        ].includes(candidate.stage),
      ) ?? candidates[candidates.length - 1]!;

    return {
      surface,
      primaryLanguage,
      candidates,
      resolved:
        selected.stage !== "opaque" &&
        selected.stage !== "provisional",
      selectedStage: selected.stage,
    };
  }
}

export interface MixedLanguageToken {
  surface: string;
  start: number;
  end: number;
}

export interface TokenLanguageHypothesis {
  language: string;
  confidence: number;
  stage: LexicalResolutionStage;
}

export interface MixedLanguageTokenAnalysis {
  token: MixedLanguageToken;
  resolution: OpenWorldLexicalResolution;
  languageHypotheses: TokenLanguageHypothesis[];
  selectedLanguage: string;
}

export interface MixedLanguageSegment {
  startToken: number;
  endToken: number;
  start: number;
  end: number;
  language: string;
  tokenSurfaces: string[];
}

export interface MixedLanguageAnalysis {
  primaryLanguage: string;
  tokens: MixedLanguageTokenAnalysis[];
  segments: MixedLanguageSegment[];
  languages: string[];
  codeSwitched: boolean;
}

const hypothesesFor = (
  resolution: OpenWorldLexicalResolution,
): TokenLanguageHypothesis[] => {
  const best = new Map<string, TokenLanguageHypothesis>();
  for (const candidate of resolution.candidates) {
    if (candidate.language === undefined) continue;
    if (
      !["exact", "morphology", "compound", "foreign"].includes(
        candidate.stage,
      )
    ) {
      continue;
    }
    const current = best.get(candidate.language);
    if (
      current === undefined ||
      candidate.confidence > current.confidence
    ) {
      best.set(candidate.language, {
        language: candidate.language,
        confidence: candidate.confidence,
        stage: candidate.stage,
      });
    }
  }
  return [...best.values()].sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.language.localeCompare(b.language),
  );
};

export const analyzeMixedLanguageTokens = (
  resolver: OpenWorldLexicalResolver,
  tokens: readonly MixedLanguageToken[],
  primaryLanguage: string,
  options: ResolveLexicalOptions = {},
): MixedLanguageAnalysis => {
  const analyses: MixedLanguageTokenAnalysis[] = tokens.map((token) => {
    const resolution = resolver.resolve(
      token.surface,
      primaryLanguage,
      options,
    );
    const languageHypotheses = hypothesesFor(resolution);
    return {
      token: structuredClone(token),
      resolution,
      languageHypotheses,
      selectedLanguage:
        languageHypotheses[0]?.language ?? "und",
    };
  });

  const segments: MixedLanguageSegment[] = [];
  for (let index = 0; index < analyses.length; index += 1) {
    const analysis = analyses[index]!;
    const previous = segments[segments.length - 1];
    if (
      previous !== undefined &&
      previous.language === analysis.selectedLanguage
    ) {
      previous.endToken = index + 1;
      previous.end = analysis.token.end;
      previous.tokenSurfaces.push(analysis.token.surface);
      continue;
    }
    segments.push({
      startToken: index,
      endToken: index + 1,
      start: analysis.token.start,
      end: analysis.token.end,
      language: analysis.selectedLanguage,
      tokenSurfaces: [analysis.token.surface],
    });
  }

  const languages = [
    ...new Set(
      analyses
        .map((analysis) => analysis.selectedLanguage)
        .filter((language) => language !== "und"),
    ),
  ].sort();

  return {
    primaryLanguage,
    tokens: analyses,
    segments,
    languages,
    codeSwitched: languages.length > 1,
  };
};

export type BorrowingStrategy =
  | "target-established"
  | "borrow-source"
  | "retain-technical-symbol"
  | "opaque-preservation"
  | "unsupported";

export interface BorrowingDecision {
  strategy: BorrowingStrategy;
  surface: string;
  targetLanguage: string;
  sourceLanguage?: string;
  reason: string;
}

export const chooseBorrowingStrategy = (input: {
  surface: string;
  targetLanguage: string;
  targetMatches: readonly LexicalMatch[];
  foreignMatches?: readonly LexicalMatch[];
  technicalSymbol?: boolean;
  permitBorrowing?: boolean;
}): BorrowingDecision => {
  if (input.targetMatches.length > 0) {
    return {
      strategy: "target-established",
      surface: input.surface,
      targetLanguage: input.targetLanguage,
      reason: "target lexicon contains an established lexical mapping",
    };
  }
  if (input.technicalSymbol === true) {
    return {
      strategy: "retain-technical-symbol",
      surface: input.surface,
      targetLanguage: input.targetLanguage,
      reason: "technical symbols are preserved exactly",
    };
  }
  const foreign = input.foreignMatches?.[0];
  if (foreign !== undefined && input.permitBorrowing === true) {
    return {
      strategy: "borrow-source",
      surface: input.surface,
      targetLanguage: input.targetLanguage,
      sourceLanguage: foreign.language,
      reason: "target lacks an established item and borrowing is explicitly permitted",
    };
  }
  if (properOrTechnicalSurface(input.surface)) {
    return {
      strategy: "opaque-preservation",
      surface: input.surface,
      targetLanguage: input.targetLanguage,
      reason: "unknown named/technical item is preserved rather than fabricated",
    };
  }
  return {
    strategy: "unsupported",
    surface: input.surface,
    targetLanguage: input.targetLanguage,
    reason: "no established target lexeme or explicitly permitted borrowing strategy exists",
  };
};
