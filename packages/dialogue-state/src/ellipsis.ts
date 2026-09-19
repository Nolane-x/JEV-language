import {
  ok,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  DialogueAct,
  DialogueState,
  QuestionChoice,
  QuestionState,
} from "./state.ts";

export interface EllipsisReconstruction {
  literalFragment: string;
  questionId?: string;
  selectedChoiceId?: string;
  reconstructedRoots: SemanticId[];
  act: DialogueAct;
  status: "resolved" | "preserved";
  provenance: {
    literalFragment: string;
    source: "dialogue-fragment";
  };
}

const normalized = (value: string): string =>
  value
    .trim()
    .replace(/[.!?]+$/u, "")
    .normalize("NFC")
    .toLocaleLowerCase();

const choiceMatches = (
  question: QuestionState,
  fragment: string,
): QuestionChoice[] => {
  const key = normalized(fragment);
  return (question.choices ?? []).filter(
    (choice) =>
      normalized(choice.label) === key ||
      normalized(choice.id) === key,
  );
};

export const reconstructEllipsis = (
  fragment: string,
  state: DialogueState,
): Result<EllipsisReconstruction> => {
  const open = [...state.openQuestions].sort(
    (left, right) => right.introducedTurn - left.introducedTurn,
  );
  for (const question of open) {
    const matches = choiceMatches(question, fragment);
    if (matches.length === 1) {
      const selected = matches[0]!;
      return ok({
        literalFragment: fragment,
        questionId: question.id,
        selectedChoiceId: selected.id,
        reconstructedRoots: [...selected.semanticRoots],
        act: {
          kind: "ANSWER",
          contentRoots: [...selected.semanticRoots],
          targetQuestionId: question.id,
          metadata: {
            ellipsisReconstructed: true,
            choiceId: selected.id,
          },
        },
        status: "resolved",
        provenance: {
          literalFragment: fragment,
          source: "dialogue-fragment",
        },
      });
    }
  }

  const newest = open[0];
  return ok({
    literalFragment: fragment,
    ...(newest === undefined ? {} : { questionId: newest.id }),
    reconstructedRoots: [],
    act: {
      kind: "ANSWER",
      contentRoots: [],
      ...(newest === undefined
        ? {}
        : { targetQuestionId: newest.id }),
      metadata: {
        ellipsisReconstructed: false,
        ambiguityPreserved: true,
      },
    },
    status: "preserved",
    provenance: {
      literalFragment: fragment,
      source: "dialogue-fragment",
    },
  });
};

export interface FollowUpFragment {
  literalFragment: string;
  activeTopic?: string;
  referencedQuestionId?: string;
  act: DialogueAct;
}

export const reconstructFollowUpFragment = (
  fragment: string,
  state: DialogueState,
): Result<FollowUpFragment> => {
  const newestQuestion = [...state.openQuestions].sort(
    (left, right) => right.introducedTurn - left.introducedTurn,
  )[0];
  const activeTopic = state.activeTopic;
  return ok({
    literalFragment: fragment,
    ...(activeTopic === undefined ? {} : { activeTopic }),
    ...(newestQuestion === undefined
      ? {}
      : { referencedQuestionId: newestQuestion.id }),
    act: {
      kind: "CONTINUE",
      contentRoots: [],
      ...(newestQuestion === undefined
        ? {}
        : { targetQuestionId: newestQuestion.id }),
      metadata: {
        followUpFragment: true,
        literalFragment: fragment,
        ...(activeTopic === undefined ? {} : { activeTopic }),
      },
    },
  });
};
