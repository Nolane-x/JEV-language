import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  validateResponseSemanticPlan,
  type ResponseDialogueAct,
  type ResponseSemanticPlan,
} from "../../discourse-ir/src/index.ts";
import {
  generateEnglishConversationProposals,
  type EnglishConversationAct,
  type EnglishConversationProposal,
  type EnglishConversationFrame,
} from "../../language-en/src/index.ts";
import {
  generateVietnameseConversationProposals,
  type VietnameseConversationAct,
  type VietnameseConversationProposal,
  type VietnameseConversationFrame,
  type VietnameseConversationRelation,
} from "../../language-vi/src/index.ts";
import type {
  UnverifiedConversationSurfaceDraft,
} from "./conversation-verification.ts";

export interface ConversationLanguageRoutingOptions {
  opaqueTerms?: string[];
  enableVietnameseTopicCommentReshape?: boolean;
  enableCompactFollowup?: boolean;
}

export interface ConversationLanguageRoutingResult {
  languageFamily: "en" | "vi";
  proposals:
    | EnglishConversationProposal[]
    | VietnameseConversationProposal[];
  drafts: UnverifiedConversationSurfaceDraft[];
}

const nonEmpty = (value: string): boolean => value.trim() !== "";

const normalizeLanguage = (value: string): string =>
  value.trim().toLocaleLowerCase("en");

const dialogueActForEnglish = (
  act: ResponseDialogueAct,
): EnglishConversationAct => {
  switch (act) {
    case "answer":
    case "acknowledge":
    case "correct":
    case "clarify":
    case "ask":
    case "instruct":
    case "social":
      return act;
    case "warn":
    case "summarize":
    case "continue":
    case "refuse":
    case "other":
      return "other";
  }
};

const dialogueActForVietnamese = (
  act: ResponseDialogueAct,
): VietnameseConversationAct => {
  switch (act) {
    case "answer":
    case "acknowledge":
    case "correct":
    case "clarify":
    case "ask":
    case "instruct":
    case "social":
      return act;
    case "warn":
    case "summarize":
    case "continue":
    case "refuse":
    case "other":
      return "other";
  }
};

const vietnameseRelation = (
  relation: ResponseSemanticPlan["social"]["relation"],
): VietnameseConversationRelation => {
  switch (relation) {
    case "peer":
    case "senior":
    case "junior":
    case "teacher":
    case "customer":
    case "service":
    case "stranger":
    case "close":
    case "unknown":
      return relation;
    case "student":
      return "junior";
    case "self":
      return "unknown";
  }
};

const englishRelation = (
  relation: ResponseSemanticPlan["social"]["relation"],
): EnglishConversationFrame["relation"] => {
  switch (relation) {
    case "peer":
    case "senior":
    case "junior":
    case "customer":
    case "service":
    case "stranger":
    case "close":
    case "unknown":
      return relation;
    case "teacher":
      return "senior";
    case "student":
      return "junior";
    case "self":
      return "unknown";
  }
};

const asDraft = (
  proposal: EnglishConversationProposal | VietnameseConversationProposal,
): UnverifiedConversationSurfaceDraft => ({
  id: proposal.id,
  surface: proposal.surface,
  language: proposal.language,
  register: proposal.register,
  sourceFamily: proposal.sourceFamily,
  constructionIds: [...proposal.constructionIds],
  annotations: {
    sourceFrameId: proposal.sourceFrameId,
    ...(proposal.annotations ?? {}),
  },
});

export const routeConversationSurfaceProposals = (
  planInput: ResponseSemanticPlan,
  baseSurface: string,
  options: ConversationLanguageRoutingOptions = {},
): Result<ConversationLanguageRoutingResult> => {
  const plan = validateResponseSemanticPlan(planInput);
  if (!plan.ok) return err(plan.error);

  if (
    !nonEmpty(baseSurface) ||
    (options.opaqueTerms ?? []).some((term) => !nonEmpty(term))
  ) {
    return err(
      new StructuredError(
        "EXPRESSION_CONVERSATION_LANGUAGE_ROUTER_INPUT",
        "Conversation language routing requires a non-empty base surface and valid opaque terms.",
      ),
    );
  }

  const target = normalizeLanguage(plan.value.targetLanguage);
  const opaqueTerms = [...new Set(options.opaqueTerms ?? [])];

  if (target === "en" || target.startsWith("en-")) {
    const act = dialogueActForEnglish(plan.value.dialogueAct);
    const frame: EnglishConversationFrame = {
      id: `${plan.value.id}:en`,
      content: baseSurface,
      relation: englishRelation(plan.value.social.relation),
      register: plan.value.social.register,
      politeness: plan.value.social.politeness,
      dialogueAct: act,
      allowContractions:
        plan.value.social.register === "casual" ||
        plan.value.social.register === "neutral" ||
        plan.value.social.register === "professional",
      allowDiscourseMarker:
        act === "correct" ||
        act === "acknowledge" ||
        act === "social",
      allowCompactFollowup:
        options.enableCompactFollowup === true &&
        (plan.value.desiredLength === "minimal" ||
          plan.value.desiredLength === "concise"),
      allowCalibratedHedge:
        plan.value.epistemic.status === "uncertain",
      epistemicStatus: plan.value.epistemic.status,
      preserveTerms: opaqueTerms,
      annotations: {
        responsePlanId: plan.value.id,
      },
    };

    const proposals = generateEnglishConversationProposals(frame);
    if (!proposals.ok) return err(proposals.error);
    return ok({
      languageFamily: "en",
      proposals: proposals.value,
      drafts: proposals.value.map(asDraft),
    });
  }

  if (
    target === "vi" ||
    target.startsWith("vi-")
  ) {
    const act = dialogueActForVietnamese(plan.value.dialogueAct);
    const relation = vietnameseRelation(plan.value.social.relation);
    const casual =
      plan.value.social.register === "casual" ||
      plan.value.social.register === "intimate";
    const language: "vi" | "vi-en" =
      target === "vi-en" && plan.value.allowCodeSwitch ? "vi-en" : "vi";

    const frame: VietnameseConversationFrame = {
      id: `${plan.value.id}:vi`,
      content: baseSurface,
      language,
      relation,
      register: plan.value.social.register,
      politeness: plan.value.social.politeness,
      dialogueAct: act,
      ...(plan.value.social.speakerFormHint === undefined
        ? {}
        : { speakerFormHint: plan.value.social.speakerFormHint }),
      ...(plan.value.social.addresseeFormHint === undefined
        ? {}
        : { addresseeFormHint: plan.value.social.addresseeFormHint }),
      allowSpeakerEllipsis:
        casual && (relation === "peer" || relation === "close"),
      allowDiscourseMarker:
        act === "correct" ||
        act === "acknowledge" ||
        act === "social",
      allowSentenceFinalParticle:
        act === "answer" ||
        act === "acknowledge" ||
        act === "correct" ||
        act === "instruct",
      allowTopicCommentReshape:
        options.enableVietnameseTopicCommentReshape === true,
      preserveTerms: opaqueTerms,
      annotations: {
        responsePlanId: plan.value.id,
      },
    };

    const proposals = generateVietnameseConversationProposals(frame);
    if (!proposals.ok) return err(proposals.error);
    return ok({
      languageFamily: "vi",
      proposals: proposals.value,
      drafts: proposals.value.map(asDraft),
    });
  }

  return err(
    new StructuredError(
      "EXPRESSION_CONVERSATION_LANGUAGE_UNSUPPORTED",
      `No native conversational surface router is implemented for target language ${plan.value.targetLanguage}.`,
    ),
  );
};
