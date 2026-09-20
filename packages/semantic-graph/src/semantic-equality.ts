import {
  canonicalJson,
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";

export type SemanticEqualityMode =
  | "exact-json"
  | "canonical"
  | "set-like-arrays"
  | "ignore-metadata";

export interface SemanticEqualityOptions {
  mode: SemanticEqualityMode;
  ignoredKeys?: string[];
}

export interface SemanticDifference {
  path: string;
  kind: "added" | "removed" | "changed";
  left?: JsonValue;
  right?: JsonValue;
}

export interface SemanticComparisonResult {
  equal: boolean;
  mode: SemanticEqualityMode;
  differences: SemanticDifference[];
}

const stripIgnoredKeys = (
  value: JsonValue,
  ignored: ReadonlySet<string>,
): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((item) => stripIgnoredKeys(item, ignored));
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      if (ignored.has(key)) continue;
      output[key] = stripIgnoredKeys(value[key]!, ignored);
    }
    return output;
  }
  return value;
};

const normalizeSetLikeArrays = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value
      .map(normalizeSetLikeArrays)
      .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = normalizeSetLikeArrays(value[key]!);
    }
    return output;
  }
  return value;
};

const normalizedForMode = (
  value: JsonValue,
  options: SemanticEqualityOptions,
): JsonValue => {
  if (options.mode === "set-like-arrays") {
    return normalizeSetLikeArrays(value);
  }
  if (options.mode === "ignore-metadata") {
    return stripIgnoredKeys(
      value,
      new Set(options.ignoredKeys ?? ["metadata", "annotations", "traceId"]),
    );
  }
  return value;
};

const diffValues = (
  left: JsonValue | undefined,
  right: JsonValue | undefined,
  path: string,
  output: SemanticDifference[],
): void => {
  if (left === undefined) {
    if (right !== undefined) output.push({ path, kind: "added", right });
    return;
  }
  if (right === undefined) {
    output.push({ path, kind: "removed", left });
    return;
  }
  if (canonicalJson(left) === canonicalJson(right)) return;

  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      diffValues(left[index], right[index], `${path}[${index}]`, output);
    }
    return;
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const keys = [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].sort();
    for (const key of keys) {
      diffValues(left[key], right[key], `${path}.${key}`, output);
    }
    return;
  }
  output.push({ path, kind: "changed", left, right });
};

export const compareSemanticJson = (
  left: JsonValue,
  right: JsonValue,
  options: SemanticEqualityOptions,
): Result<SemanticComparisonResult> => {
  if (
    ![
      "exact-json",
      "canonical",
      "set-like-arrays",
      "ignore-metadata",
    ].includes(options.mode) ||
    (options.ignoredKeys !== undefined &&
      (options.ignoredKeys.some((key) => key.trim() === "") ||
        new Set(options.ignoredKeys).size !== options.ignoredKeys.length))
  ) {
    return err(
      new StructuredError(
        "SEMANTIC_EQUALITY_OPTIONS",
        "Semantic equality mode/options are invalid.",
      ),
    );
  }

  if (options.mode === "exact-json") {
    const equal = JSON.stringify(left) === JSON.stringify(right);
    const differences: SemanticDifference[] = [];
    if (!equal) {
      diffValues(left, right, "$", differences);
    }
    return ok({ equal, mode: options.mode, differences });
  }

  const normalizedLeft = normalizedForMode(left, options);
  const normalizedRight = normalizedForMode(right, options);
  const differences: SemanticDifference[] = [];
  diffValues(normalizedLeft, normalizedRight, "$", differences);
  return ok({
    equal: differences.length === 0,
    mode: options.mode,
    differences,
  });
};
