import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";

export type MorphFeatureValue =
  | string
  | number
  | boolean
  | JsonValue;

export interface MorphFeatureDefinition {
  id: string;
  language?: string;
  values?: string[];
  openValue?: boolean;
  description: string;
}

export class MorphFeatureRegistry {
  readonly #features = new Map<string, MorphFeatureDefinition>();

  register(definition: MorphFeatureDefinition): Result<void> {
    if (
      definition.id.trim() === "" ||
      definition.description.trim() === "" ||
      (definition.language !== undefined &&
        definition.language.trim() === "") ||
      (definition.values !== undefined &&
        (definition.values.length === 0 ||
          definition.values.some((value) => value.trim() === "") ||
          new Set(definition.values).size !== definition.values.length))
    ) {
      return err(
        new StructuredError(
          "MORPH_FEATURE_DEFINITION",
          "Morphological features require a stable id, description, optional language, and unique declared values.",
        ),
      );
    }
    if (this.#features.has(definition.id)) {
      return err(
        new StructuredError(
          "MORPH_FEATURE_DUPLICATE",
          `Morphological feature already registered: ${definition.id}`,
        ),
      );
    }
    this.#features.set(definition.id, structuredClone(definition));
    return ok(undefined);
  }

  get(id: string): MorphFeatureDefinition | undefined {
    const value = this.#features.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  validate(
    featureId: string,
    value: MorphFeatureValue,
    language?: string,
  ): Result<void> {
    const definition = this.#features.get(featureId);
    if (definition === undefined) {
      return err(
        new StructuredError(
          "MORPH_FEATURE_UNKNOWN",
          `Unknown morphological feature: ${featureId}`,
        ),
      );
    }
    if (
      definition.language !== undefined &&
      language !== undefined &&
      definition.language !== language
    ) {
      return err(
        new StructuredError(
          "MORPH_FEATURE_LANGUAGE",
          `Feature ${featureId} is scoped to ${definition.language}, not ${language}.`,
        ),
      );
    }
    if (
      definition.values !== undefined &&
      typeof value === "string" &&
      !definition.values.includes(value) &&
      definition.openValue !== true
    ) {
      return err(
        new StructuredError(
          "MORPH_FEATURE_VALUE",
          `Value ${value} is not declared for feature ${featureId}.`,
        ),
      );
    }
    return ok(undefined);
  }

  definitions(language?: string): MorphFeatureDefinition[] {
    return [...this.#features.values()]
      .filter(
        (value) =>
          language === undefined ||
          value.language === undefined ||
          value.language === language,
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((value) => structuredClone(value));
  }
}

export interface CompoundAnalysis {
  surface: string;
  components: string[];
  headIndex?: number;
  semanticRelation?: string;
}

export interface DerivationAnalysis {
  surface: string;
  base: string;
  operation: string;
  derivedCategory?: string;
  semanticEffect?: string;
}

export interface MorphologicalConstructionProvider {
  readonly id: string;
  readonly language: string;
  analyzeCompound(surface: string): CompoundAnalysis[];
  analyzeDerivation(surface: string): DerivationAnalysis[];
}
