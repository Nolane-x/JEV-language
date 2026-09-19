import {
  StructuredError,
  type JsonValue,
} from "../../core-types/src/index.ts";
import type {
  LexemeId,
  PartOfSpeech,
} from "../../lexicon-core/src/index.ts";

export type MorphNumber = "singular" | "plural";
export type MorphPerson = "first" | "second" | "third" | 1 | 2 | 3;
export type MorphDegree = "positive" | "comparative" | "superlative";

export interface MorphFeatures {
  number?: MorphNumber | string;
  person?: MorphPerson | string;
  gender?: string;
  nounClass?: string;
  case?: string;
  tense?: string;
  aspect?: string;
  mood?: string;
  voice?: string;
  degree?: MorphDegree | string;
  definiteness?: string;
  politeness?: string;
  animacy?: string;
  classifier?: string;
  verbForm?: string;
  extra?: Record<string, JsonValue>;
}

export interface MorphContext {
  language: string;
  partOfSpeech?: PartOfSpeech;
  surrounding?: string[];
}

export interface MorphAnalysis {
  surface: string;
  lexemeId?: LexemeId;
  lemma: string;
  partOfSpeech?: PartOfSpeech;
  features: MorphFeatures;
  confidence?: number;
  source: "rule" | "lexicon" | "configured";
}

export interface SurfaceCandidate {
  surface: string;
  lexemeId: LexemeId;
  features: MorphFeatures;
  confidence?: number;
  source: "rule" | "lexicon" | "configured";
}

export interface MorphologyProvider {
  readonly id: string;
  readonly language: string;
  analyze(surface: string, context: MorphContext): MorphAnalysis[];
  realize(lemma: LexemeId, features: MorphFeatures): SurfaceCandidate[];
}

export class MorphologyRegistry {
  readonly #providers = new Map<string, MorphologyProvider>();

  register(provider: MorphologyProvider): void {
    if (provider.language.trim().length === 0 || provider.id.trim().length === 0) {
      throw new StructuredError(
        "MORPH_PROVIDER_ID",
        "Morphology provider id and language are required.",
      );
    }
    if (this.#providers.has(provider.language)) {
      throw new StructuredError(
        "MORPH_PROVIDER_DUPLICATE",
        `Morphology provider already registered for language ${provider.language}.`,
      );
    }
    this.#providers.set(provider.language, provider);
  }

  provider(language: string): MorphologyProvider | undefined {
    return this.#providers.get(language);
  }

  analyze(surface: string, context: MorphContext): MorphAnalysis[] {
    return this.#providers.get(context.language)?.analyze(surface, context) ?? [];
  }

  realize(
    language: string,
    lemma: LexemeId,
    features: MorphFeatures,
  ): SurfaceCandidate[] {
    return this.#providers.get(language)?.realize(lemma, features) ?? [];
  }
}

export const featureKey = (features: MorphFeatures): string =>
  Object.entries(features)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("|");
