import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type { GraphOperation } from "../../semantic-graph/src/index.ts";
import type {
  ParseCandidate,
  SyntaxForest,
  SyntaxNodeId,
} from "./index.ts";

export interface ForcedDisambiguationDiagnostic {
  code: "PARSER_FORCED_DISAMBIGUATION";
  ambiguityClass: string;
  sourceAlternatives: string[];
  selectedAlternative: string;
  reason: string;
  targetConstraint?: string;
}

export const forcedDisambiguationDiagnostic = (input: {
  ambiguityClass: string;
  sourceAlternatives: readonly string[];
  selectedAlternative: string;
  reason: string;
  targetConstraint?: string;
}): Result<ForcedDisambiguationDiagnostic> => {
  const alternatives=[...new Set(input.sourceAlternatives)];
  if(
    input.ambiguityClass.trim()==="" ||
    alternatives.length < 2 ||
    !alternatives.includes(input.selectedAlternative) ||
    input.reason.trim()===""
  ){
    return err(new StructuredError(
      "PARSER_FORCED_DISAMBIGUATION_INVALID",
      "Forced-disambiguation diagnostics require ambiguity class, at least two alternatives, a selected member, and reason.",
    ));
  }
  return ok({
    code:"PARSER_FORCED_DISAMBIGUATION",
    ambiguityClass:input.ambiguityClass,
    sourceAlternatives:alternatives,
    selectedAlternative:input.selectedAlternative,
    reason:input.reason,
    ...(input.targetConstraint===undefined?{}:{targetConstraint:input.targetConstraint}),
  });
};

export interface LexicalLatticeAlternative {
  id: string;
  tokenStart: number;
  tokenEnd: number;
  lexemeId?: string;
  senseId?: string;
  semanticTag?: string;
  language?: string;
  score?: number;
  provenanceRefs?: string[];
}

export interface PackedLexicalLattice {
  tokenCount: number;
  alternatives: LexicalLatticeAlternative[];
}

export const validatePackedLexicalLattice = (
  lattice: PackedLexicalLattice,
): Result<PackedLexicalLattice> => {
  if(!Number.isInteger(lattice.tokenCount) || lattice.tokenCount < 1){
    return err(new StructuredError(
      "PARSER_LEXICAL_LATTICE_TOKEN_COUNT",
      "Packed lexical lattices require a positive token count.",
    ));
  }
  const ids=new Set<string>();
  for(const alternative of lattice.alternatives){
    if(
      alternative.id.trim()==="" ||
      ids.has(alternative.id) ||
      !Number.isInteger(alternative.tokenStart) ||
      !Number.isInteger(alternative.tokenEnd) ||
      alternative.tokenStart < 0 ||
      alternative.tokenEnd <= alternative.tokenStart ||
      alternative.tokenEnd > lattice.tokenCount ||
      (alternative.score !== undefined && !Number.isFinite(alternative.score))
    ){
      return err(new StructuredError(
        "PARSER_LEXICAL_LATTICE_ALTERNATIVE",
        "Lexical alternatives require unique ids, valid token spans, and finite optional scores.",
      ));
    }
    ids.add(alternative.id);
  }
  return ok(structuredClone(lattice));
};

export interface SemanticHole {
  id: string;
  expectedKinds: string[];
  required: boolean;
  constraints?: Record<string, JsonValue>;
  sourceSyntaxNode?: SyntaxNodeId;
}

export interface PartialSemanticCandidate {
  id: string;
  rootNodeId: SyntaxNodeId;
  operations: GraphOperation[];
  holes: SemanticHole[];
}

export interface PackedSemanticAlternative {
  id: string;
  syntaxRoot: SyntaxNodeId;
  candidate: ParseCandidate | PartialSemanticCandidate;
  ambiguityTags: string[];
}

export interface PackedSyntaxSemanticForest {
  syntax: SyntaxForest;
  lexical?: PackedLexicalLattice;
  semanticAlternatives: PackedSemanticAlternative[];
}

export const validatePartialSemanticCandidate = (
  candidate: PartialSemanticCandidate,
): Result<void> => {
  const ids=new Set<string>();
  for(const hole of candidate.holes){
    if(
      hole.id.trim()==="" ||
      ids.has(hole.id) ||
      hole.expectedKinds.length===0 ||
      hole.expectedKinds.some(kind=>kind.trim()==="")
    ){
      return err(new StructuredError(
        "PARSER_SEMANTIC_HOLE_INVALID",
        "Semantic holes require unique ids and at least one expected semantic kind.",
      ));
    }
    ids.add(hole.id);
  }
  return ok(undefined);
};

export interface SemanticCompositionInput<TBinding> {
  binding: TBinding;
  syntaxNodeId: SyntaxNodeId;
}

export interface SemanticCompositionOutput {
  operations: GraphOperation[];
  holes?: SemanticHole[];
}

export interface TypedSemanticComposition<TBinding> {
  readonly id: string;
  compose(input: SemanticCompositionInput<TBinding>): Result<SemanticCompositionOutput>;
}

export type PruningStage =
  | "lexical-validity"
  | "grammar-constraints"
  | "semantic-type"
  | "hard-invariants"
  | "profile-budget";

export interface DeterministicPruningSignal {
  candidateId: string;
  stage: PruningStage;
  reject: boolean;
  reason: string;
}

export interface StagedPruningReport<T extends {id:string}> {
  retained: T[];
  rejected: Array<{
    candidate: T;
    stage: PruningStage;
    reason: string;
  }>;
}

export const stagedDeterministicPrune = <T extends {id:string}>(
  candidates: readonly T[],
  signals: readonly DeterministicPruningSignal[],
): Result<StagedPruningReport<T>> => {
  const candidateIds=new Set(candidates.map(candidate=>candidate.id));
  if(candidateIds.size!==candidates.length){
    return err(new StructuredError(
      "PARSER_PRUNE_DUPLICATE_CANDIDATE",
      "Deterministic pruning requires unique candidate ids.",
    ));
  }
  if(signals.some(signal=>
    !candidateIds.has(signal.candidateId) ||
    signal.reason.trim()===""
  )){
    return err(new StructuredError(
      "PARSER_PRUNE_SIGNAL_INVALID",
      "Pruning signals must target existing candidates and include an inspectable reason.",
    ));
  }
  const stageOrder:PruningStage[]=[
    "lexical-validity",
    "grammar-constraints",
    "semantic-type",
    "hard-invariants",
    "profile-budget",
  ];
  const rejected=new Map<string,{stage:PruningStage;reason:string}>();
  for(const stage of stageOrder){
    for(const signal of signals.filter(value=>value.stage===stage && value.reject)){
      if(!rejected.has(signal.candidateId)){
        rejected.set(signal.candidateId,{stage,reason:signal.reason});
      }
    }
  }
  return ok({
    retained:candidates.filter(candidate=>!rejected.has(candidate.id)).map(value=>structuredClone(value)),
    rejected:candidates
      .filter(candidate=>rejected.has(candidate.id))
      .map(candidate=>{
        const detail=rejected.get(candidate.id)!;
        return {candidate:structuredClone(candidate),...detail};
      }),
  });
};

export interface ParseRankingComponent {
  name: string;
  score: number;
  weight: number;
  rationale: string;
}

export interface ParseRankingBreakdown {
  candidateId: string;
  components: ParseRankingComponent[];
  total: number;
}

export const buildParseRankingBreakdown = (
  candidateId: string,
  components: readonly ParseRankingComponent[],
): Result<ParseRankingBreakdown> => {
  if(
    candidateId.trim()==="" ||
    components.length===0 ||
    components.some(component=>
      component.name.trim()==="" ||
      !Number.isFinite(component.score) ||
      !Number.isFinite(component.weight) ||
      component.rationale.trim()===""
    )
  ){
    return err(new StructuredError(
      "PARSER_RANKING_BREAKDOWN_INVALID",
      "Parse ranking requires candidate id and finite inspectable scoring components.",
    ));
  }
  return ok({
    candidateId,
    components:components.map(value=>structuredClone(value)),
    total:components.reduce((sum,component)=>sum+component.score*component.weight,0),
  });
};

export interface ParserProfile {
  id: "strict" | "robust" | (string & {});
  allowPartialGraphs: boolean;
  allowUnknownLexemes: boolean;
  allowRecoveryDiagnostics: boolean;
  preserveAmbiguity: boolean;
  maximumSemanticHoles: number;
  maximumCandidates: number;
}

export const STRICT_PARSER_PROFILE: ParserProfile = {
  id:"strict",
  allowPartialGraphs:false,
  allowUnknownLexemes:false,
  allowRecoveryDiagnostics:false,
  preserveAmbiguity:true,
  maximumSemanticHoles:0,
  maximumCandidates:32,
};

export const ROBUST_PARSER_PROFILE: ParserProfile = {
  id:"robust",
  allowPartialGraphs:true,
  allowUnknownLexemes:true,
  allowRecoveryDiagnostics:true,
  preserveAmbiguity:true,
  maximumSemanticHoles:16,
  maximumCandidates:128,
};

export const validateParserProfile = (
  profile: ParserProfile,
): Result<void> => {
  if(
    profile.id.trim()==="" ||
    !Number.isInteger(profile.maximumSemanticHoles) ||
    profile.maximumSemanticHoles<0 ||
    !Number.isInteger(profile.maximumCandidates) ||
    profile.maximumCandidates<1
  ){
    return err(new StructuredError(
      "PARSER_PROFILE_INVALID",
      "Parser profiles require id, non-negative hole budget, and positive candidate budget.",
    ));
  }
  if(!profile.allowPartialGraphs && profile.maximumSemanticHoles!==0){
    return err(new StructuredError(
      "PARSER_PROFILE_HOLE_POLICY",
      "Profiles that forbid partial graphs must have a zero semantic-hole budget.",
    ));
  }
  return ok(undefined);
};
