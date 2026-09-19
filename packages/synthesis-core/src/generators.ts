import {
  samePirType,
  type EffectSpec,
  type PirType,
  type ProgramHole,
} from "../../program-ir/src/index.ts";
import type {
  CandidateGenerationContext,
  CandidateGenerator,
  ExpansionCandidate,
} from "./model.ts";

const cloneEffects = (effects: readonly EffectSpec[]): EffectSpec[] =>
  effects.map((effect) => structuredClone(effect));

const typeForScopeSymbol = (
  context: CandidateGenerationContext,
  symbolId: string,
): PirType | undefined => {
  const fn = context.state.program.functions.find(
    (candidate) => candidate.id === context.functionId,
  );
  const parameter = fn?.parameters.find((candidate) => candidate.id === symbolId);
  if (parameter !== undefined) return parameter.type;

  const symbol = context.state.program.symbols?.find(
    (candidate) => candidate.id === symbolId,
  );
  if (symbol?.type !== undefined) return symbol.type;

  const targetFunction = context.state.program.functions.find(
    (candidate) => candidate.id === symbolId,
  );
  if (targetFunction !== undefined) {
    return {
      kind: "function",
      parameters: targetFunction.parameters.map((value) => value.type),
      returns: targetFunction.returnType,
      effects: cloneEffects(targetFunction.effects ?? []),
    };
  }
  return undefined;
};

const obligation = (
  id: string,
  kind: "type-safety" | "effect-safety" | "scope-legality",
  description: string,
) => ({ id, kind, description });

export class InScopeSymbolGenerator implements CandidateGenerator {
  readonly id = "generator.in-scope-symbol.v1";

  supports(context: CandidateGenerationContext): boolean {
    return context.scopeSymbols.length > 0;
  }

  generate(context: CandidateGenerationContext): ExpansionCandidate[] {
    const candidates: ExpansionCandidate[] = [];
    for (const symbolId of [...context.scopeSymbols].sort()) {
      const type = typeForScopeSymbol(context, symbolId);
      if (type === undefined || !samePirType(type, context.expectedType)) {
        continue;
      }
      candidates.push({
        id: `candidate:symbol:${symbolId}`,
        replacement: { kind: "variable", symbolId },
        newHoles: [],
        proofObligations: [
          obligation(
            `obligation:type:${symbolId}`,
            "type-safety",
            "In-scope symbol type must equal the hole expected type.",
          ),
          obligation(
            `obligation:scope:${symbolId}`,
            "scope-legality",
            "Selected symbol must occur in the hole lexical scope.",
          ),
        ],
        heuristicCost: 1,
        provenance: {
          kind: "in-scope-symbol",
          generatorId: this.id,
          evidenceRefs: [`scope:${context.hole.id}`],
        },
        resultType: structuredClone(type),
        effects: [],
      });
    }
    return candidates;
  }
}

export class LiteralGenerator implements CandidateGenerator {
  readonly id = "generator.literal.v1";

  supports(context: CandidateGenerationContext): boolean {
    return context.problem.environment.literals.length > 0;
  }

  generate(context: CandidateGenerationContext): ExpansionCandidate[] {
    return context.problem.environment.literals
      .filter((literal) => samePirType(literal.type, context.expectedType))
      .map((literal) => ({
        id: `candidate:literal:${literal.id}`,
        replacement: {
          kind: "literal" as const,
          value: structuredClone(literal.value),
          type: structuredClone(literal.type),
        },
        newHoles: [],
        proofObligations: [
          obligation(
            `obligation:type:literal:${literal.id}`,
            "type-safety",
            "Literal candidate type must equal the hole expected type.",
          ),
        ],
        heuristicCost: literal.cost ?? 2,
        provenance: {
          kind: "literal" as const,
          generatorId: this.id,
          evidenceRefs: [`literal:${literal.id}`],
        },
        resultType: structuredClone(literal.type),
        effects: [],
      }));
  }
}

export class FunctionCallGenerator implements CandidateGenerator {
  readonly id = "generator.function-call.v1";

  supports(context: CandidateGenerationContext): boolean {
    return context.problem.environment.callables.length > 0;
  }

  generate(context: CandidateGenerationContext): ExpansionCandidate[] {
    const candidates: ExpansionCandidate[] = [];

    for (const callable of context.problem.environment.callables) {
      if (!samePirType(callable.returnType, context.expectedType)) continue;

      const argumentsList = callable.parameterTypes.map(
        (parameterType, index) => ({
          hole: {
            id: `${context.hole.id}:call:${callable.id}:arg:${index}`,
            expectedType: structuredClone(parameterType),
            expectedEffect: "pure" as const,
            requiredFacts: [],
            forbiddenFacts: [],
            scopeSymbols: [...context.scopeSymbols],
            purpose: context.hole.purpose,
            budget: structuredClone(context.hole.budget),
          } satisfies ProgramHole,
          expression: undefined,
        }),
      );
      const newHoles = argumentsList.map((entry) => entry.hole);
      const expressionArguments = argumentsList.map((entry) => ({
        kind: "hole" as const,
        id: entry.hole.id,
        expected: structuredClone(entry.hole.expectedType!),
        ...(entry.hole.purpose === undefined
          ? {}
          : { purpose: entry.hole.purpose }),
      }));

      candidates.push({
        id: `candidate:call:${callable.id}`,
        replacement: {
          kind: "call",
          callee: { kind: "symbol-ref", symbolId: callable.id },
          arguments: expressionArguments,
        },
        newHoles,
        proofObligations: [
          obligation(
            `obligation:type:call:${callable.id}`,
            "type-safety",
            "Callable return type must equal the hole expected type.",
          ),
          obligation(
            `obligation:effect:call:${callable.id}`,
            "effect-safety",
            "Callable effects must satisfy the hole effect constraints.",
          ),
        ],
        heuristicCost: callable.cost ?? 3,
        provenance: {
          kind: "function-call",
          generatorId: this.id,
          evidenceRefs: [`callable:${callable.id}`],
        },
        resultType: structuredClone(callable.returnType),
        effects: cloneEffects(callable.effects),
      });
    }

    return candidates;
  }
}

export class BranchGenerator implements CandidateGenerator {
  readonly id = "generator.branch.v1";

  supports(context: CandidateGenerationContext): boolean {
    return context.problem.environment.branchSeeds.length > 0;
  }

  generate(context: CandidateGenerationContext): ExpansionCandidate[] {
    return context.problem.environment.branchSeeds.map((seed) => {
      const trueHole: ProgramHole = {
        id: `${context.hole.id}:branch:${seed.id}:true`,
        expectedType: structuredClone(context.expectedType),
        expectedEffect: context.hole.expectedEffect,
        requiredFacts: [...context.hole.requiredFacts],
        forbiddenFacts: [...context.hole.forbiddenFacts],
        scopeSymbols: [...context.scopeSymbols],
        purpose: context.hole.purpose,
        budget: structuredClone(context.hole.budget),
      };
      const falseHole: ProgramHole = {
        ...structuredClone(trueHole),
        id: `${context.hole.id}:branch:${seed.id}:false`,
      };

      return {
        id: `candidate:branch:${seed.id}`,
        replacement: {
          kind: "conditional" as const,
          condition: structuredClone(seed.condition),
          whenTrue: {
            kind: "hole" as const,
            id: trueHole.id,
            expected: structuredClone(context.expectedType),
          },
          whenFalse: {
            kind: "hole" as const,
            id: falseHole.id,
            expected: structuredClone(context.expectedType),
          },
        },
        newHoles: [trueHole, falseHole],
        proofObligations: [
          obligation(
            `obligation:type:branch:${seed.id}`,
            "type-safety",
            "Both branch result holes must preserve the parent expected type.",
          ),
        ],
        heuristicCost: seed.cost ?? 4,
        provenance: {
          kind: "branch" as const,
          generatorId: this.id,
          evidenceRefs: [`branch-seed:${seed.id}`],
        },
        resultType: structuredClone(context.expectedType),
        effects: [],
      };
    });
  }
}

export const coreCandidateGenerators = (): CandidateGenerator[] => [
  new InScopeSymbolGenerator(),
  new LiteralGenerator(),
  new FunctionCallGenerator(),
  new BranchGenerator(),
];
