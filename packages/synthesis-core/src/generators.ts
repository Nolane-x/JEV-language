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
  const parameter = fn?.parameters.find(
    (candidate) => candidate.id === symbolId,
  );
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
    return context.location === "expression" && context.scopeSymbols.length > 0;
  }

  generate(context: CandidateGenerationContext): ExpansionCandidate[] {
    if (context.location !== "expression") return [];
    const candidates: ExpansionCandidate[] = [];
    for (const symbolId of [...context.scopeSymbols].sort()) {
      const type = typeForScopeSymbol(context, symbolId);
      if (type === undefined || !samePirType(type, context.expectedType)) {
        continue;
      }
      candidates.push({
        id: `candidate:symbol:${symbolId}`,
        replacement: {
          kind: "expression",
          value: { kind: "variable", symbolId },
        },
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
    return (
      context.location === "expression" &&
      context.problem.environment.literals.length > 0
    );
  }

  generate(context: CandidateGenerationContext): ExpansionCandidate[] {
    if (context.location !== "expression") return [];
    return context.problem.environment.literals
      .filter((literal) => samePirType(literal.type, context.expectedType))
      .map((literal) => ({
        id: `candidate:literal:${literal.id}`,
        replacement: {
          kind: "expression" as const,
          value: {
            kind: "literal" as const,
            value: structuredClone(literal.value),
            type: structuredClone(literal.type),
          },
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
    return (
      context.location === "expression" &&
      context.problem.environment.callables.length > 0
    );
  }

  generate(context: CandidateGenerationContext): ExpansionCandidate[] {
    if (context.location !== "expression") return [];
    const candidates: ExpansionCandidate[] = [];

    for (const callable of context.problem.environment.callables) {
      if (!samePirType(callable.returnType, context.expectedType)) continue;

      const argumentHoles = callable.parameterTypes.map(
        (parameterType, index): ProgramHole => ({
          id: `${context.hole.id}:call:${callable.id}:arg:${index}`,
          expectedType: structuredClone(parameterType),
          expectedEffect: "pure",
          requiredFacts: [],
          forbiddenFacts: [],
          scopeSymbols: [...context.scopeSymbols],
          ...(context.hole.purpose === undefined
            ? {}
            : { purpose: context.hole.purpose }),
          budget: structuredClone(context.hole.budget),
        }),
      );

      candidates.push({
        id: `candidate:call:${callable.id}`,
        replacement: {
          kind: "expression",
          value: {
            kind: "call",
            callee: { kind: "symbol-ref", symbolId: callable.id },
            arguments: argumentHoles.map((entry) => ({
              kind: "hole",
              id: entry.id,
              expected: structuredClone(entry.expectedType!),
              ...(entry.purpose === undefined
                ? {}
                : { purpose: entry.purpose }),
            })),
          },
        },
        newHoles: argumentHoles,
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
    return (
      context.location === "expression" &&
      context.problem.environment.branchSeeds.length > 0
    );
  }

  generate(context: CandidateGenerationContext): ExpansionCandidate[] {
    if (context.location !== "expression") return [];
    return context.problem.environment.branchSeeds.map((seed) => {
      const trueHole: ProgramHole = {
        id: `${context.hole.id}:branch:${seed.id}:true`,
        expectedType: structuredClone(context.expectedType),
        ...(context.hole.expectedEffect === undefined
          ? {}
          : { expectedEffect: structuredClone(context.hole.expectedEffect) }),
        requiredFacts: [...context.hole.requiredFacts],
        forbiddenFacts: [...context.hole.forbiddenFacts],
        scopeSymbols: [...context.scopeSymbols],
        ...(context.hole.purpose === undefined
          ? {}
          : { purpose: context.hole.purpose }),
        budget: structuredClone(context.hole.budget),
      };
      const falseHole: ProgramHole = {
        ...structuredClone(trueHole),
        id: `${context.hole.id}:branch:${seed.id}:false`,
      };

      return {
        id: `candidate:branch:${seed.id}`,
        replacement: {
          kind: "expression" as const,
          value: {
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

export class CollectionPatternGenerator implements CandidateGenerator {
  readonly id = "generator.collection-pattern.v1";

  supports(context: CandidateGenerationContext): boolean {
    return (
      context.location === "expression" &&
      context.expectedType.kind === "list" &&
      context.scopeSymbols.length > 0
    );
  }

  generate(context: CandidateGenerationContext): ExpansionCandidate[] {
    if (
      context.location !== "expression" ||
      context.expectedType.kind !== "list"
    ) {
      return [];
    }

    const candidates: ExpansionCandidate[] = [];
    for (const symbolId of [...context.scopeSymbols].sort()) {
      const sourceType = typeForScopeSymbol(context, symbolId);
      if (sourceType?.kind !== "list") continue;

      if (
        samePirType(sourceType, context.expectedType) &&
        sourceType.element.kind === "record"
      ) {
        for (const [field, fieldType] of Object.entries(
          sourceType.element.fields,
        ).sort(([a], [b]) => a.localeCompare(b))) {
          if (fieldType.kind !== "boolean") continue;
          const itemId = `symbol:${context.hole.id}:filter:${field}:item`;
          candidates.push({
            id: `candidate:collection:filter:${symbolId}:${field}`,
            replacement: {
              kind: "expression",
              value: {
                kind: "filter",
                collection: { kind: "variable", symbolId },
                item: {
                  id: itemId,
                  name: "item",
                  type: structuredClone(sourceType.element),
                },
                predicate: {
                  kind: "property",
                  object: { kind: "variable", symbolId: itemId },
                  property: field,
                },
              },
            },
            newHoles: [],
            proofObligations: [
              obligation(
                `obligation:type:collection-filter:${symbolId}:${field}`,
                "type-safety",
                "Filter preserves the input collection type.",
              ),
            ],
            heuristicCost: 2,
            provenance: {
              kind: "collection-pattern",
              generatorId: this.id,
              evidenceRefs: [`scope:${context.hole.id}`, `field:${field}`],
            },
            resultType: structuredClone(context.expectedType),
            effects: [],
          });
        }
      }

      if (sourceType.element.kind === "record") {
        for (const [field, fieldType] of Object.entries(
          sourceType.element.fields,
        ).sort(([a], [b]) => a.localeCompare(b))) {
          if (!samePirType(fieldType, context.expectedType.element)) continue;
          const itemId = `symbol:${context.hole.id}:map:${field}:item`;
          candidates.push({
            id: `candidate:collection:map:${symbolId}:${field}`,
            replacement: {
              kind: "expression",
              value: {
                kind: "map",
                collection: { kind: "variable", symbolId },
                item: {
                  id: itemId,
                  name: "item",
                  type: structuredClone(sourceType.element),
                },
                mapper: {
                  kind: "property",
                  object: { kind: "variable", symbolId: itemId },
                  property: field,
                },
                resultElementType: structuredClone(fieldType),
              },
            },
            newHoles: [],
            proofObligations: [
              obligation(
                `obligation:type:collection-map:${symbolId}:${field}`,
                "type-safety",
                "Mapped field type must equal the requested output element type.",
              ),
            ],
            heuristicCost: 3,
            provenance: {
              kind: "collection-pattern",
              generatorId: this.id,
              evidenceRefs: [`scope:${context.hole.id}`, `field:${field}`],
            },
            resultType: structuredClone(context.expectedType),
            effects: [],
          });
        }
      }
    }

    return candidates;
  }
}

export class ReturnGenerator implements CandidateGenerator {
  readonly id = "generator.return.v1";

  supports(context: CandidateGenerationContext): boolean {
    return context.location === "statement";
  }

  generate(context: CandidateGenerationContext): ExpansionCandidate[] {
    if (context.location !== "statement") return [];

    if (context.expectedType.kind === "void") {
      return [
        {
          id: `candidate:return:void:${context.hole.id}`,
          replacement: {
            kind: "statements",
            value: [{ kind: "return" }],
          },
          newHoles: [],
          proofObligations: [],
          heuristicCost: 1,
          provenance: {
            kind: "return",
            generatorId: this.id,
            evidenceRefs: [`hole:${context.hole.id}`],
          },
          resultType: { kind: "void" },
          effects: [],
        },
      ];
    }

    const candidates: ExpansionCandidate[] = [];
    for (const symbolId of [...context.scopeSymbols].sort()) {
      const type = typeForScopeSymbol(context, symbolId);
      if (type === undefined || !samePirType(type, context.expectedType)) {
        continue;
      }
      candidates.push({
        id: `candidate:return:symbol:${symbolId}`,
        replacement: {
          kind: "statements",
          value: [
            {
              kind: "return",
              value: { kind: "variable", symbolId },
            },
          ],
        },
        newHoles: [],
        proofObligations: [
          obligation(
            `obligation:return-type:${symbolId}`,
            "type-safety",
            "Returned symbol type must equal the hole expected type.",
          ),
        ],
        heuristicCost: 1,
        provenance: {
          kind: "return",
          generatorId: this.id,
          evidenceRefs: [`scope:${context.hole.id}`],
        },
        resultType: structuredClone(type),
        effects: [],
      });
    }

    for (const literal of context.problem.environment.literals) {
      if (!samePirType(literal.type, context.expectedType)) continue;
      candidates.push({
        id: `candidate:return:literal:${literal.id}`,
        replacement: {
          kind: "statements",
          value: [
            {
              kind: "return",
              value: {
                kind: "literal",
                value: structuredClone(literal.value),
                type: structuredClone(literal.type),
              },
            },
          ],
        },
        newHoles: [],
        proofObligations: [
          obligation(
            `obligation:return-type:literal:${literal.id}`,
            "type-safety",
            "Returned literal type must equal the hole expected type.",
          ),
        ],
        heuristicCost: literal.cost ?? 2,
        provenance: {
          kind: "return",
          generatorId: this.id,
          evidenceRefs: [`literal:${literal.id}`],
        },
        resultType: structuredClone(literal.type),
        effects: [],
      });
    }

    return candidates;
  }
}

export const coreCandidateGenerators = (): CandidateGenerator[] => [
  new InScopeSymbolGenerator(),
  new LiteralGenerator(),
  new FunctionCallGenerator(),
  new BranchGenerator(),
  new CollectionPatternGenerator(),
  new ReturnGenerator(),
];
