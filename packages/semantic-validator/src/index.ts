import {
  isSemanticId,
  type JsonValue,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type { OntologyStore } from "../../ontology/src/index.ts";
import type {
  Diagnostic,
  GraphSnapshot,
  JsgNode,
  SemanticValue,
} from "../../semantic-graph/src/index.ts";

const knownKinds = new Set([
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

const refsFromValue = (value: SemanticValue): SemanticId[] => {
  switch (value.kind) {
    case "ref":
      return [value.ref];
    case "collection":
      return value.values.flatMap(refsFromValue);
    case "structured":
      return Object.values(value.fields).flatMap(refsFromValue);
    case "unknown":
      return value.candidates?.flatMap(refsFromValue) ?? [];
    default:
      return [];
  }
};

export const internalRefs = (node: JsgNode): SemanticId[] => {
  switch (node.kind) {
    case "entity":
      return [
        ...node.memberships,
        ...node.attributes.flatMap((attribute) => refsFromValue(attribute.value)),
      ];
    case "event":
      return [
        ...(node.temporal === undefined ? [] : [node.temporal]),
        ...node.roles.flatMap((role) => refsFromValue(role.value)),
      ];
    case "state":
      return [
        ...(node.holder === undefined ? [] : [node.holder]),
        ...(node.temporal === undefined ? [] : [node.temporal]),
        ...node.arguments.flatMap((argument) => refsFromValue(argument.value)),
      ];
    case "action":
      return [
        ...(node.actor === undefined ? [] : [node.actor]),
        ...(node.target === undefined ? [] : [node.target]),
        ...node.preconditions,
        ...node.intendedEffects,
        ...node.parameters.flatMap((argument) => refsFromValue(argument.value)),
      ];
    case "property":
      return [node.subject, ...refsFromValue(node.value)];
    case "relation":
      return [node.source, node.target];
    case "proposition":
      return [
        ...(node.temporal === undefined ? [] : [node.temporal]),
        ...(node.attribution === undefined ? [] : [node.attribution]),
        ...node.arguments.flatMap((argument) => refsFromValue(argument.value)),
      ];
    case "quantity":
    case "temporal":
      return [];
    case "location":
      return refsFromValue(node.value);
    case "intent":
      return node.content === undefined ? [] : [node.content];
    case "goal":
      return [node.desired];
    case "constraint":
      return [
        node.subject,
        ...node.parameters.flatMap((argument) => refsFromValue(argument.value)),
      ];
    case "alternative-set":
      return [
        ...node.alternatives.map((alternative) => alternative.ref),
        ...(node.resolved === undefined ? [] : [node.resolved]),
      ];
    case "reference":
      return [
        ...node.candidates,
        ...(node.resolved === undefined ? [] : [node.resolved]),
      ];
    case "collection":
      return [...node.members];
    case "type":
      return node.members ?? [];
    case "definition":
      return refsFromValue(node.definition);
    case "capability":
      return node.description === undefined ? [] : refsFromValue(node.description);
    case "evidence":
      return [
        ...node.supports,
        ...node.contradicts,
        ...refsFromValue(node.payload),
      ];
    case "unknown-concept":
      return [];
  }
};

const conceptRefs = (node: JsgNode): SemanticId[] => {
  switch (node.kind) {
    case "entity":
      return [node.concept];
    case "event":
      return [node.predicate, ...node.roles.map((role) => role.role)];
    case "state":
      return [node.predicate, ...node.arguments.map((argument) => argument.role)];
    case "action":
      return [node.operation, ...node.parameters.map((argument) => argument.role)];
    case "property":
      return [node.property];
    case "relation":
      return [node.relation];
    case "proposition":
      return [node.predicate, ...node.arguments.map((argument) => argument.role)];
    case "quantity":
      return node.unit === undefined ? [] : [node.unit];
    case "temporal":
    case "location":
      return [];
    case "intent":
      return [node.intent];
    case "goal":
      return [];
    case "constraint":
      return [node.predicate, ...node.parameters.map((argument) => argument.role)];
    case "alternative-set":
    case "reference":
      return [];
    case "collection":
      return node.concept === undefined ? [] : [node.concept];
    case "type":
      return [node.concept];
    case "definition":
      return [node.concept];
    case "capability":
    case "evidence":
      return [];
    case "unknown-concept":
      return [...node.expectedParents, ...node.candidateConcepts];
  }
};

export interface ValidationContext {
  ontology?: OntologyStore;
}

export const validateSnapshot = (
  snapshot: GraphSnapshot,
  context: ValidationContext = {},
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<SemanticId>();

  for (const node of snapshot.nodes) {
    if (!isSemanticId(node.id)) {
      diagnostics.push({
        code: "JSG000_INVALID_ID",
        severity: "error",
        message: `Invalid semantic ID: ${String(node.id)}`,
      });
    }
    if (!knownKinds.has(node.kind)) {
      diagnostics.push({
        code: "JSG900_UNSUPPORTED_NODE_KIND",
        severity: "fatal",
        message: `Unsupported node kind: ${String(node.kind)}`,
        nodeRefs: [node.id],
      });
    }
    if (ids.has(node.id)) {
      diagnostics.push({
        code: "JSG002_DUPLICATE_ID",
        severity: "error",
        message: `Duplicate node ID: ${node.id}`,
        nodeRefs: [node.id],
      });
    }
    ids.add(node.id);
  }

  for (const node of snapshot.nodes) {
    for (const ref of internalRefs(node)) {
      if (!ids.has(ref)) {
        diagnostics.push({
          code: "JSG001_DANGLING_REFERENCE",
          severity: "error",
          message: `Dangling internal reference ${ref} from ${node.id}`,
          nodeRefs: [node.id, ref],
        });
      }
    }

    if (context.ontology !== undefined) {
      for (const ref of conceptRefs(node)) {
        const isRole = ref.startsWith("role:");
        const found = isRole
          ? context.ontology.getRole(ref)
          : context.ontology.getConcept(ref);
        if (found === undefined) {
          diagnostics.push({
            code: "JSG010_UNKNOWN_ONTOLOGY_REF",
            severity: "error",
            message: `Unknown ontology reference ${ref}`,
            nodeRefs: [node.id],
            details: { ref } as JsonValue,
          });
        }
      }
    }

    if (
      (node.kind === "event" ||
        node.kind === "state" ||
        node.kind === "proposition" ||
        node.kind === "relation") &&
      node.polarity !== "positive" &&
      node.polarity !== "negative"
    ) {
      diagnostics.push({
        code: "JSG020_MISSING_POLARITY",
        severity: "error",
        message: "Polarity must be explicit.",
        nodeRefs: [node.id],
      });
    }
  }

  return diagnostics;
};

export const hasBlockingDiagnostics = (diagnostics: Diagnostic[]): boolean =>
  diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" || diagnostic.severity === "fatal",
  );
