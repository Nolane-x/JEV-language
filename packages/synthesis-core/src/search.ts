import {
  StructuredError,
  validatePirProgram,
  type PirExpression,
  type PirFunction,
  type PirProgram,
  type PirStatement,
  type ProgramHole,
} from "../../program-ir/src/index.ts";
import { applyExpansionCandidate } from "./apply.ts";
import { BestFirstFrontier } from "./frontier.ts";
import { hashSynthesisState } from "./hashing.ts";
import type {
  CandidateGenerator,
  CandidateRanker,
  ExpansionCandidate,
  ProgramAcceptanceVerifier,
  SearchBudget,
  SearchFrontier,
  SearchUsage,
  SynthesisFailure,
  SynthesisProblem,
  SynthesisResult,
  SynthesisState,
  SynthesisTraceEvent,
} from "./model.ts";
import { hardPruneCandidates } from "./pruning.ts";
import { CandidateGeneratorRegistry } from "./registry.ts";

const containsHole = (
  expression: PirExpression,
  holeId: string,
): boolean => {
  if (expression.kind === "hole") return expression.id === holeId;
  switch (expression.kind) {
    case "property":
    case "field-access":
      return containsHole(expression.object, holeId);
    case "index-access":
      return (
        containsHole(expression.object, holeId) ||
        containsHole(expression.index, holeId)
      );
    case "call":
      return (
        containsHole(expression.callee, holeId) ||
        expression.arguments.some((value) => containsHole(value, holeId))
      );
    case "construct":
      return expression.arguments.some((value) => containsHole(value, holeId));
    case "unary":
      return containsHole(expression.operand, holeId);
    case "binary":
    case "comparison":
      return (
        containsHole(expression.left, holeId) ||
        containsHole(expression.right, holeId)
      );
    case "logical":
      return expression.values.some((value) => containsHole(value, holeId));
    case "conditional":
      return (
        containsHole(expression.condition, holeId) ||
        containsHole(expression.whenTrue, holeId) ||
        containsHole(expression.whenFalse, holeId)
      );
    case "lambda":
      return containsHole(expression.body, holeId);
    case "await":
    case "cast":
      return containsHole(expression.value, holeId);
    case "collection":
      return expression.elements.some((value) => containsHole(value, holeId));
    case "record":
      return Object.values(expression.fields).some((value) =>
        containsHole(value, holeId),
      );
    case "match":
      return (
        containsHole(expression.value, holeId) ||
        expression.cases.some((entry) =>
          containsHole(entry.expression, holeId),
        )
      );
    case "filter":
      return (
        containsHole(expression.collection, holeId) ||
        containsHole(expression.predicate, holeId)
      );
    case "map":
      return (
        containsHole(expression.collection, holeId) ||
        containsHole(expression.mapper, holeId)
      );
    case "literal":
    case "variable":
    case "symbol-ref":
      return false;
  }
};

const statementsContainStatementHole = (
  statements: readonly PirStatement[],
  holeId: string,
): boolean =>
  statements.some((statement) => {
    if (statement.kind === "hole") return statement.holeId === holeId;
    switch (statement.kind) {
      case "if":
        return (
          statementsContainStatementHole(statement.then, holeId) ||
          statementsContainStatementHole(statement.else ?? [], holeId)
        );
      case "loop":
      case "for-each":
      case "defer":
        return statementsContainStatementHole(statement.body, holeId);
      case "match":
        return (
          statement.cases.some((entry) =>
            statementsContainStatementHole(entry.body, holeId),
          ) ||
          statementsContainStatementHole(statement.default ?? [], holeId)
        );
      case "try":
        return (
          statementsContainStatementHole(statement.body, holeId) ||
          statementsContainStatementHole(
            statement.catch?.body ?? [],
            holeId,
          ) ||
          statementsContainStatementHole(statement.finally ?? [], holeId)
        );
      case "block":
        return statementsContainStatementHole(statement.statements, holeId);
      default:
        return false;
    }
  });

const statementsContainExpressionHole = (
  statements: readonly PirStatement[],
  holeId: string,
): boolean =>
  statements.some((statement) => {
    switch (statement.kind) {
      case "declare":
        return (
          statement.initializer !== undefined &&
          containsHole(statement.initializer, holeId)
        );
      case "assign":
        return (
          containsHole(statement.target, holeId) ||
          containsHole(statement.value, holeId)
        );
      case "expression":
        return containsHole(statement.expression, holeId);
      case "return":
        return (
          statement.value !== undefined &&
          containsHole(statement.value, holeId)
        );
      case "if":
        return (
          containsHole(statement.condition, holeId) ||
          statementsContainExpressionHole(statement.then, holeId) ||
          statementsContainExpressionHole(statement.else ?? [], holeId)
        );
      case "loop":
        return (
          (statement.condition !== undefined &&
            containsHole(statement.condition, holeId)) ||
          statementsContainExpressionHole(statement.body, holeId)
        );
      case "for-each":
        return (
          containsHole(statement.collection, holeId) ||
          statementsContainExpressionHole(statement.body, holeId)
        );
      case "match":
        return (
          containsHole(statement.value, holeId) ||
          statement.cases.some((entry) =>
            statementsContainExpressionHole(entry.body, holeId),
          ) ||
          statementsContainExpressionHole(statement.default ?? [], holeId)
        );
      case "try":
        return (
          statementsContainExpressionHole(statement.body, holeId) ||
          statementsContainExpressionHole(
            statement.catch?.body ?? [],
            holeId,
          ) ||
          statementsContainExpressionHole(statement.finally ?? [], holeId)
        );
      case "throw":
        return containsHole(statement.value, holeId);
      case "assert":
        return containsHole(statement.condition, holeId);
      case "defer":
        return statementsContainExpressionHole(statement.body, holeId);
      case "block":
        return statementsContainExpressionHole(statement.statements, holeId);
      case "break":
      case "continue":
      case "hole":
        return false;
    }
  });

interface HoleOwner {
  fn: PirFunction;
  location: "expression" | "statement";
}

const ownerOfHole = (
  program: PirProgram,
  holeId: string,
): HoleOwner | undefined => {
  for (const fn of program.functions) {
    if (fn.body !== undefined && containsHole(fn.body, holeId)) {
      return { fn, location: "expression" };
    }
    if (fn.statements !== undefined) {
      const statementHole = statementsContainStatementHole(
        fn.statements,
        holeId,
      );
      const expressionHole = statementsContainExpressionHole(
        fn.statements,
        holeId,
      );
      if (statementHole && expressionHole) return undefined;
      if (statementHole) return { fn, location: "statement" };
      if (expressionHole) return { fn, location: "expression" };
    }
  }
  return undefined;
};

const holeById = (
  program: PirProgram,
  holeId: string,
): ProgramHole | undefined =>
  program.holes?.find((hole) => hole.id === holeId);

const holeWeight = (hole: ProgramHole): number =>
  hole.scopeSymbols.length +
  hole.requiredFacts.length +
  hole.forbiddenFacts.length +
  (hole.expectedType === undefined ? 1000 : 0);

const selectMostConstrainedHole = (
  program: PirProgram,
  openHoles: readonly string[],
): ProgramHole | undefined =>
  openHoles
    .map((id) => holeById(program, id))
    .filter((hole): hole is ProgramHole => hole !== undefined)
    .sort(
      (a, b) =>
        holeWeight(a) - holeWeight(b) || a.id.localeCompare(b.id),
    )[0];

const emptyUsage = (): SearchUsage => ({
  exploredStates: 0,
  generatedCandidates: 0,
  prunedCandidates: 0,
  deduplicatedStates: 0,
  jevCalls: 0,
  compilerRuns: 0,
  testRuns: 0,
});

const makeInitialState = (problem: SynthesisProblem): SynthesisState => {
  const openHoles = (problem.program.holes ?? [])
    .map((hole) => hole.id)
    .sort();
  const base = {
    program: structuredClone(problem.program),
    openHoles,
    obligations: [],
    accumulatedCost: 0,
    depth: 0,
    history: [],
    verifierFacts: [],
  };
  return {
    ...base,
    id: hashSynthesisState(base),
  };
};

const validateBudget = (budget: SearchBudget): void => {
  const integerFields = [
    ["maxStates", budget.maxStates],
    ["maxDepth", budget.maxDepth],
    ["maxJevCalls", budget.maxJevCalls],
    ["maxCompilerRuns", budget.maxCompilerRuns],
    ["maxTestRuns", budget.maxTestRuns],
  ] as const;
  for (const [name, value] of integerFields) {
    if (!Number.isInteger(value) || value < 0) {
      throw new StructuredError(
        "SYNTH_BUDGET_INVALID",
        `${name} must be a non-negative integer.`,
      );
    }
  }
  if (!Number.isFinite(budget.deadlineMs) || budget.deadlineMs < 0) {
    throw new StructuredError(
      "SYNTH_BUDGET_INVALID",
      "deadlineMs must be non-negative and finite.",
    );
  }
};

const failure = (
  kind: SynthesisFailure["kind"],
  best: SynthesisState | undefined,
  usage: SearchUsage,
  trace: SynthesisTraceEvent[],
  diagnostics: Array<{ code: string; message: string }>,
): SynthesisFailure => ({
  status: "failure",
  kind,
  ...(best === undefined
    ? {}
    : { bestPartialProgram: structuredClone(best.program) }),
  unresolvedHoles: [...(best?.openHoles ?? [])],
  unsatisfiedObligations: structuredClone(best?.obligations ?? []),
  exploredStates: usage.exploredStates,
  diagnostics,
  trace: structuredClone(trace),
  usage: structuredClone(usage),
});

const betterPartial = (
  candidate: SynthesisState,
  best: SynthesisState | undefined,
): boolean =>
  best === undefined ||
  candidate.openHoles.length < best.openHoles.length ||
  (candidate.openHoles.length === best.openHoles.length &&
    candidate.accumulatedCost < best.accumulatedCost);

const orderCandidates = async (
  problem: SynthesisProblem,
  hole: ProgramHole,
  candidates: ExpansionCandidate[],
  ranker: CandidateRanker | undefined,
  budget: SearchBudget,
  usage: SearchUsage,
  trace: SynthesisTraceEvent[],
  stateId: string,
): Promise<ExpansionCandidate[]> => {
  if (
    ranker === undefined ||
    candidates.length < 2 ||
    usage.jevCalls >= budget.maxJevCalls
  ) {
    return [...candidates].sort(
      (a, b) =>
        a.heuristicCost - b.heuristicCost || a.id.localeCompare(b.id),
    );
  }

  usage.jevCalls += 1;
  try {
    const order = await ranker.rank({
      problemId: problem.id,
      holeId: hole.id,
      requirements: [...problem.requirements],
      candidates: structuredClone(candidates),
    });
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const ranked: ExpansionCandidate[] = [];
    for (const id of order) {
      const candidate = byId.get(id);
      if (candidate !== undefined && !ranked.some((value) => value.id === id)) {
        ranked.push(candidate);
      }
    }
    for (const candidate of candidates) {
      if (!ranked.some((value) => value.id === candidate.id)) {
        ranked.push(candidate);
      }
    }
    trace.push({
      sequence: trace.length,
      kind: "jev-ranked",
      stateId,
      holeId: hole.id,
      details: {
        ranker: ranker.id,
        order: ranked.map((candidate) => candidate.id),
      },
    });
    return ranked;
  } catch (error) {
    trace.push({
      sequence: trace.length,
      kind: "failure",
      stateId,
      holeId: hole.id,
      details: {
        stage: "jev-ranking",
        ranker: ranker.id,
        error:
          error instanceof Error ? error.message : "unknown ranking error",
      },
    });
    return [...candidates].sort(
      (a, b) =>
        a.heuristicCost - b.heuristicCost || a.id.localeCompare(b.id),
    );
  }
};

export interface SynthesisEngineOptions {
  registry: CandidateGeneratorRegistry;
  budget: SearchBudget;
  frontier?: SearchFrontier;
  ranker?: CandidateRanker;
  verifiers?: ProgramAcceptanceVerifier[];
}

export const createCoreGeneratorRegistry = (
  generators: CandidateGenerator[],
): CandidateGeneratorRegistry => {
  const registry = new CandidateGeneratorRegistry();
  for (const generator of generators) {
    const registered = registry.register(generator);
    if (!registered.ok) throw registered.error;
  }
  return registry;
};

export const synthesizeProgram = async (
  problem: SynthesisProblem,
  options: SynthesisEngineOptions,
): Promise<SynthesisResult> => {
  validateBudget(options.budget);
  const initialValidation = validatePirProgram(problem.program);
  if (!initialValidation.ok) {
    return failure(
      "verification-failed",
      undefined,
      emptyUsage(),
      [],
      [
        {
          code: initialValidation.error.code,
          message: initialValidation.error.message,
        },
      ],
    );
  }

  const usage = emptyUsage();
  const trace: SynthesisTraceEvent[] = [];
  const frontier = options.frontier ?? new BestFirstFrontier();
  const initial = makeInitialState(problem);
  frontier.push(initial);
  const seen = new Set<string>([initial.id]);
  let best: SynthesisState | undefined = initial;
  const started = Date.now();

  while (frontier.size > 0) {
    if (
      usage.exploredStates >= options.budget.maxStates ||
      Date.now() - started >= options.budget.deadlineMs
    ) {
      trace.push({
        sequence: trace.length,
        kind: "budget-exhausted",
        ...(best === undefined ? {} : { stateId: best.id }),
        details: {
          maxStates: options.budget.maxStates,
          deadlineMs: options.budget.deadlineMs,
        },
      });
      return failure(
        "budget",
        best,
        usage,
        trace,
        [
          {
            code: "SYNTH_BUDGET_EXHAUSTED",
            message: "Synthesis search budget was exhausted.",
          },
        ],
      );
    }

    const state = frontier.pop();
    if (state === undefined) break;
    usage.exploredStates += 1;
    if (betterPartial(state, best)) best = state;

    trace.push({
      sequence: trace.length,
      kind: "state-selected",
      stateId: state.id,
      details: {
        openHoles: state.openHoles.length,
        cost: state.accumulatedCost,
        depth: state.depth,
      },
    });

    if (state.openHoles.length === 0) {
      const valid = validatePirProgram(state.program);
      if (!valid.ok) {
        trace.push({
          sequence: trace.length,
          kind: "failure",
          stateId: state.id,
          details: {
            stage: "complete-program-validation",
            code: valid.error.code,
            message: valid.error.message,
          },
        });
        continue;
      }

      const verificationEvidence: string[] = ["pir:validated"];
      let accepted = true;
      for (const verifier of options.verifiers ?? []) {
        const result = await verifier.verify({
          problem,
          program: state.program,
        });
        verificationEvidence.push(
          ...result.evidence.map(
            (evidence) => `${verifier.id}:${evidence}`,
          ),
        );
        if (!result.accepted) {
          accepted = false;
          trace.push({
            sequence: trace.length,
            kind: "failure",
            stateId: state.id,
            details: {
              stage: "acceptance-verifier",
              verifier: verifier.id,
              diagnostics: result.diagnostics,
            },
          });
          break;
        }
      }
      if (!accepted) continue;

      trace.push({
        sequence: trace.length,
        kind: "solution",
        stateId: state.id,
        details: {
          cost: state.accumulatedCost,
          depth: state.depth,
          verificationEvidence,
        },
      });
      return {
        status: "success",
        program: structuredClone(state.program),
        state: structuredClone(state),
        verificationEvidence,
        usage: structuredClone(usage),
        trace: structuredClone(trace),
      };
    }

    if (state.depth >= options.budget.maxDepth) continue;

    const hole = selectMostConstrainedHole(state.program, state.openHoles);
    if (hole === undefined || hole.expectedType === undefined) continue;
    if (
      hole.budget.maxDepth !== undefined &&
      state.depth >= hole.budget.maxDepth
    ) {
      continue;
    }

    const owner = ownerOfHole(state.program, hole.id);
    if (owner === undefined) continue;

    const context = {
      problem,
      state,
      functionId: owner.fn.id,
      hole,
      expectedType: hole.expectedType,
      location: owner.location,
      scopeSymbols: [...hole.scopeSymbols],
    } as const;

    const generated = options.registry.generate(context);
    const limited =
      hole.budget.maxExpansions === undefined
        ? generated
        : generated.slice(0, hole.budget.maxExpansions);
    usage.generatedCandidates += limited.length;
    for (const candidate of limited) {
      trace.push({
        sequence: trace.length,
        kind: "candidate-generated",
        stateId: state.id,
        holeId: hole.id,
        candidateId: candidate.id,
        details: {
          generator: candidate.provenance.generatorId,
          cost: candidate.heuristicCost,
        },
      });
    }

    const pruned = hardPruneCandidates(context, limited);
    usage.prunedCandidates += pruned.rejected.length;
    for (const rejected of pruned.rejected) {
      trace.push({
        sequence: trace.length,
        kind: "candidate-pruned",
        stateId: state.id,
        holeId: hole.id,
        candidateId: rejected.candidate.id,
        details: { reasons: rejected.reasons },
      });
    }

    if (pruned.accepted.length === 0) continue;

    const ordered = await orderCandidates(
      problem,
      hole,
      pruned.accepted,
      options.ranker,
      options.budget,
      usage,
      trace,
      state.id,
    );

    for (let rankIndex = 0; rankIndex < ordered.length; rankIndex += 1) {
      const candidate = ordered[rankIndex]!;
      const nextCost = state.accumulatedCost + candidate.heuristicCost;
      // Candidate order (deterministic or Jev-ranked) is a soft tie-break only.
      // Keep it tiny so a materially lower heuristic cost still wins.
      const nextPriorityBias =
        (state.priorityBias ?? 0) + rankIndex * 0.000001;
      if (
        hole.budget.maxCost !== undefined &&
        nextCost > hole.budget.maxCost
      ) {
        usage.prunedCandidates += 1;
        trace.push({
          sequence: trace.length,
          kind: "candidate-pruned",
          stateId: state.id,
          holeId: hole.id,
          candidateId: candidate.id,
          details: { reasons: ["HOLE_COST_BUDGET"] },
        });
        continue;
      }

      const applied = applyExpansionCandidate(
        state.program,
        owner.fn.id,
        hole.id,
        candidate,
      );
      if (!applied.ok) continue;

      const openHoles = (applied.value.holes ?? [])
        .map((value) => value.id)
        .sort();
      const nextBase = {
        program: applied.value,
        openHoles,
        obligations: [...state.obligations],
        accumulatedCost: nextCost,
        ...(nextPriorityBias === 0
          ? {}
          : { priorityBias: nextPriorityBias }),
        depth: state.depth + 1,
        history: [...state.history],
        verifierFacts: [
          ...state.verifierFacts,
          ...candidate.proofObligations.map(
            (entry) => `verified:${entry.id}`,
          ),
        ],
      };
      const nextId = hashSynthesisState(nextBase);
      if (seen.has(nextId)) {
        usage.deduplicatedStates += 1;
        trace.push({
          sequence: trace.length,
          kind: "state-deduplicated",
          stateId: nextId,
          holeId: hole.id,
          candidateId: candidate.id,
        });
        continue;
      }

      const step = {
        index: state.history.length,
        stateId: state.id,
        holeId: hole.id,
        candidateId: candidate.id,
        generatorId: candidate.provenance.generatorId,
        resultingStateId: nextId,
        accumulatedCost: nextCost,
      };
      const next: SynthesisState = {
        ...nextBase,
        id: nextId,
        history: [...state.history, step],
      };
      seen.add(next.id);
      frontier.push(next);
      if (betterPartial(next, best)) best = next;
      trace.push({
        sequence: trace.length,
        kind: "state-enqueued",
        stateId: next.id,
        holeId: hole.id,
        candidateId: candidate.id,
        details: { openHoles: next.openHoles.length },
      });
    }
  }

  return failure(
    best?.openHoles.length === 0
      ? "verification-failed"
      : "no-candidates",
    best,
    usage,
    trace,
    [
      {
        code: "SYNTH_SEARCH_EXHAUSTED",
        message:
          "Synthesis frontier was exhausted before a verified complete program was found.",
      },
    ],
  );
};
