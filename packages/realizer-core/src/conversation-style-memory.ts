import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";

export interface ConversationStyleMemoryEntry {
  surface: string;
  opening: string;
  constructionIds: string[];
  sourceFamily: string;
}

export interface ConversationStyleMemory {
  schemaVersion: "jl-conversation-style-memory-1";
  maxEntries: number;
  entries: ConversationStyleMemoryEntry[];
}

export interface StyleScorableCandidate {
  surface: string;
  constructionIds: readonly string[];
  sourceFamily: string;
}

export interface ConversationStylePenalty {
  penalty: number;
  exactSurfaceRepeat: boolean;
  openingRepeatCount: number;
  constructionRepeatCount: number;
  sourceFamilyRepeatCount: number;
  maxLexicalOverlap: number;
}

const normalize = (surface: string): string =>
  surface.normalize("NFC").trim().replace(/\s+/gu, " ");

const words = (surface: string): string[] =>
  normalize(surface)
    .toLocaleLowerCase()
    .match(/[\p{L}\p{M}\p{N}_-]+/gu) ?? [];

const opening = (surface: string): string => words(surface).slice(0, 4).join(" ");

const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.every((value) => value.trim().length > 0) &&
  new Set(values).size === values.length;

const lexicalSet = (surface: string): Set<string> => new Set(words(surface));

const jaccard = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

export const createConversationStyleMemory = (
  maxEntries = 12,
): Result<ConversationStyleMemory> => {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 64) {
    return err(
      new StructuredError(
        "REALIZE_STYLE_MEMORY_BUDGET",
        "Conversation style memory maxEntries must be an integer in [1, 64].",
      ),
    );
  }
  return ok({
    schemaVersion: "jl-conversation-style-memory-1",
    maxEntries,
    entries: [],
  });
};

export const validateConversationStyleMemory = (
  memory: ConversationStyleMemory,
): Result<ConversationStyleMemory> => {
  if (
    memory.schemaVersion !== "jl-conversation-style-memory-1" ||
    !Number.isInteger(memory.maxEntries) ||
    memory.maxEntries < 1 ||
    memory.maxEntries > 64 ||
    memory.entries.length > memory.maxEntries
  ) {
    return err(
      new StructuredError(
        "REALIZE_STYLE_MEMORY_SCHEMA",
        "Conversation style memory has an invalid schema, bound, or entry count.",
      ),
    );
  }

  for (const entry of memory.entries) {
    if (
      entry.surface.trim().length === 0 ||
      entry.opening !== opening(entry.surface) ||
      entry.sourceFamily.trim().length === 0 ||
      !uniqueNonEmpty(entry.constructionIds)
    ) {
      return err(
        new StructuredError(
          "REALIZE_STYLE_MEMORY_ENTRY",
          "Conversation style memory entries require canonical openings, a source family, and unique construction ids.",
        ),
      );
    }
  }
  return ok(structuredClone(memory));
};

export const recordConversationStyle = (
  memory: ConversationStyleMemory,
  input: {
    surface: string;
    constructionIds: readonly string[];
    sourceFamily: string;
  },
): Result<ConversationStyleMemory> => {
  const valid = validateConversationStyleMemory(memory);
  if (!valid.ok) return valid;
  if (
    input.surface.trim().length === 0 ||
    input.sourceFamily.trim().length === 0 ||
    !uniqueNonEmpty(input.constructionIds)
  ) {
    return err(
      new StructuredError(
        "REALIZE_STYLE_MEMORY_RECORD",
        "Recorded conversation style requires surface, source family, and unique construction ids.",
      ),
    );
  }

  const next: ConversationStyleMemoryEntry = {
    surface: normalize(input.surface),
    opening: opening(input.surface),
    constructionIds: [...input.constructionIds],
    sourceFamily: input.sourceFamily,
  };
  const entries = [...valid.value.entries, next].slice(-valid.value.maxEntries);
  return ok({
    ...valid.value,
    entries,
  });
};

export const scoreConversationStyleRepetition = (
  memory: ConversationStyleMemory | undefined,
  candidate: StyleScorableCandidate,
): ConversationStylePenalty => {
  if (memory === undefined || memory.entries.length === 0) {
    return {
      penalty: 0,
      exactSurfaceRepeat: false,
      openingRepeatCount: 0,
      constructionRepeatCount: 0,
      sourceFamilyRepeatCount: 0,
      maxLexicalOverlap: 0,
    };
  }

  const surface = normalize(candidate.surface);
  const candidateOpening = opening(surface);
  const candidateLexical = lexicalSet(surface);
  const exactSurfaceRepeat = memory.entries.some(
    (entry) => normalize(entry.surface) === surface,
  );
  const openingRepeatCount = memory.entries.filter(
    (entry) => entry.opening === candidateOpening && candidateOpening !== "",
  ).length;
  const constructions = new Set(candidate.constructionIds);
  const constructionRepeatCount = memory.entries.reduce(
    (count, entry) =>
      count +
      entry.constructionIds.filter((id) => constructions.has(id)).length,
    0,
  );
  const sourceFamilyRepeatCount = memory.entries
    .slice(-4)
    .filter((entry) => entry.sourceFamily === candidate.sourceFamily).length;
  const maxLexicalOverlap = memory.entries.reduce(
    (max, entry) =>
      Math.max(max, jaccard(candidateLexical, lexicalSet(entry.surface))),
    0,
  );

  const penalty =
    (exactSurfaceRepeat ? 4 : 0) +
    Math.min(1.2, openingRepeatCount * 0.3) +
    Math.min(1, constructionRepeatCount * 0.2) +
    Math.min(0.8, sourceFamilyRepeatCount * 0.2) +
    Math.min(0.8, maxLexicalOverlap * 0.8);

  return {
    penalty: Math.round(penalty * 10_000) / 10_000,
    exactSurfaceRepeat,
    openingRepeatCount,
    constructionRepeatCount,
    sourceFamilyRepeatCount,
    maxLexicalOverlap: Math.round(maxLexicalOverlap * 10_000) / 10_000,
  };
};
