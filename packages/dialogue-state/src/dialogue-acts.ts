import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";

export type ExpectedAnswerType =
  | { kind: "boolean" }
  | { kind: "entity"; semanticType?: string }
  | { kind: "quantity"; dimension?: string; unit?: string }
  | { kind: "time"; precision?: "date" | "time" | "datetime" | "duration" }
  | { kind: "location"; locationKind?: string }
  | { kind: "proposition" }
  | { kind: "text" }
  | { kind: "choice"; optionRefs: SemanticId[] };

export type QuestionSemantics =
  | {
      kind: "polar";
      propositionRef: SemanticId;
      expectedAnswer: { kind: "boolean" };
    }
  | {
      kind: "wh";
      variable: string;
      propositionRef: SemanticId;
      expectedAnswer: Exclude<ExpectedAnswerType, { kind: "boolean" }>;
    }
  | {
      kind: "alternative";
      propositionRef?: SemanticId;
      alternatives: SemanticId[];
      expectedAnswer: { kind: "choice"; optionRefs: SemanticId[] };
    }
  | {
      kind: "confirmation";
      propositionRef: SemanticId;
      expectedAnswer: { kind: "boolean" };
    };

export const validateQuestionSemantics = (
  question: QuestionSemantics,
): Result<void> => {
  if (
    "propositionRef" in question &&
    question.propositionRef !== undefined &&
    question.propositionRef.trim() === ""
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_QUESTION_PROPOSITION",
        "Question proposition references must be non-empty.",
      ),
    );
  }
  if (question.kind === "wh" && question.variable.trim() === "") {
    return err(
      new StructuredError(
        "DIALOGUE_QUESTION_VARIABLE",
        "Wh-questions require an explicit semantic variable.",
      ),
    );
  }
  if (question.kind === "alternative") {
    if (
      question.alternatives.length < 2 ||
      question.alternatives.some((ref) => ref.trim() === "") ||
      new Set(question.alternatives).size !== question.alternatives.length
    ) {
      return err(
        new StructuredError(
          "DIALOGUE_QUESTION_ALTERNATIVES",
          "Alternative questions require at least two unique semantic alternatives.",
        ),
      );
    }
    if (
      question.expectedAnswer.optionRefs.length !==
        question.alternatives.length ||
      question.expectedAnswer.optionRefs.some(
        (ref, index) => ref !== question.alternatives[index],
      )
    ) {
      return err(
        new StructuredError(
          "DIALOGUE_QUESTION_CHOICE_CONTRACT",
          "Alternative-question expected choices must preserve the declared alternative order.",
        ),
      );
    }
  }
  if (
    question.expectedAnswer.kind === "choice" &&
    (question.expectedAnswer.optionRefs.length === 0 ||
      new Set(question.expectedAnswer.optionRefs).size !==
        question.expectedAnswer.optionRefs.length)
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_EXPECTED_CHOICE",
        "Choice answers require unique explicit option references.",
      ),
    );
  }
  return ok(undefined);
};

export type AnswerLinkStatus =
  | "complete"
  | "partial"
  | "nonresponsive"
  | "rejected";

export interface AnswerToQuestionLink {
  id: string;
  questionId: string;
  answerRefs: SemanticId[];
  status: AnswerLinkStatus;
  expectedAnswer: ExpectedAnswerType;
  evidenceRefs?: string[];
}

export const validateAnswerLink = (
  link: AnswerToQuestionLink,
): Result<void> => {
  if (
    link.id.trim() === "" ||
    link.questionId.trim() === "" ||
    link.answerRefs.some((ref) => ref.trim() === "")
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_ANSWER_LINK",
        "Answer links require ids, target question, and valid semantic answer refs.",
      ),
    );
  }
  if (
    (link.status === "complete" || link.status === "partial") &&
    link.answerRefs.length === 0
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_ANSWER_LINK_EMPTY",
        "Complete or partial answers require at least one answer semantic reference.",
      ),
    );
  }
  return ok(undefined);
};

export type DirectiveActKind =
  | "request"
  | "command"
  | "suggest"
  | "advise"
  | "offer"
  | "invite"
  | "permit"
  | "prohibit"
  | "warn";

export type SemanticDialogueAct =
  | {
      kind: "question";
      question: QuestionSemantics;
      contentRoots: SemanticId[];
    }
  | {
      kind: "answer";
      link: AnswerToQuestionLink;
      contentRoots: SemanticId[];
    }
  | {
      kind: "assert";
      contentRoots: SemanticId[];
    }
  | {
      kind: "directive";
      directive: DirectiveActKind;
      contentRoots: SemanticId[];
      addressee?: string;
    }
  | {
      kind: "acknowledge" | "correct" | "retract";
      contentRoots: SemanticId[];
    };

export interface DialogueUnitSegment {
  id: string;
  start: number;
  end: number;
  actIndexes: number[];
}

export interface MultiActUtterance {
  id: string;
  source: string;
  participant: string;
  acts: SemanticDialogueAct[];
  segments: DialogueUnitSegment[];
}

export interface DialogueUnitSegmenter {
  readonly id: string;
  segment(input: {
    source: string;
    acts: readonly SemanticDialogueAct[];
  }): DialogueUnitSegment[];
}

export const validateMultiActUtterance = (
  utterance: MultiActUtterance,
): Result<void> => {
  if (
    utterance.id.trim() === "" ||
    utterance.participant.trim() === "" ||
    utterance.source.trim() === "" ||
    utterance.acts.length === 0 ||
    utterance.segments.length === 0
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_MULTI_ACT_SCHEMA",
        "Multi-act utterances require identity, participant, source, acts, and segments.",
      ),
    );
  }
  const seenActIndexes = new Set<number>();
  for (const segment of utterance.segments) {
    if (
      segment.id.trim() === "" ||
      !Number.isInteger(segment.start) ||
      !Number.isInteger(segment.end) ||
      segment.start < 0 ||
      segment.end <= segment.start ||
      segment.end > utterance.source.length ||
      segment.actIndexes.length === 0
    ) {
      return err(
        new StructuredError(
          "DIALOGUE_SEGMENT_BOUNDS",
          "Dialogue-unit segments require valid source bounds and at least one act.",
        ),
      );
    }
    for (const actIndex of segment.actIndexes) {
      if (
        !Number.isInteger(actIndex) ||
        actIndex < 0 ||
        actIndex >= utterance.acts.length
      ) {
        return err(
          new StructuredError(
            "DIALOGUE_SEGMENT_ACT",
            "Dialogue-unit segment references an invalid act index.",
          ),
        );
      }
      seenActIndexes.add(actIndex);
    }
  }
  if (seenActIndexes.size !== utterance.acts.length) {
    return err(
      new StructuredError(
        "DIALOGUE_SEGMENT_COVERAGE",
        "Every semantic dialogue act must be attached to at least one dialogue unit.",
      ),
    );
  }
  for (const act of utterance.acts) {
    if (act.kind === "question") {
      const valid = validateQuestionSemantics(act.question);
      if (!valid.ok) return valid;
    }
    if (act.kind === "answer") {
      const valid = validateAnswerLink(act.link);
      if (!valid.ok) return valid;
    }
  }
  return ok(undefined);
};

export type LedgerCommitmentStatus =
  | "active"
  | "fulfilled"
  | "retracted"
  | "superseded";

export interface ParticipantCommitment {
  id: string;
  participant: string;
  contentRefs: SemanticId[];
  status: LedgerCommitmentStatus;
  introducedTurn: number;
  resolvedTurn?: number;
  supersededBy?: string;
}

export type CommitmentTransition =
  | {
      kind: "add";
      commitment: ParticipantCommitment;
    }
  | {
      kind: "fulfill" | "retract";
      commitmentId: string;
      turn: number;
    }
  | {
      kind: "supersede";
      commitmentId: string;
      replacement: ParticipantCommitment;
      turn: number;
    };

export class ParticipantCommitmentLedger {
  readonly #active = new Map<string, ParticipantCommitment>();
  readonly #history = new Map<string, ParticipantCommitment>();

  apply(transition: CommitmentTransition): Result<void> {
    if (transition.kind === "add") {
      const commitment = transition.commitment;
      if (
        commitment.id.trim() === "" ||
        commitment.participant.trim() === "" ||
        commitment.contentRefs.length === 0 ||
        this.#active.has(commitment.id) ||
        this.#history.has(commitment.id)
      ) {
        return err(
          new StructuredError(
            "DIALOGUE_LEDGER_ADD",
            "Commitment additions require unique ids, participant, and semantic content.",
          ),
        );
      }
      this.#active.set(commitment.id, {
        ...structuredClone(commitment),
        status: "active",
      });
      return ok(undefined);
    }

    const current = this.#active.get(transition.commitmentId);
    if (current === undefined) {
      return err(
        new StructuredError(
          "DIALOGUE_LEDGER_NOT_ACTIVE",
          `Commitment is not active: ${transition.commitmentId}`,
        ),
      );
    }

    this.#active.delete(current.id);
    if (transition.kind === "supersede") {
      if (
        transition.replacement.id.trim() === "" ||
        transition.replacement.id === current.id ||
        this.#active.has(transition.replacement.id) ||
        this.#history.has(transition.replacement.id)
      ) {
        return err(
          new StructuredError(
            "DIALOGUE_LEDGER_SUPERSEDE",
            "Supersession requires a distinct unused replacement commitment id.",
          ),
        );
      }
      this.#history.set(current.id, {
        ...current,
        status: "superseded",
        resolvedTurn: transition.turn,
        supersededBy: transition.replacement.id,
      });
      this.#active.set(transition.replacement.id, {
        ...structuredClone(transition.replacement),
        status: "active",
        introducedTurn: transition.turn,
      });
      return ok(undefined);
    }

    this.#history.set(current.id, {
      ...current,
      status: transition.kind === "fulfill" ? "fulfilled" : "retracted",
      resolvedTurn: transition.turn,
    });
    return ok(undefined);
  }

  active(): ParticipantCommitment[] {
    return [...this.#active.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => structuredClone(item));
  }

  history(): ParticipantCommitment[] {
    return [...this.#history.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => structuredClone(item));
  }
}

export interface SemanticDerivation {
  id: string;
  dependsOnRefs: SemanticId[];
  producesRefs: SemanticId[];
  status: "active" | "invalidated";
  invalidatedBy?: string;
}

export interface CorrectionInvalidationInput {
  correctionId: string;
  invalidatedRefs: SemanticId[];
}

export const invalidateDependentDerivations = (
  derivations: readonly SemanticDerivation[],
  correction: CorrectionInvalidationInput,
): Result<SemanticDerivation[]> => {
  if (
    correction.correctionId.trim() === "" ||
    correction.invalidatedRefs.length === 0 ||
    correction.invalidatedRefs.some((ref) => ref.trim() === "")
  ) {
    return err(
      new StructuredError(
        "DIALOGUE_DERIVATION_INVALIDATION_INPUT",
        "Correction invalidation requires id and semantic refs.",
      ),
    );
  }

  const invalidRefs = new Set<SemanticId>(correction.invalidatedRefs);
  const output = derivations.map((item) => structuredClone(item));
  let changed = true;

  while (changed) {
    changed = false;
    for (const derivation of output) {
      if (derivation.status === "invalidated") {
        for (const ref of derivation.producesRefs) invalidRefs.add(ref);
        continue;
      }
      if (derivation.dependsOnRefs.some((ref) => invalidRefs.has(ref))) {
        derivation.status = "invalidated";
        derivation.invalidatedBy = correction.correctionId;
        for (const ref of derivation.producesRefs) invalidRefs.add(ref);
        changed = true;
      }
    }
  }
  return ok(output);
};
