import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type { LogicIr } from "./index.ts";

export type SolverStatus = "SAT" | "UNSAT" | "UNKNOWN" | "TIMEOUT";

export interface SolverTheoryRequirement {
  id: string;
  description: string;
  mandatory: boolean;
}

export interface SolverRequest {
  id: string;
  constraints: LogicIr[];
  theoryIds: string[];
  timeoutMs: number;
  maxVariables: number;
  maxAssignments: number;
  assumptions?: string[];
}

export interface BoundedVerificationMetadata {
  maxVariables: number;
  maxAssignments: number;
  exploredAssignments: number;
  completeWithinBound: boolean;
}

export interface SolverProofEvidence {
  schemaVersion: "jl-solver-proof-1";
  solverId: string;
  requestId: string;
  status: SolverStatus;
  theoryIds: string[];
  assumptions: string[];
  bounded: BoundedVerificationMetadata;
  model?: Record<string, boolean>;
  diagnostics: string[];
}

export interface SolverResult {
  status: SolverStatus;
  evidence: SolverProofEvidence;
}

export interface ConstraintSolver {
  readonly id: string;
  readonly theoryIds: readonly string[];
  solve(request: SolverRequest, signal?: AbortSignal): Promise<Result<SolverResult>>;
}

export type ProofStatus =
  | "UNPROVED"
  | "PROVED"
  | "DISPROVED"
  | "UNKNOWN"
  | "TIMEOUT";

const PROOF_STATUS_ORDER: Record<ProofStatus, number> = {
  UNPROVED: 0,
  UNKNOWN: 1,
  TIMEOUT: 1,
  DISPROVED: 2,
  PROVED: 2,
};

export const joinProofStatus = (
  left: ProofStatus,
  right: ProofStatus,
): ProofStatus => {
  if (left === right) return left;
  if (
    (left === "PROVED" && right === "DISPROVED") ||
    (left === "DISPROVED" && right === "PROVED")
  ) {
    return "UNKNOWN";
  }
  return PROOF_STATUS_ORDER[left] >= PROOF_STATUS_ORDER[right] ? left : right;
};

export interface ProofObligation {
  id: string;
  description: string;
  formula: LogicIr;
  requiredTheoryIds: string[];
  assumptions: string[];
  bounded?: {
    maxVariables: number;
    maxAssignments: number;
  };
}

export class ProofObligationRegistry {
  readonly #items = new Map<string, ProofObligation>();

  register(obligation: ProofObligation): Result<void> {
    if (
      obligation.id.trim() === "" ||
      obligation.description.trim() === "" ||
      new Set(obligation.requiredTheoryIds).size !==
        obligation.requiredTheoryIds.length ||
      obligation.requiredTheoryIds.some((id) => id.trim() === "") ||
      new Set(obligation.assumptions).size !== obligation.assumptions.length
    ) {
      return err(
        new StructuredError(
          "FORMAL_PROOF_OBLIGATION",
          "Proof obligations require stable ids/descriptions and duplicate-free theories/assumptions.",
        ),
      );
    }
    if (this.#items.has(obligation.id)) {
      return err(
        new StructuredError(
          "FORMAL_PROOF_OBLIGATION_DUPLICATE",
          `Proof obligation already exists: ${obligation.id}.`,
        ),
      );
    }
    this.#items.set(obligation.id, structuredClone(obligation));
    return ok(undefined);
  }

  get(id: string): ProofObligation | undefined {
    const value = this.#items.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  list(): ProofObligation[] {
    return [...this.#items.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => structuredClone(item));
  }
}

export class TheoryRequirementRegistry {
  readonly #items = new Map<string, SolverTheoryRequirement>();

  register(requirement: SolverTheoryRequirement): Result<void> {
    if (
      requirement.id.trim() === "" ||
      requirement.description.trim() === "" ||
      this.#items.has(requirement.id)
    ) {
      return err(
        new StructuredError(
          "FORMAL_SOLVER_THEORY",
          "Solver theory requirements need unique non-empty ids and descriptions.",
        ),
      );
    }
    this.#items.set(requirement.id, structuredClone(requirement));
    return ok(undefined);
  }

  resolve(ids: readonly string[]): Result<SolverTheoryRequirement[]> {
    const output: SolverTheoryRequirement[] = [];
    for (const id of [...new Set(ids)].sort()) {
      const requirement = this.#items.get(id);
      if (requirement === undefined) {
        return err(
          new StructuredError(
            "FORMAL_SOLVER_THEORY_UNKNOWN",
            `Unknown solver theory requirement: ${id}.`,
          ),
        );
      }
      output.push(structuredClone(requirement));
    }
    return ok(output);
  }
}

export interface SymbolicExecutionRequest<TState = JsonValue> {
  id: string;
  initialState: TState;
  maxSteps: number;
}

export interface SymbolicExecutionResult<TState = JsonValue> {
  terminalStates: TState[];
  pathConditions: LogicIr[];
  exploredSteps: number;
  complete: boolean;
}

export interface SymbolicExecutionAdapter<TState = JsonValue> {
  readonly id: string;
  execute(
    request: SymbolicExecutionRequest<TState>,
  ): Result<SymbolicExecutionResult<TState>>;
}

export interface TerminationAnalysisRequest {
  id: string;
  measureDescription?: string;
  boundedIterations?: number;
}

export interface TerminationAnalysisResult {
  status: "PROVED" | "DISPROVED" | "UNKNOWN";
  rationale: string;
  evidenceRefs: string[];
}

export interface TerminationAnalysisHook {
  readonly id: string;
  analyze(request: TerminationAnalysisRequest): Result<TerminationAnalysisResult>;
}

type BooleanAssignment = Record<string, boolean>;

const collectPropositionRefs = (
  logic: LogicIr,
  output = new Set<string>(),
): Result<Set<string>> => {
  switch (logic.kind) {
    case "proposition-ref":
      output.add(String(logic.ref));
      return ok(output);
    case "boolean":
      return ok(output);
    case "not":
      return collectPropositionRefs(logic.value, output);
    case "and":
    case "or":
      for (const value of logic.values) {
        const result = collectPropositionRefs(value, output);
        if (!result.ok) return result;
      }
      return ok(output);
    case "implies": {
      const left = collectPropositionRefs(logic.antecedent, output);
      if (!left.ok) return left;
      return collectPropositionRefs(logic.consequent, output);
    }
    case "iff": {
      const left = collectPropositionRefs(logic.left, output);
      if (!left.ok) return left;
      return collectPropositionRefs(logic.right, output);
    }
    default:
      return err(
        new StructuredError(
          "FORMAL_SOLVER_UNSUPPORTED_FRAGMENT",
          `Bounded Boolean solver does not support LogicIr kind ${logic.kind}.`,
        ),
      );
  }
};

const evaluateBooleanLogic = (
  logic: LogicIr,
  assignment: BooleanAssignment,
): Result<boolean> => {
  switch (logic.kind) {
    case "boolean":
      return ok(logic.value);
    case "proposition-ref": {
      const value = assignment[String(logic.ref)];
      return value === undefined
        ? err(
            new StructuredError(
              "FORMAL_SOLVER_ASSIGNMENT",
              "Missing Boolean assignment for proposition reference.",
            ),
          )
        : ok(value);
    }
    case "not": {
      const value = evaluateBooleanLogic(logic.value, assignment);
      return value.ok ? ok(!value.value) : value;
    }
    case "and": {
      for (const item of logic.values) {
        const value = evaluateBooleanLogic(item, assignment);
        if (!value.ok) return value;
        if (!value.value) return ok(false);
      }
      return ok(true);
    }
    case "or": {
      for (const item of logic.values) {
        const value = evaluateBooleanLogic(item, assignment);
        if (!value.ok) return value;
        if (value.value) return ok(true);
      }
      return ok(false);
    }
    case "implies": {
      const left = evaluateBooleanLogic(logic.antecedent, assignment);
      if (!left.ok) return left;
      const right = evaluateBooleanLogic(logic.consequent, assignment);
      return right.ok ? ok(!left.value || right.value) : right;
    }
    case "iff": {
      const left = evaluateBooleanLogic(logic.left, assignment);
      if (!left.ok) return left;
      const right = evaluateBooleanLogic(logic.right, assignment);
      return right.ok ? ok(left.value === right.value) : right;
    }
    default:
      return err(
        new StructuredError(
          "FORMAL_SOLVER_UNSUPPORTED_FRAGMENT",
          `Unsupported Boolean LogicIr kind ${logic.kind}.`,
        ),
      );
  }
};

const evidence = (
  solverId: string,
  request: SolverRequest,
  status: SolverStatus,
  bounded: BoundedVerificationMetadata,
  diagnostics: string[],
  model?: BooleanAssignment,
): SolverProofEvidence => ({
  schemaVersion: "jl-solver-proof-1",
  solverId,
  requestId: request.id,
  status,
  theoryIds: [...request.theoryIds].sort(),
  assumptions: [...(request.assumptions ?? [])],
  bounded,
  ...(model === undefined ? {} : { model: structuredClone(model) }),
  diagnostics: [...diagnostics],
});

export class BoundedBooleanSolver implements ConstraintSolver {
  readonly id = "solver.boolean-exhaustive.v1";
  readonly theoryIds = ["logic.propositional.boolean.v1"] as const;

  async solve(
    request: SolverRequest,
    signal?: AbortSignal,
  ): Promise<Result<SolverResult>> {
    if (
      request.id.trim() === "" ||
      !Number.isSafeInteger(request.maxVariables) ||
      request.maxVariables < 0 ||
      !Number.isSafeInteger(request.maxAssignments) ||
      request.maxAssignments < 0 ||
      !Number.isFinite(request.timeoutMs) ||
      request.timeoutMs < 0
    ) {
      return err(
        new StructuredError(
          "FORMAL_SOLVER_REQUEST",
          "Solver request requires stable id and non-negative finite bounds.",
        ),
      );
    }

    const unsupportedTheory = request.theoryIds.find(
      (id) => !this.theoryIds.includes(id as (typeof this.theoryIds)[number]),
    );
    if (unsupportedTheory !== undefined) {
      const bounded = {
        maxVariables: request.maxVariables,
        maxAssignments: request.maxAssignments,
        exploredAssignments: 0,
        completeWithinBound: false,
      };
      return ok({
        status: "UNKNOWN",
        evidence: evidence(
          this.id,
          request,
          "UNKNOWN",
          bounded,
          [`UNSUPPORTED_THEORY:${unsupportedTheory}`],
        ),
      });
    }

    if (request.timeoutMs === 0 || signal?.aborted === true) {
      const bounded = {
        maxVariables: request.maxVariables,
        maxAssignments: request.maxAssignments,
        exploredAssignments: 0,
        completeWithinBound: false,
      };
      return ok({
        status: "TIMEOUT",
        evidence: evidence(
          this.id,
          request,
          "TIMEOUT",
          bounded,
          [signal?.aborted === true ? "ABORTED" : "ZERO_TIMEOUT"],
        ),
      });
    }

    const variables = new Set<string>();
    for (const constraint of request.constraints) {
      const refs = collectPropositionRefs(constraint, variables);
      if (!refs.ok) {
        const bounded = {
          maxVariables: request.maxVariables,
          maxAssignments: request.maxAssignments,
          exploredAssignments: 0,
          completeWithinBound: false,
        };
        return ok({
          status: "UNKNOWN",
          evidence: evidence(
            this.id,
            request,
            "UNKNOWN",
            bounded,
            [refs.error.code],
          ),
        });
      }
    }

    const names = [...variables].sort();
    if (names.length > request.maxVariables || names.length >= 31) {
      const bounded = {
        maxVariables: request.maxVariables,
        maxAssignments: request.maxAssignments,
        exploredAssignments: 0,
        completeWithinBound: false,
      };
      return ok({
        status: "UNKNOWN",
        evidence: evidence(
          this.id,
          request,
          "UNKNOWN",
          bounded,
          ["VARIABLE_BOUND_EXCEEDED"],
        ),
      });
    }

    const totalAssignments = 2 ** names.length;
    const assignmentBudget = Math.min(
      totalAssignments,
      request.maxAssignments,
    );
    const startedAt = Date.now();

    for (let index = 0; index < assignmentBudget; index += 1) {
      if (
        signal?.aborted === true ||
        Date.now() - startedAt >= request.timeoutMs
      ) {
        const bounded = {
          maxVariables: request.maxVariables,
          maxAssignments: request.maxAssignments,
          exploredAssignments: index,
          completeWithinBound: false,
        };
        return ok({
          status: "TIMEOUT",
          evidence: evidence(
            this.id,
            request,
            "TIMEOUT",
            bounded,
            [signal?.aborted === true ? "ABORTED" : "TIME_BUDGET_EXCEEDED"],
          ),
        });
      }

      const assignment: BooleanAssignment = {};
      for (let bit = 0; bit < names.length; bit += 1) {
        assignment[names[bit]!] = (index & (1 << bit)) !== 0;
      }

      let satisfied = true;
      for (const constraint of request.constraints) {
        const value = evaluateBooleanLogic(constraint, assignment);
        if (!value.ok) {
          return err(value.error);
        }
        if (!value.value) {
          satisfied = false;
          break;
        }
      }

      if (satisfied) {
        const bounded = {
          maxVariables: request.maxVariables,
          maxAssignments: request.maxAssignments,
          exploredAssignments: index + 1,
          completeWithinBound: totalAssignments <= request.maxAssignments,
        };
        return ok({
          status: "SAT",
          evidence: evidence(
            this.id,
            request,
            "SAT",
            bounded,
            ["SAT_MODEL_FOUND"],
            assignment,
          ),
        });
      }
    }

    const complete = assignmentBudget === totalAssignments;
    const bounded = {
      maxVariables: request.maxVariables,
      maxAssignments: request.maxAssignments,
      exploredAssignments: assignmentBudget,
      completeWithinBound: complete,
    };
    return ok({
      status: complete ? "UNSAT" : "UNKNOWN",
      evidence: evidence(
        this.id,
        request,
        complete ? "UNSAT" : "UNKNOWN",
        bounded,
        [complete ? "EXHAUSTIVE_UNSAT" : "ASSIGNMENT_BOUND_EXHAUSTED"],
      ),
    });
  }
}

export class ScriptedConstraintSolver implements ConstraintSolver {
  readonly id = "solver.scripted.mock.v1";
  readonly theoryIds = ["mock"] as const;

  constructor(readonly scripted: SolverStatus[]) {}

  async solve(request: SolverRequest): Promise<Result<SolverResult>> {
    const status = this.scripted.shift() ?? "UNKNOWN";
    const bounded = {
      maxVariables: request.maxVariables,
      maxAssignments: request.maxAssignments,
      exploredAssignments: 0,
      completeWithinBound: false,
    };
    return ok({
      status,
      evidence: evidence(
        this.id,
        request,
        status,
        bounded,
        ["SCRIPTED_RESULT"],
      ),
    });
  }
}
