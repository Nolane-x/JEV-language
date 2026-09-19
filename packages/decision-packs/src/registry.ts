import {
  err,
  ok,
  parseVersion,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type { DecisionQuestion } from "../../decision-runtime/src/index.ts";
import {
  validateDecisionPack,
  type DecisionPackManifest,
} from "./manifest.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isQuestion = (value: unknown): value is DecisionQuestion => {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (!("instruction" in value)) return false;

  if (value.type === "noul") return true;
  if (value.type === "choice") {
    return isRecord(value.options) && Object.keys(value.options).length > 0;
  }
  if (value.type === "score") {
    return Array.isArray(value.levels) && value.levels.length >= 2;
  }
  return false;
};

export const loadDecisionPack = (
  input: unknown,
): Result<DecisionPackManifest> => {
  if (!isRecord(input)) {
    return err(
      new StructuredError(
        "DPACK_SCHEMA",
        "Decision pack must be an object.",
      ),
    );
  }

  const questions = input.questions;
  const fallback = input.fallback;
  if (
    typeof input.id !== "string" ||
    typeof input.version !== "string" ||
    typeof input.maturity !== "string" ||
    typeof input.stateProjector !== "string" ||
    !isRecord(questions) ||
    !isRecord(fallback) ||
    !Array.isArray(input.fixtures) ||
    !Array.isArray(input.counterexamples) ||
    !Array.isArray(input.knownFailureModes) ||
    typeof input.traceOutput !== "boolean" ||
    typeof input.semanticPurpose !== "string"
  ) {
    return err(
      new StructuredError(
        "DPACK_SCHEMA",
        "Decision pack is missing required manifest fields.",
      ),
    );
  }

  for (const [id, question] of Object.entries(questions)) {
    if (id.trim() === "" || !isQuestion(question)) {
      return err(
        new StructuredError(
          "DPACK_QUESTION_SCHEMA",
          `Invalid decision question: ${id || "<empty>"}.`,
        ),
      );
    }
  }

  const candidate = input as unknown as DecisionPackManifest;
  return validateDecisionPack(candidate);
};

const keyOf = (id: string, version: string): string => `${id}@${version}`;

export class DecisionPackRegistry {
  readonly #packs = new Map<string, DecisionPackManifest>();

  register(pack: DecisionPackManifest): Result<DecisionPackManifest> {
    const validated = validateDecisionPack(pack);
    if (!validated.ok) return validated;

    const key = keyOf(pack.id, pack.version);
    if (this.#packs.has(key)) {
      return err(
        new StructuredError(
          "DPACK_DUPLICATE_VERSION",
          `Decision pack already registered: ${key}.`,
        ),
      );
    }
    this.#packs.set(key, structuredClone(validated.value));
    return ok(structuredClone(validated.value));
  }

  resolve(id: string, version: string): Result<DecisionPackManifest> {
    const parsed = parseVersion(version);
    if (!parsed.ok) {
      return err(
        new StructuredError(
          "DPACK_INVALID_VERSION",
          `Invalid requested decision pack version: ${version}.`,
        ),
      );
    }
    const pack = this.#packs.get(keyOf(id, version));
    if (pack === undefined) {
      return err(
        new StructuredError(
          "DPACK_NOT_FOUND",
          `Decision pack not found: ${id}@${version}.`,
        ),
      );
    }
    return ok(structuredClone(pack));
  }

  list(id?: string): DecisionPackManifest[] {
    return [...this.#packs.values()]
      .filter((pack) => id === undefined || pack.id === id)
      .map((pack) => structuredClone(pack))
      .sort((a, b) =>
        keyOf(a.id, a.version).localeCompare(keyOf(b.id, b.version)),
      );
  }
}
