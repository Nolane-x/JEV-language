import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";

export type FeatureCoverageLevel =
  | "unsupported"
  | "partial"
  | "controlled"
  | "broad";

export interface FeatureCoverageDeclaration {
  parse: FeatureCoverageLevel;
  generate: FeatureCoverageLevel;
  evidenceRefs: string[];
  notes?: string;
}

export type ConstructionScope = "shared" | "language-specific";

export interface LanguageConstructionDescriptor {
  id: string;
  scope: ConstructionScope;
  semanticContract: string;
  parse: boolean;
  generate: boolean;
  language?: string;
}

export interface LanguageSemanticExtensionNamespace {
  id: string;
  language: string;
  namespace: string;
  extensionKeys: string[];
}

export type LocaleDateOrder = "ymd" | "dmy" | "mdy";

export interface LocaleFormattingProfile {
  id: string;
  locale: string;
  /**
   * Locale is deliberately independent from the language-pack identity.
   * A language pack may expose several formatting profiles.
   */
  languageHint?: string;
  decimalSeparator: string;
  groupSeparator: string;
  groupSize: number;
  dateOrder: LocaleDateOrder;
  dateSeparator: string;
  timeSeparator: string;
  timezoneDisplay: "preserve" | "omit";
}

export type NumberRenderingStyle = "decimal" | "percent" | "scientific";

export interface NumberRenderingStrategy {
  id: string;
  style: NumberRenderingStyle;
  minimumFractionDigits: number;
  maximumFractionDigits: number;
  useGrouping: boolean;
}

export type MixedLanguageMode =
  | "forbid"
  | "explicit-only"
  | "evidence-based";

export interface MixedLanguageRealizationPolicy {
  mode: MixedLanguageMode;
  defaultLanguage: string;
  allowedLanguages: string[];
  preserveOpaqueTerms: boolean;
  maxSwitches?: number;
}

export type LexicalFallbackAction =
  | "preserve"
  | "borrow"
  | "transliterate";

export interface LexicalFallbackPolicy {
  order: LexicalFallbackAction[];
  preserveOriginal: boolean;
  allowBorrowing: boolean;
  allowTransliteration: boolean;
  requireProvenance: boolean;
}

export interface LanguagePackFeatureManifest {
  schemaVersion: "jl-language-features-1";
  language: string;
  version: string;
  features: Record<string, FeatureCoverageDeclaration>;
  constructions: LanguageConstructionDescriptor[];
  semanticExtensions: LanguageSemanticExtensionNamespace[];
  localeProfileIds: string[];
  mixedLanguage: MixedLanguageRealizationPolicy;
  lexicalFallback: LexicalFallbackPolicy;
}

const nonEmpty = (value: string): boolean => value.trim() !== "";

const uniqueStrings = (values: readonly string[]): boolean =>
  values.every(nonEmpty) && new Set(values).size === values.length;

const coverageLevels = new Set<FeatureCoverageLevel>([
  "unsupported",
  "partial",
  "controlled",
  "broad",
]);

const validateCoverage = (
  features: Readonly<Record<string, FeatureCoverageDeclaration>>,
): string[] => {
  const diagnostics: string[] = [];
  const entries = Object.entries(features);
  if (entries.length === 0) {
    diagnostics.push("feature manifest must declare at least one feature");
    return diagnostics;
  }
  for (const [feature, declaration] of entries) {
    if (!nonEmpty(feature)) {
      diagnostics.push("feature ids must be non-empty");
      continue;
    }
    if (
      !coverageLevels.has(declaration.parse) ||
      !coverageLevels.has(declaration.generate)
    ) {
      diagnostics.push(`${feature}: invalid parse/generate coverage level`);
    }
    const supported =
      declaration.parse !== "unsupported" ||
      declaration.generate !== "unsupported";
    if (supported && declaration.evidenceRefs.length === 0) {
      diagnostics.push(
        `${feature}: supported coverage requires at least one evidence ref`,
      );
    }
    if (!uniqueStrings(declaration.evidenceRefs)) {
      diagnostics.push(`${feature}: evidence refs must be unique non-empty strings`);
    }
  }
  return diagnostics;
};

export const validateLanguagePackFeatureManifest = (
  manifest: LanguagePackFeatureManifest,
): Result<LanguagePackFeatureManifest> => {
  const diagnostics: string[] = [];
  if (
    manifest.schemaVersion !== "jl-language-features-1" ||
    !nonEmpty(manifest.language) ||
    !nonEmpty(manifest.version)
  ) {
    diagnostics.push(
      "feature manifest requires schema version, language, and version",
    );
  }
  diagnostics.push(...validateCoverage(manifest.features));

  const constructionIds = new Set<string>();
  for (const construction of manifest.constructions) {
    if (
      !nonEmpty(construction.id) ||
      constructionIds.has(construction.id) ||
      !nonEmpty(construction.semanticContract)
    ) {
      diagnostics.push(
        "constructions require unique ids and non-empty semantic contracts",
      );
    }
    constructionIds.add(construction.id);
    if (
      construction.scope === "language-specific" &&
      construction.language !== manifest.language
    ) {
      diagnostics.push(
        `${construction.id}: language-specific construction must identify ${manifest.language}`,
      );
    }
    if (
      construction.scope === "shared" &&
      construction.language !== undefined
    ) {
      diagnostics.push(
        `${construction.id}: shared construction may not claim a language owner`,
      );
    }
    if (!construction.parse && !construction.generate) {
      diagnostics.push(
        `${construction.id}: construction must support parse or generate`,
      );
    }
  }

  const namespaceIds = new Set<string>();
  const requiredPrefix = `lang:${manifest.language}:`;
  for (const extension of manifest.semanticExtensions) {
    if (
      !nonEmpty(extension.id) ||
      namespaceIds.has(extension.id) ||
      extension.language !== manifest.language ||
      !extension.namespace.startsWith(requiredPrefix) ||
      extension.namespace === requiredPrefix ||
      !uniqueStrings(extension.extensionKeys)
    ) {
      diagnostics.push(
        `${extension.id || "<unknown>"}: invalid language semantic-extension namespace`,
      );
    }
    namespaceIds.add(extension.id);
  }

  if (!uniqueStrings(manifest.localeProfileIds)) {
    diagnostics.push("locale profile ids must be unique non-empty strings");
  }

  const mixed = manifest.mixedLanguage;
  if (
    !nonEmpty(mixed.defaultLanguage) ||
    !uniqueStrings(mixed.allowedLanguages) ||
    !mixed.allowedLanguages.includes(mixed.defaultLanguage) ||
    !mixed.allowedLanguages.includes(manifest.language) ||
    (mixed.mode === "forbid" && mixed.allowedLanguages.length !== 1) ||
    (mixed.maxSwitches !== undefined &&
      (!Number.isSafeInteger(mixed.maxSwitches) || mixed.maxSwitches < 0))
  ) {
    diagnostics.push("mixed-language policy is internally inconsistent");
  }

  const fallback = manifest.lexicalFallback;
  if (
    !uniqueStrings(fallback.order) ||
    fallback.order.length === 0 ||
    (fallback.preserveOriginal && !fallback.order.includes("preserve")) ||
    (!fallback.allowBorrowing && fallback.order.includes("borrow")) ||
    (!fallback.allowTransliteration &&
      fallback.order.includes("transliterate"))
  ) {
    diagnostics.push("lexical fallback policy is internally inconsistent");
  }

  if (diagnostics.length > 0) {
    return err(
      new StructuredError(
        "LANG_FEATURE_MANIFEST",
        diagnostics.join("; "),
      ),
    );
  }
  return ok(structuredClone(manifest));
};

export const validateLocaleFormattingProfile = (
  profile: LocaleFormattingProfile,
): Result<LocaleFormattingProfile> => {
  if (
    !nonEmpty(profile.id) ||
    !nonEmpty(profile.locale) ||
    !nonEmpty(profile.decimalSeparator) ||
    !nonEmpty(profile.groupSeparator) ||
    profile.decimalSeparator === profile.groupSeparator ||
    !Number.isSafeInteger(profile.groupSize) ||
    profile.groupSize < 1 ||
    !nonEmpty(profile.dateSeparator) ||
    !nonEmpty(profile.timeSeparator)
  ) {
    return err(
      new StructuredError(
        "LANG_LOCALE_PROFILE",
        "Locale profile requires stable separators, locale id, and positive group size.",
      ),
    );
  }
  return ok(structuredClone(profile));
};

const groupInteger = (
  input: string,
  separator: string,
  groupSize: number,
): string => {
  const sign = input.startsWith("-") ? "-" : "";
  const digits = sign === "" ? input : input.slice(1);
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= groupSize) {
    groups.unshift(digits.slice(Math.max(0, end - groupSize), end));
  }
  return sign + groups.join(separator);
};

const trimFraction = (
  fraction: string,
  minimum: number,
): string => {
  let output = fraction;
  while (output.length > minimum && output.endsWith("0")) {
    output = output.slice(0, -1);
  }
  return output;
};

export const renderNumber = (
  value: number,
  strategy: NumberRenderingStrategy,
  locale: LocaleFormattingProfile,
): Result<string> => {
  if (
    !Number.isFinite(value) ||
    !nonEmpty(strategy.id) ||
    !Number.isSafeInteger(strategy.minimumFractionDigits) ||
    !Number.isSafeInteger(strategy.maximumFractionDigits) ||
    strategy.minimumFractionDigits < 0 ||
    strategy.maximumFractionDigits < strategy.minimumFractionDigits ||
    strategy.maximumFractionDigits > 12
  ) {
    return err(
      new StructuredError(
        "LANG_NUMBER_STRATEGY",
        "Number strategy requires finite input and a valid fraction-digit range.",
      ),
    );
  }
  const localeValid = validateLocaleFormattingProfile(locale);
  if (!localeValid.ok) return err(localeValid.error);

  const scaled = strategy.style === "percent" ? value * 100 : value;
  if (strategy.style === "scientific") {
    const scientific = scaled.toExponential(strategy.maximumFractionDigits);
    const [mantissa = "", exponent = ""] = scientific.split("e");
    const localizedMantissa = mantissa.replace(".", locale.decimalSeparator);
    return ok(`${localizedMantissa}e${exponent}`);
  }

  const fixed = scaled.toFixed(strategy.maximumFractionDigits);
  const [integerPart = "0", rawFraction = ""] = fixed.split(".");
  const fraction = trimFraction(
    rawFraction,
    strategy.minimumFractionDigits,
  );
  const integer = strategy.useGrouping
    ? groupInteger(integerPart, locale.groupSeparator, locale.groupSize)
    : integerPart;
  const decimal =
    fraction.length === 0
      ? integer
      : `${integer}${locale.decimalSeparator}${fraction}`;
  return ok(strategy.style === "percent" ? `${decimal}%` : decimal);
};

export type TemporalRenderPrecision =
  | "year"
  | "month"
  | "day"
  | "minute"
  | "second"
  | "millisecond";

export interface PrecisionTemporalValue {
  iso: string;
  precision: TemporalRenderPrecision;
}

export interface PrecisionTemporalRendering {
  surface: string;
  precision: TemporalRenderPrecision;
  timezonePreserved: boolean;
}

const temporalPattern =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/u;

const dateSurface = (
  year: string,
  month: string,
  day: string,
  profile: LocaleFormattingProfile,
): string => {
  const values =
    profile.dateOrder === "ymd"
      ? [year, month, day]
      : profile.dateOrder === "dmy"
        ? [day, month, year]
        : [month, day, year];
  return values.join(profile.dateSeparator);
};

export const renderTemporalPreservingPrecision = (
  value: PrecisionTemporalValue,
  profile: LocaleFormattingProfile,
): Result<PrecisionTemporalRendering> => {
  const validProfile = validateLocaleFormattingProfile(profile);
  if (!validProfile.ok) return err(validProfile.error);

  const match = value.iso.match(temporalPattern);
  if (match === null) {
    return err(
      new StructuredError(
        "LANG_TEMPORAL_ISO",
        "Temporal rendering requires a supported precision-preserving ISO form.",
      ),
    );
  }
  const [, year, month, day, hour, minute, second, millisecond, timezone] =
    match;
  const requirePart = (
    part: string | undefined,
    label: string,
  ): Result<string> =>
    part === undefined
      ? err(
          new StructuredError(
            "LANG_TEMPORAL_PRECISION",
            `Temporal precision ${value.precision} requires ${label}.`,
          ),
        )
      : ok(part);

  if (year === undefined) {
    return err(
      new StructuredError(
        "LANG_TEMPORAL_PRECISION",
        "Temporal rendering requires a year.",
      ),
    );
  }
  if (value.precision === "year") {
    return ok({
      surface: year,
      precision: value.precision,
      timezonePreserved: false,
    });
  }
  const monthResult = requirePart(month, "month");
  if (!monthResult.ok) return err(monthResult.error);
  if (value.precision === "month") {
    const surface =
      profile.dateOrder === "ymd"
        ? [year, monthResult.value].join(profile.dateSeparator)
        : [monthResult.value, year].join(profile.dateSeparator);
    return ok({
      surface,
      precision: value.precision,
      timezonePreserved: false,
    });
  }
  const dayResult = requirePart(day, "day");
  if (!dayResult.ok) return err(dayResult.error);
  const date = dateSurface(
    year,
    monthResult.value,
    dayResult.value,
    profile,
  );
  if (value.precision === "day") {
    return ok({
      surface: date,
      precision: value.precision,
      timezonePreserved: false,
    });
  }
  const hourResult = requirePart(hour, "hour");
  if (!hourResult.ok) return err(hourResult.error);
  const minuteResult = requirePart(minute, "minute");
  if (!minuteResult.ok) return err(minuteResult.error);
  let time = [hourResult.value, minuteResult.value].join(profile.timeSeparator);

  if (
    value.precision === "second" ||
    value.precision === "millisecond"
  ) {
    const secondResult = requirePart(second, "second");
    if (!secondResult.ok) return err(secondResult.error);
    time += `${profile.timeSeparator}${secondResult.value}`;
  }
  if (value.precision === "millisecond") {
    const millisResult = requirePart(millisecond, "millisecond");
    if (!millisResult.ok) return err(millisResult.error);
    time += `.${millisResult.value.padEnd(3, "0")}`;
  }

  const preserveTimezone =
    profile.timezoneDisplay === "preserve" && timezone !== undefined;
  return ok({
    surface: `${date} ${time}${preserveTimezone ? ` ${timezone}` : ""}`,
    precision: value.precision,
    timezonePreserved: preserveTimezone,
  });
};

export interface MixedLanguageSegment {
  language: string;
  text: string;
  opaque?: boolean;
  source?: "default" | "explicit" | "evidence" | "opaque";
}

export const validateMixedLanguageRealization = (
  segments: readonly MixedLanguageSegment[],
  policy: MixedLanguageRealizationPolicy,
): Result<void> => {
  if (segments.length === 0) {
    return err(
      new StructuredError(
        "LANG_MIXED_EMPTY",
        "Mixed-language realization requires at least one segment.",
      ),
    );
  }
  if (
    !uniqueStrings(policy.allowedLanguages) ||
    !policy.allowedLanguages.includes(policy.defaultLanguage)
  ) {
    return err(
      new StructuredError(
        "LANG_MIXED_POLICY",
        "Mixed-language policy requires unique allowed languages including the default.",
      ),
    );
  }

  let switches = 0;
  let previous = segments[0]?.language;
  for (const segment of segments) {
    if (!nonEmpty(segment.language) || segment.text.length === 0) {
      return err(
        new StructuredError(
          "LANG_MIXED_SEGMENT",
          "Mixed-language segments require language and non-empty text.",
        ),
      );
    }
    const opaqueAllowed =
      segment.opaque === true && policy.preserveOpaqueTerms;
    if (
      !policy.allowedLanguages.includes(segment.language) &&
      !opaqueAllowed
    ) {
      return err(
        new StructuredError(
          "LANG_MIXED_LANGUAGE",
          `Language ${segment.language} is not allowed by the realization policy.`,
        ),
      );
    }
    if (
      segment.language !== policy.defaultLanguage &&
      !opaqueAllowed &&
      policy.mode === "explicit-only" &&
      segment.source !== "explicit"
    ) {
      return err(
        new StructuredError(
          "LANG_MIXED_EXPLICIT_REQUIRED",
          "Explicit-only mixed-language policy requires an explicit switch source.",
        ),
      );
    }
    if (
      segment.language !== policy.defaultLanguage &&
      !opaqueAllowed &&
      policy.mode === "evidence-based" &&
      segment.source !== "explicit" &&
      segment.source !== "evidence"
    ) {
      return err(
        new StructuredError(
          "LANG_MIXED_EVIDENCE_REQUIRED",
          "Evidence-based mixed-language policy requires explicit or evidence-backed switching.",
        ),
      );
    }
    if (previous !== undefined && previous !== segment.language) switches += 1;
    previous = segment.language;
  }

  if (
    policy.mode === "forbid" &&
    segments.some((segment) => segment.language !== policy.defaultLanguage)
  ) {
    return err(
      new StructuredError(
        "LANG_MIXED_FORBIDDEN",
        "Mixed-language realization is forbidden by policy.",
      ),
    );
  }
  if (
    policy.maxSwitches !== undefined &&
    switches > policy.maxSwitches
  ) {
    return err(
      new StructuredError(
        "LANG_MIXED_SWITCH_LIMIT",
        "Mixed-language realization exceeds the configured switch limit.",
      ),
    );
  }
  return ok(undefined);
};

export interface LexicalFallbackCandidate {
  action: LexicalFallbackAction;
  surface: string;
  sourceLanguage: string;
  targetLanguage: string;
  provenanceRequired: boolean;
}

export const lexicalFallbackCandidates = (input: {
  surface: string;
  sourceLanguage: string;
  targetLanguage: string;
  policy: LexicalFallbackPolicy;
  transliterate?: (surface: string) => string;
}): Result<LexicalFallbackCandidate[]> => {
  if (
    input.surface.length === 0 ||
    !nonEmpty(input.sourceLanguage) ||
    !nonEmpty(input.targetLanguage) ||
    !uniqueStrings(input.policy.order)
  ) {
    return err(
      new StructuredError(
        "LANG_LEXICAL_FALLBACK_INPUT",
        "Lexical fallback requires source text, language ids, and a unique fallback order.",
      ),
    );
  }

  const candidates: LexicalFallbackCandidate[] = [];
  for (const action of input.policy.order) {
    if (action === "preserve" && input.policy.preserveOriginal) {
      candidates.push({
        action,
        surface: input.surface,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        provenanceRequired: input.policy.requireProvenance,
      });
    }
    if (action === "borrow" && input.policy.allowBorrowing) {
      candidates.push({
        action,
        surface: input.surface,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        provenanceRequired: input.policy.requireProvenance,
      });
    }
    if (
      action === "transliterate" &&
      input.policy.allowTransliteration &&
      input.transliterate !== undefined
    ) {
      const surface = input.transliterate(input.surface);
      if (!nonEmpty(surface)) {
        return err(
          new StructuredError(
            "LANG_TRANSLITERATION_EMPTY",
            "Transliteration adapter returned an empty surface.",
          ),
        );
      }
      candidates.push({
        action,
        surface,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        provenanceRequired: input.policy.requireProvenance,
      });
    }
  }
  if (candidates.length === 0) {
    return err(
      new StructuredError(
        "LANG_LEXICAL_FALLBACK_NONE",
        "No lexical fallback candidate is permitted by policy.",
      ),
    );
  }
  return ok(candidates);
};

export interface LanguagePackConformanceProfile {
  featureManifest: LanguagePackFeatureManifest;
  locales: LocaleFormattingProfile[];
  numberStrategies: NumberRenderingStrategy[];
}

export interface LanguagePackConformanceCheck {
  id: string;
  passed: boolean;
  message: string;
}

export interface LanguagePackConformanceReport {
  language: string;
  passed: boolean;
  checks: LanguagePackConformanceCheck[];
}

export const runLanguagePackConformance = (
  profile: LanguagePackConformanceProfile,
): LanguagePackConformanceReport => {
  const checks: LanguagePackConformanceCheck[] = [];
  const add = (id: string, passed: boolean, message: string): void => {
    checks.push({ id, passed, message });
  };

  const manifest = validateLanguagePackFeatureManifest(
    profile.featureManifest,
  );
  add(
    "feature-manifest",
    manifest.ok,
    manifest.ok
      ? "feature manifest is valid"
      : manifest.error.message,
  );

  const localeIds = new Set<string>();
  let localesValid = true;
  for (const locale of profile.locales) {
    const valid = validateLocaleFormattingProfile(locale);
    if (!valid.ok || localeIds.has(locale.id)) localesValid = false;
    localeIds.add(locale.id);
  }
  const declaredLocales = new Set(profile.featureManifest.localeProfileIds);
  add(
    "locale-profiles",
    localesValid &&
      declaredLocales.size === localeIds.size &&
      [...declaredLocales].every((id) => localeIds.has(id)),
    "declared locale profile ids must exactly match valid supplied profiles",
  );

  const strategyIds = profile.numberStrategies.map((item) => item.id);
  const strategiesValid =
    uniqueStrings(strategyIds) &&
    profile.numberStrategies.every(
      (strategy) =>
        Number.isSafeInteger(strategy.minimumFractionDigits) &&
        Number.isSafeInteger(strategy.maximumFractionDigits) &&
        strategy.minimumFractionDigits >= 0 &&
        strategy.maximumFractionDigits >= strategy.minimumFractionDigits &&
        strategy.maximumFractionDigits <= 12,
    );
  add(
    "number-strategies",
    strategiesValid,
    "number strategies require unique ids and valid fraction bounds",
  );

  const featureCount = Object.keys(profile.featureManifest.features).length;
  add(
    "coverage-declarations",
    featureCount > 0 &&
      Object.values(profile.featureManifest.features).every(
        (coverage) =>
          coverage.parse !== undefined &&
          coverage.generate !== undefined,
      ),
    "every declared feature must expose parse and generate coverage",
  );

  add(
    "construction-abi",
    profile.featureManifest.constructions.every(
      (construction) =>
        construction.scope === "shared" ||
        construction.language === profile.featureManifest.language,
    ),
    "construction ownership must be shared or owned by the pack language",
  );

  add(
    "semantic-extension-namespace",
    profile.featureManifest.semanticExtensions.every((extension) =>
      extension.namespace.startsWith(
        `lang:${profile.featureManifest.language}:`,
      ),
    ),
    "language semantic extensions must remain inside the language namespace",
  );

  return {
    language: profile.featureManifest.language,
    passed: checks.every((check) => check.passed),
    checks,
  };
};
