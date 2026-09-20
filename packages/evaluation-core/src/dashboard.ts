import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";

export type ConformanceEntryStatus =
  | "verified"
  | "implemented"
  | "blocked"
  | "todo"
  | "failed";

export interface CrossLayerConformanceEntry {
  id: string;
  layer: string;
  required: boolean;
  status: ConformanceEntryStatus;
  evidenceRefs: string[];
  diagnostics?: string[];
  metadata?: Record<string, JsonValue>;
}

export interface CrossLayerConformanceDashboard {
  schemaVersion: "jl-v04-dashboard-1";
  status: "pass" | "fail" | "incomplete";
  total: number;
  required: number;
  verifiedRequired: number;
  implementedNotVerified: string[];
  blocked: string[];
  failed: string[];
  todo: string[];
  zeroGenerativePassed: boolean;
  entries: CrossLayerConformanceEntry[];
}

const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.every((value) => value.trim() !== "") &&
  new Set(values).size === values.length;

export const buildV04ConformanceDashboard = (input: {
  entries: readonly CrossLayerConformanceEntry[];
  zeroGenerativePassed: boolean;
}): Result<CrossLayerConformanceDashboard> => {
  const ids = input.entries.map((entry) => entry.id);
  if (!uniqueNonEmpty(ids) || input.entries.length === 0) {
    return err(
      new StructuredError(
        "EVAL_DASHBOARD_IDS",
        "Cross-layer dashboard requires unique non-empty entry ids.",
      ),
    );
  }

  for (const entry of input.entries) {
    if (
      entry.layer.trim() === "" ||
      !["verified", "implemented", "blocked", "todo", "failed"].includes(
        entry.status,
      ) ||
      !uniqueNonEmpty(entry.evidenceRefs) ||
      (entry.status === "verified" && entry.evidenceRefs.length === 0) ||
      (entry.diagnostics?.some((diagnostic) => diagnostic.trim() === "") ??
        false)
    ) {
      return err(
        new StructuredError(
          "EVAL_DASHBOARD_ENTRY",
          `Invalid conformance dashboard entry ${entry.id}.`,
        ),
      );
    }
  }

  const required = input.entries.filter((entry) => entry.required);
  const failed = input.entries
    .filter((entry) => entry.status === "failed")
    .map((entry) => entry.id)
    .sort();
  const blocked = input.entries
    .filter((entry) => entry.status === "blocked")
    .map((entry) => entry.id)
    .sort();
  const todo = input.entries
    .filter((entry) => entry.status === "todo")
    .map((entry) => entry.id)
    .sort();
  const implementedNotVerified = input.entries
    .filter((entry) => entry.status === "implemented")
    .map((entry) => entry.id)
    .sort();
  const verifiedRequired = required.filter(
    (entry) => entry.status === "verified",
  ).length;

  const requiredFailure = required.some(
    (entry) => entry.status === "failed" || entry.status === "blocked",
  );
  const requiredIncomplete = required.some(
    (entry) =>
      entry.status === "implemented" ||
      entry.status === "todo",
  );
  const status: CrossLayerConformanceDashboard["status"] =
    requiredFailure || !input.zeroGenerativePassed
      ? "fail"
      : requiredIncomplete
        ? "incomplete"
        : "pass";

  return ok({
    schemaVersion: "jl-v04-dashboard-1",
    status,
    total: input.entries.length,
    required: required.length,
    verifiedRequired,
    implementedNotVerified,
    blocked,
    failed,
    todo,
    zeroGenerativePassed: input.zeroGenerativePassed,
    entries: [...input.entries]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((entry) => structuredClone(entry)),
  });
};
