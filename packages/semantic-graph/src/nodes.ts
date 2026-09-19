import type {
  ConfidenceValue,
  JsonValue,
  SemanticId,
  TrustLabel,
} from "../../core-types/src/index.ts";
import type {
  StringLikeValue,
} from "../../open-world-values/src/index.ts";
import type {
  ConceptRef,
  RoleRef,
} from "../../ontology/src/index.ts";
import type { ProvenanceRef } from "../../provenance/src/index.ts";

export type JsgNodeKind =
  | "entity"
  | "event"
  | "state"
  | "action"
  | "property"
  | "relation"
  | "proposition"
  | "quantity"
  | "temporal"
  | "location"
  | "intent"
  | "goal"
  | "constraint"
  | "alternative-set"
  | "reference"
  | "collection"
  | "type"
  | "definition"
  | "capability"
  | "evidence"
  | "unknown-concept";

export type Polarity = "positive" | "negative";
export type SemanticRef = SemanticId;

export interface ModalitySpec {
  kind:
    | "asserted"
    | "possible"
    | "probable"
    | "necessary"
    | "permitted"
    | "required"
    | "forbidden"
    | "hypothetical"
    | "counterfactual";
  strength?: number;
}

export interface EpistemicSpec {
  status:
    | "asserted"
    | "believed"
    | "suspected"
    | "reported"
    | "questioned"
    | "unknown";
  source?: SemanticRef;
}

export interface ScopeSpec {
  kind: "resolved" | "underspecified";
  scopeId?: SemanticId;
}

export interface JsgNodeBase<K extends JsgNodeKind> {
  id: SemanticId;
  kind: K;
  schemaVersion: string;
  ontologyVersion: string;
  provenance: ProvenanceRef[];
  trust: TrustLabel;
  confidence?: ConfidenceValue;
  annotations?: Record<string, JsonValue>;
}

export type SemanticValue =
  | { kind: "ref"; ref: SemanticRef }
  | { kind: "concept"; concept: ConceptRef }
  | { kind: "string"; value: StringLikeValue }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | {
      kind: "quantity";
      amount: number;
      unit?: ConceptRef;
      comparator?: "exact" | "at-least" | "at-most" | "more-than" | "less-than";
    }
  | { kind: "temporal"; iso: string; precision: "date" | "time" | "datetime" | "duration" }
  | { kind: "enum"; value: string }
  | { kind: "collection"; values: SemanticValue[] }
  | { kind: "structured"; fields: Record<string, SemanticValue> }
  | { kind: "unknown"; expectedType?: string; candidates?: SemanticValue[] };

export interface SemanticAttribute {
  relation: ConceptRef;
  value: SemanticValue;
}

export interface RoleBinding {
  role: RoleRef;
  value: SemanticValue;
}

export interface SemanticArgument {
  role: RoleRef;
  value: SemanticValue;
}

export interface EntityNode extends JsgNodeBase<"entity"> {
  concept: ConceptRef;
  names?: StringLikeValue[];
  attributes: SemanticAttribute[];
  memberships: SemanticRef[];
  lifecycle?: "active" | "historical" | "hypothetical" | "unknown";
}

export interface EventNode extends JsgNodeBase<"event"> {
  predicate: ConceptRef;
  roles: RoleBinding[];
  temporal?: SemanticRef;
  aspect?: "completed" | "ongoing" | "planned" | "habitual" | "unknown";
  modality?: ModalitySpec;
  polarity: Polarity;
}

export interface StateNode extends JsgNodeBase<"state"> {
  predicate: ConceptRef;
  holder?: SemanticRef;
  arguments: RoleBinding[];
  temporal?: SemanticRef;
  polarity: Polarity;
}

export interface ActionNode extends JsgNodeBase<"action"> {
  operation: ConceptRef;
  actor?: SemanticRef;
  target?: SemanticRef;
  parameters: SemanticArgument[];
  preconditions: SemanticRef[];
  intendedEffects: SemanticRef[];
}

export interface PropertyNode extends JsgNodeBase<"property"> {
  subject: SemanticRef;
  property: ConceptRef;
  value: SemanticValue;
}

export interface RelationNode extends JsgNodeBase<"relation"> {
  relation: ConceptRef;
  source: SemanticRef;
  target: SemanticRef;
  polarity: Polarity;
}

export interface PropositionNode extends JsgNodeBase<"proposition"> {
  predicate: ConceptRef;
  arguments: RoleBinding[];
  polarity: Polarity;
  modality?: ModalitySpec;
  epistemic?: EpistemicSpec;
  temporal?: SemanticRef;
  scope?: ScopeSpec;
  attribution?: SemanticRef;
}

export interface QuantityNode extends JsgNodeBase<"quantity"> {
  amount: number;
  unit?: ConceptRef;
  comparator: "exact" | "at-least" | "at-most" | "more-than" | "less-than";
  approximate?: boolean;
}

export interface TemporalNode extends JsgNodeBase<"temporal"> {
  temporalKind: "instant" | "interval" | "duration" | "recurrence" | "relative";
  value: JsonValue;
}

export interface LocationNode extends JsgNodeBase<"location"> {
  locationKind: "physical" | "virtual" | "logical" | "source" | "document" | "graph";
  value: SemanticValue;
}

export interface IntentNode extends JsgNodeBase<"intent"> {
  intent: ConceptRef;
  content?: SemanticRef;
}

export interface GoalNode extends JsgNodeBase<"goal"> {
  desired: SemanticRef;
  priority?: number;
}

export interface ConstraintNode extends JsgNodeBase<"constraint"> {
  constraintKind: "requirement" | "permission" | "prohibition" | "condition";
  subject: SemanticRef;
  predicate: ConceptRef;
  parameters: SemanticArgument[];
}

export interface AlternativeSetNode extends JsgNodeBase<"alternative-set"> {
  alternatives: Array<{ ref: SemanticRef; probability?: number }>;
  resolved?: SemanticRef;
}

export interface ReferenceNode extends JsgNodeBase<"reference"> {
  candidates: SemanticRef[];
  resolved?: SemanticRef;
}

export interface CollectionNode extends JsgNodeBase<"collection"> {
  concept?: ConceptRef;
  members: SemanticRef[];
}

export interface TypeNode extends JsgNodeBase<"type"> {
  concept: ConceptRef;
  members?: SemanticRef[];
}

export interface DefinitionNode extends JsgNodeBase<"definition"> {
  term: StringLikeValue;
  concept: ConceptRef;
  definition: SemanticValue;
}

export interface CapabilityNode extends JsgNodeBase<"capability"> {
  capabilityId: StringLikeValue;
  description?: SemanticValue;
  inputSchema?: JsonValue;
  outputSchema?: JsonValue;
}

export interface EvidenceNode extends JsgNodeBase<"evidence"> {
  supports: SemanticRef[];
  contradicts: SemanticRef[];
  payload: SemanticValue;
}

export interface UnknownConceptNode extends JsgNodeBase<"unknown-concept"> {
  mention: StringLikeValue;
  expectedParents: ConceptRef[];
  candidateConcepts: ConceptRef[];
}

export type JsgNode =
  | EntityNode
  | EventNode
  | StateNode
  | ActionNode
  | PropertyNode
  | RelationNode
  | PropositionNode
  | QuantityNode
  | TemporalNode
  | LocationNode
  | IntentNode
  | GoalNode
  | ConstraintNode
  | AlternativeSetNode
  | ReferenceNode
  | CollectionNode
  | TypeNode
  | DefinitionNode
  | CapabilityNode
  | EvidenceNode
  | UnknownConceptNode;

export interface Diagnostic {
  code: string;
  severity: "info" | "warning" | "error" | "fatal";
  message: string;
  nodeRefs?: SemanticId[];
  details?: JsonValue;
}

export interface GraphSnapshot {
  schemaVersion: string;
  ontologyVersion: string;
  revision: string;
  parentRevision?: string;
  nodes: JsgNode[];
}
