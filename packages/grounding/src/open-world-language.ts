import {
  err,
  ok,
  sha256,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  resolveUtf16Span,
  type SpanRef,
  type StringLikeValue,
} from "../../open-world-values/src/index.ts";
import {
  type ConceptDefinition,
  type ConceptKind,
  type ConceptRef,
  OntologyStore,
} from "../../ontology/src/index.ts";
import type { ProvenanceRef } from "../../provenance/src/index.ts";
import {
  mapNormalizedRangeToSourceSpan,
  type LanguageHypothesis,
  type LanguageSpan,
  type LanguageSpanTagger,
  type NormalizedGroundingSource,
} from "./pipeline.ts";

export interface DeterministicLanguageProfile {
  language: string;
  markerWords: string[];
  distinctiveCharacters?: string[];
  script?: string;
  priority?: number;
}

export interface DeterministicMixedLanguageTaggerOptions {
  profiles: DeterministicLanguageProfile[];
  unknownLanguage?: string;
  sourceHintBoost?: number;
}

const normalizeWord = (value: string): string =>
  value.normalize("NFC").toLocaleLowerCase();

const wordPattern =
  /[\p{L}\p{M}][\p{L}\p{M}\p{N}_'’-]*/gu;

const scoreWord = (
  word: string,
  profile: DeterministicLanguageProfile,
  sourceHint: string | undefined,
  sourceHintBoost: number,
): { score: number; evidence: string[] } => {
  const normalized = normalizeWord(word);
  const evidence: string[] = [];
  let score = 0;

  const markers = new Set(
    profile.markerWords.map(normalizeWord),
  );
  if (markers.has(normalized)) {
    score += 4;
    evidence.push(`marker:${normalized}`);
  }

  const distinctives = profile.distinctiveCharacters ?? [];
  const matchedDistinctive = distinctives.find((character) =>
    normalized.includes(normalizeWord(character)),
  );
  if (matchedDistinctive !== undefined) {
    score += 5;
    evidence.push(
      `distinctive-character:${normalizeWord(matchedDistinctive)}`,
    );
  }

  if (sourceHint === profile.language && score > 0) {
    score += sourceHintBoost;
    evidence.push("source-language-hint");
  }

  score += (profile.priority ?? 0) * 0.001;
  return { score, evidence };
};

const inferScript = (word: string): string => {
  if (/\p{Script=Cyrillic}/u.test(word)) return "Cyrillic";
  if (/\p{Script=Han}/u.test(word)) return "Han";
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(word)) {
    return "Japanese";
  }
  if (/\p{Script=Hangul}/u.test(word)) return "Hangul";
  if (/\p{Script=Arabic}/u.test(word)) return "Arabic";
  if (/\p{Script=Devanagari}/u.test(word)) return "Devanagari";
  if (/\p{Script=Latin}/u.test(word)) return "Latin";
  return "Unknown";
};

const confidenceFor = (
  score: number,
  total: number,
): number =>
  total <= 0 ? 0 : Math.min(1, Math.max(0, score / total));

export class DeterministicMixedLanguageSpanTagger
  implements LanguageSpanTagger
{
  readonly id = "grounding.language-mixed-deterministic.v1";
  readonly #profiles: DeterministicLanguageProfile[];
  readonly #unknownLanguage: string;
  readonly #sourceHintBoost: number;

  constructor(
    options: DeterministicMixedLanguageTaggerOptions,
  ) {
    if (options.profiles.length < 2) {
      throw new StructuredError(
        "GROUNDING_LANGUAGE_PROFILES",
        "Mixed-language tagging requires at least two language profiles.",
      );
    }

    const languages = new Set<string>();
    for (const profile of options.profiles) {
      if (
        profile.language.trim() === "" ||
        languages.has(profile.language)
      ) {
        throw new StructuredError(
          "GROUNDING_LANGUAGE_PROFILE_DUPLICATE",
          "Language profiles require unique non-empty language tags.",
        );
      }
      languages.add(profile.language);
    }

    this.#profiles = options.profiles.map((profile) => ({
      ...structuredClone(profile),
      markerWords: [...profile.markerWords],
      distinctiveCharacters: [
        ...(profile.distinctiveCharacters ?? []),
      ],
    }));
    this.#unknownLanguage =
      options.unknownLanguage?.trim() || "und";
    this.#sourceHintBoost = options.sourceHintBoost ?? 0.5;
  }

  tag(input: NormalizedGroundingSource): LanguageSpan[] {
    const output: LanguageSpan[] = [];

    for (const match of input.text.matchAll(wordPattern)) {
      const start = match.index;
      const surface = match[0];
      const end = start + surface.length;
      const scored = this.#profiles
        .map((profile) => {
          const result = scoreWord(
            surface,
            profile,
            input.source.languageHint,
            this.#sourceHintBoost,
          );
          return {
            language: profile.language,
            score: result.score,
            evidence: result.evidence,
            script: profile.script ?? inferScript(surface),
          };
        })
        .filter((entry) => entry.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.language.localeCompare(b.language),
        );

      if (scored.length === 0) {
        output.push({
          start,
          end,
          language: this.#unknownLanguage,
          confidence: 0,
          source: "deterministic",
          script: inferScript(surface),
          hypotheses: [],
        });
        continue;
      }

      const total = scored.reduce(
        (sum, entry) => sum + entry.score,
        0,
      );
      const hypotheses: LanguageHypothesis[] = scored.map(
        (entry) => ({
          language: entry.language,
          confidence: confidenceFor(entry.score, total),
          evidence: [...entry.evidence],
        }),
      );
      const best = scored[0]!;
      const second = scored[1];
      const ambiguous =
        second !== undefined && second.score === best.score;

      output.push({
        start,
        end,
        language: ambiguous
          ? this.#unknownLanguage
          : best.language,
        confidence: ambiguous
          ? 0
          : confidenceFor(best.score, total),
        source: "deterministic",
        script: best.script,
        ...(ambiguous ? { ambiguous: true } : {}),
        hypotheses,
      });
    }

    return output;
  }
}

const vietnameseDistinctiveCharacters = [
  "ă",
  "â",
  "đ",
  "ê",
  "ô",
  "ơ",
  "ư",
  "á",
  "à",
  "ả",
  "ã",
  "ạ",
  "é",
  "è",
  "ẻ",
  "ẽ",
  "ẹ",
  "í",
  "ì",
  "ỉ",
  "ĩ",
  "ị",
  "ó",
  "ò",
  "ỏ",
  "õ",
  "ọ",
  "ú",
  "ù",
  "ủ",
  "ũ",
  "ụ",
  "ý",
  "ỳ",
  "ỷ",
  "ỹ",
  "ỵ",
];

export const createEnglishVietnameseCodeSwitchTagger =
  (): DeterministicMixedLanguageSpanTagger =>
    new DeterministicMixedLanguageSpanTagger({
      profiles: [
        {
          language: "en",
          script: "Latin",
          markerWords: [
            "the",
            "a",
            "an",
            "service",
            "must",
            "should",
            "may",
            "not",
            "delete",
            "file",
            "files",
            "if",
            "because",
            "and",
            "or",
            "is",
            "are",
            "this",
            "that",
            "with",
            "from",
            "to",
          ],
        },
        {
          language: "vi",
          script: "Latin",
          markerWords: [
            "dịch",
            "vụ",
            "phải",
            "nên",
            "có",
            "không",
            "xóa",
            "tệp",
            "nếu",
            "vì",
            "và",
            "hoặc",
            "là",
            "một",
            "các",
            "này",
            "đó",
            "đang",
            "đã",
            "sẽ",
            "từ",
            "đến",
          ],
          distinctiveCharacters: vietnameseDistinctiveCharacters,
        },
      ],
      unknownLanguage: "und",
    });

export interface OpenWorldTermRequest {
  normalized: NormalizedGroundingSource;
  start: number;
  end: number;
  parents: ConceptRef[];
  ontology: OntologyStore;
  languageSpans?: readonly LanguageSpan[];
  kind?: ConceptKind;
  provenance?: ProvenanceRef[];
  localDefinition?: string;
}

export interface OpenWorldTermProposal {
  exactSurface: StringLikeValue;
  sourceSpan: SpanRef;
  exactText: string;
  concept: ConceptDefinition;
  languageHypotheses: LanguageHypothesis[];
}

const overlappingHypotheses = (
  spans: readonly LanguageSpan[],
  start: number,
  end: number,
): LanguageHypothesis[] => {
  const output = new Map<string, LanguageHypothesis>();

  for (const span of spans) {
    if (Math.max(start, span.start) >= Math.min(end, span.end)) {
      continue;
    }

    const candidates =
      span.hypotheses !== undefined &&
      span.hypotheses.length > 0
        ? span.hypotheses
        : span.language === "und"
          ? []
          : [
              {
                language: span.language,
                confidence: span.confidence ?? 0,
                evidence: [`span-source:${span.source}`],
              },
            ];

    for (const candidate of candidates) {
      const existing = output.get(candidate.language);
      if (
        existing === undefined ||
        candidate.confidence > existing.confidence
      ) {
        output.set(candidate.language, {
          language: candidate.language,
          confidence: candidate.confidence,
          evidence: [...candidate.evidence],
        });
      } else if (candidate.confidence === existing.confidence) {
        existing.evidence = [
          ...new Set([
            ...existing.evidence,
            ...candidate.evidence,
          ]),
        ].sort();
      }
    }
  }

  return [...output.values()].sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.language.localeCompare(b.language),
  );
};

export const proposeOpenWorldTerm = (
  request: OpenWorldTermRequest,
): Result<OpenWorldTermProposal> => {
  if (request.parents.length === 0) {
    return err(
      new StructuredError(
        "GROUNDING_OPEN_WORLD_PARENT_REQUIRED",
        "A provisional open-world concept requires at least one justified parent concept.",
      ),
    );
  }

  for (const parent of request.parents) {
    if (request.ontology.getConcept(parent) === undefined) {
      return err(
        new StructuredError(
          "GROUNDING_OPEN_WORLD_PARENT_UNKNOWN",
          `Open-world term parent concept does not exist: ${parent}.`,
        ),
      );
    }
  }

  const span = mapNormalizedRangeToSourceSpan(
    request.normalized,
    request.start,
    request.end,
  );
  if (!span.ok) return span;

  const exact = resolveUtf16Span(
    request.normalized.source,
    span.value,
  );
  if (!exact.ok) return exact;
  if (exact.value.length === 0) {
    return err(
      new StructuredError(
        "GROUNDING_OPEN_WORLD_EMPTY",
        "An open-world term cannot reference an empty source span.",
      ),
    );
  }

  const parentKey = [...request.parents].sort().join("|");
  const digest = sha256(
    [
      span.value.sourceId,
      span.value.sourceVersion,
      span.value.digest,
      parentKey,
      request.kind ?? "abstract",
    ].join("\u0000"),
  );
  const localId = `term-${digest.slice(0, 24)}`;
  const concept: ConceptDefinition = {
    id: `concept:provisional.${localId}` as ConceptRef,
    namespace: "provisional",
    labels: { source: exact.value },
    parents: [...request.parents],
    status: "provisional",
    kind: request.kind ?? "abstract",
    constraints: [],
    ...(request.localDefinition === undefined
      ? {}
      : {
          definition: {
            localDefinition: request.localDefinition,
            exactSourceSpan: span.value,
          },
        }),
    provenance: [...(request.provenance ?? [])],
  };

  return ok({
    exactSurface: {
      kind: "span-ref",
      span: structuredClone(span.value),
    },
    sourceSpan: structuredClone(span.value),
    exactText: exact.value,
    concept,
    languageHypotheses: overlappingHypotheses(
      request.languageSpans ?? [],
      request.start,
      request.end,
    ),
  });
};

export const commitOpenWorldTerm = (
  ontology: OntologyStore,
  proposal: OpenWorldTermProposal,
): Result<ConceptDefinition> => {
  const existing = ontology.getConcept(proposal.concept.id);
  if (existing !== undefined) {
    const sameParents =
      [...existing.parents].sort().join("\u0000") ===
      [...proposal.concept.parents].sort().join("\u0000");
    const sameLabel =
      existing.labels.source === proposal.concept.labels.source;
    if (sameParents && sameLabel) {
      return ok(existing);
    }
    return err(
      new StructuredError(
        "GROUNDING_OPEN_WORLD_CONCEPT_COLLISION",
        `Deterministic provisional concept id collides with different semantics: ${proposal.concept.id}.`,
      ),
    );
  }

  const added = ontology.addConcept(proposal.concept);
  return added.ok
    ? ok(structuredClone(proposal.concept))
    : err(added.error);
};
