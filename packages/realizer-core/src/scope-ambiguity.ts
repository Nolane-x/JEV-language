import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  GraphSnapshot,
  ScopeConstraintNode,
  ScopeRelation,
} from "../../semantic-graph/src/index.ts";

export interface ScopeRealizationCommitment {
  left: SemanticId;
  relation: Exclude<ScopeRelation, "unknown">;
  right: SemanticId;
}

export interface ScopeAwareGenerationCandidate<T> {
  id: string;
  value: T;
  scopeCommitments?: ScopeRealizationCommitment[];
}

export interface ScopeRealizationPlan {
  strategy: "resolved" | "preserve-ambiguity";
  unresolvedConstraintIds: SemanticId[];
  unresolvedPairs: Array<{ left: SemanticId; right: SemanticId }>;
}

const scopeConstraints = (
  snapshot: GraphSnapshot,
): ScopeConstraintNode[] =>
  snapshot.nodes
    .filter(
      (node): node is ScopeConstraintNode => node.kind === "scope-constraint",
    )
    .map((node) => structuredClone(node))
    .sort((a, b) => a.id.localeCompare(b.id));

export const planScopeRealization = (
  snapshot: GraphSnapshot,
): ScopeRealizationPlan => {
  const unresolved = scopeConstraints(snapshot).filter(
    (constraint) => constraint.relation === "unknown",
  );
  return {
    strategy: unresolved.length === 0 ? "resolved" : "preserve-ambiguity",
    unresolvedConstraintIds: unresolved.map((constraint) => constraint.id),
    unresolvedPairs: unresolved.map((constraint) => ({
      left: constraint.left,
      right: constraint.right,
    })),
  };
};

const samePair = (
  constraint: ScopeConstraintNode,
  commitment: ScopeRealizationCommitment,
): boolean =>
  (constraint.left === commitment.left &&
    constraint.right === commitment.right) ||
  (constraint.left === commitment.right &&
    constraint.right === commitment.left);

export const filterScopeSafeGenerationCandidates = <T>(
  snapshot: GraphSnapshot,
  candidates: readonly ScopeAwareGenerationCandidate<T>[],
): Result<ScopeAwareGenerationCandidate<T>[]> => {
  const unresolved = scopeConstraints(snapshot).filter(
    (constraint) => constraint.relation === "unknown",
  );

  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.id.trim() === "" || ids.has(candidate.id)) {
      return err(
        new StructuredError(
          "REALIZE_SCOPE_CANDIDATE_ID",
          "Scope-aware generation candidates require unique non-empty ids.",
        ),
      );
    }
    ids.add(candidate.id);
  }

  const safe = candidates.filter((candidate) =>
    (candidate.scopeCommitments ?? []).every(
      (commitment) =>
        !unresolved.some((constraint) => samePair(constraint, commitment)),
    ),
  );

  if (safe.length === 0 && candidates.length > 0) {
    return err(
      new StructuredError(
        "REALIZE_SCOPE_AMBIGUITY_LOST",
        "Every generation candidate commits a scope relation that is still unresolved.",
        {
          unresolvedConstraintIds: unresolved.map((constraint) => constraint.id),
          rejectedCandidateIds: candidates.map((candidate) => candidate.id),
        },
      ),
    );
  }

  return ok(safe.map((candidate) => structuredClone(candidate)));
};
