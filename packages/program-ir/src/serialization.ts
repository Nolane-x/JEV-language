import {
  canonicalJson,
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type { PirProgram } from "./model.ts";
import { validatePirProgram } from "./validator.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const serializePirProgram = (
  program: PirProgram,
): Result<string> => {
  const valid = validatePirProgram(program);
  if (!valid.ok) return err(valid.error);
  const json = JSON.parse(JSON.stringify(program)) as JsonValue;
  return ok(canonicalJson(json));
};

export const deserializePirProgram = (
  source: string,
): Result<PirProgram> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return err(
      new StructuredError(
        "PIR_PARSE_JSON",
        error instanceof Error
          ? error.message
          : "PIR JSON could not be parsed.",
      ),
    );
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.version !== "string" ||
    !Array.isArray(parsed.functions)
  ) {
    return err(
      new StructuredError(
        "PIR_PARSE_SHAPE",
        "Serialized PIR requires a string version and function array.",
      ),
    );
  }

  const program = parsed as unknown as PirProgram;
  const valid = validatePirProgram(program);
  return valid.ok
    ? ok(structuredClone(program))
    : err(valid.error);
};
