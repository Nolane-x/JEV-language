import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  samePirType,
  validatePirProgram,
  type EffectSpec,
  type PirEffectKind,
  type PirType,
  type ProgramHole,
} from "../../program-ir/src/index.ts";
import type {
  CandidateSource,
  ProgramEnvironment,
  ProgramSpecification,
  SynthesisGrammarProfileName,
  SynthesisProblem,
} from "./model.ts";

export type SynthesisProductionFamily = CandidateSource["kind"];

export interface SynthesisGrammarProduction {
  id: string;
  family: SynthesisProductionFamily;
  resultType?: PirType;
  effects: EffectSpec[];
  requiredCapabilities: string[];
  requiredLibraries?: string[];
  backends?: string[];
  baseCost: number;
  deterministic: boolean;
  enabled?: boolean;
}

export interface SynthesisGrammar {
  schemaVersion: "jl-synthesis-grammar-1";
  id: string;
  version: string;
  profile: SynthesisGrammarProfileName;
  productions: SynthesisGrammarProduction[];
}

export interface SynthesisGrammarProfile {
  id: SynthesisGrammarProfileName;
  allowedFamilies: SynthesisProductionFamily[];
  maxBaseCost: number;
  allowPlugins: boolean;
}

const PROFILE_ORDER: SynthesisGrammarProfileName[] = ["G0", "G1", "G2", "G3"];

export const SYNTHESIS_GRAMMAR_PROFILES: Readonly<
  Record<SynthesisGrammarProfileName, SynthesisGrammarProfile>
> = {
  G0: {
    id: "G0",
    allowedFamilies: ["literal", "in-scope-symbol"],
    maxBaseCost: 4,
    allowPlugins: false,
  },
  G1: {
    id: "G1",
    allowedFamilies: [
      "literal",
      "in-scope-symbol",
      "function-call",
      "return",
    ],
    maxBaseCost: 8,
    allowPlugins: false,
  },
  G2: {
    id: "G2",
    allowedFamilies: [
      "literal",
      "in-scope-symbol",
      "function-call",
      "return",
      "branch",
      "collection-pattern",
    ],
    maxBaseCost: 16,
    allowPlugins: false,
  },
  G3: {
    id: "G3",
    allowedFamilies: [
      "literal",
      "in-scope-symbol",
      "function-call",
      "return",
      "branch",
      "collection-pattern",
      "plugin",
    ],
    maxBaseCost: Number.POSITIVE_INFINITY,
    allowPlugins: true,
  },
};

const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.every((value) => value.trim() !== "") &&
  new Set(values).size === values.length;

const validCost = (value: number): boolean =>
  Number.isFinite(value) && value >= 0;

const validateSpecificationInner = (
  specification: ProgramSpecification,
  seen: WeakSet<object>,
): Result<void> => {
  if (seen.has(specification as object)) {
    return err(
      new StructuredError(
        "SYNTH_SPEC_CYCLE",
        "Program specifications may not contain recursive object cycles.",
      ),
    );
  }
  seen.add(specification as object);

  switch (specification.kind) {
    case "requirements":
      return uniqueNonEmpty(specification.requirements)
        ? ok(undefined)
        : err(
            new StructuredError(
              "SYNTH_SPEC_REQUIREMENTS",
              "Requirement specifications require unique non-empty requirements.",
            ),
          );
    case "examples": {
      const ids = specification.examples.map((example) => example.id);
      return uniqueNonEmpty(ids)
        ? ok(undefined)
        : err(
            new StructuredError(
              "SYNTH_SPEC_EXAMPLES",
              "Example specifications require unique non-empty ids.",
            ),
          );
    }
    case "type-contract":
      return ok(undefined);
    case "effect-contract": {
      const allowed = new Set(specification.allowed);
      const forbidden = new Set(specification.forbidden);
      if (
        allowed.size !== specification.allowed.length ||
        forbidden.size !== specification.forbidden.length ||
        [...allowed].some((effect) => forbidden.has(effect))
      ) {
        return err(
          new StructuredError(
            "SYNTH_SPEC_EFFECTS",
            "Effect contract sets must be duplicate-free and disjoint.",
          ),
        );
      }
      return ok(undefined);
    }
    case "semantic-contract": {
      if (
        !uniqueNonEmpty(specification.requiredFacts) ||
        !uniqueNonEmpty(specification.forbiddenFacts) ||
        specification.requiredFacts.some((fact) =>
          specification.forbiddenFacts.includes(fact),
        )
      ) {
        return err(
          new StructuredError(
            "SYNTH_SPEC_SEMANTIC",
            "Semantic contract facts must be unique, non-empty, and disjoint.",
          ),
        );
      }
      return ok(undefined);
    }
    case "composite":
      if (specification.parts.length === 0) {
        return err(
          new StructuredError(
            "SYNTH_SPEC_COMPOSITE_EMPTY",
            "Composite specification requires at least one part.",
          ),
        );
      }
      for (const part of specification.parts) {
        const valid = validateSpecificationInner(part, seen);
        if (!valid.ok) return valid;
      }
      return ok(undefined);
  }
};

export const validateProgramSpecification = (
  specification: ProgramSpecification,
): Result<void> => validateSpecificationInner(specification, new WeakSet());

export const validateProgramEnvironment = (
  environment: ProgramEnvironment,
): Result<void> => {
  const literalIds = environment.literals.map((item) => item.id);
  const callableIds = environment.callables.map((item) => item.id);
  const branchIds = environment.branchSeeds.map((item) => item.id);
  const symbolIds = (environment.symbols ?? []).map((item) => item.id);
  if (
    !uniqueNonEmpty(literalIds) ||
    !uniqueNonEmpty(callableIds) ||
    !uniqueNonEmpty(branchIds) ||
    !uniqueNonEmpty(symbolIds)
  ) {
    return err(
      new StructuredError(
        "SYNTH_ENV_IDS",
        "Program environment candidate ids must be unique and non-empty within each candidate family.",
      ),
    );
  }
  for (const list of [
    environment.capabilities ?? [],
    environment.libraries ?? [],
    environment.semanticFacts ?? [],
  ]) {
    if (!uniqueNonEmpty(list)) {
      return err(
        new StructuredError(
          "SYNTH_ENV_LIST",
          "Program environment lists must contain unique non-empty values.",
        ),
      );
    }
  }

  const allowed = new Set(environment.allowedEffects ?? []);
  const forbidden = new Set(environment.forbiddenEffects ?? []);
  if (
    allowed.size !== (environment.allowedEffects ?? []).length ||
    forbidden.size !== (environment.forbiddenEffects ?? []).length ||
    [...allowed].some((effect) => forbidden.has(effect)) ||
    (environment.maxCandidateCost !== undefined &&
      !validCost(environment.maxCandidateCost))
  ) {
    return err(
      new StructuredError(
        "SYNTH_ENV_CONSTRAINTS",
        "Environment effect sets must be disjoint and cost bounds non-negative.",
      ),
    );
  }
  return ok(undefined);
};

export const validateSynthesisProblemSchema = (
  problem: SynthesisProblem,
): Result<void> => {
  if (problem.id.trim() === "") {
    return err(
      new StructuredError(
        "SYNTH_PROBLEM_ID",
        "Synthesis problem requires a non-empty id.",
      ),
    );
  }
  const program = validatePirProgram(problem.program);
  if (!program.ok) return err(program.error);
  const environment = validateProgramEnvironment(problem.environment);
  if (!environment.ok) return environment;
  if (!uniqueNonEmpty(problem.requirements)) {
    return err(
      new StructuredError(
        "SYNTH_PROBLEM_REQUIREMENTS",
        "Compatibility requirements must be unique non-empty strings.",
      ),
    );
  }
  if (
    problem.requirements.length === 0 &&
    problem.specification === undefined
  ) {
    return err(
      new StructuredError(
        "SYNTH_PROBLEM_SPECIFICATION_MISSING",
        "Synthesis problem requires legacy requirements or a typed ProgramSpecification.",
      ),
    );
  }
  if (problem.specification !== undefined) {
    const specification = validateProgramSpecification(problem.specification);
    if (!specification.ok) return specification;
  }
  return ok(undefined);
};

export const validateSynthesisGrammar = (
  grammar: SynthesisGrammar,
): Result<void> => {
  if (
    grammar.schemaVersion !== "jl-synthesis-grammar-1" ||
    grammar.id.trim() === "" ||
    grammar.version.trim() === "" ||
    !PROFILE_ORDER.includes(grammar.profile)
  ) {
    return err(
      new StructuredError(
        "SYNTH_GRAMMAR_SCHEMA",
        "Synthesis grammar requires schema version, id, version, and G0-G3 profile.",
      ),
    );
  }

  if (grammar.productions.length === 0) {
    return err(
      new StructuredError(
        "SYNTH_GRAMMAR_EMPTY",
        "Synthesis grammar requires at least one production.",
      ),
    );
  }
  const knownFamilies = new Set<SynthesisProductionFamily>([
    "literal",
    "in-scope-symbol",
    "function-call",
    "branch",
    "collection-pattern",
    "return",
    "plugin",
  ]);
  const ids = grammar.productions.map((production) => production.id);
  if (!uniqueNonEmpty(ids)) {
    return err(
      new StructuredError(
        "SYNTH_GRAMMAR_PRODUCTION_ID",
        "Grammar production ids must be unique and non-empty.",
      ),
    );
  }
  for (const production of grammar.productions) {
    if (
      !knownFamilies.has(production.family) ||
      !validCost(production.baseCost) ||
      !uniqueNonEmpty(production.requiredCapabilities) ||
      !uniqueNonEmpty(production.requiredLibraries ?? []) ||
      !uniqueNonEmpty(production.backends ?? [])
    ) {
      return err(
        new StructuredError(
          "SYNTH_GRAMMAR_PRODUCTION",
          `Invalid synthesis production ${production.id}.`,
        ),
      );
    }
  }
  return ok(undefined);
};

export interface GrammarSpecializationExclusion {
  productionId: string;
  reasons: string[];
}

export interface GrammarSpecializationResult {
  grammar: SynthesisGrammar;
  excluded: GrammarSpecializationExclusion[];
}

const effectKinds = (effects: readonly EffectSpec[]): PirEffectKind[] =>
  [...new Set(effects.map((effect) => effect.kind))];

const environmentAllowsEffects = (
  effects: readonly EffectSpec[],
  environment: ProgramEnvironment,
): boolean => {
  const kinds = effectKinds(effects);
  const allowed =
    environment.allowedEffects === undefined
      ? undefined
      : new Set(environment.allowedEffects);
  const forbidden = new Set(environment.forbiddenEffects ?? []);
  return kinds.every(
    (kind) =>
      !forbidden.has(kind) &&
      (allowed === undefined || allowed.has(kind)),
  );
};

export const applyGrammarProfile = (
  grammar: SynthesisGrammar,
  profileName: SynthesisGrammarProfileName,
): Result<SynthesisGrammar> => {
  const valid = validateSynthesisGrammar(grammar);
  if (!valid.ok) return err(valid.error);
  const profile = SYNTHESIS_GRAMMAR_PROFILES[profileName];
  const allowed = new Set(profile.allowedFamilies);
  return ok({
    ...structuredClone(grammar),
    profile: profileName,
    productions: grammar.productions
      .filter(
        (production) =>
          production.enabled !== false &&
          allowed.has(production.family) &&
          production.baseCost <= profile.maxBaseCost &&
          (profile.allowPlugins || production.family !== "plugin"),
      )
      .map((production) => structuredClone(production))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
};

export const specializeGrammarForEnvironment = (
  grammar: SynthesisGrammar,
  environment: ProgramEnvironment,
): Result<GrammarSpecializationResult> => {
  const grammarValid = validateSynthesisGrammar(grammar);
  if (!grammarValid.ok) return err(grammarValid.error);
  const envValid = validateProgramEnvironment(environment);
  if (!envValid.ok) return err(envValid.error);

  const capabilities = new Set(environment.capabilities ?? []);
  const libraries = new Set(environment.libraries ?? []);
  const included: SynthesisGrammarProduction[] = [];
  const excluded: GrammarSpecializationExclusion[] = [];

  for (const production of grammar.productions) {
    const reasons: string[] = [];
    if (production.enabled === false) reasons.push("DISABLED");
    if (
      production.backends !== undefined &&
      (environment.backend === undefined ||
        !production.backends.includes(environment.backend))
    ) {
      reasons.push("BACKEND");
    }
    for (const capability of production.requiredCapabilities) {
      if (!capabilities.has(capability)) {
        reasons.push(`CAPABILITY:${capability}`);
      }
    }
    for (const library of production.requiredLibraries ?? []) {
      if (!libraries.has(library)) reasons.push(`LIBRARY:${library}`);
    }
    if (!environmentAllowsEffects(production.effects, environment)) {
      reasons.push("EFFECT_POLICY");
    }
    if (
      environment.maxCandidateCost !== undefined &&
      production.baseCost > environment.maxCandidateCost
    ) {
      reasons.push("COST_BOUND");
    }

    if (reasons.length === 0) included.push(structuredClone(production));
    else {
      excluded.push({
        productionId: production.id,
        reasons: [...new Set(reasons)].sort(),
      });
    }
  }

  return ok({
    grammar: {
      ...structuredClone(grammar),
      productions: included.sort((a, b) => a.id.localeCompare(b.id)),
    },
    excluded: excluded.sort((a, b) =>
      a.productionId.localeCompare(b.productionId),
    ),
  });
};

export interface TypedGrammarCandidate {
  id: string;
  productionId: string;
  family: SynthesisProductionFamily;
  sourceRef: string;
  resultType: PirType;
  effects: EffectSpec[];
  cost: number;
  requiredCapabilities: string[];
  deterministic: boolean;
}

const productionAcceptsType = (
  production: SynthesisGrammarProduction,
  expectedType: PirType,
): boolean =>
  production.resultType === undefined ||
  samePirType(production.resultType, expectedType);

const candidateFromProduction = (
  production: SynthesisGrammarProduction,
  input: {
    sourceRef: string;
    resultType: PirType;
    effects: EffectSpec[];
    sourceCost?: number;
  },
): TypedGrammarCandidate => ({
  id: `grammar-candidate:${production.id}:${input.sourceRef}`,
  productionId: production.id,
  family: production.family,
  sourceRef: input.sourceRef,
  resultType: structuredClone(input.resultType),
  effects: structuredClone(input.effects),
  cost: production.baseCost + (input.sourceCost ?? 0),
  requiredCapabilities: [...production.requiredCapabilities],
  deterministic: production.deterministic,
});

export const enumerateTypeDirectedCandidates = (input: {
  grammar: SynthesisGrammar;
  environment: ProgramEnvironment;
  hole: ProgramHole;
  expectedType: PirType;
}): Result<TypedGrammarCandidate[]> => {
  const grammarValid = validateSynthesisGrammar(input.grammar);
  if (!grammarValid.ok) return err(grammarValid.error);
  const environmentValid = validateProgramEnvironment(input.environment);
  if (!environmentValid.ok) return err(environmentValid.error);

  const visible = new Set(
    input.hole.scope?.visibleSymbols ?? input.hole.scopeSymbols,
  );
  const output: TypedGrammarCandidate[] = [];

  for (const production of input.grammar.productions) {
    if (!productionAcceptsType(production, input.expectedType)) continue;

    if (production.family === "literal") {
      for (const literal of input.environment.literals) {
        if (!samePirType(literal.type, input.expectedType)) continue;
        output.push(
          candidateFromProduction(production, {
            sourceRef: literal.id,
            resultType: literal.type,
            effects: [],
            ...(literal.cost === undefined ? {} : { sourceCost: literal.cost }),
          }),
        );
      }
      continue;
    }

    if (production.family === "in-scope-symbol") {
      for (const symbol of input.environment.symbols ?? []) {
        if (
          !visible.has(symbol.id) ||
          !samePirType(symbol.type, input.expectedType)
        ) {
          continue;
        }
        output.push(
          candidateFromProduction(production, {
            sourceRef: symbol.id,
            resultType: symbol.type,
            effects: symbol.effects ?? [],
            ...(symbol.cost === undefined ? {} : { sourceCost: symbol.cost }),
          }),
        );
      }
      continue;
    }

    if (production.family === "function-call") {
      for (const callable of input.environment.callables) {
        if (!samePirType(callable.returnType, input.expectedType)) continue;
        output.push(
          candidateFromProduction(production, {
            sourceRef: callable.id,
            resultType: callable.returnType,
            effects: callable.effects,
            ...(callable.cost === undefined
              ? {}
              : { sourceCost: callable.cost }),
          }),
        );
      }
      continue;
    }

    if (production.family === "branch") {
      for (const branch of input.environment.branchSeeds) {
        output.push(
          candidateFromProduction(production, {
            sourceRef: branch.id,
            resultType: input.expectedType,
            effects: production.effects,
            ...(branch.cost === undefined ? {} : { sourceCost: branch.cost }),
          }),
        );
      }
      continue;
    }

    output.push(
      candidateFromProduction(production, {
        sourceRef: production.id,
        resultType: input.expectedType,
        effects: production.effects,
      }),
    );
  }

  const deduplicated = new Map<string, TypedGrammarCandidate>();
  for (const candidate of output) {
    const key = JSON.stringify([
      candidate.family,
      candidate.sourceRef,
      candidate.resultType,
      candidate.effects,
    ]);
    const existing = deduplicated.get(key);
    if (
      existing === undefined ||
      candidate.cost < existing.cost ||
      (candidate.cost === existing.cost && candidate.id < existing.id)
    ) {
      deduplicated.set(key, candidate);
    }
  }

  return ok(
    [...deduplicated.values()].sort(
      (a, b) => a.cost - b.cost || a.id.localeCompare(b.id),
    ),
  );
};

export interface GrammarCandidatePruningDecision {
  accepted: TypedGrammarCandidate[];
  rejected: Array<{
    candidate: TypedGrammarCandidate;
    reasons: string[];
  }>;
}

export const pruneCandidatesByConstraints = (input: {
  candidates: readonly TypedGrammarCandidate[];
  hole: ProgramHole;
  environment: ProgramEnvironment;
}): GrammarCandidatePruningDecision => {
  const allowedFamilies =
    input.hole.constraints?.allowedCandidateFamilies === undefined
      ? undefined
      : new Set(input.hole.constraints.allowedCandidateFamilies);
  const forbiddenFamilies = new Set(
    input.hole.constraints?.forbiddenCandidateFamilies ?? [],
  );
  const requiredCapabilities = new Set(
    input.hole.constraints?.requiredCapabilities ?? [],
  );
  const environmentCapabilities = new Set(
    input.environment.capabilities ?? [],
  );
  const holeAllowedEffects =
    input.hole.effectConstraints === undefined ||
    input.hole.effectConstraints.allowed.length === 0
      ? undefined
      : new Set(input.hole.effectConstraints.allowed);
  const holeForbiddenEffects = new Set(
    input.hole.effectConstraints?.forbidden ?? [],
  );
  const maxCost = Math.min(
    input.hole.constraints?.maxCandidateCost ??
      Number.POSITIVE_INFINITY,
    input.environment.maxCandidateCost ?? Number.POSITIVE_INFINITY,
  );

  const accepted: TypedGrammarCandidate[] = [];
  const rejected: GrammarCandidatePruningDecision["rejected"] = [];

  for (const candidate of input.candidates) {
    const reasons: string[] = [];
    if (
      allowedFamilies !== undefined &&
      !allowedFamilies.has(candidate.family)
    ) {
      reasons.push("FAMILY_NOT_ALLOWED");
    }
    if (forbiddenFamilies.has(candidate.family)) {
      reasons.push("FAMILY_FORBIDDEN");
    }
    if (candidate.cost > maxCost) reasons.push("COST_BOUND");
    if (
      input.hole.constraints?.deterministicOnly === true &&
      !candidate.deterministic
    ) {
      reasons.push("NONDETERMINISTIC");
    }
    for (const capability of requiredCapabilities) {
      if (!environmentCapabilities.has(capability)) {
        reasons.push(`MISSING_HOLE_CAPABILITY:${capability}`);
      }
    }
    for (const capability of candidate.requiredCapabilities) {
      if (!environmentCapabilities.has(capability)) {
        reasons.push(`MISSING_CANDIDATE_CAPABILITY:${capability}`);
      }
    }
    for (const effect of effectKinds(candidate.effects)) {
      if (
        holeAllowedEffects !== undefined &&
        !holeAllowedEffects.has(effect)
      ) {
        reasons.push(`HOLE_EFFECT_NOT_ALLOWED:${effect}`);
      }
      if (holeForbiddenEffects.has(effect)) {
        reasons.push(`HOLE_EFFECT_FORBIDDEN:${effect}`);
      }
    }
    if (!environmentAllowsEffects(candidate.effects, input.environment)) {
      reasons.push("ENVIRONMENT_EFFECT_POLICY");
    }

    if (reasons.length === 0) accepted.push(structuredClone(candidate));
    else {
      rejected.push({
        candidate: structuredClone(candidate),
        reasons: [...new Set(reasons)].sort(),
      });
    }
  }

  return {
    accepted: accepted.sort(
      (a, b) => a.cost - b.cost || a.id.localeCompare(b.id),
    ),
    rejected: rejected.sort((a, b) =>
      a.candidate.id.localeCompare(b.candidate.id),
    ),
  };
};
