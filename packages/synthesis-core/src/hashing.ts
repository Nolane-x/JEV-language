import {
  canonicalJson,
  sha256,
  type JsonValue,
} from "../../core-types/src/index.ts";
import type {
  SynthesisState,
  SynthesisStateId,
} from "./model.ts";

const jsonValue = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

export const hashSynthesisState = (
  state: Pick<
    SynthesisState,
    "program" | "openHoles" | "obligations" | "verifierFacts"
  >,
): SynthesisStateId =>
  sha256(
    canonicalJson({
      program: jsonValue(state.program),
      openHoles: [...state.openHoles].sort(),
      obligations: jsonValue(
        [...state.obligations].sort((a, b) => a.id.localeCompare(b.id)),
      ),
      verifierFacts: [...state.verifierFacts].sort(),
    }),
  );
