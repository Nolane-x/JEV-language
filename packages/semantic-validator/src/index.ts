import {
  err,
  isSemanticId,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
  type TrustLabel,
} from "../../core-types/src/index.ts";
import type {
  ConceptRef,
  OntologyStore,
  RoleDefinition,
  RoleRef,
} from "../../ontology/src/index.ts";
import type {
  ProvenanceRecord,
  ProvenanceRef,
} from "../../provenance/src/index.ts";
import {
  validateGraphTopology,
  type CyclePermissionRegistry,
  type Diagnostic,
  type GraphSnapshot,
  type JsgNode,
  type SemanticValue,
} from "../../semantic-graph/src/index.ts";

export type ValidationStage =
  | "V0"
  | "V1"
  | "V2"
  | "V3"
  | "V4"
  | "V5"
  | "V6"
  | "V7"
  | "V8";

export const VALIDATION_PIPELINE: readonly ValidationStage[] = [
  "V0",
  "V1",
  "V2",
  "V3",
  "V4",
  "V5",
  "V6",
  "V7",
  "V8",
];

export interface DiagnosticDefinition {
  code: string;
  stage: ValidationStage;
  defaultSeverity: Diagnostic["severity"];
  description: string;
}

export const DIAGNOSTIC_REGISTRY = {
  JSG000_INVALID_ID: {
    code: "JSG000_INVALID_ID",
    stage: "V1",
    defaultSeverity: "error",
    description: "A semantic node identifier is malformed.",
  },
  JSG001_DANGLING_REFERENCE: {
    code: "JSG001_DANGLING_REFERENCE",
    stage: "V1",
    defaultSeverity: "error",
    description: "An internal semantic reference does not resolve.",
  },
  JSG002_DUPLICATE_ID: {
    code: "JSG002_DUPLICATE_ID",
    stage: "V1",
    defaultSeverity: "error",
    description: "Two semantic nodes share the same identifier.",
  },
  JSG003_SCHEMA_VERSION_MISMATCH: {
    code: "JSG003_SCHEMA_VERSION_MISMATCH",
    stage: "V0",
    defaultSeverity: "error",
    description: "A node schema version does not match its graph snapshot.",
  },
  JSG004_ONTOLOGY_VERSION_MISMATCH: {
    code: "JSG004_ONTOLOGY_VERSION_MISMATCH",
    stage: "V0",
    defaultSeverity: "error",
    description: "A node ontology version does not match its graph snapshot.",
  },
  JSG005_INVALID_CONFIDENCE: {
    code: "JSG005_INVALID_CONFIDENCE",
    stage: "V0",
    defaultSeverity: "error",
    description: "Confidence metadata is outside its supported runtime domain.",
  },
  JSG006_INVALID_NUMERIC_VALUE: {
    code: "JSG006_INVALID_NUMERIC_VALUE",
    stage: "V0",
    defaultSeverity: "error",
    description: "A numeric semantic value is non-finite or otherwise invalid.",
  },
  JSG007_INVALID_TRUST_LABEL: {
    code: "JSG007_INVALID_TRUST_LABEL",
    stage: "V0",
    defaultSeverity: "error",
    description: "A semantic node uses a trust label outside the declared trust lattice.",
  },
  JSG010_UNKNOWN_ONTOLOGY_REF: {
    code: "JSG010_UNKNOWN_ONTOLOGY_REF",
    stage: "V2",
    defaultSeverity: "error",
    description: "A semantic ontology reference cannot be resolved.",
  },
  JSG014_ROLE_DOMAIN_MISMATCH: {
    code: "JSG014_ROLE_DOMAIN_MISMATCH",
    stage: "V3",
    defaultSeverity: "error",
    description: "A role is bound on a semantic owner outside its declared domain.",
  },
  JSG015_ROLE_RANGE_MISMATCH: {
    code: "JSG015_ROLE_RANGE_MISMATCH",
    stage: "V3",
    defaultSeverity: "error",
    description: "A role value is outside its declared range.",
  },
  JSG016_RELATION_DOMAIN_MISMATCH: {
    code: "JSG016_RELATION_DOMAIN_MISMATCH",
    stage: "V3",
    defaultSeverity: "error",
    description: "A relation source is outside its declared domain.",
  },
  JSG017_RELATION_RANGE_MISMATCH: {
    code: "JSG017_RELATION_RANGE_MISMATCH",
    stage: "V3",
    defaultSeverity: "error",
    description: "A relation target is outside its declared range.",
  },
  JSG020_MISSING_POLARITY: {
    code: "JSG020_MISSING_POLARITY",
    stage: "V6",
    defaultSeverity: "error",
    description: "A polarity-bearing semantic node does not make polarity explicit.",
  },
  JSG021_ROLE_CARDINALITY: {
    code: "JSG021_ROLE_CARDINALITY",
    stage: "V4",
    defaultSeverity: "error",
    description: "A role binding violates its declared cardinality.",
  },
  JSG030_SCOPE_RESOLUTION_INVALID: {
    code: "JSG030_SCOPE_RESOLUTION_INVALID",
    stage: "V5",
    defaultSeverity: "error",
    description: "A resolved scope lacks a valid scope identity.",
  },
  JSG031_NEGATION_SCOPE_AMBIGUOUS: {
    code: "JSG031_NEGATION_SCOPE_AMBIGUOUS",
    stage: "V5",
    defaultSeverity: "warning",
    description: "A negative proposition has no explicit or underspecified scope marker.",
  },
  JSG032_BINDING_RESOLUTION_INVALID: {
    code: "JSG032_BINDING_RESOLUTION_INVALID",
    stage: "V5",
    defaultSeverity: "error",
    description: "A resolved reference is not a member of its candidate set.",
  },
  JSG040_EXACT_QUANTITY_WITHOUT_UNIT: {
    code: "JSG040_EXACT_QUANTITY_WITHOUT_UNIT",
    stage: "V6",
    defaultSeverity: "warning",
    description: "An exact quantity has no retained unit.",
  },
  JSG041_EVIDENCE_CONFLICT: {
    code: "JSG041_EVIDENCE_CONFLICT",
    stage: "V6",
    defaultSeverity: "error",
    description: "One evidence node both supports and contradicts the same semantic node.",
  },
  JSG050_UNPERMITTED_CYCLE: {
    code: "JSG050_UNPERMITTED_CYCLE",
    stage: "V1",
    defaultSeverity: "error",
    description: "A semantic cycle is present without an explicit cycle-permission rule.",
  },
  JSG900_UNSUPPORTED_NODE_KIND: {
    code: "JSG900_UNSUPPORTED_NODE_KIND",
    stage: "V0",
    defaultSeverity: "fatal",
    description: "The graph contains a node kind unsupported by this schema.",
  },
  VAL020_UNKNOWN_PROVENANCE_REF: {
    code: "VAL020_UNKNOWN_PROVENANCE_REF",
    stage: "V7",
    defaultSeverity: "error",
    description: "A semantic node references provenance that is not available.",
  },
  VAL021_MISSING_PROVENANCE: {
    code: "VAL021_MISSING_PROVENANCE",
    stage: "V7",
    defaultSeverity: "warning",
    description: "A semantic assertion has no provenance record.",
  },
  VAL022_UNTRUSTED_CONTROL_ESCALATION: {
    code: "VAL022_UNTRUSTED_CONTROL_ESCALATION",
    stage: "V7",
    defaultSeverity: "error",
    description: "Semantic content has stronger authority than its provenance can justify.",
  },
  VAL030_INVARIANT_REGISTRATION: {
    code: "VAL030_INVARIANT_REGISTRATION",
    stage: "V6",
    defaultSeverity: "error",
    description: "A semantic invariant registration is invalid.",
  },
} as const satisfies Record<string, DiagnosticDefinition>;

export type RegisteredDiagnosticCode = keyof typeof DIAGNOSTIC_REGISTRY;

export const diagnosticDefinition = (
  code: RegisteredDiagnosticCode,
): DiagnosticDefinition => DIAGNOSTIC_REGISTRY[code];

const makeDiagnostic = (
  code: RegisteredDiagnosticCode,
  message: string,
  input: {
    severity?: Diagnostic["severity"];
    nodeRefs?: SemanticId[];
    details?: JsonValue;
  } = {},
): Diagnostic => ({
  code,
  severity: input.severity ?? DIAGNOSTIC_REGISTRY[code].defaultSeverity,
  message,
  ...(input.nodeRefs === undefined ? {} : { nodeRefs: input.nodeRefs }),
  ...(input.details === undefined ? {} : { details: input.details }),
});

const knownKinds = new Set<string>([
  "entity",
  "mention",
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

const knownTrust = new Set<TrustLabel>([
  "system-trusted",
  "configured-trusted",
  "user-instruction",
  "user-content",
  "external-content",
  "untrusted-generated",
  "unknown",
]);

const authorityRank: Record<TrustLabel, number> = {
  "system-trusted": 6,
  "configured-trusted": 5,
  "user-instruction": 4,
  "user-content": 3,
  "external-content": 2,
  "untrusted-generated": 1,
  unknown: 0,
};

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

const conceptRefsFromValue = (value: SemanticValue): ConceptRef[] => {
  switch (value.kind) {
    case "concept":
      return [value.concept];
    case "quantity":
      return value.unit === undefined ? [] : [value.unit];
    case "collection":
      return value.values.flatMap(conceptRefsFromValue);
    case "structured":
      return Object.values(value.fields).flatMap(conceptRefsFromValue);
    case "unknown":
      return value.candidates?.flatMap(conceptRefsFromValue) ?? [];
    default:
      return [];
  }
};

const hasInvalidNumber = (value: SemanticValue): boolean => {
  switch (value.kind) {
    case "number":
      return !Number.isFinite(value.value);
    case "quantity":
      return !Number.isFinite(value.amount);
    case "collection":
      return value.values.some(hasInvalidNumber);
    case "structured":
      return Object.values(value.fields).some(hasInvalidNumber);
    case "unknown":
      return value.candidates?.some(hasInvalidNumber) ?? false;
    default:
      return false;
  }
};

const semanticValues = (node: JsgNode): SemanticValue[] => {
  switch (node.kind) {
    case "entity":
      return node.attributes.map((attribute) => attribute.value);
    case "event":
      return node.roles.map((binding) => binding.value);
    case "state":
      return node.arguments.map((binding) => binding.value);
    case "action":
      return node.parameters.map((binding) => binding.value);
    case "property":
      return [node.value];
    case "proposition":
      return node.arguments.map((binding) => binding.value);
    case "location":
      return [node.value];
    case "constraint":
      return node.parameters.map((binding) => binding.value);
    case "definition":
      return [node.definition];
    case "capability":
      return node.description === undefined ? [] : [node.description];
    case "evidence":
      return [node.payload];
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
    case "mention":
      return [node.entityRef];
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
        ...(node.epistemic?.source === undefined ? [] : [node.epistemic.source]),
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

type OntologyRefKind = "concept" | "role" | "relation";

interface OntologyRefUse {
  kind: OntologyRefKind;
  ref: SemanticId;
}

const ontologyRefs = (node: JsgNode): OntologyRefUse[] => {
  const concepts = (refs: readonly ConceptRef[]): OntologyRefUse[] =>
    refs.map((ref) => ({ kind: "concept", ref }));
  const roles = (refs: readonly RoleRef[]): OntologyRefUse[] =>
    refs.map((ref) => ({ kind: "role", ref }));

  const valueConcepts = semanticValues(node).flatMap(conceptRefsFromValue);

  switch (node.kind) {
    case "entity":
      return [
        { kind: "concept", ref: node.concept },
        ...concepts(node.attributes.map((attribute) => attribute.relation)),
        ...concepts(valueConcepts),
      ];
    case "event":
      return [
        { kind: "concept", ref: node.predicate },
        ...roles(node.roles.map((binding) => binding.role)),
        ...concepts(valueConcepts),
      ];
    case "state":
      return [
        { kind: "concept", ref: node.predicate },
        ...roles(node.arguments.map((binding) => binding.role)),
        ...concepts(valueConcepts),
      ];
    case "action":
      return [
        { kind: "concept", ref: node.operation },
        ...roles(node.parameters.map((binding) => binding.role)),
        ...concepts(valueConcepts),
      ];
    case "property":
      return [
        { kind: "concept", ref: node.property },
        ...concepts(valueConcepts),
      ];
    case "relation":
      return [{ kind: "relation", ref: node.relation }];
    case "proposition":
      return [
        { kind: "concept", ref: node.predicate },
        ...roles(node.arguments.map((binding) => binding.role)),
        ...concepts(valueConcepts),
      ];
    case "quantity":
      return node.unit === undefined
        ? []
        : [{ kind: "concept", ref: node.unit }];
    case "intent":
      return [{ kind: "concept", ref: node.intent }];
    case "constraint":
      return [
        { kind: "concept", ref: node.predicate },
        ...roles(node.parameters.map((binding) => binding.role)),
        ...concepts(valueConcepts),
      ];
    case "collection":
      return node.concept === undefined
        ? []
        : [{ kind: "concept", ref: node.concept }];
    case "type":
      return [{ kind: "concept", ref: node.concept }];
    case "definition":
      return [
        { kind: "concept", ref: node.concept },
        ...concepts(valueConcepts),
      ];
    case "unknown-concept":
      return concepts([
        ...node.expectedParents,
        ...node.candidateConcepts,
      ]);
    default:
      return concepts(valueConcepts);
  }
};

interface RoleBindingLike {
  role: RoleRef;
  value: SemanticValue;
}

const roleBindings = (node: JsgNode): RoleBindingLike[] => {
  switch (node.kind) {
    case "event":
      return node.roles;
    case "state":
      return node.arguments;
    case "action":
      return node.parameters;
    case "proposition":
      return node.arguments;
    case "constraint":
      return node.parameters;
    default:
      return [];
  }
};

const directNodeConcepts = (node: JsgNode): ConceptRef[] => {
  switch (node.kind) {
    case "entity":
      return [node.concept];
    case "event":
      return [node.predicate];
    case "state":
      return [node.predicate];
    case "action":
      return [node.operation];
    case "property":
      return [node.property];
    case "proposition":
      return [node.predicate];
    case "constraint":
      return [node.predicate];
    case "collection":
      return node.concept === undefined ? [] : [node.concept];
    case "type":
      return [node.concept];
    case "definition":
      return [node.concept];
    case "unknown-concept":
      return [...node.candidateConcepts, ...node.expectedParents];
    default:
      return [];
  }
};

const conceptsForValue = (
  value: SemanticValue,
  nodes: ReadonlyMap<SemanticId, JsgNode>,
): ConceptRef[] => {
  switch (value.kind) {
    case "concept":
      return [value.concept];
    case "ref": {
      const target = nodes.get(value.ref);
      return target === undefined ? [] : directNodeConcepts(target);
    }
    case "collection":
      return value.values.flatMap((member) => conceptsForValue(member, nodes));
    case "structured":
      return Object.values(value.fields).flatMap((member) =>
        conceptsForValue(member, nodes),
      );
    case "unknown":
      return value.candidates?.flatMap((candidate) =>
        conceptsForValue(candidate, nodes),
      ) ?? [];
    default:
      return [];
  }
};

const matchesAnyConcept = (
  actual: readonly ConceptRef[],
  expected: readonly ConceptRef[],
  ontology: OntologyStore,
): boolean => {
  if (actual.length === 0 || expected.length === 0) return true;
  const knownActual = actual.filter(
    (concept) => ontology.getConcept(concept) !== undefined,
  );
  if (knownActual.length === 0) return true;
  return knownActual.every((concept) =>
    expected.some((parent) => ontology.isA(concept, parent)),
  );
};

export interface ProvenanceLookup {
  has(ref: ProvenanceRef): boolean;
  get(ref: ProvenanceRef): ProvenanceRecord | undefined;
}

export interface ProfileValidator {
  id: string;
  validate(snapshot: GraphSnapshot, context: ValidationContext): Diagnostic[];
}

export interface NodeSelector {
  kinds?: readonly JsgNode["kind"][];
}

export interface InvariantContext {
  snapshot: GraphSnapshot;
  validation: ValidationContext;
  nodes: ReadonlyMap<SemanticId, JsgNode>;
  node?: JsgNode;
}

export interface SemanticInvariant {
  id: string;
  description: string;
  appliesTo?: NodeSelector;
  check(context: InvariantContext): Diagnostic[];
}

const selectorMatches = (selector: NodeSelector | undefined, node: JsgNode): boolean =>
  selector?.kinds === undefined || selector.kinds.includes(node.kind);

export class SemanticInvariantRegistry {
  readonly #invariants = new Map<string, SemanticInvariant>();

  register(invariant: SemanticInvariant): Result<void> {
    if (invariant.id.trim() === "") {
      return err(
        new StructuredError(
          "VAL030_INVARIANT_REGISTRATION",
          "Semantic invariant id is required.",
        ),
      );
    }
    if (this.#invariants.has(invariant.id)) {
      return err(
        new StructuredError(
          "VAL030_INVARIANT_REGISTRATION",
          `Semantic invariant already registered: ${invariant.id}.`,
        ),
      );
    }
    this.#invariants.set(invariant.id, invariant);
    return ok(undefined);
  }

  list(): SemanticInvariant[] {
    return [...this.#invariants.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((invariant) => ({ ...invariant }));
  }

  validate(snapshot: GraphSnapshot, validation: ValidationContext): Diagnostic[] {
    const nodes = new Map(snapshot.nodes.map((node) => [node.id, node] as const));
    const diagnostics: Diagnostic[] = [];

    for (const invariant of this.list()) {
      if (invariant.appliesTo === undefined) {
        diagnostics.push(...invariant.check({ snapshot, validation, nodes }));
        continue;
      }
      for (const node of snapshot.nodes) {
        if (!selectorMatches(invariant.appliesTo, node)) continue;
        diagnostics.push(
          ...invariant.check({ snapshot, validation, nodes, node }),
        );
      }
    }
    return diagnostics;
  }
}

export const createCoreInvariantRegistry = (): SemanticInvariantRegistry => {
  const registry = new SemanticInvariantRegistry();

  const polarity = registry.register({
    id: "core.explicit-polarity",
    description:
      "Polarity-bearing event/state/proposition/relation nodes must be explicit.",
    appliesTo: {
      kinds: ["event", "state", "proposition", "relation"],
    },
    check({ node }) {
      if (
        node === undefined ||
        !("polarity" in node) ||
        node.polarity === "positive" ||
        node.polarity === "negative"
      ) {
        return [];
      }
      return [
        makeDiagnostic(
          "JSG020_MISSING_POLARITY",
          "Polarity must be explicit.",
          { nodeRefs: [node.id] },
        ),
      ];
    },
  });
  if (!polarity.ok) throw polarity.error;

  const quantities = registry.register({
    id: "core.exact-quantity-retains-unit",
    description:
      "Exact semantic quantities should retain their unit when represented as QuantityNode.",
    appliesTo: { kinds: ["quantity"] },
    check({ node }) {
      if (
        node?.kind !== "quantity" ||
        node.comparator !== "exact" ||
        node.unit !== undefined
      ) {
        return [];
      }
      return [
        makeDiagnostic(
          "JSG040_EXACT_QUANTITY_WITHOUT_UNIT",
          "Exact quantity has no retained unit; verify that it is intentionally dimensionless.",
          { nodeRefs: [node.id] },
        ),
      ];
    },
  });
  if (!quantities.ok) throw quantities.error;

  const evidence = registry.register({
    id: "core.evidence-support-contradiction-disjoint",
    description:
      "One evidence node cannot support and contradict the same target simultaneously.",
    appliesTo: { kinds: ["evidence"] },
    check({ node }) {
      if (node?.kind !== "evidence") return [];
      const contradicts = new Set(node.contradicts);
      const conflicts = node.supports
        .filter((ref) => contradicts.has(ref))
        .sort();
      if (conflicts.length === 0) return [];
      return [
        makeDiagnostic(
          "JSG041_EVIDENCE_CONFLICT",
          `Evidence node ${node.id} both supports and contradicts the same target.`,
          {
            nodeRefs: [node.id, ...conflicts],
            details: { conflicts } as JsonValue,
          },
        ),
      ];
    },
  });
  if (!evidence.ok) throw evidence.error;

  return registry;
};

export interface ValidationContext {
  ontology?: OntologyStore;
  provenance?: ProvenanceLookup;
  invariants?: SemanticInvariantRegistry;
  cyclePermissions?: CyclePermissionRegistry;
  profileValidators?: readonly ProfileValidator[];
}

export interface ValidationStageReport {
  stage: ValidationStage;
  diagnostics: Diagnostic[];
}

export interface ValidationReport {
  stages: ValidationStageReport[];
  diagnostics: Diagnostic[];
}

const validateV0 = (snapshot: GraphSnapshot): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  for (const node of snapshot.nodes) {
    if (!knownKinds.has(node.kind)) {
      diagnostics.push(
        makeDiagnostic(
          "JSG900_UNSUPPORTED_NODE_KIND",
          `Unsupported node kind: ${String(node.kind)}`,
          { nodeRefs: [node.id] },
        ),
      );
    }
    if (node.schemaVersion !== snapshot.schemaVersion) {
      diagnostics.push(
        makeDiagnostic(
          "JSG003_SCHEMA_VERSION_MISMATCH",
          `Node ${node.id} schema version ${node.schemaVersion} does not match snapshot ${snapshot.schemaVersion}.`,
          { nodeRefs: [node.id] },
        ),
      );
    }
    if (node.ontologyVersion !== snapshot.ontologyVersion) {
      diagnostics.push(
        makeDiagnostic(
          "JSG004_ONTOLOGY_VERSION_MISMATCH",
          `Node ${node.id} ontology version ${node.ontologyVersion} does not match snapshot ${snapshot.ontologyVersion}.`,
          { nodeRefs: [node.id] },
        ),
      );
    }
    if (!knownTrust.has(node.trust)) {
      diagnostics.push(
        makeDiagnostic(
          "JSG007_INVALID_TRUST_LABEL",
          `Unsupported trust label on ${node.id}: ${String(node.trust)}.`,
          { nodeRefs: [node.id] },
        ),
      );
    }

    const probability = node.confidence?.probability;
    const evidenceCount = node.confidence?.evidenceCount;
    if (
      (probability !== undefined &&
        (!Number.isFinite(probability) || probability < 0 || probability > 1)) ||
      (evidenceCount !== undefined &&
        (!Number.isInteger(evidenceCount) || evidenceCount < 0))
    ) {
      diagnostics.push(
        makeDiagnostic(
          "JSG005_INVALID_CONFIDENCE",
          `Node ${node.id} has invalid confidence metadata.`,
          { nodeRefs: [node.id] },
        ),
      );
    }

    const nodeHasInvalidNumber =
      (node.kind === "quantity" && !Number.isFinite(node.amount)) ||
      (node.kind === "mention" &&
        (!Number.isFinite(node.salience) || node.salience < 0)) ||
      semanticValues(node).some(hasInvalidNumber) ||
      (node.kind === "alternative-set" &&
        node.alternatives.some(
          (alternative) =>
            alternative.probability !== undefined &&
            (!Number.isFinite(alternative.probability) ||
              alternative.probability < 0 ||
              alternative.probability > 1),
        ));

    if (nodeHasInvalidNumber) {
      diagnostics.push(
        makeDiagnostic(
          "JSG006_INVALID_NUMERIC_VALUE",
          `Node ${node.id} contains an invalid numeric semantic value.`,
          { nodeRefs: [node.id] },
        ),
      );
    }
  }

  return diagnostics;
};

const validateV1 = (
  snapshot: GraphSnapshot,
  context: ValidationContext,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<SemanticId>();

  for (const node of snapshot.nodes) {
    if (!isSemanticId(node.id)) {
      diagnostics.push(
        makeDiagnostic(
          "JSG000_INVALID_ID",
          `Invalid semantic ID: ${String(node.id)}`,
        ),
      );
    }
    if (ids.has(node.id)) {
      diagnostics.push(
        makeDiagnostic(
          "JSG002_DUPLICATE_ID",
          `Duplicate node ID: ${node.id}`,
          { nodeRefs: [node.id] },
        ),
      );
    }
    ids.add(node.id);
  }

  for (const node of snapshot.nodes) {
    for (const ref of internalRefs(node)) {
      if (!ids.has(ref)) {
        diagnostics.push(
          makeDiagnostic(
            "JSG001_DANGLING_REFERENCE",
            `Dangling internal reference ${ref} from ${node.id}`,
            { nodeRefs: [node.id, ref] },
          ),
        );
      }
    }
  }

  diagnostics.push(
    ...validateGraphTopology(snapshot, context.cyclePermissions).map((diagnostic) =>
      diagnostic.code === "JSG050_UNPERMITTED_CYCLE"
        ? makeDiagnostic(
            "JSG050_UNPERMITTED_CYCLE",
            diagnostic.message,
            {
              ...(diagnostic.nodeRefs === undefined
                ? {}
                : { nodeRefs: diagnostic.nodeRefs }),
              ...(diagnostic.details === undefined
                ? {}
                : { details: diagnostic.details }),
            },
          )
        : diagnostic,
    ),
  );

  return diagnostics;
};

const ontologyUseExists = (
  use: OntologyRefUse,
  ontology: OntologyStore,
): boolean => {
  switch (use.kind) {
    case "role":
      return ontology.getRole(use.ref) !== undefined;
    case "relation":
      return (
        ontology.getRelation(use.ref) !== undefined ||
        ontology.getConcept(use.ref) !== undefined
      );
    case "concept":
      return ontology.getConcept(use.ref) !== undefined;
  }
};

const validateV2 = (
  snapshot: GraphSnapshot,
  context: ValidationContext,
): Diagnostic[] => {
  if (context.ontology === undefined) return [];
  const diagnostics: Diagnostic[] = [];

  for (const node of snapshot.nodes) {
    for (const use of ontologyRefs(node)) {
      if (ontologyUseExists(use, context.ontology)) continue;
      diagnostics.push(
        makeDiagnostic(
          "JSG010_UNKNOWN_ONTOLOGY_REF",
          `Unknown ontology ${use.kind} reference ${use.ref}`,
          {
            nodeRefs: [node.id],
            details: { ref: use.ref, kind: use.kind } as JsonValue,
          },
        ),
      );
    }
  }

  return diagnostics;
};

const validateV3 = (
  snapshot: GraphSnapshot,
  context: ValidationContext,
): Diagnostic[] => {
  const ontology = context.ontology;
  if (ontology === undefined) return [];

  const diagnostics: Diagnostic[] = [];
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node] as const));

  for (const node of snapshot.nodes) {
    const ownerConcepts = directNodeConcepts(node);

    for (const binding of roleBindings(node)) {
      const definition = ontology.getRole(binding.role);
      if (definition === undefined) continue;

      if (
        definition.domain !== undefined &&
        definition.domain.length > 0 &&
        !matchesAnyConcept(ownerConcepts, definition.domain, ontology)
      ) {
        diagnostics.push(
          makeDiagnostic(
            "JSG014_ROLE_DOMAIN_MISMATCH",
            `Role ${binding.role} is outside its declared domain on ${node.id}.`,
            {
              nodeRefs: [node.id],
              details: {
                role: binding.role,
                actual: ownerConcepts,
                expected: definition.domain,
              } as JsonValue,
            },
          ),
        );
      }

      if (definition.range !== undefined && definition.range.length > 0) {
        const actual = conceptsForValue(binding.value, nodes);
        if (!matchesAnyConcept(actual, definition.range, ontology)) {
          diagnostics.push(
            makeDiagnostic(
              "JSG015_ROLE_RANGE_MISMATCH",
              `Role ${binding.role} value is outside its declared range on ${node.id}.`,
              {
                nodeRefs: [node.id, ...refsFromValue(binding.value)],
                details: {
                  role: binding.role,
                  actual,
                  expected: definition.range,
                } as JsonValue,
              },
            ),
          );
        }
      }
    }

    if (node.kind !== "relation") continue;
    const definition = ontology.getRelation(node.relation);
    if (definition === undefined) continue;

    const source = nodes.get(node.source);
    const target = nodes.get(node.target);
    const sourceConcepts = source === undefined ? [] : directNodeConcepts(source);
    const targetConcepts = target === undefined ? [] : directNodeConcepts(target);

    if (
      definition.domain !== undefined &&
      definition.domain.length > 0 &&
      !matchesAnyConcept(sourceConcepts, definition.domain, ontology)
    ) {
      diagnostics.push(
        makeDiagnostic(
          "JSG016_RELATION_DOMAIN_MISMATCH",
          `Relation ${node.relation} source is outside its declared domain.`,
          {
            nodeRefs: [node.id, node.source],
            details: {
              actual: sourceConcepts,
              expected: definition.domain,
            } as JsonValue,
          },
        ),
      );
    }
    if (
      definition.range !== undefined &&
      definition.range.length > 0 &&
      !matchesAnyConcept(targetConcepts, definition.range, ontology)
    ) {
      diagnostics.push(
        makeDiagnostic(
          "JSG017_RELATION_RANGE_MISMATCH",
          `Relation ${node.relation} target is outside its declared range.`,
          {
            nodeRefs: [node.id, node.target],
            details: {
              actual: targetConcepts,
              expected: definition.range,
            } as JsonValue,
          },
        ),
      );
    }
  }

  return diagnostics;
};

const roleMinimum = (definition: RoleDefinition): number =>
  definition.cardinality === "exactly-one" ||
  definition.cardinality === "one-or-many"
    ? 1
    : 0;

const roleMaximum = (definition: RoleDefinition): number | undefined =>
  definition.cardinality === "zero-or-one" ||
  definition.cardinality === "exactly-one"
    ? 1
    : undefined;

const roleAppliesToNode = (
  definition: RoleDefinition,
  node: JsgNode,
  ontology: OntologyStore,
): boolean => {
  if (definition.domain === undefined || definition.domain.length === 0) {
    return false;
  }
  const actual = directNodeConcepts(node).filter(
    (concept) => ontology.getConcept(concept) !== undefined,
  );
  if (actual.length === 0) return false;
  return matchesAnyConcept(actual, definition.domain, ontology);
};

const validateV4 = (
  snapshot: GraphSnapshot,
  context: ValidationContext,
): Diagnostic[] => {
  const ontology = context.ontology;
  if (ontology === undefined) return [];

  const diagnostics: Diagnostic[] = [];
  const roleDefinitions = ontology.snapshot().roles;

  for (const node of snapshot.nodes) {
    const bindings = roleBindings(node);
    const counts = new Map<RoleRef, number>();
    for (const binding of bindings) {
      counts.set(binding.role, (counts.get(binding.role) ?? 0) + 1);
    }

    for (const definition of roleDefinitions) {
      if (definition.cardinality === undefined) continue;
      const count = counts.get(definition.id) ?? 0;
      const minimum = roleMinimum(definition);
      const maximum = roleMaximum(definition);
      const applicable =
        count > 0 || roleAppliesToNode(definition, node, ontology);

      if (!applicable) continue;
      if (count < minimum || (maximum !== undefined && count > maximum)) {
        diagnostics.push(
          makeDiagnostic(
            "JSG021_ROLE_CARDINALITY",
            `Role ${definition.id} occurs ${count} time(s) on ${node.id}, violating ${definition.cardinality}.`,
            {
              nodeRefs: [node.id],
              details: {
                role: definition.id,
                cardinality: definition.cardinality,
                count,
              } as JsonValue,
            },
          ),
        );
      }
    }
  }

  return diagnostics;
};

const validateV5 = (snapshot: GraphSnapshot): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  for (const node of snapshot.nodes) {
    if (node.kind === "proposition") {
      if (
        node.scope?.kind === "resolved" &&
        (node.scope.scopeId === undefined || !isSemanticId(node.scope.scopeId))
      ) {
        diagnostics.push(
          makeDiagnostic(
            "JSG030_SCOPE_RESOLUTION_INVALID",
            `Resolved scope on ${node.id} requires a valid scopeId.`,
            { nodeRefs: [node.id] },
          ),
        );
      }
      if (node.polarity === "negative" && node.scope === undefined) {
        diagnostics.push(
          makeDiagnostic(
            "JSG031_NEGATION_SCOPE_AMBIGUOUS",
            `Negative proposition ${node.id} has no explicit scope marker.`,
            { nodeRefs: [node.id] },
          ),
        );
      }
    }

    if (
      node.kind === "reference" &&
      node.resolved !== undefined &&
      !node.candidates.includes(node.resolved)
    ) {
      diagnostics.push(
        makeDiagnostic(
          "JSG032_BINDING_RESOLUTION_INVALID",
          `Reference ${node.id} resolves to a value outside its candidate set.`,
          { nodeRefs: [node.id, node.resolved] },
        ),
      );
    }

    if (
      node.kind === "alternative-set" &&
      node.resolved !== undefined &&
      !node.alternatives.some((alternative) => alternative.ref === node.resolved)
    ) {
      diagnostics.push(
        makeDiagnostic(
          "JSG032_BINDING_RESOLUTION_INVALID",
          `Alternative set ${node.id} resolves to a value outside its alternatives.`,
          { nodeRefs: [node.id, node.resolved] },
        ),
      );
    }
  }

  return diagnostics;
};

const validateV7 = (
  snapshot: GraphSnapshot,
  context: ValidationContext,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  for (const node of snapshot.nodes) {
    if (node.provenance.length === 0) {
      diagnostics.push(
        makeDiagnostic(
          "VAL021_MISSING_PROVENANCE",
          `Semantic node ${node.id} has no provenance.`,
          { nodeRefs: [node.id] },
        ),
      );
      continue;
    }

    const lookup = context.provenance;
    if (lookup === undefined) continue;

    const records: ProvenanceRecord[] = [];
    for (const ref of node.provenance) {
      const record = lookup.get(ref);
      if (record === undefined || !lookup.has(ref)) {
        diagnostics.push(
          makeDiagnostic(
            "VAL020_UNKNOWN_PROVENANCE_REF",
            `Semantic node ${node.id} references missing provenance ${ref}.`,
            {
              nodeRefs: [node.id],
              details: { provenanceRef: ref } as JsonValue,
            },
          ),
        );
        continue;
      }
      records.push(record);
    }

    if (records.length > 0) {
      const strongestJustifiedAuthority = Math.max(
        ...records.map((record) => authorityRank[record.trust]),
      );
      if (authorityRank[node.trust] > strongestJustifiedAuthority) {
        diagnostics.push(
          makeDiagnostic(
            "VAL022_UNTRUSTED_CONTROL_ESCALATION",
            `Semantic node ${node.id} has stronger trust than its declared provenance can justify.`,
            {
              nodeRefs: [node.id],
              details: {
                nodeTrust: node.trust,
                provenanceTrust: records.map((record) => record.trust),
              } as JsonValue,
            },
          ),
        );
      }
    }
  }

  return diagnostics;
};

const stageDiagnostics = (
  stage: ValidationStage,
  snapshot: GraphSnapshot,
  context: ValidationContext,
): Diagnostic[] => {
  switch (stage) {
    case "V0":
      return validateV0(snapshot);
    case "V1":
      return validateV1(snapshot, context);
    case "V2":
      return validateV2(snapshot, context);
    case "V3":
      return validateV3(snapshot, context);
    case "V4":
      return validateV4(snapshot, context);
    case "V5":
      return validateV5(snapshot);
    case "V6":
      return (context.invariants ?? createCoreInvariantRegistry()).validate(
        snapshot,
        context,
      );
    case "V7":
      return validateV7(snapshot, context);
    case "V8":
      return (context.profileValidators ?? [])
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .flatMap((validator) => validator.validate(snapshot, context));
  }
};

export const validateSnapshotStages = (
  snapshot: GraphSnapshot,
  context: ValidationContext = {},
  stages: readonly ValidationStage[] = VALIDATION_PIPELINE,
): ValidationReport => {
  const reports = stages.map((stage) => ({
    stage,
    diagnostics: stageDiagnostics(stage, snapshot, context),
  }));
  return {
    stages: reports,
    diagnostics: reports.flatMap((report) => report.diagnostics),
  };
};

export const validateSnapshot = (
  snapshot: GraphSnapshot,
  context: ValidationContext = {},
): Diagnostic[] => validateSnapshotStages(snapshot, context).diagnostics;

export const hasBlockingDiagnostics = (
  diagnostics: readonly Diagnostic[],
): boolean =>
  diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" || diagnostic.severity === "fatal",
  );
