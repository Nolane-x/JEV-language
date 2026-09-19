import {
  applySourcePatches,
  type ProgrammingBackend,
  type SourceDocument,
} from "../../code-backend-core/src/index.ts";
import {
  InMemoryPirGraph,
  type PirProgram,
} from "../../program-ir/src/index.ts";
import {
  generateRepairCandidates,
} from "./generators.ts";
import {
  normalizeRepairDiagnostics,
} from "./diagnostics.ts";
import type {
  NormalizedCompileResult,
  NormalizedTestResult,
  RepairBudget,
  RepairCandidate,
  RepairCandidateRanker,
  RepairCompiler,
  RepairGenerationContext,
  RepairKnowledgeBase,
  RepairResult,
  RepairTestRunner,
  RepairTraceEvent,
  RepairUsage,
} from "./model.ts";

const validateBudget = (budget: RepairBudget): void => {
  for (const [name, value] of [
    ["maxIterations", budget.maxIterations],
    ["maxCandidatesPerIteration", budget.maxCandidatesPerIteration],
    ["maxCompileRuns", budget.maxCompileRuns],
    ["maxTestRuns", budget.maxTestRuns],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer.`);
    }
  }
  if (!Number.isFinite(budget.deadlineMs) || budget.deadlineMs < 0) {
    throw new Error("deadlineMs must be non-negative and finite.");
  }
};

const emptyUsage = (): RepairUsage => ({
  iterations: 0,
  candidatesGenerated: 0,
  candidatesTried: 0,
  compileRuns: 0,
  testRuns: 0,
  rollbacks: 0,
});

const failedCaseCount = (
  result: NormalizedTestResult | undefined,
): number =>
  result?.cases.filter((entry) => entry.status === "fail").length ?? 0;

const diagnosticScore = (
  compile: NormalizedCompileResult,
  tests: NormalizedTestResult | undefined,
): number =>
  compile.diagnostics.length * 100 + failedCaseCount(tests);

const applyCandidate = (input: {
  source: SourceDocument;
  program?: PirProgram;
  candidate: RepairCandidate;
}):
  | {
      ok: true;
      source: SourceDocument;
      program?: PirProgram;
    }
  | {
      ok: false;
      code: string;
      message: string;
    } => {
  const patched = applySourcePatches(
    input.source,
    input.candidate.sourcePatches,
  );
  if (!patched.ok) {
    return {
      ok: false,
      code: patched.error.code,
      message: patched.error.message,
    };
  }

  if (
    input.candidate.pirOperations.length === 0 ||
    input.program === undefined
  ) {
    return {
      ok: true,
      source: patched.value,
      ...(input.program === undefined
        ? {}
        : { program: structuredClone(input.program) }),
    };
  }

  const graph = new InMemoryPirGraph(input.program);
  const transaction = graph.beginTransaction(
    input.candidate.pirOperations,
  );
  const committed = graph.commit(transaction);
  if (!committed.ok) {
    return {
      ok: false,
      code: committed.error.code,
      message: committed.error.message,
    };
  }

  return {
    ok: true,
    source: patched.value,
    program: committed.value.program,
  };
};

export class BackendRepairCompiler<Ast>
  implements RepairCompiler
{
  readonly id: string;

  constructor(
    readonly backend: ProgrammingBackend<Ast>,
  ) {
    this.id = `repair-compiler:${backend.manifest.id}`;
  }

  compile(input: {
    source: SourceDocument;
    program?: PirProgram;
  }): NormalizedCompileResult {
    const checked = this.backend.typecheck(input.source);
    return {
      ok: checked.ok,
      backendId: this.backend.manifest.id,
      diagnostics: normalizeRepairDiagnostics({
        backendId: this.backend.manifest.id,
        source: input.source,
        diagnostics: checked.diagnostics,
        ...(input.program === undefined
          ? {}
          : { program: input.program }),
      }),
      evidence: checked.ok
        ? [`compile:${this.backend.manifest.id}:pass`]
        : [`compile:${this.backend.manifest.id}:fail`],
    };
  }
}

export interface RepairLoopOptions {
  compiler: RepairCompiler;
  tests: RepairTestRunner;
  regression: RepairTestRunner;
  knowledge: RepairKnowledgeBase;
  budget: RepairBudget;
  ranker?: RepairCandidateRanker;
}

const budgetExpired = (
  started: number,
  budget: RepairBudget,
): boolean => Date.now() - started >= budget.deadlineMs;

const failure = (
  kind: Extract<RepairResult, { status: "failure" }>["kind"],
  source: SourceDocument,
  program: PirProgram | undefined,
  diagnostics: Extract<RepairResult, { status: "failure" }>["diagnostics"],
  history: RepairCandidate[],
  usage: RepairUsage,
  trace: RepairTraceEvent[],
): Extract<RepairResult, { status: "failure" }> => ({
  status: "failure",
  kind,
  source: structuredClone(source),
  ...(program === undefined
    ? {}
    : { program: structuredClone(program) }),
  diagnostics: structuredClone(diagnostics),
  candidateHistory: structuredClone(history),
  usage: structuredClone(usage),
  trace: structuredClone(trace),
});

export const repairProgram = async (input: {
  source: SourceDocument;
  program?: PirProgram;
  options: RepairLoopOptions;
}): Promise<RepairResult> => {
  validateBudget(input.options.budget);

  let source = structuredClone(input.source);
  let program =
    input.program === undefined
      ? undefined
      : structuredClone(input.program);
  const usage = emptyUsage();
  const trace: RepairTraceEvent[] = [];
  const history: RepairCandidate[] = [];
  const started = Date.now();

  const compile = (): NormalizedCompileResult | undefined => {
    if (
      usage.compileRuns >= input.options.budget.maxCompileRuns ||
      budgetExpired(started, input.options.budget)
    ) {
      return undefined;
    }
    usage.compileRuns += 1;
    return input.options.compiler.compile({
      source,
      ...(program === undefined ? {} : { program }),
    });
  };

  const runTests = (
    runner: RepairTestRunner,
  ): Promise<NormalizedTestResult | undefined> | NormalizedTestResult | undefined => {
    if (
      usage.testRuns >= input.options.budget.maxTestRuns ||
      budgetExpired(started, input.options.budget)
    ) {
      return undefined;
    }
    usage.testRuns += 1;
    return runner.run({
      source,
      ...(program === undefined ? {} : { program }),
    });
  };

  let compileResult = compile();
  if (compileResult === undefined) {
    return failure(
      "budget",
      source,
      program,
      [],
      history,
      usage,
      trace,
    );
  }

  let testsResult: NormalizedTestResult | undefined;
  if (compileResult.ok) {
    testsResult = await runTests(input.options.tests);
    if (testsResult === undefined) {
      return failure(
        "budget",
        source,
        program,
        compileResult.diagnostics,
        history,
        usage,
        trace,
      );
    }
  }

  for (
    let iteration = 0;
    iteration < input.options.budget.maxIterations;
    iteration += 1
  ) {
    usage.iterations += 1;

    if (
      compileResult.ok &&
      testsResult?.ok === true
    ) {
      const regression = await runTests(input.options.regression);
      if (regression === undefined) {
        return failure(
          "budget",
          source,
          program,
          [],
          history,
          usage,
          trace,
        );
      }
      if (regression.ok) {
        trace.push({
          sequence: trace.length,
          kind: "verified",
          details: {
            iteration,
            compileRuns: usage.compileRuns,
            testRuns: usage.testRuns,
          },
        });
        return {
          status: "success",
          source: structuredClone(source),
          ...(program === undefined
            ? {}
            : { program: structuredClone(program) }),
          candidateHistory: structuredClone(history),
          compile: structuredClone(compileResult),
          tests: structuredClone(testsResult),
          regression: structuredClone(regression),
          usage: structuredClone(usage),
          trace: structuredClone(trace),
        };
      }
      trace.push({
        sequence: trace.length,
        kind: "test-fail",
        details: {
          stage: "regression",
          failed: failedCaseCount(regression),
        },
      });
      return failure(
        "regression-failed",
        source,
        program,
        regression.diagnostics,
        history,
        usage,
        trace,
      );
    }

    if (budgetExpired(started, input.options.budget)) {
      trace.push({
        sequence: trace.length,
        kind: "budget-exhausted",
        details: { stage: "deadline" },
      });
      return failure(
        "budget",
        source,
        program,
        compileResult.diagnostics,
        history,
        usage,
        trace,
      );
    }

    const diagnostics = compileResult.ok
      ? testsResult?.diagnostics ?? []
      : compileResult.diagnostics;

    for (const diagnostic of diagnostics) {
      trace.push({
        sequence: trace.length,
        kind: "diagnostic",
        diagnosticId: diagnostic.id,
        details: {
          kind: diagnostic.kind,
          code: diagnostic.compiler.code,
        },
      });
    }

    const context: RepairGenerationContext = {
      source,
      ...(program === undefined ? {} : { program }),
      diagnostics,
      knowledge: input.options.knowledge,
    };
    const generated = generateRepairCandidates(context).slice(
      0,
      input.options.budget.maxCandidatesPerIteration,
    );
    usage.candidatesGenerated += generated.length;

    for (const candidate of generated) {
      trace.push({
        sequence: trace.length,
        kind: "candidate-generated",
        candidateId: candidate.id,
        details: {
          kind: candidate.kind,
          cost: candidate.cost,
        },
      });
    }

    if (generated.length === 0) {
      return failure(
        "no-candidates",
        source,
        program,
        diagnostics,
        history,
        usage,
        trace,
      );
    }

    let ordered = [...generated];
    if (input.options.ranker !== undefined && generated.length > 1) {
      try {
        const order = await input.options.ranker.rank({
          diagnostics,
          candidates: structuredClone(generated),
        });
        const byId = new Map(
          generated.map((candidate) => [candidate.id, candidate]),
        );
        ordered = [
          ...order
            .map((id) => byId.get(id))
            .filter(
              (candidate): candidate is RepairCandidate =>
                candidate !== undefined,
            ),
          ...generated.filter(
            (candidate) => !order.includes(candidate.id),
          ),
        ];
      } catch {
        ordered = [...generated];
      }
    }

    const baselineScore = diagnosticScore(
      compileResult,
      testsResult,
    );
    let acceptedProgress = false;

    for (const candidate of ordered) {
      usage.candidatesTried += 1;
      trace.push({
        sequence: trace.length,
        kind: "candidate-selected",
        candidateId: candidate.id,
      });

      const applied = applyCandidate({
        source,
        ...(program === undefined ? {} : { program }),
        candidate,
      });
      if (!applied.ok) {
        usage.rollbacks += 1;
        trace.push({
          sequence: trace.length,
          kind: "rollback",
          candidateId: candidate.id,
          details: {
            code: applied.code,
            message: applied.message,
          },
        });
        continue;
      }

      const previousSource = source;
      const previousProgram = program;
      source = applied.source;
      program = applied.program;
      trace.push({
        sequence: trace.length,
        kind: "candidate-applied",
        candidateId: candidate.id,
      });

      const candidateCompile = compile();
      if (candidateCompile === undefined) {
        source = previousSource;
        program = previousProgram;
        usage.rollbacks += 1;
        return failure(
          "budget",
          source,
          program,
          diagnostics,
          history,
          usage,
          trace,
        );
      }

      if (!candidateCompile.ok) {
        const score = diagnosticScore(
          candidateCompile,
          undefined,
        );
        trace.push({
          sequence: trace.length,
          kind: "compile-fail",
          candidateId: candidate.id,
          details: {
            diagnostics: candidateCompile.diagnostics.length,
            score,
          },
        });
        if (score < baselineScore) {
          compileResult = candidateCompile;
          testsResult = undefined;
          history.push(candidate);
          acceptedProgress = true;
          break;
        }

        source = previousSource;
        program = previousProgram;
        usage.rollbacks += 1;
        trace.push({
          sequence: trace.length,
          kind: "rollback",
          candidateId: candidate.id,
          details: { stage: "compile-no-improvement" },
        });
        continue;
      }

      trace.push({
        sequence: trace.length,
        kind: "compile-pass",
        candidateId: candidate.id,
      });

      const candidateTests = await runTests(input.options.tests);
      if (candidateTests === undefined) {
        source = previousSource;
        program = previousProgram;
        usage.rollbacks += 1;
        return failure(
          "budget",
          source,
          program,
          diagnostics,
          history,
          usage,
          trace,
        );
      }

      if (!candidateTests.ok) {
        trace.push({
          sequence: trace.length,
          kind: "test-fail",
          candidateId: candidate.id,
          details: {
            failed: failedCaseCount(candidateTests),
          },
        });
        const score = diagnosticScore(
          candidateCompile,
          candidateTests,
        );
        if (score < baselineScore) {
          compileResult = candidateCompile;
          testsResult = candidateTests;
          history.push(candidate);
          acceptedProgress = true;
          break;
        }

        source = previousSource;
        program = previousProgram;
        usage.rollbacks += 1;
        trace.push({
          sequence: trace.length,
          kind: "rollback",
          candidateId: candidate.id,
          details: { stage: "tests-no-improvement" },
        });
        continue;
      }

      trace.push({
        sequence: trace.length,
        kind: "test-pass",
        candidateId: candidate.id,
      });

      const regression = await runTests(input.options.regression);
      if (regression === undefined) {
        source = previousSource;
        program = previousProgram;
        usage.rollbacks += 1;
        return failure(
          "budget",
          source,
          program,
          diagnostics,
          history,
          usage,
          trace,
        );
      }
      if (!regression.ok) {
        source = previousSource;
        program = previousProgram;
        usage.rollbacks += 1;
        trace.push({
          sequence: trace.length,
          kind: "rollback",
          candidateId: candidate.id,
          details: {
            stage: "regression",
            failed: failedCaseCount(regression),
          },
        });
        continue;
      }

      history.push(candidate);
      compileResult = candidateCompile;
      testsResult = candidateTests;
      trace.push({
        sequence: trace.length,
        kind: "verified",
        candidateId: candidate.id,
        details: {
          iteration,
          compileRuns: usage.compileRuns,
          testRuns: usage.testRuns,
        },
      });
      return {
        status: "success",
        source: structuredClone(source),
        ...(program === undefined
          ? {}
          : { program: structuredClone(program) }),
        candidateHistory: structuredClone(history),
        compile: structuredClone(candidateCompile),
        tests: structuredClone(candidateTests),
        regression: structuredClone(regression),
        usage: structuredClone(usage),
        trace: structuredClone(trace),
      };
    }

    if (!acceptedProgress) {
      return failure(
        compileResult.ok ? "tests-failed" : "compile-failed",
        source,
        program,
        diagnostics,
        history,
        usage,
        trace,
      );
    }
  }

  trace.push({
    sequence: trace.length,
    kind: "budget-exhausted",
    details: {
      stage: "iterations",
      maxIterations: input.options.budget.maxIterations,
    },
  });
  return failure(
    "budget",
    source,
    program,
    compileResult.diagnostics,
    history,
    usage,
    trace,
  );
};
