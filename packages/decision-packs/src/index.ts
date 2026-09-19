import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  DecisionQuestion,
  DecisionState,
} from "../../decision-runtime/src/index.ts";

export type DecisionPackLifecycle =
  | "draft"
  | "fixture-tested"
  | "calibration-tested"
  | "candidate"
  | "production"
  | "deprecated";

export interface DecisionPackManifest {
  id: string;
  version: string;
  maturity: DecisionPackLifecycle;
  stateProjector: string;
  questions: Record<string, DecisionQuestion>;
  calibrationProfile?: string;
  fallback: {
    onLowConfidence:
      | "preserve-ambiguity"
      | "abstain"
      | "deterministic-fallback"
      | "consumer-clarification";
  };
  fixtures: string[];
}

export interface StateProjector<I> {
  readonly id: string;
  project(input: I): DecisionState;
}

export const validateDecisionPack = (
  input: DecisionPackManifest,
): Result<DecisionPackManifest> => {
  if (input.id.trim() === "" || input.version.trim() === "") {
    return err(
      new StructuredError(
        "DPACK_INVALID_ID",
        "Decision pack id and version are required.",
      ),
    );
  }
  if (Object.keys(input.questions).length === 0) {
    return err(
      new StructuredError(
        "DPACK_NO_QUESTIONS",
        "Decision pack must contain at least one question.",
      ),
    );
  }
  if (
    input.maturity === "production" &&
    (input.fixtures.length === 0 || input.calibrationProfile === undefined)
  ) {
    return err(
      new StructuredError(
        "DPACK_PRODUCTION_GATE",
        "Production packs require fixtures and a calibration profile.",
      ),
    );
  }
  return ok(structuredClone(input));
};

export const sentinelDecisionPack: DecisionPackManifest = {
  id: "sentinel.semantic-preservation.v1",
  version: "1.0.0",
  maturity: "draft",
  stateProjector: "sentinel.compact-v1",
  questions: {
    preserves_negation: {
      type: "noul",
      instruction:
        "Does the candidate preserve the source requirement's negation or upper-bound restriction?",
      criteria: {
        true: "The restriction is preserved.",
        false: "The restriction is weakened, dropped, or reversed.",
      },
    },
  },
  fallback: { onLowConfidence: "preserve-ambiguity" },
  fixtures: [],
};

export class DecisionPackRegistry {
  #packs = new Map<string, DecisionPackManifest>();

  register(pack: DecisionPackManifest): Result<void> {
    const validated = validateDecisionPack(pack);
    if (!validated.ok) return validated;
    const key = `${pack.id}@${pack.version}`;
    if (this.#packs.has(key)) {
      return err(
        new StructuredError(
          "DPACK_DUPLICATE",
          `Decision pack already registered: ${key}`,
        ),
      );
    }
    this.#packs.set(key, structuredClone(pack));
    return ok(undefined);
  }

  get(id: string, version: string): DecisionPackManifest | undefined {
    const value = this.#packs.get(`${id}@${version}`);
    return value === undefined ? undefined : structuredClone(value);
  }

  list(): DecisionPackManifest[] {
    return [...this.#packs.values()]
      .map((value) => structuredClone(value))
      .sort((a, b) =>
        a.id === b.id
          ? a.version.localeCompare(b.version)
          : a.id.localeCompare(b.id),
      );
  }
}
