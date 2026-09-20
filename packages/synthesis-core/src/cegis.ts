import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  CandidateId,
  CandidateRanker,
  CandidateRankingRequest,
  ExpansionCandidate,
  SearchFrontier,
  SynthesisGrammarProfileName,
  SynthesisState,
} from "./model.ts";
import { BestFirstFrontier } from "./frontier.ts";

export interface SearchStrategy {
  readonly id: string;
  readonly deterministic: boolean;
  createFrontier(): SearchFrontier;
}

export class BestFirstSearchStrategy implements SearchStrategy {
  readonly id = "search.best-first.v1";
  readonly deterministic = true;

  createFrontier(): SearchFrontier {
    return new BestFirstFrontier();
  }
}

export interface CandidateFamilyRanking {
  familyOrder: string[];
  candidateOrder: CandidateId[];
}

export class CandidateRankerFamilyAdapter {
  readonly id = "search.family-ranker-adapter.v1";

  constructor(readonly ranker: CandidateRanker) {}

  async rankFamilies(
    request: CandidateRankingRequest,
  ): Promise<CandidateFamilyRanking> {
    const candidateOrder = await this.ranker.rank(request);
    const byId = new Map(
      request.candidates.map((candidate) => [candidate.id, candidate]),
    );
    const familyOrder: string[] = [];
    for (const candidateId of candidateOrder) {
      const candidate = byId.get(candidateId);
      if (
        candidate !== undefined &&
        !familyOrder.includes(candidate.provenance.kind)
      ) {
        familyOrder.push(candidate.provenance.kind);
      }
    }
    for (const candidate of request.candidates) {
      if (!familyOrder.includes(candidate.provenance.kind)) {
        familyOrder.push(candidate.provenance.kind);
      }
    }
    return {
      familyOrder,
      candidateOrder: [...candidateOrder],
    };
  }
}

export interface HierarchicalExpansion {
  family: string;
  candidates: ExpansionCandidate[];
}

export const hierarchicalCandidateExpansion = (
  candidates: readonly ExpansionCandidate[],
  familyOrder?: readonly string[],
): HierarchicalExpansion[] => {
  const groups = new Map<string, ExpansionCandidate[]>();
  for (const candidate of candidates) {
    const family = candidate.provenance.kind;
    const list = groups.get(family) ?? [];
    list.push(structuredClone(candidate));
    groups.set(family, list);
  }
  const explicit = familyOrder ?? [];
  const families = [
    ...explicit.filter((family) => groups.has(family)),
    ...[...groups.keys()]
      .filter((family) => !explicit.includes(family))
      .sort(),
  ];
  return families.map((family) => ({
    family,
    candidates: (groups.get(family) ?? []).sort(
      (a, b) =>
        a.heuristicCost - b.heuristicCost || a.id.localeCompare(b.id),
    ),
  }));
};

export interface Counterexample {
  schemaVersion: "jl-counterexample-1";
  id: string;
  verifierId: string;
  input: JsonValue;
  expected?: JsonValue;
  observed?: JsonValue;
  violatedConstraints: string[];
  evidenceRefs: string[];
  minimizedFrom?: string;
  metadata?: Record<string, JsonValue>;
}

const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.every((value) => value.trim() !== "") &&
  new Set(values).size === values.length;

export const validateCounterexample = (
  counterexample: Counterexample,
): Result<Counterexample> => {
  if (
    counterexample.schemaVersion !== "jl-counterexample-1" ||
    counterexample.id.trim() === "" ||
    counterexample.verifierId.trim() === "" ||
    !uniqueNonEmpty(counterexample.violatedConstraints) ||
    counterexample.violatedConstraints.length === 0 ||
    !uniqueNonEmpty(counterexample.evidenceRefs) ||
    counterexample.evidenceRefs.length === 0 ||
    (counterexample.minimizedFrom !== undefined &&
      counterexample.minimizedFrom.trim() === "")
  ) {
    return err(
      new StructuredError(
        "SYNTH_COUNTEREXAMPLE_SCHEMA",
        "Counterexamples require stable ids, verifier identity, violated constraints, and evidence.",
      ),
    );
  }
  return ok(structuredClone(counterexample));
};

export interface ValidationPartition {
  development: string[];
  validation: string[];
  heldOut: string[];
}

export const validateValidationPartition = (
  partition: ValidationPartition,
): Result<ValidationPartition> => {
  for (const [name, values] of Object.entries(partition)) {
    if (!uniqueNonEmpty(values)) {
      return err(
        new StructuredError(
          "SYNTH_VALIDATION_PARTITION",
          `${name} partition must contain unique non-empty case ids.`,
        ),
      );
    }
  }
  const ownership = new Map<string, string>();
  for (const [name, values] of Object.entries(partition)) {
    for (const value of values) {
      const previous = ownership.get(value);
      if (previous !== undefined) {
        return err(
          new StructuredError(
            "SYNTH_VALIDATION_PARTITION_OVERLAP",
            `Validation case ${value} occurs in both ${previous} and ${name}.`,
          ),
        );
      }
      ownership.set(value, name);
    }
  }
  if (partition.heldOut.length === 0) {
    return err(
      new StructuredError(
        "SYNTH_VALIDATION_HELD_OUT",
        "CEGIS validation requires at least one held-out case.",
      ),
    );
  }
  return ok(structuredClone(partition));
};

export interface CounterexampleShrinker {
  readonly id: string;
  shrink(counterexample: Counterexample): Counterexample[];
}

const counterexampleSize = (value: Counterexample): number =>
  JSON.stringify(value.input).length +
  JSON.stringify(value.expected ?? null).length +
  JSON.stringify(value.observed ?? null).length +
  value.violatedConstraints.join("").length;

export const minimizeCounterexample = async (input: {
  counterexample: Counterexample;
  shrinkers: readonly CounterexampleShrinker[];
  stillFails: (candidate: Counterexample) => boolean | Promise<boolean>;
  maxSteps?: number;
}): Promise<Result<Counterexample>> => {
  const valid = validateCounterexample(input.counterexample);
  if (!valid.ok) return err(valid.error);
  const maxSteps = input.maxSteps ?? 32;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0) {
    return err(
      new StructuredError(
        "SYNTH_COUNTEREXAMPLE_SHRINK_BUDGET",
        "Counterexample shrink budget must be a non-negative integer.",
      ),
    );
  }

  let current = valid.value;
  let steps = 0;
  while (steps < maxSteps) {
    const proposals = input.shrinkers
      .flatMap((shrinker) => shrinker.shrink(current))
      .filter((candidate) => validateCounterexample(candidate).ok)
      .sort(
        (a, b) =>
          counterexampleSize(a) - counterexampleSize(b) ||
          a.id.localeCompare(b.id),
      );
    let improved: Counterexample | undefined;
    for (const proposal of proposals) {
      if (
        counterexampleSize(proposal) < counterexampleSize(current) &&
        (await input.stillFails(proposal))
      ) {
        improved = {
          ...structuredClone(proposal),
          minimizedFrom: current.minimizedFrom ?? current.id,
        };
        break;
      }
    }
    if (improved === undefined) break;
    current = improved;
    steps += 1;
  }
  return ok(current);
};

export type GrammarWideningReason =
  | "no-candidates"
  | "counterexample-stagnation"
  | "expressiveness-gap";

export interface GrammarWideningPolicy {
  order: SynthesisGrammarProfileName[];
  permittedReasons: GrammarWideningReason[];
  maxProfile: SynthesisGrammarProfileName;
}

const PROFILE_RANK: Record<SynthesisGrammarProfileName, number> = {
  G0: 0,
  G1: 1,
  G2: 2,
  G3: 3,
};

export const nextGrammarProfile = (
  current: SynthesisGrammarProfileName,
  reason: GrammarWideningReason,
  policy: GrammarWideningPolicy,
): Result<SynthesisGrammarProfileName> => {
  if (
    !uniqueNonEmpty(policy.order) ||
    new Set(policy.order).size !== policy.order.length ||
    policy.order.some((profile) => !(profile in PROFILE_RANK)) ||
    !policy.order.includes(current) ||
    !policy.order.includes(policy.maxProfile) ||
    !policy.permittedReasons.includes(reason)
  ) {
    return err(
      new StructuredError(
        "SYNTH_GRAMMAR_WIDENING_POLICY",
        "Grammar widening requires a valid ordered profile path and permitted reason.",
      ),
    );
  }
  const currentIndex = policy.order.indexOf(current);
  const maxRank = PROFILE_RANK[policy.maxProfile];
  for (let index = currentIndex + 1; index < policy.order.length; index += 1) {
    const candidate = policy.order[index]!;
    if (PROFILE_RANK[candidate] <= maxRank) return ok(candidate);
  }
  return ok(current);
};

export interface CegisVerification {
  accepted: boolean;
  counterexamples: Counterexample[];
  evidenceRefs: string[];
}

export interface CegisIteration<TCandidate> {
  index: number;
  profile: SynthesisGrammarProfileName;
  candidate: TCandidate;
  verification: CegisVerification;
  minimizedCounterexamples: Counterexample[];
}

export interface CegisSuccess<TCandidate> {
  status: "success";
  candidate: TCandidate;
  iterations: CegisIteration<TCandidate>[];
  counterexamples: Counterexample[];
  evidenceRefs: string[];
}

export interface CegisFailure<TCandidate> {
  status: "failure";
  reason: "iteration-budget" | "no-candidate" | "grammar-exhausted";
  bestCandidate?: TCandidate;
  iterations: CegisIteration<TCandidate>[];
  counterexamples: Counterexample[];
  evidenceRefs: string[];
}

export type CegisResult<TCandidate> =
  | CegisSuccess<TCandidate>
  | CegisFailure<TCandidate>;

export const runCegis = async <TCandidate>(input: {
  initialProfile: SynthesisGrammarProfileName;
  wideningPolicy: GrammarWideningPolicy;
  partition: ValidationPartition;
  maxIterations: number;
  propose: (context: {
    iteration: number;
    profile: SynthesisGrammarProfileName;
    counterexamples: readonly Counterexample[];
  }) => TCandidate | undefined | Promise<TCandidate | undefined>;
  verify: (context: {
    candidate: TCandidate;
    partition: ValidationPartition;
    counterexamples: readonly Counterexample[];
  }) => CegisVerification | Promise<CegisVerification>;
  shrinkers?: readonly CounterexampleShrinker[];
  stillFails?: (
    candidate: TCandidate,
    counterexample: Counterexample,
  ) => boolean | Promise<boolean>;
}): Promise<Result<CegisResult<TCandidate>>> => {
  const partition = validateValidationPartition(input.partition);
  if (!partition.ok) return err(partition.error);
  if (!Number.isSafeInteger(input.maxIterations) || input.maxIterations < 1) {
    return err(
      new StructuredError(
        "SYNTH_CEGIS_BUDGET",
        "CEGIS maxIterations must be a positive integer.",
      ),
    );
  }

  let profile = input.initialProfile;
  let bestCandidate: TCandidate | undefined;
  const counterexamples: Counterexample[] = [];
  const evidenceRefs = new Set<string>();
  const iterations: CegisIteration<TCandidate>[] = [];

  for (let index = 0; index < input.maxIterations; index += 1) {
    const candidate = await input.propose({
      iteration: index,
      profile,
      counterexamples,
    });
    if (candidate === undefined) {
      const widened = nextGrammarProfile(
        profile,
        "no-candidates",
        input.wideningPolicy,
      );
      if (!widened.ok) return err(widened.error);
      if (widened.value === profile) {
        return ok({
          status: "failure",
          reason: "grammar-exhausted",
          ...(bestCandidate === undefined ? {} : { bestCandidate }),
          iterations,
          counterexamples,
          evidenceRefs: [...evidenceRefs].sort(),
        });
      }
      profile = widened.value;
      continue;
    }

    bestCandidate = candidate;
    const verification = await input.verify({
      candidate,
      partition: partition.value,
      counterexamples,
    });
    for (const evidence of verification.evidenceRefs) {
      if (evidence.trim() !== "") evidenceRefs.add(evidence);
    }

    const minimized: Counterexample[] = [];
    for (const counterexample of verification.counterexamples) {
      const valid = validateCounterexample(counterexample);
      if (!valid.ok) return err(valid.error);
      let value = valid.value;
      if (
        input.shrinkers !== undefined &&
        input.shrinkers.length > 0 &&
        input.stillFails !== undefined
      ) {
        const shrunk = await minimizeCounterexample({
          counterexample: value,
          shrinkers: input.shrinkers,
          stillFails: (proposal) => input.stillFails!(candidate, proposal),
        });
        if (!shrunk.ok) return err(shrunk.error);
        value = shrunk.value;
      }
      minimized.push(value);
    }

    iterations.push({
      index,
      profile,
      candidate,
      verification: {
        ...verification,
        counterexamples: verification.counterexamples.map((item) =>
          structuredClone(item),
        ),
        evidenceRefs: [...verification.evidenceRefs],
      },
      minimizedCounterexamples: minimized.map((item) =>
        structuredClone(item),
      ),
    });

    if (verification.accepted && minimized.length === 0) {
      return ok({
        status: "success",
        candidate,
        iterations,
        counterexamples,
        evidenceRefs: [...evidenceRefs].sort(),
      });
    }

    const knownIds = new Set(counterexamples.map((item) => item.id));
    let added = 0;
    for (const item of minimized) {
      if (!knownIds.has(item.id)) {
        counterexamples.push(structuredClone(item));
        knownIds.add(item.id);
        added += 1;
      }
    }

    if (added === 0) {
      const widened = nextGrammarProfile(
        profile,
        "counterexample-stagnation",
        input.wideningPolicy,
      );
      if (!widened.ok) return err(widened.error);
      if (widened.value === profile) {
        return ok({
          status: "failure",
          reason: "grammar-exhausted",
          bestCandidate,
          iterations,
          counterexamples,
          evidenceRefs: [...evidenceRefs].sort(),
        });
      }
      profile = widened.value;
    }
  }

  return ok({
    status: "failure",
    reason: "iteration-budget",
    ...(bestCandidate === undefined ? {} : { bestCandidate }),
    iterations,
    counterexamples,
    evidenceRefs: [...evidenceRefs].sort(),
  });
};

export interface StateExpansionStrategy {
  readonly id: string;
  expand(state: SynthesisState): SynthesisState[];
}

export const deterministicStateExpansion = (
  strategy: StateExpansionStrategy,
  state: SynthesisState,
): SynthesisState[] =>
  strategy
    .expand(structuredClone(state))
    .map((item) => structuredClone(item))
    .sort(
      (a, b) =>
        a.accumulatedCost - b.accumulatedCost || a.id.localeCompare(b.id),
    );
