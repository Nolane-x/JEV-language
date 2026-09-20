import type { JsonValue, SemanticId } from "../../core-types/src/index.ts";
import type {
  EffectSpec,
  HoleId,
  PirEffectKind,
  PirExpression,
  PirProgram,
  PirStatement,
  PirType,
  ProgramHole,
  ProgramRef,
} from "../../program-ir/src/index.ts";

export type CandidateId = string;
export type SynthesisStateId = string;

export interface CandidateSource {
  kind:
    | "literal"
    | "in-scope-symbol"
    | "function-call"
    | "branch"
    | "collection-pattern"
    | "return"
    | "plugin";
  generatorId: string;
  evidenceRefs: string[];
}

export interface SynthesisProofObligation {
  id: string;
  kind:
    | "type-safety"
    | "effect-safety"
    | "scope-legality"
    | "requirement"
    | "other";
  description: string;
}

export type ExpansionReplacement =
  | { kind: "expression"; value: PirExpression }
  | { kind: "statements"; value: PirStatement[] };

export interface ExpansionCandidate {
  id: CandidateId;
  replacement: ExpansionReplacement;
  newHoles: ProgramHole[];
  proofObligations: SynthesisProofObligation[];
  heuristicCost: number;
  provenance: CandidateSource;
  resultType: PirType;
  effects: EffectSpec[];
}

export interface LiteralCandidate {
  id: string;
  value: JsonValue;
  type: PirType;
  cost?: number;
}

export interface CallableCandidate {
  id: ProgramRef;
  parameterTypes: PirType[];
  returnType: PirType;
  effects: EffectSpec[];
  cost?: number;
}

export interface BranchSeed {
  id: string;
  condition: PirExpression;
  cost?: number;
}

export interface EnvironmentSymbolCandidate {
  id: ProgramRef;
  type: PirType;
  effects?: EffectSpec[];
  cost?: number;
  capabilities?: string[];
}

export interface ProgramEnvironment {
  literals: LiteralCandidate[];
  callables: CallableCandidate[];
  branchSeeds: BranchSeed[];
  symbols?: EnvironmentSymbolCandidate[];
  backend?: string;
  capabilities?: string[];
  libraries?: string[];
  allowedEffects?: PirEffectKind[];
  forbiddenEffects?: PirEffectKind[];
  semanticFacts?: SemanticId[];
  maxCandidateCost?: number;
}

export type ProgramSpecification =
  | {
      kind: "requirements";
      requirements: string[];
    }
  | {
      kind: "examples";
      examples: Array<{
        id: string;
        input: JsonValue;
        expected: JsonValue;
      }>;
    }
  | {
      kind: "type-contract";
      parameters: PirType[];
      returns: PirType;
    }
  | {
      kind: "effect-contract";
      allowed: PirEffectKind[];
      forbidden: PirEffectKind[];
    }
  | {
      kind: "semantic-contract";
      requiredFacts: SemanticId[];
      forbiddenFacts: SemanticId[];
    }
  | {
      kind: "composite";
      parts: ProgramSpecification[];
    };

export type SynthesisGrammarProfileName = "G0" | "G1" | "G2" | "G3";

export interface SynthesisProblem {
  id: string;
  program: PirProgram;
  environment: ProgramEnvironment;
  /**
   * Compatibility list retained from the M11 bootstrap. New callers SHOULD
   * prefer specification so requirements can coexist with examples/types/
   * effects without flattening them into prose.
   */
  requirements: string[];
  specification?: ProgramSpecification;
  grammarProfile?: SynthesisGrammarProfileName;
}

export interface ExpansionStep {
  index: number;
  stateId: SynthesisStateId;
  holeId: HoleId;
  candidateId: CandidateId;
  generatorId: string;
  resultingStateId: SynthesisStateId;
  accumulatedCost: number;
}

export interface SynthesisState {
  id: SynthesisStateId;
  program: PirProgram;
  openHoles: HoleId[];
  obligations: SynthesisProofObligation[];
  accumulatedCost: number;
  /**
   * Soft ordering bias only. This is deliberately excluded from the
   * state hash and never weakens hard type/effect/scope constraints.
   */
  priorityBias?: number;
  depth: number;
  history: ExpansionStep[];
  verifierFacts: string[];
}

export interface SearchBudget {
  maxStates: number;
  maxDepth: number;
  maxJevCalls: number;
  maxCompilerRuns: number;
  maxTestRuns: number;
  deadlineMs: number;
  maxMemoryBytes?: number;
}

export interface SearchUsage {
  exploredStates: number;
  generatedCandidates: number;
  prunedCandidates: number;
  deduplicatedStates: number;
  jevCalls: number;
  compilerRuns: number;
  testRuns: number;
}

export interface SynthesisTraceEvent {
  sequence: number;
  kind:
    | "state-selected"
    | "candidate-generated"
    | "candidate-pruned"
    | "jev-ranked"
    | "state-enqueued"
    | "state-deduplicated"
    | "solution"
    | "budget-exhausted"
    | "failure";
  stateId?: SynthesisStateId;
  holeId?: HoleId;
  candidateId?: CandidateId;
  details?: JsonValue;
}

export interface SynthesisSuccess {
  status: "success";
  program: PirProgram;
  state: SynthesisState;
  verificationEvidence: string[];
  usage: SearchUsage;
  trace: SynthesisTraceEvent[];
}

export interface SynthesisFailure {
  status: "failure";
  kind:
    | "budget"
    | "unsatisfied-constraints"
    | "no-candidates"
    | "verification-failed"
    | "unknown";
  bestPartialProgram?: PirProgram;
  unresolvedHoles: HoleId[];
  unsatisfiedObligations: SynthesisProofObligation[];
  exploredStates: number;
  diagnostics: Array<{ code: string; message: string }>;
  trace: SynthesisTraceEvent[];
  usage: SearchUsage;
}

export type SynthesisResult = SynthesisSuccess | SynthesisFailure;

export interface CandidateGenerationContext {
  problem: SynthesisProblem;
  state: SynthesisState;
  functionId: string;
  hole: ProgramHole;
  expectedType: PirType;
  location: "expression" | "statement";
  scopeSymbols: ProgramRef[];
}

export interface CandidateGenerator {
  readonly id: string;
  supports(context: CandidateGenerationContext): boolean;
  generate(context: CandidateGenerationContext): ExpansionCandidate[];
}

export interface CandidateRankingRequest {
  problemId: string;
  holeId: HoleId;
  requirements: string[];
  candidates: ExpansionCandidate[];
}

export interface ProgramAcceptanceResult {
  accepted: boolean;
  evidence: string[];
  diagnostics: Array<{ code: string; message: string }>;
}

export interface ProgramAcceptanceVerifier {
  readonly id: string;
  readonly costKind?: "deterministic" | "compiler" | "test";
  verify(input: {
    problem: SynthesisProblem;
    program: PirProgram;
  }): ProgramAcceptanceResult | Promise<ProgramAcceptanceResult>;
}

export interface CandidateRanker {
  readonly id: string;
  rank(request: CandidateRankingRequest): Promise<CandidateId[]>;
}

export interface SearchFrontier {
  readonly kind: string;
  get size(): number;
  push(state: SynthesisState): void;
  pop(): SynthesisState | undefined;
  snapshot(): SynthesisState[];
}
