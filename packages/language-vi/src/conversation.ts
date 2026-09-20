import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  ConversationSurfaceDraft,
} from "../../realizer-core/src/index.ts";

export type VietnameseConversationRelation =
  | "peer"
  | "teacher"
  | "senior"
  | "junior"
  | "close"
  | "customer"
  | "service"
  | "stranger"
  | "unknown";

export type VietnameseConversationAct =
  | "answer"
  | "acknowledge"
  | "correct"
  | "clarify"
  | "ask"
  | "instruct"
  | "social"
  | "other";

export interface VietnameseConversationFrame {
  id: string;
  content: string;
  language?: "vi" | "vi-en";
  relation: VietnameseConversationRelation;
  register: "intimate" | "casual" | "neutral" | "professional" | "formal" | "unknown";
  politeness: number;
  dialogueAct: VietnameseConversationAct;
  speakerFormHint?: string;
  addresseeFormHint?: string;
  allowSpeakerEllipsis?: boolean;
  allowDiscourseMarker?: boolean;
  allowSentenceFinalParticle?: boolean;
  allowTopicCommentReshape?: boolean;
  preserveTerms?: string[];
  annotations?: Record<string, JsonValue>;
}

export interface VietnameseConversationProposal {
  id: string;
  surface: string;
  language: "vi" | "vi-en";
  register: VietnameseConversationFrame["register"];
  sourceFamily:
    | "direct"
    | "speaker-ellipsis"
    | "respectful-ack"
    | "casual-ack"
    | "respectful-particle"
    | "peer-softener"
    | "topic-comment";
  constructionIds: string[];
  sourceFrameId: string;
  preserveTerms: string[];
  annotations?: Record<string, JsonValue>;
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;
const probability = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

const normalize = (surface: string): string =>
  surface
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\s+([.,!?;:])/gu, "$1");

const preserveExactTerms = (
  surface: string,
  terms: readonly string[],
): boolean => terms.every((term) => surface.includes(term));

const capitalizeInitial = (value: string): string =>
  value.length === 0
    ? value
    : value.charAt(0).toLocaleUpperCase("vi") + value.slice(1);

const replaceSocialPlaceholder = (
  surface: string,
  placeholder: "{{speaker}}" | "{{addressee}}",
  value: string,
): string => {
  const escaped = placeholder.replace(/[{}]/gu, "\\$&");
  const sentenceStart = new RegExp(`(^|[.!?]\\s+)${escaped}`, "gu");
  return surface
    .replace(
      sentenceStart,
      (_match, prefix: string) => `${prefix}${capitalizeInitial(value)}`,
    )
    .replaceAll(placeholder, value);
};

const replacePlaceholders = (
  frame: VietnameseConversationFrame,
): Result<string> => {
  let surface = frame.content;

  if (surface.includes("{{speaker}}")) {
    if (!nonEmpty(frame.speakerFormHint ?? "")) {
      return err(
        new StructuredError(
          "LANG_VI_CONVERSATION_SPEAKER_HINT_REQUIRED",
          "Vietnamese conversation templates using {{speaker}} require an explicit speaker form; the microgrammar does not guess social pronouns.",
        ),
      );
    }
    surface = replaceSocialPlaceholder(
      surface,
      "{{speaker}}",
      frame.speakerFormHint!.trim(),
    );
  }

  if (surface.includes("{{addressee}}")) {
    if (!nonEmpty(frame.addresseeFormHint ?? "")) {
      return err(
        new StructuredError(
          "LANG_VI_CONVERSATION_ADDRESSEE_HINT_REQUIRED",
          "Vietnamese conversation templates using {{addressee}} require an explicit addressee form; the microgrammar does not guess gendered or relational pronouns.",
        ),
      );
    }
    surface = replaceSocialPlaceholder(
      surface,
      "{{addressee}}",
      frame.addresseeFormHint!.trim(),
    );
  }

  return ok(normalize(surface));
};

const withPrefix = (prefix: string, surface: string): string =>
  normalize(
    `${prefix}, ${surface.charAt(0).toLocaleLowerCase("vi")}${surface.slice(1)}`,
  );

const stripTerminal = (surface: string): {
  body: string;
  terminal: string;
} => {
  const match = surface.match(/([.!?])$/u);
  if (match === null) return { body: surface, terminal: "." };
  return {
    body: surface.slice(0, -1).trimEnd(),
    terminal: match[1] ?? ".",
  };
};

const withFinalParticle = (
  surface: string,
  particle: "ạ" | "nhé",
): string => {
  const { body, terminal } = stripTerminal(surface);
  if (new RegExp(`(?:^|\\s)${particle}import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  ConversationSurfaceDraft,
} from "../../realizer-core/src/index.ts";

export type VietnameseConversationRelation =
  | "peer"
  | "teacher"
  | "senior"
  | "junior"
  | "close"
  | "customer"
  | "service"
  | "stranger"
  | "unknown";

export type VietnameseConversationAct =
  | "answer"
  | "acknowledge"
  | "correct"
  | "clarify"
  | "ask"
  | "instruct"
  | "social"
  | "other";

export interface VietnameseConversationFrame {
  id: string;
  content: string;
  language?: "vi" | "vi-en";
  relation: VietnameseConversationRelation;
  register: "intimate" | "casual" | "neutral" | "professional" | "formal" | "unknown";
  politeness: number;
  dialogueAct: VietnameseConversationAct;
  speakerFormHint?: string;
  addresseeFormHint?: string;
  allowSpeakerEllipsis?: boolean;
  allowDiscourseMarker?: boolean;
  allowSentenceFinalParticle?: boolean;
  allowTopicCommentReshape?: boolean;
  preserveTerms?: string[];
  annotations?: Record<string, JsonValue>;
}

export interface VietnameseConversationProposal {
  id: string;
  surface: string;
  language: "vi" | "vi-en";
  register: VietnameseConversationFrame["register"];
  sourceFamily:
    | "direct"
    | "speaker-ellipsis"
    | "respectful-ack"
    | "casual-ack"
    | "respectful-particle"
    | "peer-softener"
    | "topic-comment";
  constructionIds: string[];
  sourceFrameId: string;
  preserveTerms: string[];
  annotations?: Record<string, JsonValue>;
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;
const probability = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

const normalize = (surface: string): string =>
  surface
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\s+([.,!?;:])/gu, "$1");

const preserveExactTerms = (
  surface: string,
  terms: readonly string[],
): boolean => terms.every((term) => surface.includes(term));

const capitalizeInitial = (value: string): string =>
  value.length === 0
    ? value
    : value.charAt(0).toLocaleUpperCase("vi") + value.slice(1);

const replaceSocialPlaceholder = (
  surface: string,
  placeholder: "{{speaker}}" | "{{addressee}}",
  value: string,
): string => {
  const escaped = placeholder.replace(/[{}]/gu, "\\$&");
  const sentenceStart = new RegExp(`(^|[.!?]\\s+)${escaped}`, "gu");
  return surface
    .replace(
      sentenceStart,
      (_match, prefix: string) => `${prefix}${capitalizeInitial(value)}`,
    )
    .replaceAll(placeholder, value);
};

const replacePlaceholders = (
  frame: VietnameseConversationFrame,
): Result<string> => {
  let surface = frame.content;

  if (surface.includes("{{speaker}}")) {
    if (!nonEmpty(frame.speakerFormHint ?? "")) {
      return err(
        new StructuredError(
          "LANG_VI_CONVERSATION_SPEAKER_HINT_REQUIRED",
          "Vietnamese conversation templates using {{speaker}} require an explicit speaker form; the microgrammar does not guess social pronouns.",
        ),
      );
    }
    surface = replaceSocialPlaceholder(
      surface,
      "{{speaker}}",
      frame.speakerFormHint!.trim(),
    );
  }

  if (surface.includes("{{addressee}}")) {
    if (!nonEmpty(frame.addresseeFormHint ?? "")) {
      return err(
        new StructuredError(
          "LANG_VI_CONVERSATION_ADDRESSEE_HINT_REQUIRED",
          "Vietnamese conversation templates using {{addressee}} require an explicit addressee form; the microgrammar does not guess gendered or relational pronouns.",
        ),
      );
    }
    surface = replaceSocialPlaceholder(
      surface,
      "{{addressee}}",
      frame.addresseeFormHint!.trim(),
    );
  }

  return ok(normalize(surface));
};

const withPrefix = (prefix: string, surface: string): string =>
  normalize(
    `${prefix}, ${surface.charAt(0).toLocaleLowerCase("vi")}${surface.slice(1)}`,
  );

const stripTerminal = (surface: string): {
  body: string;
  terminal: string;
} => {
  const match = surface.match(/([.!?])$/u);
  if (match === null) return { body: surface, terminal: "." };
  return {
    body: surface.slice(0, -1).trimEnd(),
    terminal: match[1] ?? ".",
  };
};

, "u").test(body)) return surface;
  return normalize(`${body} ${particle}${terminal}`);
};

const topicCommentReshape = (surface: string): string | undefined => {
  const match = surface.match(
    /^(Mình|Tôi|Em|Anh|Chị) chưa (kiểm tra|xem|thử) phần (.+?)([.!?])$/u,
  );
  if (match === null) return undefined;

  const speaker = match[1];
  const verb = match[2];
  const topic = match[3]?.trim();
  const terminal = match[4] ?? ".";
  if (!speaker || !verb || !topic) return undefined;

  return normalize(
    `Còn phần ${topic} thì ${speaker.toLocaleLowerCase("vi")} chưa ${verb}${terminal}`,
  );
};

const respectfulRelation = (
  relation: VietnameseConversationRelation,
): boolean =>
  relation === "teacher" ||
  relation === "senior" ||
  relation === "customer" ||
  relation === "stranger";

const casualRelation = (
  relation: VietnameseConversationRelation,
): boolean => relation === "peer" || relation === "close";

const proposal = (
  frame: VietnameseConversationFrame,
  id: string,
  surface: string,
  family: VietnameseConversationProposal["sourceFamily"],
  constructionIds: string[],
): VietnameseConversationProposal => ({
  id,
  surface: normalize(surface),
  language: frame.language ?? "vi",
  register: frame.register,
  sourceFamily: family,
  constructionIds,
  sourceFrameId: frame.id,
  preserveTerms: [...new Set(frame.preserveTerms ?? [])],
  ...(frame.annotations === undefined
    ? {}
    : { annotations: structuredClone(frame.annotations) }),
});

export const generateVietnameseConversationProposals = (
  frame: VietnameseConversationFrame,
): Result<VietnameseConversationProposal[]> => {
  if (
    !nonEmpty(frame.id) ||
    !nonEmpty(frame.content) ||
    !probability(frame.politeness) ||
    (frame.preserveTerms ?? []).some((term) => !nonEmpty(term))
  ) {
    return err(
      new StructuredError(
        "LANG_VI_CONVERSATION_FRAME",
        "Vietnamese conversation frames require id/content, politeness in [0,1], and valid preserved terms.",
      ),
    );
  }

  const resolved = replacePlaceholders(frame);
  if (!resolved.ok) return resolved;
  const base = resolved.value;
  const terms = [...new Set(frame.preserveTerms ?? [])];
  if (!preserveExactTerms(base, terms)) {
    return err(
      new StructuredError(
        "LANG_VI_CONVERSATION_OPAQUE_TERM",
        "The base Vietnamese conversation surface already corrupts a required preserved term.",
      ),
    );
  }

  const output: VietnameseConversationProposal[] = [
    proposal(
      frame,
      `${frame.id}:direct`,
      base,
      "direct",
      ["construction:vi:conversation:direct"],
    ),
  ];

  const speaker = frame.speakerFormHint?.trim();
  if (
    frame.allowSpeakerEllipsis === true &&
    nonEmpty(speaker ?? "") &&
    base.toLocaleLowerCase("vi").startsWith(
      `${speaker!.toLocaleLowerCase("vi")} `,
    ) &&
    !["ask", "clarify"].includes(frame.dialogueAct)
  ) {
    const withoutSpeaker = normalize(base.slice(speaker!.length + 1));
    if (preserveExactTerms(withoutSpeaker, terms)) {
      output.push(
        proposal(
          frame,
          `${frame.id}:speaker-ellipsis`,
          withoutSpeaker,
          "speaker-ellipsis",
          ["construction:vi:conversation:speaker-ellipsis"],
        ),
      );
    }
  }

  if (
    frame.allowDiscourseMarker === true &&
    respectfulRelation(frame.relation) &&
    frame.politeness >= 0.7 &&
    ["answer", "acknowledge", "correct"].includes(frame.dialogueAct) &&
    !/^dạ\b/iu.test(base)
  ) {
    output.push(
      proposal(
        frame,
        `${frame.id}:respectful-ack`,
        withPrefix("Dạ", base),
        "respectful-ack",
        ["construction:vi:conversation:dạ-ack"],
      ),
    );
  }

  if (
    frame.allowDiscourseMarker === true &&
    casualRelation(frame.relation) &&
    (frame.register === "casual" || frame.register === "intimate") &&
    ["answer", "acknowledge", "correct", "social"].includes(frame.dialogueAct) &&
    !/^(?:ừ|ờ)\b/iu.test(base)
  ) {
    output.push(
      proposal(
        frame,
        `${frame.id}:casual-ack`,
        withPrefix("Ừ", base),
        "casual-ack",
        ["construction:vi:conversation:ừ-ack"],
      ),
    );
  }

  if (
    frame.allowSentenceFinalParticle === true &&
    respectfulRelation(frame.relation) &&
    frame.politeness >= 0.75 &&
    ["answer", "acknowledge", "correct"].includes(frame.dialogueAct)
  ) {
    output.push(
      proposal(
        frame,
        `${frame.id}:respectful-particle`,
        withFinalParticle(base, "ạ"),
        "respectful-particle",
        ["construction:vi:conversation:ạ-final"],
      ),
    );
  }

  if (
    frame.allowSentenceFinalParticle === true &&
    casualRelation(frame.relation) &&
    (frame.register === "casual" || frame.register === "intimate") &&
    ["answer", "acknowledge", "instruct"].includes(frame.dialogueAct)
  ) {
    output.push(
      proposal(
        frame,
        `${frame.id}:peer-softener`,
        withFinalParticle(base, "nhé"),
        "peer-softener",
        ["construction:vi:conversation:nhé-final"],
      ),
    );
  }

  if (
    frame.allowTopicCommentReshape === true &&
    ["answer", "clarify"].includes(frame.dialogueAct)
  ) {
    const reshaped = topicCommentReshape(base);
    if (
      reshaped !== undefined &&
      reshaped !== base &&
      preserveExactTerms(reshaped, terms)
    ) {
      output.push(
        proposal(
          frame,
          `${frame.id}:topic-comment`,
          reshaped,
          "topic-comment",
          ["construction:vi:conversation:topic-comment"],
        ),
      );
    }
  }

  const deduplicated = [
    ...new Map(
      output
        .filter((item) => preserveExactTerms(item.surface, terms))
        .map((item) => [item.surface, item] as const),
    ).values(),
  ];

  return ok(deduplicated);
};

export const promoteVietnameseConversationProposal = (
  proposalValue: VietnameseConversationProposal,
  semanticEvidenceRefs: readonly string[],
): Result<ConversationSurfaceDraft> => {
  if (
    semanticEvidenceRefs.length === 0 ||
    semanticEvidenceRefs.some((ref) => !nonEmpty(ref)) ||
    !preserveExactTerms(proposalValue.surface, proposalValue.preserveTerms)
  ) {
    return err(
      new StructuredError(
        "LANG_VI_CONVERSATION_PROMOTION",
        "A Vietnamese conversation proposal can become a ranking draft only after semantic verification evidence exists and preserved terms remain exact.",
      ),
    );
  }

  return ok({
    id: proposalValue.id,
    surface: proposalValue.surface,
    language: proposalValue.language,
    register: proposalValue.register,
    semanticPreservationVerified: true,
    semanticEvidenceRefs: [...new Set(semanticEvidenceRefs)],
    sourceFamily: proposalValue.sourceFamily,
    constructionIds: [...proposalValue.constructionIds],
    annotations: {
      sourceFrameId: proposalValue.sourceFrameId,
      ...(proposalValue.annotations ?? {}),
    },
  });
};
