import {
  ok,
  type Result,
} from "../../core-types/src/index.ts";
import type { GraphSnapshot } from "../../semantic-graph/src/index.ts";
import {
  criticalSemanticPreservationProfile,
  verifySemanticPreservation,
  type PreservationReport,
} from "./semantic-preservation.ts";

export interface TranslationInvariantReport {
  ok: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  preservation: PreservationReport;
  forcedDisambiguations: string[];
}

export const verifyTranslationInvariants = (input: {
  sourceLanguage: string;
  targetLanguage: string;
  sourceGraph: GraphSnapshot;
  targetGraph: GraphSnapshot;
  forcedDisambiguations?: readonly string[];
}): Result<TranslationInvariantReport> => {
  const preservation = verifySemanticPreservation(
    input.sourceGraph,
    input.targetGraph,
    criticalSemanticPreservationProfile,
  );
  return ok({
    ok: preservation.ok,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    preservation,
    forcedDisambiguations: [...new Set(input.forcedDisambiguations ?? [])].sort(),
  });
};
