import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type { ConstituentOrderingProvider } from "../../grammar-core/src/index.ts";
import type {
  MorphFeatures,
  MorphologicalConstructionProvider,
} from "../../morphology-core/src/index.ts";

export type ZeroRealizationKind =
  | "pro-drop"
  | "zero-copula"
  | "zero-determiner"
  | "ellipsis"
  | "other";

export interface ZeroRealizationDecision {
  kind: ZeroRealizationKind;
  semanticRef: SemanticId;
  licensed: boolean;
  reason: string;
  recoverability: "unambiguous" | "context-dependent" | "ambiguous";
}

export interface ZeroRealizationProvider {
  readonly id: string;
  readonly language: string;
  decide(input: {
    semanticRef: SemanticId;
    grammaticalRole: string;
    features: MorphFeatures;
    discourseStatus?: "given" | "new" | "topic" | "focus";
  }): ZeroRealizationDecision[];
}

export interface ClassifierSelectionCandidate {
  classifier: string;
  semanticClass?: string;
  score?: number;
  reason: string;
}

export interface ClassifierSelectionProvider {
  readonly id: string;
  readonly language: string;
  select(input: {
    nounSemanticRef: SemanticId;
    quantity?: number;
    morphFeatures?: MorphFeatures;
  }): ClassifierSelectionCandidate[];
}

export interface SocialRealizationContext {
  speakerRef?: SemanticId;
  addresseeRef?: SemanticId;
  referentRef?: SemanticId;
  relation?: string;
  formality?: number;
  politeness?: number;
  socialFeatures?: Record<string, string | number | boolean>;
}

export interface SocialRealizationCandidate {
  surface: string;
  features: Record<string, string | number | boolean>;
  reason: string;
}

export interface SocialDeixisRealizationProvider {
  readonly id: string;
  readonly language: string;
  realize(context: SocialRealizationContext): SocialRealizationCandidate[];
}

export interface CodeSwitchSegment {
  startToken: number;
  endToken: number;
  language: string;
  confidence?: number;
  source: "lexicon" | "morphology" | "configured" | "unknown";
  borrowing?: boolean;
}

export const validateCodeSwitchSegments = (
  segments: readonly CodeSwitchSegment[],
  tokenCount: number,
): Result<void> => {
  if (!Number.isInteger(tokenCount) || tokenCount < 0) {
    return err(
      new StructuredError(
        "LANG_CODE_SWITCH_TOKEN_COUNT",
        "Code-switch validation requires a non-negative token count.",
      ),
    );
  }
  const ordered=[...segments].sort((a,b)=>a.startToken-b.startToken || a.endToken-b.endToken);
  for(let index=0;index<ordered.length;index+=1){
    const segment=ordered[index]!;
    if(
      !Number.isInteger(segment.startToken) ||
      !Number.isInteger(segment.endToken) ||
      segment.startToken < 0 ||
      segment.endToken <= segment.startToken ||
      segment.endToken > tokenCount ||
      segment.language.trim()==="" ||
      (segment.confidence !== undefined &&
        (!Number.isFinite(segment.confidence) ||
          segment.confidence < 0 ||
          segment.confidence > 1))
    ){
      return err(
        new StructuredError(
          "LANG_CODE_SWITCH_SEGMENT",
          "Code-switch segments require valid token bounds, language, and normalized optional confidence.",
        ),
      );
    }
    const previous=ordered[index-1];
    if(previous !== undefined && segment.startToken < previous.endToken){
      return err(
        new StructuredError(
          "LANG_CODE_SWITCH_OVERLAP",
          "Code-switch segments must not overlap.",
        ),
      );
    }
  }
  return ok(undefined);
};

export interface TypologyProviderBundle {
  constituentOrder: ConstituentOrderingProvider;
  zeroRealization?: ZeroRealizationProvider;
  classifiers?: ClassifierSelectionProvider;
  socialDeixis?: SocialDeixisRealizationProvider;
  morphologicalConstructions?: MorphologicalConstructionProvider;
}

export const assertTypologyProviderLanguages = (
  language: string,
  bundle: TypologyProviderBundle,
): void => {
  const providerLanguages=[
    bundle.constituentOrder.language,
    ...(bundle.zeroRealization === undefined ? [] : [bundle.zeroRealization.language]),
    ...(bundle.classifiers === undefined ? [] : [bundle.classifiers.language]),
    ...(bundle.socialDeixis === undefined ? [] : [bundle.socialDeixis.language]),
    ...(bundle.morphologicalConstructions === undefined
      ? []
      : [bundle.morphologicalConstructions.language]),
  ];
  if(providerLanguages.some(value=>value!==language)){
    throw new StructuredError(
      "LANG_TYPOLOGY_PROVIDER_LANGUAGE",
      `Typology provider bundle for ${language} contains mismatched provider languages: ${providerLanguages.join(", ")}`,
    );
  }
};
