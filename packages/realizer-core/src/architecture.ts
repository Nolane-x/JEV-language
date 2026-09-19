import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";

export interface RealizationCandidate {
  id: string;
  surface: string;
  semanticRefs: SemanticId[];
  annotations?: Record<string, string | number | boolean>;
}

export interface RealizationCandidateLattice {
  candidates: RealizationCandidate[];
  alternativesBySemanticRef: Record<string, string[]>;
}

export const validateRealizationCandidateLattice = (
  lattice: RealizationCandidateLattice,
): Result<void> => {
  const ids = new Set<string>();
  for (const candidate of lattice.candidates) {
    if (
      candidate.id.trim() === "" ||
      ids.has(candidate.id) ||
      candidate.surface.length === 0 ||
      candidate.semanticRefs.length === 0 ||
      candidate.semanticRefs.some((ref) => ref.trim() === "")
    ) {
      return err(
        new StructuredError(
          "REALIZER_LATTICE_CANDIDATE",
          "Realization candidates require unique ids, non-empty surfaces, and semantic refs.",
        ),
      );
    }
    ids.add(candidate.id);
  }
  for (const [semanticRef, candidateIds] of Object.entries(
    lattice.alternativesBySemanticRef,
  )) {
    if (
      semanticRef.trim() === "" ||
      candidateIds.length === 0 ||
      candidateIds.some((id) => !ids.has(id))
    ) {
      return err(
        new StructuredError(
          "REALIZER_LATTICE_INDEX",
          "Realization lattice indexes must reference existing candidates.",
        ),
      );
    }
  }
  return ok(undefined);
};

export interface RealizationHardConstraint {
  id: string;
  description: string;
  check(candidate: RealizationCandidate): boolean;
}

export interface RealizationSoftObjective {
  id: string;
  description: string;
  weight: number;
  score(candidate: RealizationCandidate): number;
}

export interface EvaluatedRealizationCandidate {
  candidate: RealizationCandidate;
  hardFailures: string[];
  softComponents: Array<{
    objectiveId: string;
    score: number;
    weight: number;
  }>;
  softTotal: number;
}

export const evaluateRealizationCandidates = (input: {
  candidates: readonly RealizationCandidate[];
  hardConstraints: readonly RealizationHardConstraint[];
  softObjectives: readonly RealizationSoftObjective[];
}): Result<EvaluatedRealizationCandidate[]> => {
  const output: EvaluatedRealizationCandidate[] = [];
  for (const candidate of input.candidates) {
    const hardFailures = input.hardConstraints
      .filter((constraint) => !constraint.check(candidate))
      .map((constraint) => constraint.id)
      .sort();
    const softComponents = input.softObjectives.map((objective) => {
      const score = objective.score(candidate);
      if (!Number.isFinite(score) || !Number.isFinite(objective.weight)) {
        throw new StructuredError(
          "REALIZER_SOFT_OBJECTIVE_SCORE",
          `Soft realization objective ${objective.id} returned a non-finite score/weight.`,
        );
      }
      return {
        objectiveId: objective.id,
        score,
        weight: objective.weight,
      };
    });
    output.push({
      candidate: structuredClone(candidate),
      hardFailures,
      softComponents,
      softTotal: softComponents.reduce(
        (sum, component) => sum + component.score * component.weight,
        0,
      ),
    });
  }
  return ok(
    output.sort(
      (a, b) =>
        a.hardFailures.length - b.hardFailures.length ||
        b.softTotal - a.softTotal ||
        a.candidate.id.localeCompare(b.candidate.id),
    ),
  );
};

export interface ReferenceAmbiguitySimulation {
  expression: string;
  intendedRef: SemanticId;
  compatibleRefs: SemanticId[];
  ambiguous: boolean;
}

export const simulateReferenceAmbiguity = (input: {
  expression: string;
  intendedRef: SemanticId;
  candidateRefs: readonly SemanticId[];
  compatible: (ref: SemanticId) => boolean;
}): Result<ReferenceAmbiguitySimulation> => {
  if (input.expression.trim() === "" || input.intendedRef.trim() === "") {
    return err(
      new StructuredError(
        "REALIZER_REFERENCE_SIMULATION_INPUT",
        "Reference ambiguity simulation requires expression and intended referent.",
      ),
    );
  }
  const compatibleRefs = [...new Set(input.candidateRefs)]
    .filter(input.compatible)
    .sort();
  if (!compatibleRefs.includes(input.intendedRef)) {
    return err(
      new StructuredError(
        "REALIZER_REFERENCE_TARGET_MISSING",
        "Intended referent must remain compatible with the generated expression.",
      ),
    );
  }
  return ok({
    expression: input.expression,
    intendedRef: input.intendedRef,
    compatibleRefs,
    ambiguous: compatibleRefs.length > 1,
  });
};

export interface AggregationUnit {
  id: string;
  semanticRefs: SemanticId[];
  subjectRef?: SemanticId;
  polarity?: "positive" | "negative";
  tense?: string;
}

export interface AggregationGroup {
  id: string;
  memberIds: string[];
  reversible: true;
  reason: string;
}

export interface AggregationPlan {
  groups: AggregationGroup[];
  ungroupedIds: string[];
}

const compatibleForAggregation = (
  left: AggregationUnit,
  right: AggregationUnit,
): boolean =>
  left.subjectRef !== undefined &&
  left.subjectRef === right.subjectRef &&
  (left.polarity ?? "positive") === (right.polarity ?? "positive") &&
  (left.tense ?? "") === (right.tense ?? "");

export const planAggregation = (
  units: readonly AggregationUnit[],
): Result<AggregationPlan> => {
  const ids = new Set<string>();
  if (
    units.some(
      (unit) =>
        unit.id.trim() === "" ||
        ids.has(unit.id) ||
        (ids.add(unit.id), false) ||
        unit.semanticRefs.length === 0,
    )
  ) {
    return err(
      new StructuredError(
        "REALIZER_AGGREGATION_UNIT",
        "Aggregation units require unique ids and semantic refs.",
      ),
    );
  }

  const remaining = [...units].map((unit) => structuredClone(unit));
  const groups: AggregationGroup[] = [];
  const ungroupedIds: string[] = [];
  while (remaining.length > 0) {
    const first = remaining.shift()!;
    const matches = remaining.filter((candidate) =>
      compatibleForAggregation(first, candidate),
    );
    if (matches.length === 0) {
      ungroupedIds.push(first.id);
      continue;
    }
    const members = [first, ...matches];
    for (const match of matches) {
      const index = remaining.findIndex((item) => item.id === match.id);
      if (index >= 0) remaining.splice(index, 1);
    }
    groups.push({
      id: `aggregation:${members.map((item) => item.id).sort().join("+")}`,
      memberIds: members.map((item) => item.id).sort(),
      reversible: true,
      reason: "shared subject, polarity, and tense",
    });
  }
  return ok({ groups, ungroupedIds: ungroupedIds.sort() });
};

export const deaggregateFallback = (
  group: AggregationGroup,
): string[] => [...group.memberIds];

const stableHash = (value: string): number => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export interface RealizationReplayRecord {
  seed: string;
  candidateIds: string[];
  selectedId: string;
}

export const deterministicRealizationOrder = (
  candidates: readonly RealizationCandidate[],
  seed: string,
): Result<RealizationCandidate[]> => {
  if (seed.trim() === "") {
    return err(
      new StructuredError(
        "REALIZER_REPLAY_SEED",
        "Deterministic realization ordering requires a non-empty seed.",
      ),
    );
  }
  return ok(
    candidates
      .map((candidate) => structuredClone(candidate))
      .sort(
        (a, b) =>
          stableHash(`${seed}\u0000${a.id}`) -
            stableHash(`${seed}\u0000${b.id}`) ||
          a.id.localeCompare(b.id),
      ),
  );
};

export const createRealizationReplay = (
  candidates: readonly RealizationCandidate[],
  seed: string,
): Result<RealizationReplayRecord> => {
  const ordered = deterministicRealizationOrder(candidates, seed);
  if (!ordered.ok) return ordered;
  const selected = ordered.value[0];
  if (selected === undefined) {
    return err(
      new StructuredError(
        "REALIZER_REPLAY_EMPTY",
        "Cannot create realization replay from an empty candidate set.",
      ),
    );
  }
  return ok({
    seed,
    candidateIds: candidates.map((candidate) => candidate.id).sort(),
    selectedId: selected.id,
  });
};

export const replayRealization = (
  candidates: readonly RealizationCandidate[],
  record: RealizationReplayRecord,
): Result<string> => {
  const ids = candidates.map((candidate) => candidate.id).sort();
  if (JSON.stringify(ids) !== JSON.stringify(record.candidateIds)) {
    return err(
      new StructuredError(
        "REALIZER_REPLAY_CANDIDATE_DRIFT",
        "Replay candidate set differs from the recorded candidate set.",
      ),
    );
  }
  const replay = createRealizationReplay(candidates, record.seed);
  if (!replay.ok) return replay;
  if (replay.value.selectedId !== record.selectedId) {
    return err(
      new StructuredError(
        "REALIZER_REPLAY_SELECTION_DRIFT",
        "Deterministic replay selected a different candidate.",
      ),
    );
  }
  return ok(record.selectedId);
};
