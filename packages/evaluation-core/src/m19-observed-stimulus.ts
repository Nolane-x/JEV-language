import {
  canonicalJson,
  err,
  ok,
  sha256,
  StructuredError,
  type Digest,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import {
  createM19BlindedBundle,
  validateM19StudyManifest,
  type M19BlindedBundle,
  type M19Stimulus,
  type M19StudyManifest,
} from "./natural-conversation.ts";
import {
  createM19RatingWorksheet,
  type M19RatingWorksheet,
} from "./m19-study-kit.ts";

export type M19ObservedTurnRole = "user" | "assistant";

export interface M19ObservedTurn {
  role: M19ObservedTurnRole;
  text: string;
}

export interface M19ObservedStimulusCapture {
  itemId: string;
  armCode: string;
  conversationRef: string;
  turns: M19ObservedTurn[];
  latencyMs: number;
  costUnits: number;
  semanticEvidenceRefs: string[];
  observationEvidenceRefs: string[];
  observedAt: string;
}

export interface M19ObservedStimulusFreeze {
  schemaVersion: "jl-m19-observed-stimulus-freeze-1";
  studyId: string;
  frozenAt: string;
  blinded: true;
  observedCaptureCount: number;
  bundle: M19BlindedBundle;
  evaluatorWorksheetTemplate: M19RatingWorksheet;
  digests: {
    manifest: Digest;
    observedCaptures: Digest;
    blindedBundle: Digest;
    evaluatorWorksheetTemplate: Digest;
  };
}

const asJson = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

const nonEmpty = (value: string): boolean => value.trim() !== "";

const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.length > 0 &&
  values.every(nonEmpty) &&
  new Set(values).size === values.length;

const parseableTimestamp = (value: string): boolean =>
  nonEmpty(value) && !Number.isNaN(Date.parse(value));

const stableCaptureSort = (
  captures: readonly M19ObservedStimulusCapture[],
): M19ObservedStimulusCapture[] =>
  captures
    .map((capture) => structuredClone(capture))
    .sort(
      (a, b) =>
        a.itemId.localeCompare(b.itemId) ||
        a.armCode.localeCompare(b.armCode),
    );

export const formatM19ObservedTranscript = (
  turns: readonly M19ObservedTurn[],
): Result<string> => {
  if (
    turns.length === 0 ||
    turns.some(
      (turn) =>
        !["user", "assistant"].includes(turn.role) || !nonEmpty(turn.text),
    )
  ) {
    return err(
      new StructuredError(
        "EVAL_M19_OBSERVED_TURNS",
        "Observed M19 transcripts require non-empty user/assistant turns.",
      ),
    );
  }

  if (turns[0]?.role !== "user" || turns.at(-1)?.role !== "assistant") {
    return err(
      new StructuredError(
        "EVAL_M19_OBSERVED_TURN_BOUNDARY",
        "Observed M19 conversations must start with a user turn and end with an assistant turn.",
      ),
    );
  }

  for (let index = 0; index < turns.length; index += 1) {
    const expected: M19ObservedTurnRole =
      index % 2 === 0 ? "user" : "assistant";
    if (turns[index]?.role !== expected) {
      return err(
        new StructuredError(
          "EVAL_M19_OBSERVED_TURN_ORDER",
          "Observed M19 conversations must alternate user and assistant turns.",
        ),
      );
    }
  }

  return ok(
    turns
      .map((turn) =>
        turn.role === "user"
          ? `[User]\n${turn.text.trim()}`
          : `[Assistant]\n${turn.text.trim()}`,
      )
      .join("\n\n"),
  );
};

export const freezeM19ObservedStimuli = (input: {
  manifest: M19StudyManifest;
  captures: readonly M19ObservedStimulusCapture[];
  frozenAt: string;
}): Result<M19ObservedStimulusFreeze> => {
  const manifest = validateM19StudyManifest(input.manifest);
  if (!manifest.ok) return err(manifest.error);

  if (!parseableTimestamp(input.frozenAt)) {
    return err(
      new StructuredError(
        "EVAL_M19_OBSERVED_FREEZE_TIME",
        "Observed M19 stimulus freeze requires an explicit parseable timestamp.",
      ),
    );
  }

  const expectedPairs = new Set(
    manifest.value.items.flatMap((item) =>
      manifest.value.armCodes.map(
        (armCode) => `${item.id}\u0000${armCode}`,
      ),
    ),
  );
  const observedPairs = new Set<string>();
  const itemById = new Map(
    manifest.value.items.map((item) => [item.id, item] as const),
  );
  const stimuli: M19Stimulus[] = [];

  for (const capture of input.captures) {
    const pair = `${capture.itemId}\u0000${capture.armCode}`;
    const item = itemById.get(capture.itemId);

    if (
      item === undefined ||
      !manifest.value.armCodes.includes(capture.armCode) ||
      observedPairs.has(pair) ||
      capture.conversationRef !== item.conversationRef ||
      capture.turns.length !== item.expectedTurns ||
      !Number.isFinite(capture.latencyMs) ||
      capture.latencyMs < 0 ||
      !Number.isFinite(capture.costUnits) ||
      capture.costUnits < 0 ||
      !uniqueNonEmpty(capture.semanticEvidenceRefs) ||
      !uniqueNonEmpty(capture.observationEvidenceRefs) ||
      !parseableTimestamp(capture.observedAt)
    ) {
      return err(
        new StructuredError(
          "EVAL_M19_OBSERVED_CAPTURE",
          `Invalid observed M19 capture: ${capture.itemId || "<empty>"}:${capture.armCode || "<empty>"}.`,
        ),
      );
    }

    const transcript = formatM19ObservedTranscript(capture.turns);
    if (!transcript.ok) return err(transcript.error);

    observedPairs.add(pair);
    stimuli.push({
      itemId: capture.itemId,
      armCode: capture.armCode,
      output: transcript.value,
      latencyMs: capture.latencyMs,
      costUnits: capture.costUnits,
      semanticEvidenceRefs: [...capture.semanticEvidenceRefs],
    });
  }

  if (
    observedPairs.size !== expectedPairs.size ||
    [...expectedPairs].some((pair) => !observedPairs.has(pair))
  ) {
    return err(
      new StructuredError(
        "EVAL_M19_OBSERVED_COVERAGE",
        "Observed M19 stimulus freeze requires exactly one real capture for every preregistered item/arm pair.",
      ),
    );
  }

  const bundle = createM19BlindedBundle(manifest.value, stimuli);
  if (!bundle.ok) return err(bundle.error);

  const worksheet = createM19RatingWorksheet(
    manifest.value,
    bundle.value,
  );
  if (!worksheet.ok) return err(worksheet.error);

  const captures = stableCaptureSort(input.captures);

  return ok({
    schemaVersion: "jl-m19-observed-stimulus-freeze-1",
    studyId: manifest.value.id,
    frozenAt: input.frozenAt,
    blinded: true,
    observedCaptureCount: captures.length,
    bundle: bundle.value,
    evaluatorWorksheetTemplate: worksheet.value,
    digests: {
      manifest: sha256(canonicalJson(asJson(manifest.value))),
      observedCaptures: sha256(canonicalJson(asJson(captures))),
      blindedBundle: sha256(canonicalJson(asJson(bundle.value))),
      evaluatorWorksheetTemplate: sha256(
        canonicalJson(asJson(worksheet.value)),
      ),
    },
  });
};
