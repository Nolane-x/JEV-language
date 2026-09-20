import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  validateM19StudyManifest,
  type M19StudyManifest,
} from "./natural-conversation.ts";
import type {
  M19ObservedStimulusCapture,
  M19ObservedTurn,
} from "./m19-observed-stimulus.ts";

export interface M19ScenarioItem {
  id: string;
  conversationRef: string;
  languageTags: string[];
  userTurns: string[];
}

export interface M19ScenarioPack {
  schemaVersion: "jl-m19-scenario-pack-1";
  studyId: string;
  version: string;
  items: M19ScenarioItem[];
}

export interface M19ObservedArmResponse {
  text: string;
  latencyMs: number;
  costUnits: number;
  semanticEvidenceRefs: string[];
  observationEvidenceRefs: string[];
}

export interface M19ObservedArm {
  reset(input: {
    itemId: string;
    conversationRef: string;
  }): Result<void> | Promise<Result<void>>;
  respond(input: {
    itemId: string;
    conversationRef: string;
    userText: string;
    userTurnIndex: number;
  }): Result<M19ObservedArmResponse> | Promise<Result<M19ObservedArmResponse>>;
}

const nonEmpty = (value: string): boolean => value.trim() !== "";

const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.length > 0 &&
  values.every(nonEmpty) &&
  new Set(values).size === values.length;

export const validateM19ScenarioPack = (
  manifestInput: M19StudyManifest,
  pack: M19ScenarioPack,
): Result<M19ScenarioPack> => {
  const manifest = validateM19StudyManifest(manifestInput);
  if (!manifest.ok) return err(manifest.error);

  if (
    pack.schemaVersion !== "jl-m19-scenario-pack-1" ||
    pack.studyId !== manifest.value.id ||
    !nonEmpty(pack.version) ||
    pack.items.length !== manifest.value.items.length
  ) {
    return err(
      new StructuredError(
        "EVAL_M19_SCENARIO_PACK",
        "M19 scenario pack must match the preregistered study identity and item count.",
      ),
    );
  }

  const itemById = new Map(
    manifest.value.items.map((item) => [item.id, item] as const),
  );
  const seen = new Set<string>();

  for (const scenario of pack.items) {
    const item = itemById.get(scenario.id);
    if (
      item === undefined ||
      seen.has(scenario.id) ||
      scenario.conversationRef !== item.conversationRef ||
      !uniqueNonEmpty(scenario.languageTags) ||
      scenario.languageTags.length !== item.languageTags.length ||
      scenario.languageTags.some(
        (tag, index) => tag !== item.languageTags[index],
      ) ||
      scenario.userTurns.length * 2 !== item.expectedTurns ||
      !uniqueNonEmpty(scenario.userTurns)
    ) {
      return err(
        new StructuredError(
          "EVAL_M19_SCENARIO_ITEM",
          `Invalid M19 scenario item: ${scenario.id || "<empty>"}.`,
        ),
      );
    }
    seen.add(scenario.id);
  }

  return ok(structuredClone(pack));
};

const mergeEvidenceRefs = (
  values: readonly string[][],
): string[] => [...new Set(values.flat())];

export const runM19ObservedArm = async (input: {
  manifest: M19StudyManifest;
  scenarios: M19ScenarioPack;
  armCode: string;
  arm: M19ObservedArm;
  observedAt: () => string;
}): Promise<Result<M19ObservedStimulusCapture[]>> => {
  const manifest = validateM19StudyManifest(input.manifest);
  if (!manifest.ok) return err(manifest.error);

  const scenarios = validateM19ScenarioPack(
    manifest.value,
    input.scenarios,
  );
  if (!scenarios.ok) return err(scenarios.error);

  if (!manifest.value.armCodes.includes(input.armCode)) {
    return err(
      new StructuredError(
        "EVAL_M19_ARM_CODE",
        "Observed M19 runner requires an arm code declared by the preregistered manifest.",
      ),
    );
  }

  const captures: M19ObservedStimulusCapture[] = [];

  for (const item of manifest.value.items) {
    const scenario = scenarios.value.items.find(
      (entry) => entry.id === item.id,
    );
    if (scenario === undefined) {
      return err(
        new StructuredError(
          "EVAL_M19_SCENARIO_MISSING",
          `Missing M19 scenario for ${item.id}.`,
        ),
      );
    }

    let reset: Result<void>;
    try {
      reset = await input.arm.reset({
        itemId: item.id,
        conversationRef: item.conversationRef,
      });
    } catch (error) {
      return err(
        new StructuredError(
          "EVAL_M19_ARM_RESET_THROW",
          `M19 arm reset threw for ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    if (!reset.ok) return err(reset.error);

    const turns: M19ObservedTurn[] = [];
    const semanticRefs: string[][] = [];
    const observationRefs: string[][] = [];
    let latencyMs = 0;
    let costUnits = 0;

    for (
      let userTurnIndex = 0;
      userTurnIndex < scenario.userTurns.length;
      userTurnIndex += 1
    ) {
      const userText = scenario.userTurns[userTurnIndex]!;
      turns.push({ role: "user", text: userText });

      let response: Result<M19ObservedArmResponse>;
      try {
        response = await input.arm.respond({
          itemId: item.id,
          conversationRef: item.conversationRef,
          userText,
          userTurnIndex,
        });
      } catch (error) {
        return err(
          new StructuredError(
            "EVAL_M19_ARM_RESPONSE_THROW",
            `M19 arm response threw for ${item.id} turn ${userTurnIndex}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
      if (!response.ok) return err(response.error);

      if (
        !nonEmpty(response.value.text) ||
        !Number.isFinite(response.value.latencyMs) ||
        response.value.latencyMs < 0 ||
        !Number.isFinite(response.value.costUnits) ||
        response.value.costUnits < 0 ||
        !uniqueNonEmpty(response.value.semanticEvidenceRefs) ||
        !uniqueNonEmpty(response.value.observationEvidenceRefs)
      ) {
        return err(
          new StructuredError(
            "EVAL_M19_ARM_RESPONSE",
            `Invalid observed M19 arm response for ${item.id} turn ${userTurnIndex}.`,
          ),
        );
      }

      turns.push({
        role: "assistant",
        text: response.value.text,
      });
      latencyMs += response.value.latencyMs;
      costUnits += response.value.costUnits;
      semanticRefs.push(response.value.semanticEvidenceRefs);
      observationRefs.push(response.value.observationEvidenceRefs);
    }

    const observedAt = input.observedAt();
    if (!nonEmpty(observedAt) || Number.isNaN(Date.parse(observedAt))) {
      return err(
        new StructuredError(
          "EVAL_M19_ARM_OBSERVED_AT",
          "Observed M19 runner clock must return a parseable timestamp.",
        ),
      );
    }

    captures.push({
      itemId: item.id,
      armCode: input.armCode,
      conversationRef: item.conversationRef,
      turns,
      latencyMs,
      costUnits,
      semanticEvidenceRefs: mergeEvidenceRefs(semanticRefs),
      observationEvidenceRefs: mergeEvidenceRefs(observationRefs),
      observedAt,
    });
  }

  return ok(captures);
};
