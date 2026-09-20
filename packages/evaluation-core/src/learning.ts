import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";

export type LearningProposalStatus =
  | "proposed"
  | "evaluated"
  | "rejected"
  | "approved"
  | "promoted"
  | "rolled-back";

export interface LearningProposalTransition {
  from: LearningProposalStatus;
  to: LearningProposalStatus;
  evidenceRefs: string[];
  rationale: string;
}

export interface LearningProposal {
  schemaVersion: "jl-learning-proposal-1";
  id: string;
  target: string;
  change: JsonValue;
  status: LearningProposalStatus;
  evidenceRefs: string[];
  evaluationRefs: string[];
  history: LearningProposalTransition[];
}

const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.every((value) => value.trim() !== "") &&
  new Set(values).size === values.length;

const allowedTransitions: Readonly<
  Record<LearningProposalStatus, readonly LearningProposalStatus[]>
> = {
  proposed: ["evaluated", "rejected"],
  evaluated: ["approved", "rejected"],
  rejected: [],
  approved: ["promoted", "rejected"],
  promoted: ["rolled-back"],
  "rolled-back": [],
};

export const validateLearningProposal = (
  proposal: LearningProposal,
): Result<LearningProposal> => {
  if (
    proposal.schemaVersion !== "jl-learning-proposal-1" ||
    proposal.id.trim() === "" ||
    proposal.target.trim() === "" ||
    ![
      "proposed",
      "evaluated",
      "rejected",
      "approved",
      "promoted",
      "rolled-back",
    ].includes(proposal.status) ||
    !uniqueNonEmpty(proposal.evidenceRefs) ||
    !uniqueNonEmpty(proposal.evaluationRefs)
  ) {
    return err(
      new StructuredError(
        "EVAL_LEARNING_PROPOSAL_SCHEMA",
        "Learning proposal has invalid identity, status, or evidence lists.",
      ),
    );
  }

  let expected: LearningProposalStatus = "proposed";
  for (const transition of proposal.history) {
    if (
      transition.from !== expected ||
      !allowedTransitions[transition.from].includes(transition.to) ||
      transition.rationale.trim() === "" ||
      transition.evidenceRefs.length === 0 ||
      !uniqueNonEmpty(transition.evidenceRefs)
    ) {
      return err(
        new StructuredError(
          "EVAL_LEARNING_PROPOSAL_HISTORY",
          "Learning proposal history contains an invalid or unevidenced transition.",
        ),
      );
    }
    expected = transition.to;
  }
  if (expected !== proposal.status) {
    return err(
      new StructuredError(
        "EVAL_LEARNING_PROPOSAL_STATUS",
        "Learning proposal status does not match its transition history.",
      ),
    );
  }
  if (
    (proposal.status === "evaluated" ||
      proposal.status === "approved" ||
      proposal.status === "promoted" ||
      proposal.status === "rolled-back") &&
    proposal.evaluationRefs.length === 0
  ) {
    return err(
      new StructuredError(
        "EVAL_LEARNING_PROPOSAL_EVALUATION",
        "Evaluated/promotable proposals require evaluation evidence.",
      ),
    );
  }
  return ok(structuredClone(proposal));
};

export const transitionLearningProposal = (
  proposal: LearningProposal,
  input: {
    to: LearningProposalStatus;
    evidenceRefs: string[];
    rationale: string;
    evaluationRefs?: string[];
  },
): Result<LearningProposal> => {
  const valid = validateLearningProposal(proposal);
  if (!valid.ok) return err(valid.error);
  if (!allowedTransitions[proposal.status].includes(input.to)) {
    return err(
      new StructuredError(
        "EVAL_LEARNING_TRANSITION",
        `Transition ${proposal.status} -> ${input.to} is not allowed.`,
      ),
    );
  }
  if (
    input.evidenceRefs.length === 0 ||
    !uniqueNonEmpty(input.evidenceRefs) ||
    input.rationale.trim() === ""
  ) {
    return err(
      new StructuredError(
        "EVAL_LEARNING_TRANSITION_EVIDENCE",
        "Learning transitions require rationale and non-empty evidence.",
      ),
    );
  }

  const next: LearningProposal = {
    ...structuredClone(proposal),
    status: input.to,
    evidenceRefs: [
      ...new Set([...proposal.evidenceRefs, ...input.evidenceRefs]),
    ].sort(),
    evaluationRefs: [
      ...new Set([
        ...proposal.evaluationRefs,
        ...(input.evaluationRefs ?? []),
      ]),
    ].sort(),
    history: [
      ...structuredClone(proposal.history),
      {
        from: proposal.status,
        to: input.to,
        evidenceRefs: [...input.evidenceRefs],
        rationale: input.rationale,
      },
    ],
  };

  if (
    (input.to === "approved" || input.to === "promoted") &&
    next.evaluationRefs.length === 0
  ) {
    return err(
      new StructuredError(
        "EVAL_LEARNING_PROMOTION_WITHOUT_EVALUATION",
        "Approval/promotion is forbidden without evaluation evidence.",
      ),
    );
  }
  return validateLearningProposal(next);
};
