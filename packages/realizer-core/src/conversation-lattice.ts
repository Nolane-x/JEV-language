import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import {
  projectResponsePlanForSurfaceRanking,
  validateResponseSemanticPlan,
  type ResponseRegister,
  type ResponseSemanticPlan,
} from "../../discourse-ir/src/index.ts";
import {
  validateConversationCandidateSet,
  type ConversationCandidateSet,
  type ConversationalCandidate,
} from "./conversation-candidates.ts";
import {
  scoreConversationStyleRepetition,
  type ConversationStyleMemory,
} from "./conversation-style-memory.ts";

export interface ConversationSurfaceDraft {
  id: string;
  surface: string;
  language: string;
  register: ResponseRegister;
  semanticPreservationVerified: boolean;
  semanticEvidenceRefs: string[];
  sourceFamily: string;
  constructionIds: string[];
  baseCost?: number;
  annotations?: Record<string, JsonValue>;
}

export type ConversationDraftRejectionReason =
  | "not-semantically-verified"
  | "language-mismatch"
  | "opaque-term-corruption"
  | "duplicate-surface"
  | "invalid-draft"
  | "budget";

export interface ConversationDraftRejection {
  id: string;
  reason: ConversationDraftRejectionReason;
  detail?: string;
}

export interface ConversationCandidateLatticeReport {
  sourceDraftCount: number;
  eligibleDraftCount: number;
  emittedCandidateCount: number;
  representedFamilies: string[];
  rejected: ConversationDraftRejection[];
}

export interface BuildConversationCandidateSetInput {
  id: string;
  plan: ResponseSemanticPlan;
  dialogueContext: JsonValue;
  drafts: readonly ConversationSurfaceDraft[];
  opaqueTerms?: readonly string[];
  maxCandidates?: number;
  styleMemory?: ConversationStyleMemory;
}

export interface BuiltConversationCandidateSet {
  set: ConversationCandidateSet;
  report: ConversationCandidateLatticeReport;
}

const nonEmpty = (value: string): boolean => value.trim().length > 0;

const normalizeSurface = (surface: string): string =>
  surface.normalize("NFC").trim().replace(/\s+/gu, " ");

const normalizeLanguage = (language: string): string =>
  language.trim().toLocaleLowerCase("en");

const baseLanguage = (language: string): string =>
  normalizeLanguage(language).split("-")[0] ?? normalizeLanguage(language);

const finiteCost = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, value);

const hasAllOpaqueTerms = (
  surface: string,
  terms: readonly string[],
): boolean => terms.every((term) => surface.includes(term));

const languageAllowed = (
  plan: ResponseSemanticPlan,
  language: string,
): boolean => {
  const target = normalizeLanguage(plan.targetLanguage);
  const candidate = normalizeLanguage(language);
  if (candidate === target) return true;
  if (!plan.allowCodeSwitch) return false;

  const targetBase = baseLanguage(target);
  const candidateParts = candidate.split("-").filter(Boolean);
  return candidateParts.includes(targetBase);
};

const registerPenalty = (
  expected: ResponseRegister,
  actual: ResponseRegister,
): number => {
  if (expected === "unknown" || actual === "unknown") return 0.2;
  if (expected === actual) return 0;

  const scale: ResponseRegister[] = [
    "intimate",
    "casual",
    "neutral",
    "professional",
    "formal",
  ];
  const left = scale.indexOf(expected);
  const right = scale.indexOf(actual);
  if (left < 0 || right < 0) return 0.5;
  return Math.abs(left - right) * 0.35;
};

const deterministicDraftCost = (
  plan: ResponseSemanticPlan,
  draft: ConversationSurfaceDraft,
  styleMemory?: ConversationStyleMemory,
): number =>
  finiteCost(draft.baseCost) +
  registerPenalty(plan.social.register, draft.register) +
  Math.max(0, draft.surface.length - 640) / 640 +
  scoreConversationStyleRepetition(styleMemory, draft).penalty;

const validateDraft = (
  draft: ConversationSurfaceDraft,
): string | undefined => {
  if (
    !nonEmpty(draft.id) ||
    !nonEmpty(draft.surface) ||
    !nonEmpty(draft.language) ||
    !nonEmpty(draft.sourceFamily) ||
    draft.semanticEvidenceRefs.length === 0 ||
    draft.semanticEvidenceRefs.some((ref) => !nonEmpty(ref)) ||
    draft.constructionIds.some((id) => !nonEmpty(id)) ||
    new Set(draft.constructionIds).size !== draft.constructionIds.length
  ) {
    return "Drafts require id, surface, language, source family, semantic evidence, and valid construction ids.";
  }
  if (
    draft.baseCost !== undefined &&
    (!Number.isFinite(draft.baseCost) || draft.baseCost < 0)
  ) {
    return "Draft baseCost must be a non-negative finite number.";
  }
  return undefined;
};

const roundRobinFamilies = (
  drafts: readonly ConversationSurfaceDraft[],
  plan: ResponseSemanticPlan,
  maxCandidates: number,
  styleMemory?: ConversationStyleMemory,
): ConversationSurfaceDraft[] => {
  const byFamily = new Map<string, ConversationSurfaceDraft[]>();
  for (const draft of drafts) {
    const bucket = byFamily.get(draft.sourceFamily) ?? [];
    bucket.push(draft);
    byFamily.set(draft.sourceFamily, bucket);
  }
  for (const bucket of byFamily.values()) {
    bucket.sort(
      (a, b) =>
        deterministicDraftCost(plan, a, styleMemory) -
          deterministicDraftCost(plan, b, styleMemory) ||
        a.id.localeCompare(b.id),
    );
  }

  const families = [...byFamily.keys()].sort();
  const selected: ConversationSurfaceDraft[] = [];
  let cursor = 0;
  while (selected.length < maxCandidates && families.length > 0) {
    const family = families[cursor % families.length];
    if (family === undefined) break;
    const bucket = byFamily.get(family);
    const next = bucket?.shift();
    if (next !== undefined) selected.push(next);

    if (bucket === undefined || bucket.length === 0) {
      const familyIndex = families.indexOf(family);
      if (familyIndex >= 0) families.splice(familyIndex, 1);
      if (families.length === 0) break;
      cursor = familyIndex % families.length;
    } else {
      cursor = (cursor + 1) % families.length;
    }
  }
  return selected;
};

export const buildConversationCandidateSet = (
  input: BuildConversationCandidateSetInput,
): Result<BuiltConversationCandidateSet> => {
  const plan = validateResponseSemanticPlan(input.plan);
  if (!plan.ok) return plan;

  const maxCandidates = input.maxCandidates ?? 16;
  if (
    !nonEmpty(input.id) ||
    !Number.isInteger(maxCandidates) ||
    maxCandidates < 2 ||
    maxCandidates > 32
  ) {
    return err(
      new StructuredError(
        "REALIZE_CONVERSATION_LATTICE_CONFIG",
        "Conversation lattice requires an id and maxCandidates in [2, 32].",
      ),
    );
  }

  const opaqueTerms = [...new Set(input.opaqueTerms ?? [])];
  if (opaqueTerms.some((term) => !nonEmpty(term))) {
    return err(
      new StructuredError(
        "REALIZE_CONVERSATION_OPAQUE_TERMS",
        "Opaque terms must be unique non-empty strings.",
      ),
    );
  }

  const rejected: ConversationDraftRejection[] = [];
  const eligible: ConversationSurfaceDraft[] = [];
  const seenSurfaces = new Set<string>();

  for (const draft of input.drafts) {
    const invalid = validateDraft(draft);
    if (invalid !== undefined) {
      rejected.push({ id: draft.id || "<empty>", reason: "invalid-draft", detail: invalid });
      continue;
    }
    if (draft.semanticPreservationVerified !== true) {
      rejected.push({ id: draft.id, reason: "not-semantically-verified" });
      continue;
    }
    if (!languageAllowed(plan.value, draft.language)) {
      rejected.push({
        id: draft.id,
        reason: "language-mismatch",
        detail: `Expected ${plan.value.targetLanguage}; observed ${draft.language}.`,
      });
      continue;
    }

    const surface = normalizeSurface(draft.surface);
    if (
      plan.value.preserveOpaqueTerms &&
      opaqueTerms.length > 0 &&
      !hasAllOpaqueTerms(surface, opaqueTerms)
    ) {
      rejected.push({
        id: draft.id,
        reason: "opaque-term-corruption",
        detail: "One or more required opaque terms are not preserved exactly.",
      });
      continue;
    }
    if (seenSurfaces.has(surface)) {
      rejected.push({ id: draft.id, reason: "duplicate-surface" });
      continue;
    }
    seenSurfaces.add(surface);
    eligible.push({ ...structuredClone(draft), surface });
  }

  if (eligible.length < 2) {
    return err(
      new StructuredError(
        "REALIZE_CONVERSATION_LATTICE_RECALL",
        "Fewer than two verified conversational surface candidates survived the lattice gates.",
        {
          sourceDraftCount: input.drafts.length,
          eligibleDraftCount: eligible.length,
          rejected: rejected.map((entry) => ({
            id: entry.id,
            reason: entry.reason,
            detail: entry.detail ?? null,
          })),
        },
      ),
    );
  }

  const emitted = roundRobinFamilies(
    eligible,
    plan.value,
    maxCandidates,
    input.styleMemory,
  );
  const emittedIds = new Set(emitted.map((draft) => draft.id));
  for (const draft of eligible) {
    if (!emittedIds.has(draft.id)) {
      rejected.push({ id: draft.id, reason: "budget" });
    }
  }

  const responseSemantics = projectResponsePlanForSurfaceRanking(plan.value);
  if (!responseSemantics.ok) return responseSemantics;

  const candidates: ConversationalCandidate[] = emitted.map((draft) => ({
    id: draft.id,
    surface: draft.surface,
    language: draft.language,
    register: draft.register,
    semanticEvidenceRefs: [...draft.semanticEvidenceRefs],
    semanticPreservationVerified: true,
    annotations: {
      sourceFamily: draft.sourceFamily,
      constructionIds: [...draft.constructionIds],
      deterministicPreRankCost: deterministicDraftCost(
        plan.value,
        draft,
        input.styleMemory,
      ),
      styleRepetitionPenalty: scoreConversationStyleRepetition(
        input.styleMemory,
        draft,
      ).penalty,
      ...(draft.annotations ?? {}),
    },
  }));

  const set: ConversationCandidateSet = {
    id: input.id,
    targetLanguage: plan.value.targetLanguage,
    dialogueContext: structuredClone(input.dialogueContext),
    responseSemantics: responseSemantics.value,
    candidates,
  };

  const validSet = validateConversationCandidateSet(set);
  if (!validSet.ok) return validSet;

  return ok({
    set: validSet.value,
    report: {
      sourceDraftCount: input.drafts.length,
      eligibleDraftCount: eligible.length,
      emittedCandidateCount: candidates.length,
      representedFamilies: [...new Set(emitted.map((draft) => draft.sourceFamily))].sort(),
      rejected: rejected.sort(
        (a, b) => a.reason.localeCompare(b.reason) || a.id.localeCompare(b.id),
      ),
    },
  });
};
