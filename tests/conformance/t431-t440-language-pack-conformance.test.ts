import { describe, expect, it } from "vitest";
import {
  lexicalFallbackCandidates,
  renderNumber,
  renderTemporalPreservingPrecision,
  runLanguagePackConformance,
  validateLanguagePackFeatureManifest,
  validateLocaleFormattingProfile,
  validateMixedLanguageRealization,
  type LanguagePackFeatureManifest,
  type LocaleFormattingProfile,
} from "../../packages/language-pack-core/src/index.ts";
import {
  englishLanguageConformanceProfile,
  englishLanguageFeatureManifest,
  englishLanguagePack,
  englishLocaleProfiles,
  englishNumberStrategies,
} from "../../packages/language-en/src/index.ts";
import {
  vietnameseLanguageConformanceProfile,
  vietnameseLanguageFeatureManifest,
  vietnameseLanguagePack,
  vietnameseLocaleProfiles,
  vietnameseNumberStrategies,
} from "../../packages/language-vi/src/index.ts";

const cloneManifest = (
  manifest: LanguagePackFeatureManifest,
): LanguagePackFeatureManifest => structuredClone(manifest);

describe("T431-T440 language-pack conformance", () => {
  it("T431 validates explicit feature-manifest schemas on real English and Vietnamese packs", () => {
    expect(validateLanguagePackFeatureManifest(englishLanguageFeatureManifest).ok).toBe(true);
    expect(validateLanguagePackFeatureManifest(vietnameseLanguageFeatureManifest).ok).toBe(true);
    expect(englishLanguagePack.featureManifest.language).toBe("en");
    expect(vietnameseLanguagePack.featureManifest.language).toBe("vi");
  });

  it("T432 requires parse and generate coverage with evidence for every supported feature", () => {
    for (const manifest of [
      englishLanguageFeatureManifest,
      vietnameseLanguageFeatureManifest,
    ]) {
      for (const declaration of Object.values(manifest.features)) {
        expect(declaration.parse).toBeDefined();
        expect(declaration.generate).toBeDefined();
        if (
          declaration.parse !== "unsupported" ||
          declaration.generate !== "unsupported"
        ) {
          expect(declaration.evidenceRefs.length).toBeGreaterThan(0);
        }
      }
    }

    const broken = cloneManifest(englishLanguageFeatureManifest);
    broken.features.questions = {
      parse: "controlled",
      generate: "controlled",
      evidenceRefs: [],
    };
    expect(validateLanguagePackFeatureManifest(broken).ok).toBe(false);
  });

  it("T433 distinguishes shared and language-specific constructions", () => {
    const valid = cloneManifest(englishLanguageFeatureManifest);
    expect(
      valid.constructions.some(
        (item) => item.scope === "shared" && item.language === undefined,
      ),
    ).toBe(true);
    expect(
      valid.constructions.some(
        (item) =>
          item.scope === "language-specific" && item.language === "en",
      ),
    ).toBe(true);

    valid.constructions.push({
      id: "construction:bad-owned",
      scope: "language-specific",
      language: "vi",
      semanticContract: "invalid cross-owner construction",
      parse: true,
      generate: false,
    });
    expect(validateLanguagePackFeatureManifest(valid).ok).toBe(false);
  });

  it("T434 rejects language semantic extensions outside the pack namespace", () => {
    const valid = cloneManifest(vietnameseLanguageFeatureManifest);
    expect(validateLanguagePackFeatureManifest(valid).ok).toBe(true);
    valid.semanticExtensions[0] = {
      ...valid.semanticExtensions[0]!,
      namespace: "core:classifier",
    };
    expect(validateLanguagePackFeatureManifest(valid).ok).toBe(false);
  });

  it("T435 keeps locale formatting profiles separate from language identity", () => {
    const crossLocale: LocaleFormattingProfile = {
      id: "locale:en-user-fr",
      locale: "fr-FR",
      languageHint: "en",
      decimalSeparator: ",",
      groupSeparator: " ",
      groupSize: 3,
      dateOrder: "dmy",
      dateSeparator: "/",
      timeSeparator: ":",
      timezoneDisplay: "preserve",
    };
    expect(validateLocaleFormattingProfile(crossLocale).ok).toBe(true);
    expect(crossLocale.languageHint).toBe("en");
    expect(crossLocale.locale).toBe("fr-FR");
  });

  it("T436 renders numbers through explicit locale-independent strategies", () => {
    const en = renderNumber(
      1234.5,
      englishNumberStrategies[0]!,
      englishLocaleProfiles[0]!,
    );
    expect(en).toEqual({ ok: true, value: "1,234.5" });

    const vi = renderNumber(
      1234.5,
      vietnameseNumberStrategies[0]!,
      vietnameseLocaleProfiles[0]!,
    );
    expect(vi).toEqual({ ok: true, value: "1.234,5" });

    const percent = renderNumber(
      0.125,
      englishNumberStrategies[1]!,
      englishLocaleProfiles[0]!,
    );
    expect(percent).toEqual({ ok: true, value: "12.5%" });
  });

  it("T437 preserves declared temporal precision and timezone evidence during realization", () => {
    const day = renderTemporalPreservingPrecision(
      { iso: "2026-09-20", precision: "day" },
      englishLocaleProfiles[1]!,
    );
    expect(day).toEqual({
      ok: true,
      value: {
        surface: "20/09/2026",
        precision: "day",
        timezonePreserved: false,
      },
    });

    const minute = renderTemporalPreservingPrecision(
      { iso: "2026-09-20T06:53+07:00", precision: "minute" },
      englishLocaleProfiles[1]!,
    );
    expect(minute).toEqual({
      ok: true,
      value: {
        surface: "20/09/2026 06:53 +07:00",
        precision: "minute",
        timezonePreserved: true,
      },
    });

    expect(
      renderTemporalPreservingPrecision(
        { iso: "2026-09", precision: "day" },
        englishLocaleProfiles[1]!,
      ).ok,
    ).toBe(false);
  });

  it("T438 enforces mixed-language switch policy instead of treating it as metadata only", () => {
    const policy = englishLanguageFeatureManifest.mixedLanguage;
    expect(
      validateMixedLanguageRealization(
        [
          { language: "en", text: "Open the file.", source: "default" },
          { language: "vi", text: "Sau đó lưu lại.", source: "evidence" },
        ],
        policy,
      ).ok,
    ).toBe(true);

    expect(
      validateMixedLanguageRealization(
        [
          { language: "en", text: "Open the file.", source: "default" },
          { language: "vi", text: "Sau đó lưu lại.", source: "default" },
        ],
        policy,
      ).ok,
    ).toBe(false);

    expect(
      validateMixedLanguageRealization(
        [
          { language: "en", text: "Use", source: "default" },
          { language: "x-opaque", text: "Nolane-X", opaque: true, source: "opaque" },
        ],
        policy,
      ).ok,
    ).toBe(true);
  });

  it("T439 orders preserve/borrow/transliterate fallbacks and keeps provenance requirements explicit", () => {
    const result = lexicalFallbackCandidates({
      surface: "Nolane",
      sourceLanguage: "en",
      targetLanguage: "vi",
      policy: vietnameseLanguageFeatureManifest.lexicalFallback,
      transliterate: (surface) => surface.toLocaleUpperCase(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((item) => item.action)).toEqual([
        "preserve",
        "borrow",
        "transliterate",
      ]);
      expect(result.value[2]?.surface).toBe("NOLANE");
      expect(result.value.every((item) => item.provenanceRequired)).toBe(true);
    }
  });

  it("T440 runs the real language-pack conformance profiles and reports negative fixtures", () => {
    const english = runLanguagePackConformance(
      englishLanguageConformanceProfile,
    );
    const vietnamese = runLanguagePackConformance(
      vietnameseLanguageConformanceProfile,
    );
    expect(english.passed).toBe(true);
    expect(vietnamese.passed).toBe(true);
    expect(english.checks.every((check) => check.passed)).toBe(true);
    expect(vietnamese.checks.every((check) => check.passed)).toBe(true);

    const brokenManifest = cloneManifest(englishLanguageFeatureManifest);
    brokenManifest.localeProfileIds = ["locale:missing"];
    const negative = runLanguagePackConformance({
      featureManifest: brokenManifest,
      locales: englishLocaleProfiles,
      numberStrategies: englishNumberStrategies,
    });
    expect(negative.passed).toBe(false);
    expect(
      negative.checks.find((check) => check.id === "locale-profiles")?.passed,
    ).toBe(false);
  });
});
