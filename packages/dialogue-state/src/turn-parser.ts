import {
  type JsonValue,
} from "../../core-types/src/index.ts";
import type {
  DialogueAct,
  DialogueActKind,
  DialogueState,
} from "./state.ts";

export interface ParsedDialogueTurnIntent {
  surface: string;
  normalized: string;
  acts: DialogueAct[];
  fragment: boolean;
}

const words = (value: string): string[] =>
  value
    .trim()
    .split(/\s+/u)
    .filter((entry) => entry.length > 0);

const act = (
  kind: DialogueActKind,
  surface: string,
  metadata: Record<string, JsonValue> = {},
): DialogueAct => ({
  kind,
  contentRoots: [],
  metadata: {
    surface,
    ...metadata,
  },
});

export const parseDialogueTurnIntent = (
  surface: string,
  state?: DialogueState,
): ParsedDialogueTurnIntent => {
  const normalized = surface.trim().normalize("NFC");
  const lower = normalized.toLocaleLowerCase();
  const tokenCount = words(normalized).length;
  const fragment = tokenCount > 0 && tokenCount <= 4;

  if (/^(correction|actually|rather)\s*:/iu.test(normalized)) {
    return {
      surface,
      normalized,
      fragment: false,
      acts: [act("CORRECT", normalized)],
    };
  }

  if (/^(i|we)\s+(?:retract|withdraw)\b/iu.test(normalized)) {
    return {
      surface,
      normalized,
      fragment: false,
      acts: [act("RETRACT", normalized)],
    };
  }

  if (/^(please|could you|would you|can you)\b/iu.test(normalized)) {
    return {
      surface,
      normalized,
      fragment: false,
      acts: [act("REQUEST", normalized)],
    };
  }

  if (/^(i|we)\s+(?:will|accept|agree to)\b/iu.test(normalized)) {
    return {
      surface,
      normalized,
      fragment: false,
      acts: [act("ACCEPT", normalized)],
    };
  }

  if (/^(i|we)\s+(?:decline|cannot|can't|won't)\b/iu.test(normalized)) {
    return {
      surface,
      normalized,
      fragment: false,
      acts: [act("DECLINE", normalized)],
    };
  }

  if (/^(yes|correct|exactly|right)[.!]?$/iu.test(normalized)) {
    return {
      surface,
      normalized,
      fragment: true,
      acts: [act("CONFIRM", normalized)],
    };
  }

  if (/^(no|incorrect|wrong)[.!]?$/iu.test(normalized)) {
    return {
      surface,
      normalized,
      fragment: true,
      acts: [act("DENY", normalized)],
    };
  }

  if (
    fragment &&
    (state?.openQuestions.length ?? 0) > 0 &&
    !normalized.endsWith("?")
  ) {
    return {
      surface,
      normalized,
      fragment: true,
      acts: [
        act("ANSWER", normalized, {
          ellipsisCandidate: true,
          openQuestionCount: state?.openQuestions.length ?? 0,
        }),
      ],
    };
  }

  if (/^and\b/iu.test(normalized) && normalized.endsWith("?")) {
    return {
      surface,
      normalized,
      fragment: true,
      acts: [
        act("CONTINUE", normalized, {
          followUpQuestion: true,
          ...(state?.activeTopic === undefined
            ? {}
            : { activeTopic: state.activeTopic }),
        }),
        act("ASK", normalized),
      ],
    };
  }

  if (normalized.endsWith("?")) {
    return {
      surface,
      normalized,
      fragment,
      acts: [act("ASK", normalized)],
    };
  }

  if (/^(define|what does)\b/iu.test(lower)) {
    return {
      surface,
      normalized,
      fragment,
      acts: [act("DEFINE", normalized)],
    };
  }

  if (/^(explain|why)\b/iu.test(lower)) {
    return {
      surface,
      normalized,
      fragment,
      acts: [act("EXPLAIN", normalized)],
    };
  }

  if (/^(compare|versus|vs\.?\b)/iu.test(lower)) {
    return {
      surface,
      normalized,
      fragment,
      acts: [act("COMPARE", normalized)],
    };
  }

  return {
    surface,
    normalized,
    fragment,
    acts: [act("ASSERT", normalized)],
  };
};
