import type {
  PirFunction,
  PirModule,
  PirProgram,
  PirType,
  ProgramHole,
} from "./model.ts";

const numberType: PirType = { kind: "number" };
const stringType: PirType = { kind: "string" };
const booleanType: PirType = { kind: "boolean" };

const moduleFor = (
  id: string,
  functionIds: string[],
): PirModule => ({
  id,
  kind: "module",
  nameIntent: {
    preferredTerms: [id.replace(/^module:/u, "")],
    style: "backend-default",
  },
  exports: [...functionIds],
  imports: [],
  declarations: [...functionIds],
});

const program = (
  module: PirModule,
  functions: PirFunction[],
  extras: Partial<PirProgram> = {},
): PirProgram => ({
  version: "1.0.0",
  modules: [module],
  functions,
  ...structuredClone(extras),
});

export const pureArithmeticFixture = (): PirProgram => {
  const fn: PirFunction = {
    kind: "function",
    id: "function:add",
    name: "add",
    parameters: [
      { id: "param:add:a", name: "a", type: numberType },
      { id: "param:add:b", name: "b", type: numberType },
    ],
    returnType: numberType,
    body: {
      kind: "binary",
      operator: "add",
      left: { kind: "variable", symbolId: "param:add:a" },
      right: { kind: "variable", symbolId: "param:add:b" },
    },
    effects: [{ kind: "pure" }],
    contract: {
      preconditions: [],
      postconditions: [],
      effects: [{ kind: "pure" }],
      provenance: [
        { source: "requirement", refs: ["requirement:pure-arithmetic"] },
      ],
    },
    visibility: "public",
    sourceBinding: {
      sourceId: "fixture:pure-arithmetic",
      existingName: "add",
      start: 0,
      end: 3,
    },
  };
  return program(moduleFor("module:arithmetic", [fn.id]), [fn]);
};

export const conditionalValidationFixture = (): PirProgram => {
  const fn: PirFunction = {
    kind: "function",
    id: "function:validate-non-negative",
    name: "validateNonNegative",
    parameters: [
      {
        id: "param:validate:value",
        name: "value",
        type: numberType,
      },
    ],
    returnType: numberType,
    statements: [
      {
        kind: "if",
        condition: {
          kind: "comparison",
          operator: "gte",
          left: {
            kind: "variable",
            symbolId: "param:validate:value",
          },
          right: {
            kind: "literal",
            value: 0,
            type: numberType,
          },
        },
        then: [
          {
            kind: "return",
            value: {
              kind: "variable",
              symbolId: "param:validate:value",
            },
          },
        ],
        else: [
          {
            kind: "throw",
            value: {
              kind: "literal",
              value: "negative value",
              type: stringType,
            },
          },
        ],
      },
    ],
    effects: [{ kind: "throw" }],
    contract: {
      preconditions: [],
      postconditions: [],
      effects: [{ kind: "throw" }],
      errorCases: [
        {
          id: "error:negative",
          recoverable: true,
          errorType: stringType,
        },
      ],
      provenance: [
        { source: "requirement", refs: ["requirement:non-negative"] },
      ],
    },
  };
  return program(moduleFor("module:validation", [fn.id]), [fn]);
};

export const collectionFilterMapFixture = (): PirProgram => {
  const userType: PirType = {
    kind: "record",
    fields: {
      active: booleanType,
      name: stringType,
    },
  };
  const usersType: PirType = { kind: "list", element: userType };
  const namesType: PirType = { kind: "list", element: stringType };

  const filterFn: PirFunction = {
    kind: "function",
    id: "function:filter-active",
    name: "filterActive",
    parameters: [
      { id: "param:filter:users", name: "users", type: usersType },
    ],
    returnType: usersType,
    body: {
      kind: "filter",
      collection: {
        kind: "variable",
        symbolId: "param:filter:users",
      },
      item: {
        id: "symbol:filter:user",
        name: "user",
        type: userType,
      },
      predicate: {
        kind: "property",
        object: {
          kind: "variable",
          symbolId: "symbol:filter:user",
        },
        property: "active",
      },
    },
    effects: [{ kind: "pure" }],
  };

  const mapFn: PirFunction = {
    kind: "function",
    id: "function:map-names",
    name: "mapNames",
    parameters: [
      { id: "param:map:users", name: "users", type: usersType },
    ],
    returnType: namesType,
    body: {
      kind: "map",
      collection: {
        kind: "variable",
        symbolId: "param:map:users",
      },
      item: {
        id: "symbol:map:user",
        name: "user",
        type: userType,
      },
      mapper: {
        kind: "property",
        object: {
          kind: "variable",
          symbolId: "symbol:map:user",
        },
        property: "name",
      },
      resultElementType: stringType,
    },
    effects: [{ kind: "pure" }],
  };

  return program(
    moduleFor("module:collections", [filterFn.id, mapFn.id]),
    [filterFn, mapFn],
  );
};

export const stateMutationFixture = (): PirProgram => {
  const stateType: PirType = {
    kind: "record",
    fields: { count: numberType },
  };
  const fn: PirFunction = {
    kind: "function",
    id: "function:increment",
    name: "increment",
    parameters: [
      { id: "param:increment:state", name: "state", type: stateType },
    ],
    returnType: numberType,
    statements: [
      {
        kind: "assign",
        target: {
          kind: "property",
          object: {
            kind: "variable",
            symbolId: "param:increment:state",
          },
          property: "count",
        },
        value: {
          kind: "binary",
          operator: "add",
          left: {
            kind: "property",
            object: {
              kind: "variable",
              symbolId: "param:increment:state",
            },
            property: "count",
          },
          right: { kind: "literal", value: 1, type: numberType },
        },
      },
      {
        kind: "return",
        value: {
          kind: "property",
          object: {
            kind: "variable",
            symbolId: "param:increment:state",
          },
          property: "count",
        },
      },
    ],
    effects: [{ kind: "write-memory" }],
  };
  return program(moduleFor("module:state", [fn.id]), [fn]);
};

export const errorHandlingFixture = (): PirProgram => {
  const fn: PirFunction = {
    kind: "function",
    id: "function:safe-value",
    name: "safeValue",
    parameters: [
      { id: "param:safe:value", name: "value", type: numberType },
    ],
    returnType: numberType,
    statements: [
      {
        kind: "try",
        body: [
          {
            kind: "if",
            condition: {
              kind: "comparison",
              operator: "lt",
              left: {
                kind: "variable",
                symbolId: "param:safe:value",
              },
              right: {
                kind: "literal",
                value: 0,
                type: numberType,
              },
            },
            then: [
              {
                kind: "throw",
                value: {
                  kind: "literal",
                  value: "negative",
                  type: stringType,
                },
              },
            ],
          },
          {
            kind: "return",
            value: {
              kind: "variable",
              symbolId: "param:safe:value",
            },
          },
        ],
        catch: {
          parameter: {
            id: "param:safe:error",
            name: "error",
            type: stringType,
          },
          body: [
            {
              kind: "return",
              value: {
                kind: "literal",
                value: 0,
                type: numberType,
              },
            },
          ],
        },
        finally: [
          {
            kind: "assert",
            condition: {
              kind: "literal",
              value: true,
              type: booleanType,
            },
            message: "cleanup complete",
          },
        ],
      },
    ],
    effects: [{ kind: "throw" }],
  };
  return program(moduleFor("module:errors", [fn.id]), [fn]);
};

export const asyncCallFixture = (): PirProgram => {
  const fetcherType: PirType = {
    kind: "function",
    parameters: [],
    returns: { kind: "promise", value: stringType },
    effects: [{ kind: "network" }, { kind: "async" }],
  };
  const fn: PirFunction = {
    kind: "function",
    id: "function:fetch-value",
    name: "fetchValue",
    parameters: [
      {
        id: "param:fetch:fetcher",
        name: "fetcher",
        type: fetcherType,
      },
    ],
    returnType: stringType,
    body: {
      kind: "await",
      value: {
        kind: "call",
        callee: {
          kind: "variable",
          symbolId: "param:fetch:fetcher",
        },
        arguments: [],
      },
    },
    async: true,
    effects: [{ kind: "network" }, { kind: "async" }],
  };
  return program(moduleFor("module:async", [fn.id]), [fn]);
};

export const multiFunctionModuleFixture = (): PirProgram => {
  const square: PirFunction = {
    kind: "function",
    id: "function:square",
    name: "square",
    parameters: [
      { id: "param:square:x", name: "x", type: numberType },
    ],
    returnType: numberType,
    body: {
      kind: "binary",
      operator: "multiply",
      left: { kind: "variable", symbolId: "param:square:x" },
      right: { kind: "variable", symbolId: "param:square:x" },
    },
    effects: [{ kind: "pure" }],
  };

  const main: PirFunction = {
    kind: "function",
    id: "function:square-plus-one",
    name: "squarePlusOne",
    parameters: [
      { id: "param:main:x", name: "x", type: numberType },
    ],
    returnType: numberType,
    body: {
      kind: "binary",
      operator: "add",
      left: {
        kind: "call",
        callee: {
          kind: "symbol-ref",
          symbolId: square.id,
        },
        arguments: [
          { kind: "variable", symbolId: "param:main:x" },
        ],
      },
      right: { kind: "literal", value: 1, type: numberType },
    },
    effects: [{ kind: "pure" }],
  };

  const module = moduleFor("module:multi", [main.id]);
  module.declarations = [square.id, main.id];
  return program(module, [square, main]);
};

export const simpleGenericFixture = (): PirProgram => {
  const typeVariable: Extract<PirType, { kind: "type-variable" }> = {
    kind: "type-variable",
    id: "type:T",
    name: "T",
  };
  const fn: PirFunction = {
    kind: "function",
    id: "function:identity",
    name: "identity",
    typeParameters: [typeVariable],
    parameters: [
      { id: "param:identity:value", name: "value", type: typeVariable },
    ],
    returnType: typeVariable,
    body: {
      kind: "variable",
      symbolId: "param:identity:value",
    },
    effects: [{ kind: "pure" }],
  };
  return program(moduleFor("module:generic", [fn.id]), [fn]);
};

export type M10ProgramFixtureId =
  | "pure-arithmetic"
  | "conditional-validation"
  | "collection-filter-map"
  | "state-mutation"
  | "error-handling"
  | "async-call"
  | "multi-function-module"
  | "simple-generic-function";

export const m10ProgramCorpus = (): Record<
  M10ProgramFixtureId,
  PirProgram
> => ({
  "pure-arithmetic": pureArithmeticFixture(),
  "conditional-validation": conditionalValidationFixture(),
  "collection-filter-map": collectionFilterMapFixture(),
  "state-mutation": stateMutationFixture(),
  "error-handling": errorHandlingFixture(),
  "async-call": asyncCallFixture(),
  "multi-function-module": multiFunctionModuleFixture(),
  "simple-generic-function": simpleGenericFixture(),
});

export const activeUserFilterGoal = (): PirProgram => {
  const userType: PirType = {
    kind: "record",
    fields: {
      active: { kind: "boolean" },
    },
  };
  const usersType: PirType = { kind: "list", element: userType };
  const hole: ProgramHole = {
    id: "hole:filter-active-users-body",
    expectedType: usersType,
    expectedEffect: "pure",
    requiredFacts: [],
    forbiddenFacts: [],
    scopeSymbols: ["param:users"],
    budget: {
      maxExpansions: 64,
      maxDepth: 8,
      maxCost: 32,
    },
  };
  const fn: PirFunction = {
    kind: "function",
    id: "function:filter-active-users",
    name: "filterActiveUsers",
    parameters: [
      { id: "param:users", name: "users", type: usersType },
    ],
    returnType: usersType,
    body: {
      kind: "hole",
      id: hole.id,
      expected: usersType,
    },
    effects: [{ kind: "pure" }],
  };
  return program(
    moduleFor("module:active-user-filter", [fn.id]),
    [fn],
    { holes: [hole] },
  );
};
