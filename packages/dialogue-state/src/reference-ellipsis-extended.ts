import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type { ExpectedAnswerType } from "./dialogue-acts.ts";

export type ReferenceKind =
  | "name"
  | "personal-pronoun"
  | "demonstrative"
  | "definite-description"
  | "zero"
  | "bridging"
  | "cataphoric"
  | "split-antecedent"
  | "discourse-deictic"
  | "other";

export type ReferenceRelation =
  | "identity"
  | "part-of"
  | "member-of"
  | "owned-by"
  | "role-of"
  | "associated-with"
  | "discourse-link";

export interface ExtendedReferenceCandidate {
  id: string;
  referentRefs: SemanticId[];
  kind: ReferenceKind;
  relation: ReferenceRelation;
  semanticType: string;
  recencyRank: number;
  salience: number;
  topicMatch: boolean;
  semanticCompatibility: number;
  mentionOffset?: number;
  evidenceRefs?: string[];
}

export interface BridgingFact {
  source: SemanticId;
  target: SemanticId;
  relation: Exclude<ReferenceRelation, "identity">;
  evidenceRef?: string;
}

export const bridgingReferenceCandidates = (input: {
  anchor: SemanticId;
  facts: readonly BridgingFact[];
  semanticType: string;
}): ExtendedReferenceCandidate[] =>
  input.facts
    .filter((fact) => fact.source === input.anchor)
    .sort(
      (a, b) =>
        a.relation.localeCompare(b.relation) ||
        a.target.localeCompare(b.target),
    )
    .map((fact, index) => ({
      id: `bridge:${input.anchor}:${fact.relation}:${fact.target}`,
      referentRefs: [fact.target],
      kind: "bridging",
      relation: fact.relation,
      semanticType: input.semanticType,
      recencyRank: index,
      salience: 0.5,
      topicMatch: true,
      semanticCompatibility: 1,
      ...(fact.evidenceRef === undefined
        ? {}
        : { evidenceRefs: [fact.evidenceRef] }),
    }));

export const cataphoraReferenceCandidate = (input: {
  mentionId: string;
  futureReferent: SemanticId;
  semanticType: string;
  mentionOffset: number;
}): Result<ExtendedReferenceCandidate> => {
  if (
    input.mentionId.trim() === "" ||
    input.futureReferent.trim() === "" ||
    !Number.isInteger(input.mentionOffset) ||
    input.mentionOffset <= 0
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_CATAPHORA_INVALID",
        "Cataphora requires a future referent and positive mention offset.",
      ),
    );
  }
  return ok({
    id: `cataphora:${input.mentionId}:${input.futureReferent}`,
    referentRefs: [input.futureReferent],
    kind: "cataphoric",
    relation: "identity",
    semanticType: input.semanticType,
    recencyRank: Number.MAX_SAFE_INTEGER,
    salience: 0,
    topicMatch: false,
    semanticCompatibility: 1,
    mentionOffset: input.mentionOffset,
  });
};

export const constructSplitAntecedentCandidate = (input: {
  id: string;
  members: readonly SemanticId[];
  semanticType?: string;
}): Result<ExtendedReferenceCandidate> => {
  const members = [...new Set(input.members)].sort();
  if (
    input.id.trim() === "" ||
    members.length < 2 ||
    members.some((member) => member.trim() === "")
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_SPLIT_ANTECEDENT_INVALID",
        "Split antecedents require a stable id and at least two unique referents.",
      ),
    );
  }
  return ok({
    id: input.id,
    referentRefs: members,
    kind: "split-antecedent",
    relation: "identity",
    semanticType: input.semanticType ?? "group",
    recencyRank: 0,
    salience: 0.5,
    topicMatch: true,
    semanticCompatibility: 1,
  });
};

export interface ReferencePruningDecision {
  retained: ExtendedReferenceCandidate[];
  rejected: Array<{
    candidate: ExtendedReferenceCandidate;
    reason:
      | "semantic-incompatible"
      | "cataphora-not-licensed"
      | "low-salience"
      | "candidate-cap";
  }>;
}

const candidateScore = (candidate: ExtendedReferenceCandidate): number =>
  candidate.semanticCompatibility * 4 +
  Math.max(0, Math.min(1, candidate.salience)) * 2 +
  (candidate.topicMatch ? 1 : 0) -
  Math.min(candidate.recencyRank, 20) * 0.02;

export const pruneReferenceCandidates = (input: {
  candidates: readonly ExtendedReferenceCandidate[];
  allowCataphora?: boolean;
  minimumCompatibility?: number;
  minimumSalience?: number;
  maxCandidates?: number;
}): Result<ReferencePruningDecision> => {
  const minimumCompatibility = input.minimumCompatibility ?? 0.5;
  const minimumSalience = input.minimumSalience ?? 0;
  const maxCandidates = input.maxCandidates ?? 8;
  if (
    !Number.isFinite(minimumCompatibility) ||
    minimumCompatibility < 0 ||
    minimumCompatibility > 1 ||
    !Number.isFinite(minimumSalience) ||
    minimumSalience < 0 ||
    minimumSalience > 1 ||
    !Number.isInteger(maxCandidates) ||
    maxCandidates < 1
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_REFERENCE_PRUNING_CONFIG",
        "Reference pruning thresholds must be normalized and candidate cap positive.",
      ),
    );
  }

  const retained: ExtendedReferenceCandidate[] = [];
  const rejected: ReferencePruningDecision["rejected"] = [];
  const eligible: ExtendedReferenceCandidate[] = [];
  for (const candidate of input.candidates) {
    if (
      !Number.isFinite(candidate.semanticCompatibility) ||
      candidate.semanticCompatibility < minimumCompatibility
    ) {
      rejected.push({
        candidate: structuredClone(candidate),
        reason: "semantic-incompatible",
      });
      continue;
    }
    if (
      candidate.kind === "cataphoric" &&
      input.allowCataphora !== true
    ) {
      rejected.push({
        candidate: structuredClone(candidate),
        reason: "cataphora-not-licensed",
      });
      continue;
    }
    if (
      candidate.salience < minimumSalience &&
      candidate.kind !== "cataphoric"
    ) {
      rejected.push({
        candidate: structuredClone(candidate),
        reason: "low-salience",
      });
      continue;
    }
    eligible.push(structuredClone(candidate));
  }

  eligible.sort(
    (a, b) =>
      candidateScore(b) - candidateScore(a) ||
      a.recencyRank - b.recencyRank ||
      a.id.localeCompare(b.id),
  );
  retained.push(...eligible.slice(0, maxCandidates));
  for (const candidate of eligible.slice(maxCandidates)) {
    rejected.push({ candidate, reason: "candidate-cap" });
  }

  return ok({ retained, rejected });
};

export type AmbiguityPreservingReferenceResult =
  | {
      status: "resolved";
      candidates: ExtendedReferenceCandidate[];
      resolved: ExtendedReferenceCandidate;
    }
  | {
      status: "ambiguous";
      candidates: ExtendedReferenceCandidate[];
    }
  | {
      status: "unresolved";
      candidates: [];
    };

export const preserveReferenceAmbiguity = (
  candidates: readonly ExtendedReferenceCandidate[],
): AmbiguityPreservingReferenceResult => {
  if (candidates.length === 0) {
    return { status: "unresolved", candidates: [] };
  }
  if (candidates.length === 1) {
    return {
      status: "resolved",
      candidates: [structuredClone(candidates[0]!)],
      resolved: structuredClone(candidates[0]!),
    };
  }
  return {
    status: "ambiguous",
    candidates: candidates.map((candidate) => structuredClone(candidate)),
  };
};

export type EllipsisKind =
  | "fragment-answer"
  | "verb-phrase"
  | "noun-phrase"
  | "sluicing"
  | "gapping"
  | "stripping"
  | "other";

export interface EllipsisNode {
  id: string;
  kind: EllipsisKind;
  literalFragment: string;
  antecedentRefs: SemanticId[];
  reconstructedRefs: SemanticId[];
  status: "candidate" | "resolved" | "preserved";
  origin: ReconstructedOrigin;
}

export interface ReconstructedOrigin {
  kind: "reconstructed";
  sourceTurnId: string;
  sourceFragment: string;
  questionId?: string;
  method: "choice-match" | "typed-fragment" | "ellipsis-rule";
  antecedentRefs: SemanticId[];
}

export interface FragmentAnswerCandidate {
  id: string;
  literalFragment: string;
  answerRefs: SemanticId[];
  expectedAnswer: ExpectedAnswerType;
  questionId: string;
  sourceTurnId: string;
}

export const reconstructFragmentAnswer = (
  candidate: FragmentAnswerCandidate,
): Result<EllipsisNode> => {
  if (
    candidate.id.trim() === "" ||
    candidate.literalFragment.trim() === "" ||
    candidate.questionId.trim() === "" ||
    candidate.sourceTurnId.trim() === "" ||
    candidate.answerRefs.length === 0 ||
    candidate.answerRefs.some((ref) => ref.trim() === "")
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_FRAGMENT_RECONSTRUCTION_INVALID",
        "Fragment reconstruction requires source, question, literal fragment, and semantic answer refs.",
      ),
    );
  }
  return ok({
    id: candidate.id,
    kind: "fragment-answer",
    literalFragment: candidate.literalFragment,
    antecedentRefs: [],
    reconstructedRefs: [...candidate.answerRefs],
    status: "resolved",
    origin: {
      kind: "reconstructed",
      sourceTurnId: candidate.sourceTurnId,
      sourceFragment: candidate.literalFragment,
      questionId: candidate.questionId,
      method: "typed-fragment",
      antecedentRefs: [],
    },
  });
};
