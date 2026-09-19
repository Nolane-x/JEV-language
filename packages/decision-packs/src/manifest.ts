import {
  err,
  ok,
  parseVersion,
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

export type LowConfidenceFallback =
  | "preserve-ambiguity"
  | "abstain"
  | "deterministic-fallback"
  | "consumer-clarification";

export interface DecisionPackManifest {
  id: string;
  version: string;
  maturity: DecisionPackLifecycle;
  semanticPurpose: string;
  stateProjector: string;
  questions: Record<string, DecisionQuestion>;
  calibrationProfile?: string;
  fallback: {
    onLowConfidence: LowConfidenceFallback;
  };
  fixtures: string[];
  counterexamples: string[];
  knownFailureModes: string[];
  traceOutput: boolean;
}

export interface StateProjector<I> {
  readonly id: string;
  project(input: I): DecisionState;
}

const validMaturity = new Set<DecisionPackLifecycle>([
  "draft",
  "fixture-tested",
  "calibration-tested",
  "candidate",
  "production",
  "deprecated",
]);

const validFallback = new Set<LowConfidenceFallback>([
  "preserve-ambiguity",
  "abstain",
  "deterministic-fallback",
  "consumer-clarification",
]);

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

  const version = parseVersion(input.version);
  if (!version.ok) {
    return err(
      new StructuredError(
        "DPACK_INVALID_VERSION",
        `Decision pack version must be semantic-version compatible: ${input.version}.`,
      ),
    );
  }

  if (!validMaturity.has(input.maturity)) {
    return err(
      new StructuredError(
        "DPACK_INVALID_MATURITY",
        `Unsupported decision pack maturity: ${String(input.maturity)}.`,
      ),
    );
  }

  if (input.semanticPurpose.trim() === "" || input.stateProjector.trim() === "") {
    return err(
      new StructuredError(
        "DPACK_MISSING_PURPOSE",
        "Decision packs require semanticPurpose and stateProjector.",
      ),
    );
  }

  if (!validFallback.has(input.fallback.onLowConfidence)) {
    return err(
      new StructuredError(
        "DPACK_INVALID_FALLBACK",
        "Decision pack has an unsupported low-confidence fallback policy.",
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
    (
      input.fixtures.length === 0 ||
      input.calibrationProfile === undefined ||
      input.counterexamples.length === 0 ||
      input.knownFailureModes.length === 0 ||
      !input.traceOutput
    )
  ) {
    return err(
      new StructuredError(
        "DPACK_PRODUCTION_GATE",
        "Production packs require fixtures, calibration, counterexamples, known failure modes, and trace output.",
      ),
    );
  }

  return ok(structuredClone(input));
};

export const sentinelDecisionPack: DecisionPackManifest = {
  id: "sentinel.semantic-preservation.v1",
  version: "1.0.0",
  maturity: "draft",
  semanticPurpose:
    "Detect whether a candidate transformation preserves critical source semantics.",
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
  counterexamples: [],
  knownFailureModes: [
    "Candidate state omits a critical source constraint.",
    "Ambiguous wording makes preservation genuinely unresolved.",
  ],
  traceOutput: true,
};
