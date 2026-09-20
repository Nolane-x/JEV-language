import { describe, expect, it } from "vitest";
import {
  pureArithmeticFixture,
  validatePirProgram,
  type PirProgram,
  type PirType,
  type ProgramHole,
} from "../../packages/program-ir/src/index.ts";
import {
  SYNTHESIS_GRAMMAR_PROFILES,
  applyGrammarProfile,
  enumerateTypeDirectedCandidates,
  pruneCandidatesByConstraints,
  specializeGrammarForEnvironment,
  validateProgramEnvironment,
  validateProgramSpecification,
  validateSynthesisGrammar,
  validateSynthesisProblemSchema,
  type ProgramEnvironment,
  type ProgramSpecification,
  type SynthesisGrammar,
  type SynthesisProblem,
} from "../../packages/synthesis-core/src/index.ts";

const numberType: PirType = { kind: "number" };
const stringType: PirType = { kind: "string" };

const makeHole = (): ProgramHole => ({
  id: "hole:number",
  expectedType: numberType,
  expectedEffect: "pure",
  requiredFacts: [],
  forbiddenFacts: [],
  scopeSymbols: ["param:add:a"],
  scope: {
    visibleSymbols: ["param:add:a"],
    allowGlobalSymbols: false,
    functionRef: "function:add",
  },
  effectConstraints: {
    allowed: ["pure"],
    forbidden: ["network"],
  },
  constraints: {
    allowedCandidateFamilies: ["literal", "in-scope-symbol"],
    forbiddenCandidateFamilies: ["plugin"],
    requiredCapabilities: ["pure-eval"],
    maxCandidateCost: 4,
    deterministicOnly: true,
  },
  budget: {
    maxExpansions: 32,
    maxDepth: 4,
    maxCost: 8,
  },
});

const makeProgramWithHole = (): PirProgram => {
  const program = pureArithmeticFixture();
  const fn = program.functions[0]!;
  const hole = makeHole();
  fn.body = {
    kind: "hole",
    id: hole.id,
    expected: numberType,
  };
  program.holes = [hole];
  return program;
};

const makeEnvironment = (): ProgramEnvironment => ({
  literals: [
    { id: "literal:zero", value: 0, type: numberType, cost: 0 },
    { id: "literal:text", value: "x", type: stringType, cost: 0 },
  ],
  callables: [
    {
      id: "callable:pure-number",
      parameterTypes: [],
      returnType: numberType,
      effects: [{ kind: "pure" }],
      cost: 1,
    },
    {
      id: "callable:network-number",
      parameterTypes: [],
      returnType: numberType,
      effects: [{ kind: "network" }],
      cost: 1,
    },
  ],
  branchSeeds: [
    {
      id: "branch:positive",
      condition: {
        kind: "literal",
        value: true,
        type: { kind: "boolean" },
      },
      cost: 1,
    },
  ],
  symbols: [
    {
      id: "param:add:a",
      type: numberType,
      effects: [],
      cost: 0,
      capabilities: ["pure-eval"],
    },
    {
      id: "symbol:text",
      type: stringType,
      effects: [],
      cost: 0,
    },
  ],
  backend: "typescript",
  capabilities: ["pure-eval"],
  libraries: ["stdlib"],
  allowedEffects: ["pure"],
  forbiddenEffects: ["network"],
  semanticFacts: [],
  maxCandidateCost: 6,
});

const makeGrammar = (): SynthesisGrammar => ({
  schemaVersion: "jl-synthesis-grammar-1",
  id: "grammar:test",
  version: "1.0.0",
  profile: "G3",
  productions: [
    {
      id: "production:literal",
      family: "literal",
      resultType: numberType,
      effects: [],
      requiredCapabilities: [],
      baseCost: 1,
      deterministic: true,
    },
    {
      id: "production:symbol",
      family: "in-scope-symbol",
      resultType: numberType,
      effects: [],
      requiredCapabilities: [],
      baseCost: 1,
      deterministic: true,
    },
    {
      id: "production:call",
      family: "function-call",
      resultType: numberType,
      effects: [{ kind: "pure" }],
      requiredCapabilities: ["pure-eval"],
      backends: ["typescript", "python"],
      baseCost: 2,
      deterministic: true,
    },
    {
      id: "production:branch",
      family: "branch",
      resultType: numberType,
      effects: [],
      requiredCapabilities: [],
      baseCost: 3,
      deterministic: true,
    },
    {
      id: "production:collection",
      family: "collection-pattern",
      resultType: numberType,
      effects: [],
      requiredCapabilities: [],
      baseCost: 5,
      deterministic: true,
    },
    {
      id: "production:return",
      family: "return",
      resultType: numberType,
      effects: [],
      requiredCapabilities: [],
      baseCost: 2,
      deterministic: true,
    },
    {
      id: "production:network-plugin",
      family: "plugin",
      resultType: numberType,
      effects: [{ kind: "network" }],
      requiredCapabilities: ["network-plugin"],
      requiredLibraries: ["network-sdk"],
      backends: ["typescript"],
      baseCost: 20,
      deterministic: false,
    },
  ],
});

describe("T441-T450 synthesis grammar foundation", () => {
  it("T441 validates the refined SynthesisProblem schema without breaking legacy requirements", () => {
    const problem: SynthesisProblem = {
      id: "problem:number",
      program: makeProgramWithHole(),
      environment: makeEnvironment(),
      requirements: ["produce a number"],
      specification: {
        kind: "requirements",
        requirements: ["produce a number"],
      },
      grammarProfile: "G1",
    };
    expect(validateSynthesisProblemSchema(problem).ok).toBe(true);

    expect(
      validateSynthesisProblemSchema({
        ...problem,
        id: "",
      }).ok,
    ).toBe(false);
  });

  it("T442 validates composite ProgramSpecification components independently", () => {
    const specification: ProgramSpecification = {
      kind: "composite",
      parts: [
        {
          kind: "requirements",
          requirements: ["preserve type safety", "return a number"],
        },
        {
          kind: "examples",
          examples: [{ id: "example:zero", input: null, expected: 0 }],
        },
        {
          kind: "type-contract",
          parameters: [],
          returns: numberType,
        },
        {
          kind: "effect-contract",
          allowed: ["pure"],
          forbidden: ["network"],
        },
        {
          kind: "semantic-contract",
          requiredFacts: [],
          forbiddenFacts: [],
        },
      ],
    };
    expect(validateProgramSpecification(specification).ok).toBe(true);
    expect(
      validateProgramSpecification({
        kind: "effect-contract",
        allowed: ["network"],
        forbidden: ["network"],
      }).ok,
    ).toBe(false);
  });

  it("T443 validates a typed synthesis grammar with stable production ids", () => {
    expect(validateSynthesisGrammar(makeGrammar()).ok).toBe(true);
    const duplicate = makeGrammar();
    duplicate.productions.push(structuredClone(duplicate.productions[0]!));
    expect(validateSynthesisGrammar(duplicate).ok).toBe(false);
  });

  it("T444 specializes grammar against backend, capabilities, libraries, effects and cost", () => {
    const specialized = specializeGrammarForEnvironment(
      makeGrammar(),
      makeEnvironment(),
    );
    expect(specialized.ok).toBe(true);
    if (specialized.ok) {
      expect(
        specialized.value.grammar.productions.map((item) => item.id),
      ).not.toContain("production:network-plugin");
      expect(
        specialized.value.excluded.find(
          (item) => item.productionId === "production:network-plugin",
        )?.reasons,
      ).toEqual([
        "CAPABILITY:network-plugin",
        "COST_BOUND",
        "EFFECT_POLICY",
        "LIBRARY:network-sdk",
      ]);
    }
  });

  it("T445 enforces monotonic layered grammar profiles G0-G3", () => {
    const grammar = makeGrammar();
    const outputs = (["G0", "G1", "G2", "G3"] as const).map((profile) => {
      const result = applyGrammarProfile(grammar, profile);
      expect(result.ok).toBe(true);
      return result.ok
        ? result.value.productions.map((item) => item.family)
        : [];
    });

    for (let index = 1; index < outputs.length; index += 1) {
      const previous = new Set(outputs[index - 1]!);
      const current = new Set(outputs[index]!);
      expect([...previous].every((family) => current.has(family))).toBe(true);
    }
    expect(SYNTHESIS_GRAMMAR_PROFILES.G0.allowPlugins).toBe(false);
    expect(SYNTHESIS_GRAMMAR_PROFILES.G3.allowPlugins).toBe(true);
  });

  it("T446 validates structured ProgramHole scope, effects and candidate constraints", () => {
    expect(validatePirProgram(makeProgramWithHole()).ok).toBe(true);

    const invalid = makeProgramWithHole();
    invalid.holes![0]!.constraints = {
      allowedCandidateFamilies: ["literal"],
      forbiddenCandidateFamilies: ["literal"],
    };
    expect(validatePirProgram(invalid).ok).toBe(false);
  });

  it("T447 validates ProgramEnvironment capability/effect/cost contracts", () => {
    expect(validateProgramEnvironment(makeEnvironment()).ok).toBe(true);
    expect(
      validateProgramEnvironment({
        ...makeEnvironment(),
        allowedEffects: ["pure", "network"],
        forbiddenEffects: ["network"],
      }).ok,
    ).toBe(false);
  });

  it("T448 enumerates only type-correct literal/symbol/call candidates for a hole", () => {
    const profiled = applyGrammarProfile(makeGrammar(), "G1");
    expect(profiled.ok).toBe(true);
    if (!profiled.ok) return;

    const enumerated = enumerateTypeDirectedCandidates({
      grammar: profiled.value,
      environment: makeEnvironment(),
      hole: makeHole(),
      expectedType: numberType,
    });
    expect(enumerated.ok).toBe(true);
    if (enumerated.ok) {
      expect(
        enumerated.value.every((candidate) =>
          candidate.resultType.kind === "number",
        ),
      ).toBe(true);
      expect(
        enumerated.value.some(
          (candidate) => candidate.sourceRef === "literal:text",
        ),
      ).toBe(false);
      expect(
        enumerated.value.some(
          (candidate) => candidate.sourceRef === "symbol:text",
        ),
      ).toBe(false);
    }
  });

  it("T449 prunes candidates early from hole family/effect/cost/capability constraints", () => {
    const enumerated = enumerateTypeDirectedCandidates({
      grammar: makeGrammar(),
      environment: makeEnvironment(),
      hole: makeHole(),
      expectedType: numberType,
    });
    expect(enumerated.ok).toBe(true);
    if (!enumerated.ok) return;

    const pruned = pruneCandidatesByConstraints({
      candidates: enumerated.value,
      hole: makeHole(),
      environment: makeEnvironment(),
    });
    expect(
      pruned.accepted.every((candidate) =>
        ["literal", "in-scope-symbol"].includes(candidate.family),
      ),
    ).toBe(true);
    expect(
      pruned.rejected.some((entry) =>
        entry.reasons.includes("FAMILY_NOT_ALLOWED"),
      ),
    ).toBe(true);
  });

  it("T450 preserves profile/enumeration determinism under reordered grammar and environment inputs", () => {
    const grammar = makeGrammar();
    const reversedGrammar: SynthesisGrammar = {
      ...structuredClone(grammar),
      productions: [...grammar.productions].reverse(),
    };
    const g1a = applyGrammarProfile(grammar, "G2");
    const g1b = applyGrammarProfile(reversedGrammar, "G2");
    expect(g1a.ok && g1b.ok).toBe(true);
    if (g1a.ok && g1b.ok) {
      expect(g1a.value.productions.map((item) => item.id)).toEqual(
        g1b.value.productions.map((item) => item.id),
      );
    }

    const environment = makeEnvironment();
    const reversedEnvironment: ProgramEnvironment = {
      ...structuredClone(environment),
      literals: [...environment.literals].reverse(),
      callables: [...environment.callables].reverse(),
      branchSeeds: [...environment.branchSeeds].reverse(),
      symbols: [...(environment.symbols ?? [])].reverse(),
    };
    if (!g1a.ok) return;
    const first = enumerateTypeDirectedCandidates({
      grammar: g1a.value,
      environment,
      hole: makeHole(),
      expectedType: numberType,
    });
    const second = enumerateTypeDirectedCandidates({
      grammar: g1a.value,
      environment: reversedEnvironment,
      hole: makeHole(),
      expectedType: numberType,
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.map((item) => item.id)).toEqual(
        second.value.map((item) => item.id),
      );
    }
  });
});
