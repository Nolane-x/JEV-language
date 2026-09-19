import {
  StructuredError,
  type JsonValue,
} from "../../core-types/src/index.ts";
import type { Lexeme, PartOfSpeech } from "../../lexicon-core/src/index.ts";

export interface MorphFeatures {
  number?: "singular" | "plural" | string;
  person?: "first" | "second" | "third" | string;
  gender?: string;
  nounClass?: string;
  case?: string;
  tense?: string;
  aspect?: string;
  mood?: string;
  voice?: string;
  degree?: string;
  definiteness?: string;
  politeness?: string;
  animacy?: string;
  classifier?: string;
  extra?: Record<string, JsonValue>;
}

export interface MorphContext {
  language: string;
  partOfSpeech?: PartOfSpeech;
  surrounding?: string[];
}

export interface MorphAnalysis {
  surface: string;
  lemma: string;
  partOfSpeech?: PartOfSpeech;
  features: MorphFeatures;
  confidence?: number;
  source: "rule" | "lexicon" | "configured";
}

export interface MorphologyProvider {
  readonly id: string;
  readonly language: string;
  analyze(surface: string, context: MorphContext): MorphAnalysis[];
  realize(lexeme: Lexeme, features: MorphFeatures): string[];
}

export class MorphologyRegistry {
  readonly #providers = new Map<string, MorphologyProvider>();

  register(provider: MorphologyProvider): void {
    const key = provider.language;
    if (this.#providers.has(key)) {
      throw new StructuredError(
        "MORPH_PROVIDER_DUPLICATE",
        `Morphology provider already registered for language ${key}.`,
      );
    }
    this.#providers.set(key, provider);
  }

  provider(language: string): MorphologyProvider | undefined {
    return this.#providers.get(language);
  }

  analyze(
    surface: string,
    context: MorphContext,
  ): MorphAnalysis[] {
    return this.#providers.get(context.language)?.analyze(surface, context) ?? [];
  }

  realize(
    lexeme: Lexeme,
    features: MorphFeatures,
  ): string[] {
    return this.#providers.get(lexeme.language)?.realize(lexeme, features) ?? [];
  }
}

export const featureKey = (features: MorphFeatures): string =>
  Object.entries(features)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("|");
