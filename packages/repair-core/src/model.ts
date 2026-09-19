import type { JsonValue } from "../../core-types/src/index.ts";
import type {
  NormalizedCompilerDiagnostic,
  SourceDocument,
  SourcePatch,
} from "../../code-backend-core/src/backend.ts";
import type {
  PirGraphOperation,
  PirProgram,
  ProgramRef,
  SourceBinding,
} from "../../program-ir/src/index.ts";

export type RepairDiagnosticKind =
  | "syntax"
  | "type"
  | "missing-symbol"
  | "import"
  | "argument"
  | "return"
  | "nullability"
  | "test-failure"
  | "runtime"
  | "unknown";

export interface RepairDiagnostic {
  id: string;
  kind: RepairDiagnosticKind;
  backendId: string;
  compiler: NormalizedCompilerDiagnostic;
  implicated: ImplicatedProgramNode[];
  metadata?: Record<string, JsonValue>;
}

export interface ImplicatedProgramNode {
  refId: ProgramRef;
  nodeKind: "module" | "function" | "parameter" | "symbol" | "hole";
  binding: SourceBinding;
  relation: "overlap" | "nearest";
  distance: number;
}

export type RepairCandidateKind =
  | "add-guard"
  | "import-symbol"
  | "argument"
  | "return-type"
  | "plugin";

export interface RepairCandidate {
  id: string;
  kind: RepairCandidateKind;
  diagnosticIds: string[];
  pirOperations: PirGraphOperation[];
  sourcePatches: SourcePatch[];
  expectedRemovedCodes: string[];
  cost: number;
  rationale: string;
  evidenceRefs: string[];
  metadata?: Record<string, JsonValue>;
}

export interface RepairKnowledgeBase {
  symbolImports: Record<
    string,
    Array<{
      module: string;
      imported: string;
      alias?: string;
      cost?: number;
    }>
  >;
  argumentDefaults: Record<
    string,
    Array<{
      source: string;
      cost?: number;
    }>
  >;
  returnReplacements: Record<
    string,
    Array<{
      source: string;
      cost?: number;
    }>
  >;
  nullGuards: Record<
    string,
    Array<{
      source: string;
      cost?: number;
    }>
  >;
}

export interface RepairGenerationContext {
  source: SourceDocument;
  program?: PirProgram;
  diagnostics: RepairDiagnostic[];
  knowledge: RepairKnowledgeBase;
}

export interface RepairGenerator {
  readonly id: string;
  supports(context: RepairGenerationContext): boolean;
  generate(context: RepairGenerationContext): RepairCandidate[];
}

export interface NormalizedCompileResult {
  ok: boolean;
  backendId: string;
  diagnostics: RepairDiagnostic[];
  evidence: string[];
}

export interface NormalizedTestCaseResult {
  id: string;
  status: "pass" | "fail" | "skipped";
  message?: string;
  evidence?: string[];
}

export interface NormalizedTestResult {
  ok: boolean;
  runner: string;
  cases: NormalizedTestCaseResult[];
  diagnostics: RepairDiagnostic[];
  evidence: string[];
}

export interface RepairTestRunner {
  readonly id: string;
  run(input: {
    source: SourceDocument;
    program?: PirProgram;
  }): Promise<NormalizedTestResult> | NormalizedTestResult;
}

export interface RepairCompiler {
  readonly id: string;
  compile(input: {
    source: SourceDocument;
    program?: PirProgram;
  }): NormalizedCompileResult;
}

export interface RepairCandidateRanker {
  readonly id: string;
  rank(input: {
    diagnostics: RepairDiagnostic[];
    candidates: RepairCandidate[];
  }): Promise<string[]> | string[];
}

export interface RepairBudget {
  maxIterations: number;
  maxCandidatesPerIteration: number;
  maxCompileRuns: number;
  maxTestRuns: number;
  deadlineMs: number;
}

export interface RepairUsage {
  iterations: number;
  candidatesGenerated: number;
  candidatesTried: number;
  compileRuns: number;
  testRuns: number;
  rollbacks: number;
}

export interface RepairTraceEvent {
  sequence: number;
  kind:
    | "diagnostic"
    | "candidate-generated"
    | "candidate-selected"
    | "candidate-applied"
    | "compile-pass"
    | "compile-fail"
    | "test-pass"
    | "test-fail"
    | "rollback"
    | "verified"
    | "budget-exhausted"
    | "failure";
  candidateId?: string;
  diagnosticId?: string;
  details?: JsonValue;
}

export interface RepairSuccess {
  status: "success";
  source: SourceDocument;
  program?: PirProgram;
  candidateHistory: RepairCandidate[];
  compile: NormalizedCompileResult;
  tests: NormalizedTestResult;
  regression: NormalizedTestResult;
  usage: RepairUsage;
  trace: RepairTraceEvent[];
}

export interface RepairFailure {
  status: "failure";
  kind:
    | "budget"
    | "no-candidates"
    | "compile-failed"
    | "tests-failed"
    | "regression-failed"
    | "invalid-repair"
    | "unknown";
  source: SourceDocument;
  program?: PirProgram;
  diagnostics: RepairDiagnostic[];
  candidateHistory: RepairCandidate[];
  usage: RepairUsage;
  trace: RepairTraceEvent[];
}

export type RepairResult = RepairSuccess | RepairFailure;
