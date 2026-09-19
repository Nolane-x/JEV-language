import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type { ConceptRef } from "../../ontology/src/index.ts";

export interface SelectionalPreference {
  preferredConcepts?: ConceptRef[];
  dispreferredConcepts?: ConceptRef[];
  semanticFeatures?: string[];
  strength?: number;
}

export type UnicodeNormalizationLayer =
  | "source-exact"
  | "NFC"
  | "NFD"
  | "NFKC"
  | "NFKD"
  | "case-folded";

export interface NormalizedSurfaceLayer {
  layer: UnicodeNormalizationLayer;
  value: string;
}

export const unicodeNormalizationLayers = (
  source: string,
  locale = "und",
): NormalizedSurfaceLayer[] => [
  { layer: "source-exact", value: source },
  { layer: "NFC", value: source.normalize("NFC") },
  { layer: "NFD", value: source.normalize("NFD") },
  { layer: "NFKC", value: source.normalize("NFKC") },
  { layer: "NFKD", value: source.normalize("NFKD") },
  {
    layer: "case-folded",
    value: source.normalize("NFKC").toLocaleLowerCase(locale),
  },
];

export const graphemeSegments = (
  source: string,
  locale = "und",
): string[] => {
  const SegmenterCtor = Intl.Segmenter;
  const segmenter = new SegmenterCtor(locale, { granularity: "grapheme" });
  return [...segmenter.segment(source)].map((entry) => entry.segment);
};

export const sliceGraphemes = (
  source: string,
  start: number,
  end?: number,
  locale = "und",
): Result<string> => {
  if (
    !Number.isInteger(start) ||
    start < 0 ||
    (end !== undefined && (!Number.isInteger(end) || end < start))
  ) {
    return err(
      new StructuredError(
        "LEXICON_GRAPHEME_RANGE",
        "Grapheme slicing requires non-negative integer bounds.",
      ),
    );
  }
  const segments = graphemeSegments(source, locale);
  if (start > segments.length || (end !== undefined && end > segments.length)) {
    return err(
      new StructuredError(
        "LEXICON_GRAPHEME_BOUNDS",
        "Grapheme slice is outside the surface bounds.",
      ),
    );
  }
  return ok(segments.slice(start, end).join(""));
};

export interface NamedEntityAlias {
  surface: string;
  language?: string;
  script?: string;
  validFrom?: string;
  validTo?: string;
  sourceRef?: string;
}

export interface NamedEntityLexicalModel {
  entityId: string;
  canonicalName: string;
  canonicalScript?: string;
  aliases: NamedEntityAlias[];
}

const validIsoDate = (value: string | undefined): boolean =>
  value === undefined || /^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(value);

export const validateNamedEntityLexicalModel = (
  model: NamedEntityLexicalModel,
): Result<void> => {
  if (
    model.entityId.trim() === "" ||
    model.canonicalName.trim() === "" ||
    model.aliases.some((alias) => alias.surface.trim() === "")
  ) {
    return err(
      new StructuredError(
        "LEXICON_NAMED_ENTITY_REQUIRED",
        "Named-entity lexical models require entity id, canonical name, and non-empty aliases.",
      ),
    );
  }
  for (const alias of model.aliases) {
    if (!validIsoDate(alias.validFrom) || !validIsoDate(alias.validTo)) {
      return err(
        new StructuredError(
          "LEXICON_NAMED_ENTITY_VALIDITY",
          "Named-entity alias validity bounds must be ISO-like dates.",
        ),
      );
    }
    if (
      alias.validFrom !== undefined &&
      alias.validTo !== undefined &&
      alias.validFrom > alias.validTo
    ) {
      return err(
        new StructuredError(
          "LEXICON_NAMED_ENTITY_VALIDITY_ORDER",
          "Named-entity alias validFrom must not be after validTo.",
        ),
      );
    }
  }
  return ok(undefined);
};

export interface UnknownLexeme {
  kind: "unknown-lexeme";
  surfaceExact: string;
  languageHypotheses: string[];
  script?: string;
  normalization: NormalizedSurfaceLayer[];
  preservedExact: true;
}

export const createUnknownLexeme = (input: {
  surface: string;
  languageHypotheses?: readonly string[];
  script?: string;
}): Result<UnknownLexeme> => {
  if (input.surface.length === 0) {
    return err(
      new StructuredError(
        "LEXICON_UNKNOWN_EMPTY",
        "Unknown lexemes must preserve a non-empty exact surface.",
      ),
    );
  }
  const languageHypotheses = [...new Set(input.languageHypotheses ?? [])]
    .filter((value) => value.trim() !== "")
    .sort();
  return ok({
    kind: "unknown-lexeme",
    surfaceExact: input.surface,
    languageHypotheses,
    ...(input.script === undefined ? {} : { script: input.script }),
    normalization: unicodeNormalizationLayers(input.surface),
    preservedExact: true,
  });
};

export type LexicalExtensionProposalStatus =
  | "proposed"
  | "reviewed"
  | "accepted"
  | "rejected"
  | "deprecated";

export interface LexicalExtensionProposal {
  id: string;
  surface: string;
  language: string;
  proposedSenseId: string;
  proposedConcept?: ConceptRef;
  evidenceRefs: string[];
  status: LexicalExtensionProposalStatus;
  reviewedBy?: string;
  decisionReason?: string;
}

const allowedProposalTransitions: Readonly<
  Record<LexicalExtensionProposalStatus, readonly LexicalExtensionProposalStatus[]>
> = {
  proposed: ["reviewed", "rejected"],
  reviewed: ["accepted", "rejected"],
  accepted: ["deprecated"],
  rejected: [],
  deprecated: [],
};

export const transitionLexicalExtensionProposal = (
  proposal: LexicalExtensionProposal,
  nextStatus: LexicalExtensionProposalStatus,
  input: { reviewedBy?: string; decisionReason?: string } = {},
): Result<LexicalExtensionProposal> => {
  if (
    proposal.id.trim() === "" ||
    proposal.surface.length === 0 ||
    proposal.language.trim() === "" ||
    proposal.proposedSenseId.trim() === "" ||
    proposal.evidenceRefs.length === 0
  ) {
    return err(
      new StructuredError(
        "LEXICON_PROPOSAL_REQUIRED",
        "Lexical extension proposals require identity, surface, language, sense, and evidence.",
      ),
    );
  }
  if (!allowedProposalTransitions[proposal.status].includes(nextStatus)) {
    return err(
      new StructuredError(
        "LEXICON_PROPOSAL_TRANSITION",
        `Invalid lexical proposal transition ${proposal.status} -> ${nextStatus}.`,
      ),
    );
  }
  if (
    (nextStatus === "reviewed" ||
      nextStatus === "accepted" ||
      nextStatus === "rejected") &&
    (input.reviewedBy === undefined || input.reviewedBy.trim() === "")
  ) {
    return err(
      new StructuredError(
        "LEXICON_PROPOSAL_REVIEWER",
        "Reviewed/accepted/rejected lexical proposals require reviewer identity.",
      ),
    );
  }
  return ok({
    ...structuredClone(proposal),
    status: nextStatus,
    ...(input.reviewedBy === undefined ? {} : { reviewedBy: input.reviewedBy }),
    ...(input.decisionReason === undefined
      ? {}
      : { decisionReason: input.decisionReason }),
  });
};

export interface TransliterationCandidate {
  source: string;
  target: string;
  sourceScript?: string;
  targetScript: string;
  reversible: boolean;
  confidence?: number;
}

export interface TransliterationAdapter {
  readonly id: string;
  readonly sourceLanguage?: string;
  readonly targetLanguage?: string;
  readonly sourceScripts: readonly string[];
  readonly targetScripts: readonly string[];
  transliterate(input: {
    surface: string;
    sourceScript?: string;
    targetScript: string;
  }): Result<TransliterationCandidate[]>;
}

export const validateTransliterationCandidates = (
  candidates: readonly TransliterationCandidate[],
): Result<void> => {
  for (const candidate of candidates) {
    if (
      candidate.source.length === 0 ||
      candidate.target.length === 0 ||
      candidate.targetScript.trim() === "" ||
      (candidate.confidence !== undefined &&
        (!Number.isFinite(candidate.confidence) ||
          candidate.confidence < 0 ||
          candidate.confidence > 1))
    ) {
      return err(
        new StructuredError(
          "LEXICON_TRANSLITERATION_CANDIDATE",
          "Transliteration candidates require source/target/script and normalized optional confidence.",
        ),
      );
    }
  }
  return ok(undefined);
};
