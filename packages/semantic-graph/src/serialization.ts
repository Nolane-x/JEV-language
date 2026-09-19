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

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";

const optionalNumber = (value: unknown): boolean =>
  value === undefined || (typeof value === "number" && Number.isFinite(value));

const isSpanRef = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.sourceId === "string" &&
  typeof value.sourceVersion === "string" &&
  typeof value.start === "number" &&
  Number.isSafeInteger(value.start) &&
  value.start >= 0 &&
  typeof value.end === "number" &&
  Number.isSafeInteger(value.end) &&
  value.end >= value.start &&
  (value.coordinateSystem === "utf16" ||
    value.coordinateSystem === "unicode-scalar" ||
    value.coordinateSystem === "byte") &&
  typeof value.digest === "string";

const isMentionExpressionType = (value: unknown): boolean =>
  value === "name" ||
  value === "pronoun" ||
  value === "description" ||
  value === "demonstrative" ||
  value === "zero" ||
  value === "other";

const isJsonValue = (value: unknown): boolean => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
};

const isStringLikeValue = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "span-ref":
      return isRecord(value.span);
    case "opaque":
      return (
        typeof value.id === "string" &&
        typeof value.digest === "string" &&
        typeof value.sensitivity === "string"
      );
    case "constructed":
      return isRecord(value.plan);
    case "lexeme":
      return isRecord(value.lexeme);
    case "surface-literal":
      return typeof value.value === "string" && typeof value.origin === "string";
    default:
      return false;
  }
};

const isSemanticValue = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "ref":
      return typeof value.ref === "string";
    case "concept":
      return typeof value.concept === "string";
    case "string":
      return isStringLikeValue(value.value);
    case "number":
      return typeof value.value === "number" && Number.isFinite(value.value);
    case "boolean":
      return typeof value.value === "boolean";
    case "quantity":
      return (
        typeof value.amount === "number" &&
        Number.isFinite(value.amount) &&
        optionalString(value.unit) &&
        optionalString(value.comparator)
      );
    case "temporal":
      return typeof value.iso === "string" && typeof value.precision === "string";
    case "enum":
      return typeof value.value === "string";
    case "collection":
      return Array.isArray(value.values) && value.values.every(isSemanticValue);
    case "structured":
      return (
        isRecord(value.fields) &&
        Object.values(value.fields).every(isSemanticValue)
      );
    case "unknown":
      return (
        optionalString(value.expectedType) &&
        (value.candidates === undefined ||
          (Array.isArray(value.candidates) &&
            value.candidates.every(isSemanticValue)))
      );
    default:
      return false;
  }
};

const isRoleBindings = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      typeof item.role === "string" &&
      isSemanticValue(item.value),
  );

const isAttributes = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      typeof item.relation === "string" &&
      isSemanticValue(item.value),
  );

const isPolarity = (value: unknown): boolean =>
  value === "positive" || value === "negative";

const hasBaseEnvelope = (value: Record<string, unknown>): boolean =>
  typeof value.id === "string" &&
  typeof value.kind === "string" &&
  typeof value.schemaVersion === "string" &&
  typeof value.ontologyVersion === "string" &&
  isStringArray(value.provenance) &&
  typeof value.trust === "string" &&
  (value.annotations === undefined ||
    (isRecord(value.annotations) &&
      Object.values(value.annotations).every(isJsonValue)));

const structurallyValidNode = (value: unknown): value is JsgNode => {
  if (!isRecord(value) || !hasBaseEnvelope(value)) return false;

  switch (value.kind) {
    case "entity":
      return (
        typeof value.concept === "string" &&
        isAttributes(value.attributes) &&
        isStringArray(value.memberships) &&
        (value.names === undefined ||
          (Array.isArray(value.names) && value.names.every(isStringLikeValue)))
      );
    case "mention":
      return (
        typeof value.entityRef === "string" &&
        (value.sourceSpan === undefined || isSpanRef(value.sourceSpan)) &&
        isMentionExpressionType(value.expressionType) &&
        (value.language === undefined || typeof value.language === "string") &&
        typeof value.salience === "number" &&
        Number.isFinite(value.salience) &&
        value.salience >= 0
      );
    case "event":
      return (
        typeof value.predicate === "string" &&
        isRoleBindings(value.roles) &&
        isPolarity(value.polarity) &&
        optionalString(value.temporal)
      );
    case "state":
      return (
        typeof value.predicate === "string" &&
        isRoleBindings(value.arguments) &&
        isPolarity(value.polarity) &&
        optionalString(value.holder) &&
        optionalString(value.temporal)
      );
    case "action":
      return (
        typeof value.operation === "string" &&
        optionalString(value.actor) &&
        optionalString(value.target) &&
        isRoleBindings(value.parameters) &&
        isStringArray(value.preconditions) &&
        isStringArray(value.intendedEffects)
      );
    case "property":
      return (
        typeof value.subject === "string" &&
        typeof value.property === "string" &&
        isSemanticValue(value.value)
      );
    case "relation":
      return (
        typeof value.relation === "string" &&
        typeof value.source === "string" &&
        typeof value.target === "string" &&
        isPolarity(value.polarity)
      );
    case "proposition":
      return (
        typeof value.predicate === "string" &&
        isRoleBindings(value.arguments) &&
        isPolarity(value.polarity) &&
        optionalString(value.temporal) &&
        optionalString(value.attribution)
      );
    case "quantity":
      return (
        typeof value.amount === "number" &&
        Number.isFinite(value.amount) &&
        typeof value.comparator === "string" &&
        optionalString(value.unit) &&
        (value.approximate === undefined ||
          typeof value.approximate === "boolean")
      );
    case "temporal":
      return typeof value.temporalKind === "string" && isJsonValue(value.value);
    case "location":
      return (
        typeof value.locationKind === "string" &&
        isSemanticValue(value.value)
      );
    case "intent":
      return typeof value.intent === "string" && optionalString(value.content);
    case "goal":
      return typeof value.desired === "string" && optionalNumber(value.priority);
    case "constraint":
      return (
        typeof value.constraintKind === "string" &&
        typeof value.subject === "string" &&
        typeof value.predicate === "string" &&
        isRoleBindings(value.parameters)
      );
    case "alternative-set":
      return (
        Array.isArray(value.alternatives) &&
        value.alternatives.every(
          (item) =>
            isRecord(item) &&
            typeof item.ref === "string" &&
            optionalNumber(item.probability),
        ) &&
        optionalString(value.resolved)
      );
    case "reference":
      return isStringArray(value.candidates) && optionalString(value.resolved);
    case "collection":
      return isStringArray(value.members) && optionalString(value.concept);
    case "type":
      return (
        typeof value.concept === "string" &&
        (value.members === undefined || isStringArray(value.members))
      );
    case "definition":
      return (
        isStringLikeValue(value.term) &&
        typeof value.concept === "string" &&
        isSemanticValue(value.definition)
      );
    case "capability":
      return (
        isStringLikeValue(value.capabilityId) &&
        (value.description === undefined ||
          isSemanticValue(value.description)) &&
        (value.inputSchema === undefined || isJsonValue(value.inputSchema)) &&
        (value.outputSchema === undefined || isJsonValue(value.outputSchema))
      );
    case "evidence":
      return (
        isStringArray(value.supports) &&
        isStringArray(value.contradicts) &&
        isSemanticValue(value.payload)
      );
    case "unknown-concept":
      return (
        isStringLikeValue(value.mention) &&
        isStringArray(value.expectedParents) &&
        isStringArray(value.candidateConcepts)
      );
    default:
      return false;
  }
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

  const nodes = value.nodes as JsgNode[];
  const snapshot: GraphSnapshot = {
    schemaVersion: value.schemaVersion,
    ontologyVersion: value.ontologyVersion,
    revision: value.revision,
    ...(typeof value.parentRevision === "string"
      ? { parentRevision: value.parentRevision }
      : {}),
    nodes: nodes.map((node) => structuredClone(node)),
  };
  return ok(snapshot);
};
