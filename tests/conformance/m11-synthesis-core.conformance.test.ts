import { describe, expect, it } from "vitest";
import { createTraceId } from "../../packages/core-types/src/index.ts";
import {
  DecisionRuntime,
  RecordedDecisionAdapter,
  type DecisionBatchResponse,
} from "../../packages/decision-runtime/src/index.ts";
import {
  samePirType,
  validatePirProgram,
  type PirExpression,
  type PirFunction,
  type PirProgram,
  type PirType,
  type ProgramHole,
} from "../../packages/program-ir/src/index.ts";
import {
  BeamFrontier,
  BestFirstFrontier,
  BranchGenerator,
  CandidateGeneratorRegistry,
  FunctionCallGenerator,
  InScopeSymbolGenerator,
  JevChoiceCandidateRanker,
  LiteralGenerator,
  coreCandidateGenerators,
  createCoreGeneratorRegistry,
  hardPruneCandidates,
  synthesizeProgram,
  type CandidateGenerationContext,
  type CandidateGenerator,
  type ExpansionCandidate,
  type SearchBudget,
  type SynthesisProblem,
} from "../../packages/synthesis-core/src/index.ts";

const numberType: PirType = { kind: "number" };
const booleanType: PirType = { kind: "boolean" };

const budget = (
  overrides: Partial<SearchBudget> = {},
): SearchBudget => ({
  maxStates: 64,
  maxDepth: 8,
  maxJevCalls: 0,
  maxCompilerRuns: 0,
  maxTestRuns: 0,
  deadlineMs: 10_000,
  ...overrides,
});

const expressionProgram = (input: {
  id: string;
  parameters?: PirFunction["parameters"];
  returnType: PirType;
  hole: ProgramHole;
  functions?: PirFunction[];
}): PirProgram => {
  const target: PirFunction = {
    kind: "function",
    id: `function:${input.id}`,
    name: input.id,
    parameters: input.parameters ?? [],
    returnType: input.returnType,
    body: {
      kind: "hole",
      id: input.hole.id,
      expected: input.returnType,
    },
    effects: [{ kind: "pure" }],
  };
  const functions = [...(input.functions ?? []), target];
  return {
    version: "1.0.0",
    modules: [
      {
        id: `module:${input.id}`,
        kind: "module",
        nameIntent: { preferredTerms: [input.id] },
        exports: [target.id],
        imports: [],
        declarations: functions.map((fn) => fn.id),
      },
    ],
    functions,
    holes: [input.hole],
  };
};

const hole = (input: {
  id: string;
  type: PirType;
  scope?: string[];
  effect?: ProgramHole["expectedEffect"];
}): ProgramHole => ({
  id: input.id,
  expectedType: input.type,
  ...(input.effect === undefined ? {} : { expectedEffect: input.effect }),
  requiredFacts: [],
  forbiddenFacts: [],
  scopeSymbols: [...(input.scope ?? [])],
  budget: {
    maxExpansions: 32,
    maxDepth: 8,
    maxCost: 32,
  },
});

const registry = (...generators: CandidateGenerator[]) =>
  createCoreGeneratorRegistry(generators);

describe("M11 synthesis core conformance", () => {
  it("synthesizes an unseen identity body from an in-scope typed symbol", async () => {
    const parameter = {
      id: "param:identity:value",
      name: "value",
      type: numberType,
    };
    const goalHole = hole({
      id: "hole:identity",
      type: numberType,
      scope: [parameter.id],
      effect: "pure",
    });
    const problem: SynthesisProblem = {
      id: "problem:identity-unseen",
      program: expressionProgram({
        id: "identity-unseen",
        parameters: [parameter],
        returnType: numberType,
        hole: goalHole,
      }),
      environment: { literals: [], callables: [], branchSeeds: [] },
      requirements: ["return the available numeric input"],
    };

    const result = await synthesizeProgram(problem, {
      registry: registry(new InScopeSymbolGenerator()),
      budget: budget(),
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.program.holes).toEqual([]);
    expect(result.program.functions.at(-1)?.body).toEqual({
      kind: "variable",
      symbolId: parameter.id,
    });
    expect(result.state.history).toHaveLength(1);
    expect(result.state.history[0]?.generatorId).toBe(
      "generator.in-scope-symbol.v1",
    );
    expect(validatePirProgram(result.program).ok).toBe(true);
  });

  it("uses recorded Jev Choice only to rank already-valid literal candidates", async () => {
    const goalHole = hole({
      id: "hole:boolean",
      type: booleanType,
      effect: "pure",
    });
    const problem: SynthesisProblem = {
      id: "problem:boolean-literal",
      program: expressionProgram({
        id: "boolean-literal",
        returnType: booleanType,
        hole: goalHole,
      }),
      environment: {
        literals: [
          { id: "false", value: false, type: booleanType, cost: 1 },
          { id: "true", value: true, type: booleanType, cost: 1 },
        ],
        callables: [],
        branchSeeds: [],
      },
      requirements: ["return true"],
    };

    const requestId =
      "synth-rank:problem:boolean-literal:hole:boolean";
    const recorded: DecisionBatchResponse = {
      requestId,
      answers: [
        {
          questionId: "rank_expansion",
          type: "choice",
          selected: "candidate:literal:true",
          probabilities: {
            "candidate:literal:false": 0.1,
            "candidate:literal:true": 0.9,
          },
          confidence: 0.9,
          model: "recorded:jev",
          latencyMs: 1,
        },
      ],
      model: "recorded:jev",
      usage: { inputTokens: 12, outputTokens: 1, requests: 1 },
      traceId: createTraceId(),
      source: "recorded",
    };
    const runtime = new DecisionRuntime({
      adapter: new RecordedDecisionAdapter([recorded]),
      budget: { maxRequests: 1 },
    });
    const ranker = new JevChoiceCandidateRanker({
      executor: runtime,
      modelProfile: "recorded:jev",
      minimumConfidence: 0.7,
    });

    const result = await synthesizeProgram(problem, {
      registry: registry(new LiteralGenerator()),
      budget: budget({ maxJevCalls: 1 }),
      ranker,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.program.functions[0]?.body).toEqual({
      kind: "literal",
      value: true,
      type: booleanType,
    });
    expect(result.usage.jevCalls).toBe(1);
    expect(runtime.requestsUsed).toBe(1);
    expect(
      result.trace.some((event) => event.kind === "jev-ranked"),
    ).toBe(true);
  });

  it("composes a function call and its argument through two typed expansions", async () => {
    const helper: PirFunction = {
      kind: "function",
      id: "function:double",
      name: "double",
      parameters: [
        { id: "param:double:value", name: "value", type: numberType },
      ],
      returnType: numberType,
      body: {
        kind: "binary",
        operator: "multiply",
        left: { kind: "variable", symbolId: "param:double:value" },
        right: { kind: "literal", value: 2, type: numberType },
      },
      effects: [{ kind: "pure" }],
    };
    const input = {
      id: "param:caller:value",
      name: "value",
      type: numberType,
    };
    const goalHole = hole({
      id: "hole:call",
      type: numberType,
      scope: [input.id],
      effect: "pure",
    });
    const problem: SynthesisProblem = {
      id: "problem:function-call-unseen",
      program: expressionProgram({
        id: "caller",
        parameters: [input],
        returnType: numberType,
        hole: goalHole,
        functions: [helper],
      }),
      environment: {
        literals: [],
        callables: [
          {
            id: helper.id,
            parameterTypes: [numberType],
            returnType: numberType,
            effects: [{ kind: "pure" }],
            cost: 1,
          },
        ],
        branchSeeds: [],
      },
      requirements: ["call the available pure number helper with the input"],
    };

    const result = await synthesizeProgram(problem, {
      registry: registry(
        new FunctionCallGenerator(),
        new InScopeSymbolGenerator(),
      ),
      budget: budget(),
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    const body = result.program.functions.find(
      (fn) => fn.id === "function:caller",
    )?.body;
    expect(body?.kind).toBe("call");
    if (body?.kind === "call") {
      expect(body.callee).toEqual({
        kind: "symbol-ref",
        symbolId: helper.id,
      });
      expect(body.arguments[0]).toEqual({
        kind: "variable",
        symbolId: input.id,
      });
    }
    expect(result.state.history.map((step) => step.generatorId)).toEqual([
      "generator.function-call.v1",
      "generator.in-scope-symbol.v1",
    ]);
  });

  it("composes a branch from a condition plus independently filled typed child holes", async () => {
    const condition = {
      id: "param:branch:condition",
      name: "condition",
      type: booleanType,
    };
    const goalHole = hole({
      id: "hole:branch-result",
      type: numberType,
      scope: [condition.id],
      effect: "pure",
    });
    const problem: SynthesisProblem = {
      id: "problem:branch-unseen",
      program: expressionProgram({
        id: "branch-unseen",
        parameters: [condition],
        returnType: numberType,
        hole: goalHole,
      }),
      environment: {
        literals: [
          { id: "one", value: 1, type: numberType, cost: 5 },
          { id: "two", value: 2, type: numberType, cost: 5 },
        ],
        callables: [],
        branchSeeds: [
          {
            id: "condition-input",
            condition: {
              kind: "variable",
              symbolId: condition.id,
            },
            cost: 0,
          },
        ],
      },
      requirements: ["return one numeric branch result for each condition"],
    };

    const result = await synthesizeProgram(problem, {
      registry: registry(new BranchGenerator(), new LiteralGenerator()),
      budget: budget(),
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    const body = result.program.functions[0]?.body;
    expect(body?.kind).toBe("conditional");
    if (body?.kind === "conditional") {
      expect(body.condition).toEqual({
        kind: "variable",
        symbolId: condition.id,
      });
      expect(body.whenTrue.kind).toBe("literal");
      expect(body.whenFalse.kind).toBe("literal");
    }
    expect(result.state.history.length).toBe(3);
    expect(result.state.history[0]?.generatorId).toBe("generator.branch.v1");
  });

  it("hard-prunes forbidden effects before ranking", () => {
    const goalHole = hole({
      id: "hole:pure-number",
      type: numberType,
      effect: "pure",
    });
    const problem: SynthesisProblem = {
      id: "problem:effect-prune",
      program: expressionProgram({
        id: "effect-prune",
        returnType: numberType,
        hole: goalHole,
      }),
      environment: {
        literals: [],
        callables: [
          {
            id: "function:network-number",
            parameterTypes: [],
            returnType: numberType,
            effects: [{ kind: "network" }],
          },
        ],
        branchSeeds: [],
      },
      requirements: ["remain pure"],
    };
    const initialProgram = problem.program;
    const fn = initialProgram.functions[0]!;
    const context: CandidateGenerationContext = {
      problem,
      state: {
        id: "state:test",
        program: initialProgram,
        openHoles: [goalHole.id],
        obligations: [],
        accumulatedCost: 0,
        depth: 0,
        history: [],
        verifierFacts: [],
      },
      functionId: fn.id,
      hole: goalHole,
      expectedType: numberType,
      scopeSymbols: [],
    };
    const candidates = new FunctionCallGenerator().generate(context);
    const pruned = hardPruneCandidates(context, candidates);

    expect(pruned.accepted).toEqual([]);
    expect(pruned.rejected[0]?.reasons).toContain(
      "FORBIDDEN_EFFECT:network",
    );
  });

  it("deduplicates equivalent states reached through different candidate ids", async () => {
    const goalHole = hole({
      id: "hole:dedup",
      type: numberType,
      effect: "pure",
    });
    const problem: SynthesisProblem = {
      id: "problem:dedup",
      program: expressionProgram({
        id: "dedup",
        returnType: numberType,
        hole: goalHole,
      }),
      environment: { literals: [], callables: [], branchSeeds: [] },
      requirements: ["return 7"],
    };

    const duplicateGenerator: CandidateGenerator = {
      id: "generator:duplicate-test",
      supports: () => true,
      generate: (): ExpansionCandidate[] =>
        ["a", "b"].map((suffix) => ({
          id: `candidate:duplicate:${suffix}`,
          replacement: {
            kind: "literal",
            value: 7,
            type: numberType,
          },
          newHoles: [],
          proofObligations: [],
          heuristicCost: 1,
          provenance: {
            kind: "plugin",
            generatorId: "generator:duplicate-test",
            evidenceRefs: [],
          },
          resultType: numberType,
          effects: [],
        })),
    };

    const result = await synthesizeProgram(problem, {
      registry: registry(duplicateGenerator),
      budget: budget(),
    });
    expect(result.status).toBe("success");
    expect(result.usage.deduplicatedStates).toBe(1);
  });

  it("returns a structured partial result when the search budget is exhausted", async () => {
    const goalHole = hole({
      id: "hole:budget",
      type: numberType,
      effect: "pure",
    });
    const problem: SynthesisProblem = {
      id: "problem:budget",
      program: expressionProgram({
        id: "budget",
        returnType: numberType,
        hole: goalHole,
      }),
      environment: {
        literals: [{ id: "one", value: 1, type: numberType }],
        callables: [],
        branchSeeds: [],
      },
      requirements: ["return a number"],
    };

    const result = await synthesizeProgram(problem, {
      registry: registry(new LiteralGenerator()),
      budget: budget({ maxStates: 0 }),
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.kind).toBe("budget");
    expect(result.bestPartialProgram).toBeDefined();
    expect(result.unresolvedHoles).toEqual(["hole:budget"]);
    expect(result.diagnostics[0]?.code).toBe("SYNTH_BUDGET_EXHAUSTED");
  });

  it("supports pluggable best-first and beam frontiers", () => {
    const baseProgram = expressionProgram({
      id: "frontier",
      returnType: numberType,
      hole: hole({ id: "hole:frontier", type: numberType }),
    });
    const state = {
      id: "state:frontier",
      program: baseProgram,
      openHoles: ["hole:frontier"],
      obligations: [],
      accumulatedCost: 3,
      depth: 1,
      history: [],
      verifierFacts: [],
    };

    const best = new BestFirstFrontier();
    best.push(state);
    expect(best.size).toBe(1);
    expect(best.pop()?.id).toBe(state.id);

    const beam = new BeamFrontier(1);
    beam.push({ ...state, id: "state:high", accumulatedCost: 9 });
    beam.push({ ...state, id: "state:low", accumulatedCost: 1 });
    expect(beam.snapshot().map((entry) => entry.id)).toEqual(["state:low"]);
  });

  it("rejects duplicate generator ids", () => {
    const generator = new LiteralGenerator();
    const registry = new CandidateGeneratorRegistry();
    expect(registry.register(generator).ok).toBe(true);
    const duplicate = registry.register(generator);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe("SYNTH_GENERATOR_DUPLICATE");
    }
  });

  it("keeps type equality deterministic for generated candidate contracts", () => {
    expect(samePirType(numberType, { kind: "number" })).toBe(true);
    expect(samePirType(numberType, booleanType)).toBe(false);
    expect(coreCandidateGenerators().map((generator) => generator.id)).toEqual([
      "generator.in-scope-symbol.v1",
      "generator.literal.v1",
      "generator.function-call.v1",
      "generator.branch.v1",
    ]);
  });
});
