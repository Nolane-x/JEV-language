import type { LanguagePackFeatureManifest } from "./conformance.ts";
import { assertTypologyProviderLanguages, type TypologyProviderBundle } from "./typology.ts";
import type { SemanticId } from "../../core-types/src/index.ts";
import type { GrammarCoverageMatrix, GrammarRegistry } from "../../grammar-core/src/index.ts";
import type { LanguageNeutralLexiconIndex } from "../../lexicon-core/src/index.ts";
import type { MorphologyProvider } from "../../morphology-core/src/index.ts";

export interface LanguagePackManifest {
  id: string;
  languageTag: string;
  version: string;
  schemaVersion: "jl-language-pack-1";
  maturity: "experimental" | "candidate" | "stable";
  capabilities: {
    parsing: boolean;
    realization: boolean;
    morphology: boolean;
    mixedLanguage: boolean;
  };
  coverage: {
    grammarProfile: string;
    lexiconEntries: "dynamic" | number;
  };
  requires: {
    semanticSchema: string;
  };
}

export interface TokenizerProvider<TToken> {
  readonly id: string;
  readonly language: string;
  tokenize(source: string): TToken[];
}

export interface LexiconProvider {
  readonly id: string;
  readonly language: string;
  create(): LanguageNeutralLexiconIndex;
}

export interface GrammarProvider {
  readonly id: string;
  readonly language: string;
  readonly coverage: GrammarCoverageMatrix;
  create(): GrammarRegistry;
}

export interface ParserHookProvider<TInput, TResult> {
  readonly id: string;
  readonly language: string;
  parse(input: TInput): TResult;
}

export interface RealizationHookProvider<TInput, TResult> {
  readonly id: string;
  readonly language: string;
  realize(input: TInput): TResult;
}

export interface PunctuationProvider {
  readonly id: string;
  readonly language: string;
  terminal(kind: "statement" | "question" | "exclamation"): string;
  join(tokens: readonly string[]): string;
}

export interface LanguageDiscourseProvider<TContext, TChoice> {
  readonly id: string;
  readonly language: string;
  choose(context: TContext): TChoice;
}

export type GrammaticalTense =
  | "past"
  | "present"
  | "future"
  | "nonpast"
  | "tenseless"
  | "relative"
  | "unknown";

export type LanguageAspectFeature =
  | "perfective"
  | "imperfective"
  | "progressive"
  | "perfect"
  | "prospective"
  | "habitual"
  | "iterative"
  | "none"
  | "unknown";

export interface TenseTimeSemantics {
  /** Morphosyntactic tense expressed by the language. */
  tense: GrammaticalTense;
  /** Independent semantic time object; tense never substitutes for this anchor. */
  semanticTimeRef?: SemanticId;
  deicticAnchorRef?: SemanticId;
}

export interface AspectFeatureMapping {
  semanticAspect: LanguageAspectFeature;
  languageFeatures: Record<string, string | boolean>;
}

export interface TemporalAspectProvider {
  readonly id: string;
  readonly language: string;
  mapTense(input: {
    tense: GrammaticalTense;
    semanticTimeRef?: SemanticId;
    deicticAnchorRef?: SemanticId;
  }): TenseTimeSemantics;
  mapAspect(input: {
    semanticAspect: LanguageAspectFeature;
    eventCategory?:
      | "event"
      | "state"
      | "process"
      | "transition"
      | "achievement"
      | "activity";
  }): AspectFeatureMapping;
}

export type PresuppositionTriggerKind =
  | "lexical"
  | "multiword"
  | "construction";

export type PresuppositionProjectionPreference =
  | "local"
  | "global"
  | "unresolved";

export interface LanguagePresuppositionTriggerDescriptor {
  id: string;
  language: string;
  kind: PresuppositionTriggerKind;
  /**
   * Inspectable language-pack key such as a lexeme id, multiword unit id, or
   * construction id. It is not executable code and does not assert the
   * triggered content by itself.
   */
  triggerKey: string;
  presuppositionType: string;
  cancellable: boolean;
  projectionPreference: PresuppositionProjectionPreference;
}

export interface PresuppositionTriggerRegistryProvider {
  readonly id: string;
  readonly language: string;
  triggers(): readonly LanguagePresuppositionTriggerDescriptor[];
}

export interface LanguageConformanceManifest {
  id: string;
  language: string;
  corpusRefs: string[];
  requiredPhenomena: string[];
  determinism: "D0" | "D1";
}

export interface HumanLanguagePack<
  TToken,
  TParseInput,
  TParseResult,
  TRealizeInput,
  TRealizeResult,
  TDiscourseContext,
  TDiscourseChoice,
> {
  manifest: LanguagePackManifest;
  featureManifest: LanguagePackFeatureManifest;
  tokenizer: TokenizerProvider<TToken>;
  morphology: MorphologyProvider;
  lexicon: LexiconProvider;
  grammar: GrammarProvider;
  parserHooks: ParserHookProvider<TParseInput, TParseResult>;
  realizationHooks: RealizationHookProvider<TRealizeInput, TRealizeResult>;
  /**
   * Compatibility aliases for pre-ABI callers. New integrations SHOULD use
   * parserHooks/realizationHooks so provider identity remains inspectable.
   */
  parse?: ParserHookProvider<TParseInput, TParseResult>["parse"];
  realize?: RealizationHookProvider<TRealizeInput, TRealizeResult>["realize"];
  punctuation: PunctuationProvider;
  discourse: LanguageDiscourseProvider<TDiscourseContext, TDiscourseChoice>;
  temporalAspect?: TemporalAspectProvider;
  presuppositionTriggers?: PresuppositionTriggerRegistryProvider;
  typology?: TypologyProviderBundle;
  tests: LanguageConformanceManifest;
}

export interface LanguagePackIdentityView {
  manifest: Pick<LanguagePackManifest, "id" | "languageTag">;
  featureManifest?: Pick<LanguagePackFeatureManifest, "language">;
  tokenizer: Pick<TokenizerProvider<unknown>, "language">;
  morphology: Pick<MorphologyProvider, "language">;
  lexicon: Pick<LexiconProvider, "language">;
  grammar: Pick<GrammarProvider, "language">;
  parserHooks: { readonly language: string };
  realizationHooks: { readonly language: string };
  punctuation: Pick<PunctuationProvider, "language">;
  discourse: { readonly language: string };
  temporalAspect?: Pick<TemporalAspectProvider, "language">;
  presuppositionTriggers?: Pick<PresuppositionTriggerRegistryProvider, "language">;
  tests: Pick<LanguageConformanceManifest, "language">;
}

export const assertLanguagePackIdentity = (
  pack: LanguagePackIdentityView,
): void => {
  const language = pack.manifest.languageTag;
  const providerLanguages = [
    ...(pack.featureManifest === undefined ? [] : [pack.featureManifest.language]),
    pack.tokenizer.language,
    pack.morphology.language,
    pack.lexicon.language,
    pack.grammar.language,
    pack.parserHooks.language,
    pack.realizationHooks.language,
    pack.punctuation.language,
    pack.discourse.language,
    ...(pack.temporalAspect === undefined ? [] : [pack.temporalAspect.language]),
    ...(pack.presuppositionTriggers === undefined
      ? []
      : [pack.presuppositionTriggers.language]),
    pack.tests.language,
  ];
  if (providerLanguages.some((value) => value !== language)) {
    throw new Error(
      `Language pack ${pack.manifest.id} mixes provider languages: ${providerLanguages.join(", ")}`,
    );
  }
  const typology = (pack as LanguagePackIdentityView & { typology?: TypologyProviderBundle }).typology;
  if (typology !== undefined) {
    assertTypologyProviderLanguages(language, typology);
  }
};

export * from "./open-world-lexicon.ts";

export * from "./typology.ts";

export * from "./conformance.ts";
