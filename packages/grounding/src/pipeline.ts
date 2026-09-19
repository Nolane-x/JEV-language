import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  makeUtf16Span,
  parseKnownLiteral,
  type GroundingSource,
  type ParsedLiteral,
  type SpanRef,
} from "../../open-world-values/src/index.ts";

export interface NormalizationEdit {
  originalStart: number;
  originalEnd: number;
  normalizedStart: number;
  normalizedEnd: number;
  kind: "line-ending" | "unicode-nfc";
}

export interface NormalizedGroundingSource {
  source: GroundingSource;
  text: string;
  edits: NormalizationEdit[];
  /**
   * UTF-16 normalized boundary -> original UTF-16 boundary.
   * Length is always text.length + 1.
   */
  normalizedToOriginal: number[];
}

export type SegmentKind = "line" | "sentence";

export interface GroundingSegment {
  id: string;
  kind: SegmentKind;
  start: number;
  end: number;
  sourceSpan: SpanRef;
  text: string;
}

export type GroundingTokenCategory =
  | "word"
  | "number"
  | "punctuation"
  | "whitespace"
  | "symbol"
  | "unknown";

export interface GroundingToken {
  id: string;
  start: number;
  end: number;
  text: string;
  category: GroundingTokenCategory;
  sourceSpan: SpanRef;
  literal?: ParsedLiteral;
}

export interface LanguageHypothesis {
  language: string;
  confidence: number;
  evidence: string[];
}

export interface LanguageSpan {
  start: number;
  end: number;
  language: string;
  confidence?: number;
  source: "hint" | "deterministic" | "external";
  script?: string;
  ambiguous?: boolean;
  hypotheses?: LanguageHypothesis[];
}

export interface LanguageSpanTagger {
  readonly id: string;
  tag(input: NormalizedGroundingSource): LanguageSpan[];
}

export interface LiteralExtraction {
  tokenId: string;
  literal: ParsedLiteral;
}

export interface LiteralExtractor {
  readonly id: string;
  extract(token: GroundingToken): ParsedLiteral | undefined;
}

export interface GroundingLexiconMatch {
  tokenId: string;
  language?: string;
  lemma: string;
  conceptIds: string[];
  score?: number;
}

export interface GroundingLexiconProvider {
  readonly id: string;
  lookup(token: GroundingToken, languageSpans: readonly LanguageSpan[]): GroundingLexiconMatch[];
}

export interface GroundingDocument {
  normalized: NormalizedGroundingSource;
  segments: GroundingSegment[];
  tokens: GroundingToken[];
  languageSpans: LanguageSpan[];
  literals: LiteralExtraction[];
  lexiconMatches: GroundingLexiconMatch[];
}

const requireTextSource = (source: GroundingSource): Result<string> => {
  if (typeof source.content !== "string") {
    return err(
      new StructuredError(
        "GROUNDING_NON_TEXT_SOURCE",
        "The M4 grounding pipeline currently accepts text grounding sources only.",
      ),
    );
  }
  return ok(source.content);
};

const normalizeLineEndings = (
  original: string,
): { text: string; boundaryMap: number[]; edits: NormalizationEdit[] } => {
  let text = "";
  const boundaryMap: number[] = [0];
  const edits: NormalizationEdit[] = [];

  for (let index = 0; index < original.length; ) {
    const start = index;
    const normalizedStart = text.length;

    if (original[index] === "\r") {
      const width = original[index + 1] === "\n" ? 2 : 1;
      index += width;
      text += "\n";
      boundaryMap.push(index);
      edits.push({
        originalStart: start,
        originalEnd: index,
        normalizedStart,
        normalizedEnd: text.length,
        kind: "line-ending",
      });
      continue;
    }

    text += original[index] ?? "";
    index += 1;
    boundaryMap.push(index);
  }

  return { text, boundaryMap, edits };
};

const normalizeUnicodeNfc = (
  lineNormalized: string,
  lineBoundaryMap: readonly number[],
  priorEdits: readonly NormalizationEdit[],
): { text: string; boundaryMap: number[]; edits: NormalizationEdit[] } => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let text = "";
  const boundaryMap: number[] = [lineBoundaryMap[0] ?? 0];
  const lineToFinal = new Array<number>(lineNormalized.length + 1).fill(0);
  const unicodeEdits: NormalizationEdit[] = [];

  for (const part of segmenter.segment(lineNormalized)) {
    const inputStart = part.index;
    const inputEnd = inputStart + part.segment.length;
    const originalStart = lineBoundaryMap[inputStart] ?? 0;
    const originalEnd =
      lineBoundaryMap[inputEnd] ?? lineBoundaryMap[lineBoundaryMap.length - 1] ?? 0;
    const normalizedStart = text.length;
    const normalized = part.segment.normalize("NFC");

    lineToFinal[inputStart] = normalizedStart;
    for (let boundary = inputStart + 1; boundary < inputEnd; boundary += 1) {
      lineToFinal[boundary] = normalizedStart;
    }

    text += normalized;
    lineToFinal[inputEnd] = text.length;

    for (let offset = 1; offset <= normalized.length; offset += 1) {
      boundaryMap.push(offset === normalized.length ? originalEnd : originalStart);
    }

    if (normalized !== part.segment) {
      unicodeEdits.push({
        originalStart,
        originalEnd,
        normalizedStart,
        normalizedEnd: text.length,
        kind: "unicode-nfc",
      });
    }
  }

  const rebasedPriorEdits = priorEdits.map((edit) => ({
    ...edit,
    normalizedStart: lineToFinal[edit.normalizedStart] ?? edit.normalizedStart,
    normalizedEnd: lineToFinal[edit.normalizedEnd] ?? edit.normalizedEnd,
  }));

  return {
    text,
    boundaryMap,
    edits: [...rebasedPriorEdits, ...unicodeEdits],
  };
};

export const normalizeGroundingSource = (
  source: GroundingSource,
): Result<NormalizedGroundingSource> => {
  const content = requireTextSource(source);
  if (!content.ok) return content;

  const line = normalizeLineEndings(content.value);
  const unicode = normalizeUnicodeNfc(
    line.text,
    line.boundaryMap,
    line.edits,
  );

  if (unicode.boundaryMap.length !== unicode.text.length + 1) {
    return err(
      new StructuredError(
        "GROUNDING_NORMALIZATION_MAP_INVALID",
        "Normalization boundary map is inconsistent with normalized UTF-16 length.",
      ),
    );
  }

  return ok({
    source,
    text: unicode.text,
    edits: unicode.edits,
    normalizedToOriginal: unicode.boundaryMap,
  });
};

export const mapNormalizedRangeToSourceSpan = (
  normalized: NormalizedGroundingSource,
  start: number,
  end: number,
): Result<SpanRef> => {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > normalized.text.length
  ) {
    return err(
      new StructuredError(
        "GROUNDING_NORMALIZED_RANGE",
        `Invalid normalized UTF-16 range [${start}, ${end}).`,
      ),
    );
  }

  const originalStart = normalized.normalizedToOriginal[start];
  const originalEnd = normalized.normalizedToOriginal[end];
  if (originalStart === undefined || originalEnd === undefined) {
    return err(
      new StructuredError(
        "GROUNDING_NORMALIZATION_MAP_MISSING",
        "Normalized range does not map back to original source boundaries.",
      ),
    );
  }

  return ok(makeUtf16Span(normalized.source, originalStart, originalEnd));
};

const pushSegment = (
  output: GroundingSegment[],
  normalized: NormalizedGroundingSource,
  kind: SegmentKind,
  start: number,
  end: number,
): void => {
  if (end <= start) return;
  const span = mapNormalizedRangeToSourceSpan(normalized, start, end);
  if (!span.ok) throw span.error;
  output.push({
    id: `${kind}:${output.length}`,
    kind,
    start,
    end,
    sourceSpan: span.value,
    text: normalized.text.slice(start, end),
  });
};

export const segmentGroundingSource = (
  normalized: NormalizedGroundingSource,
  kind: SegmentKind = "sentence",
): GroundingSegment[] => {
  const output: GroundingSegment[] = [];
  const text = normalized.text;

  if (kind === "line") {
    let start = 0;
    for (let index = 0; index <= text.length; index += 1) {
      if (index === text.length || text[index] === "\n") {
        pushSegment(output, normalized, kind, start, index);
        start = index + 1;
      }
    }
    return output;
  }

  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== "." && char !== "!" && char !== "?") continue;
    const next = text[index + 1];
    if (next !== undefined && !/\s/u.test(next)) continue;

    let end = index + 1;
    while (end < text.length && /\s/u.test(text[end] ?? "")) end += 1;
    pushSegment(output, normalized, kind, start, index + 1);
    start = end;
    index = end - 1;
  }
  pushSegment(output, normalized, kind, start, text.length);
  return output;
};

const tokenPattern =
  /https?:\/\/[^\s]+|[^\s@]+@[^\s@]+\.[^\s@]+|[+-]?(?:\d+(?:\.\d+)?|\.\d+)|[\p{L}\p{M}_][\p{L}\p{M}\p{N}_'’-]*|\s+|[^\s]/gu;

const classifyToken = (text: string): GroundingTokenCategory => {
  if (/^\s+$/u.test(text)) return "whitespace";
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(text)) return "number";
  if (/^[\p{L}\p{M}_][\p{L}\p{M}\p{N}_'’-]*$/u.test(text)) return "word";
  if (/^[\p{P}]+$/u.test(text)) return "punctuation";
  if (/^[\p{S}]+$/u.test(text)) return "symbol";
  return "unknown";
};

const knownLiteralOrUndefined = (surface: string): ParsedLiteral | undefined => {
  const literal = parseKnownLiteral(surface);
  return literal.kind === "text" ? undefined : literal;
};

export const tokenizeGroundingSource = (
  normalized: NormalizedGroundingSource,
): GroundingToken[] => {
  const output: GroundingToken[] = [];

  for (const match of normalized.text.matchAll(tokenPattern)) {
    const start = match.index;
    const text = match[0];
    const end = start + text.length;
    const span = mapNormalizedRangeToSourceSpan(normalized, start, end);
    if (!span.ok) throw span.error;

    const literal = knownLiteralOrUndefined(text);
    output.push({
      id: `token:${output.length}`,
      start,
      end,
      text,
      category: classifyToken(text),
      sourceSpan: span.value,
      ...(literal === undefined ? {} : { literal }),
    });
  }

  return output;
};

export class HintLanguageSpanTagger implements LanguageSpanTagger {
  readonly id = "grounding.language-hint.v1";

  tag(input: NormalizedGroundingSource): LanguageSpan[] {
    const language = input.source.languageHint;
    if (language === undefined || input.text.length === 0) return [];
    return [
      {
        start: 0,
        end: input.text.length,
        language,
        source: "hint",
      },
    ];
  }
}

export class LiteralExtractionRegistry {
  readonly #extractors: LiteralExtractor[] = [];

  constructor(extractors: readonly LiteralExtractor[] = []) {
    for (const extractor of extractors) this.register(extractor);
  }

  register(extractor: LiteralExtractor): void {
    if (this.#extractors.some((entry) => entry.id === extractor.id)) {
      throw new StructuredError(
        "GROUNDING_LITERAL_EXTRACTOR_DUPLICATE",
        `Literal extractor already registered: ${extractor.id}.`,
      );
    }
    this.#extractors.push(extractor);
  }

  extract(tokens: readonly GroundingToken[]): LiteralExtraction[] {
    const output: LiteralExtraction[] = [];
    for (const token of tokens) {
      for (const extractor of this.#extractors) {
        const literal = extractor.extract(token);
        if (literal === undefined) continue;
        output.push({ tokenId: token.id, literal });
        break;
      }
    }
    return output;
  }
}

export const knownLiteralExtractor: LiteralExtractor = {
  id: "grounding.known-literal.v1",
  extract(token) {
    return knownLiteralOrUndefined(token.text);
  },
};

export interface GroundingPipelineOptions {
  segmentKind?: SegmentKind;
  languageTaggers?: readonly LanguageSpanTagger[];
  literalRegistry?: LiteralExtractionRegistry;
  lexiconProviders?: readonly GroundingLexiconProvider[];
}

export const groundSource = (
  source: GroundingSource,
  options: GroundingPipelineOptions = {},
): Result<GroundingDocument> => {
  const normalized = normalizeGroundingSource(source);
  if (!normalized.ok) return normalized;

  try {
    const tokens = tokenizeGroundingSource(normalized.value);
    const segments = segmentGroundingSource(
      normalized.value,
      options.segmentKind ?? "sentence",
    );
    const taggers =
      options.languageTaggers ?? [new HintLanguageSpanTagger()];
    const languageSpans = taggers.flatMap((tagger) =>
      tagger.tag(normalized.value),
    );
    const literalRegistry =
      options.literalRegistry ??
      new LiteralExtractionRegistry([knownLiteralExtractor]);
    const literals = literalRegistry.extract(tokens);
    const lexiconMatches = (options.lexiconProviders ?? []).flatMap((provider) =>
      tokens.flatMap((token) => provider.lookup(token, languageSpans)),
    );

    return ok({
      normalized: normalized.value,
      segments,
      tokens,
      languageSpans,
      literals,
      lexiconMatches,
    });
  } catch (error) {
    if (error instanceof StructuredError) return err(error);
    throw error;
  }
};
