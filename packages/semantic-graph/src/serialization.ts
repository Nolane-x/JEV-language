import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  GraphSnapshot,
  JsgNode,
} from "./nodes.ts";
import { canonicalSnapshotJson } from "./graph.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const validNodeKinds = new Set([
  "entity",
  "event",
  "state",
  "action",
  "property",
  "relation",
  "proposition",
  "quantity",
  "temporal",
  "location",
  "intent",
  "goal",
  "constraint",
  "alternative-set",
  "reference",
  "collection",
  "type",
  "definition",
  "capability",
  "evidence",
  "unknown-concept",
]);

const structurallyValidNode = (value: unknown): value is JsgNode => {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    validNodeKinds.has(value.kind) &&
    typeof value.schemaVersion === "string" &&
    typeof value.ontologyVersion === "string" &&
    Array.isArray(value.provenance) &&
    value.provenance.every((item) => typeof item === "string") &&
    typeof value.trust === "string"
  );
};

export const serializeSnapshot = (snapshot: GraphSnapshot): string =>
  canonicalSnapshotJson(snapshot);

export const deserializeSnapshot = (
  source: string,
): Result<GraphSnapshot> => {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return err(
      new StructuredError("JSG_DESERIALIZE_JSON", "Snapshot is not valid JSON."),
    );
  }
  if (!isRecord(value)) {
    return err(
      new StructuredError(
        "JSG_DESERIALIZE_SHAPE",
        "Snapshot root must be an object.",
      ),
    );
  }
  if (
    typeof value.schemaVersion !== "string" ||
    typeof value.ontologyVersion !== "string" ||
    typeof value.revision !== "string" ||
    !Array.isArray(value.nodes) ||
    !value.nodes.every(structurallyValidNode)
  ) {
    return err(
      new StructuredError(
        "JSG_DESERIALIZE_SCHEMA",
        "Snapshot failed the JSG structural boundary schema.",
      ),
    );
  }

  const snapshot: GraphSnapshot = {
    schemaVersion: value.schemaVersion,
    ontologyVersion: value.ontologyVersion,
    revision: value.revision,
    ...(typeof value.parentRevision === "string"
      ? { parentRevision: value.parentRevision }
      : {}),
    nodes: value.nodes.map((node) => structuredClone(node)),
  };
  return ok(snapshot);
};
