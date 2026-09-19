import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type { GraphSnapshot } from "../../semantic-graph/src/index.ts";

export interface SemanticTransferTranslationRequest {
  sourceLanguage: string;
  targetLanguage: string;
  sourceSurface: string;
}

export interface SemanticTransferArtifact<TSurface = string> {
  sourceLanguage: string;
  targetLanguage: string;
  sourceSurface: string;
  sourceGraph: GraphSnapshot;
  targetSurface: TSurface;
  targetGraph?: GraphSnapshot;
  forcedDisambiguations: string[];
}

export interface SemanticTransferParser {
  readonly id: string;
  parse(input: {
    language: string;
    surface: string;
  }): Result<GraphSnapshot> | Promise<Result<GraphSnapshot>>;
}

export interface SemanticTransferRealizer<TSurface = string> {
  readonly id: string;
  realize(input: {
    language: string;
    graph: GraphSnapshot;
  }): Result<TSurface> | Promise<Result<TSurface>>;
}

export interface SemanticTransferRoundTripParser {
  readonly id: string;
  parse(input: {
    language: string;
    surface: string;
  }): Result<GraphSnapshot> | Promise<Result<GraphSnapshot>>;
}

export const translateViaSemanticTransfer = async <TSurface = string>(input: {
  request: SemanticTransferTranslationRequest;
  parser: SemanticTransferParser;
  realizer: SemanticTransferRealizer<TSurface>;
  reparseTarget?: SemanticTransferRoundTripParser;
  targetSurfaceToString?: (surface: TSurface) => string;
  forcedDisambiguations?: readonly string[];
}): Promise<Result<SemanticTransferArtifact<TSurface>>> => {
  const { request } = input;
  if (
    request.sourceLanguage.trim() === "" ||
    request.targetLanguage.trim() === "" ||
    request.sourceSurface.length === 0
  ) {
    return err(
      new StructuredError(
        "TRANSLATION_REQUEST_INVALID",
        "Semantic-transfer translation requires source/target languages and non-empty source surface.",
      ),
    );
  }

  const parsed = await input.parser.parse({
    language: request.sourceLanguage,
    surface: request.sourceSurface,
  });
  if (!parsed.ok) return parsed;

  const realized = await input.realizer.realize({
    language: request.targetLanguage,
    graph: parsed.value,
  });
  if (!realized.ok) return realized;

  let targetGraph: GraphSnapshot | undefined;
  if (input.reparseTarget !== undefined) {
    if (input.targetSurfaceToString === undefined) {
      return err(
        new StructuredError(
          "TRANSLATION_TARGET_SERIALIZER_REQUIRED",
          "Round-trip translation verification requires a target surface serializer.",
        ),
      );
    }
    const reparsed = await input.reparseTarget.parse({
      language: request.targetLanguage,
      surface: input.targetSurfaceToString(realized.value),
    });
    if (!reparsed.ok) return reparsed;
    targetGraph = reparsed.value;
  }

  return ok({
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    sourceSurface: request.sourceSurface,
    sourceGraph: parsed.value,
    targetSurface: realized.value,
    ...(targetGraph === undefined ? {} : { targetGraph }),
    forcedDisambiguations: [...new Set(input.forcedDisambiguations ?? [])].sort(),
  });
};
