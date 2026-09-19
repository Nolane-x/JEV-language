import type {
  ConfidenceValue,
  JsonValue,
  SemanticId,
  TrustLabel,
} from "../../core-types/src/index.ts";
import type {
  SpanRef,
  StringLikeValue,
} from "../../open-world-values/src/index.ts";
import type {
  ConceptRef,
  RoleRef,
} from "../../ontology/src/index.ts";
import type { ProvenanceRef } from "../../provenance/src/index.ts";

export type JsgNodeKind =
  | "entity"
  | "mention"
  | "event"
  | "state"
  | "action"
  | "property"
  | "relation"
  | "proposition"
  | "context"
  | "scope"
  | "scope-constraint"
  | "quantifier"
  | "negation"
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

export type EventCategory =
  | "event"
  | "state"
  | "process"
  | "transition"
  | "achievement"
  | "activity";

export type EventMode =
  | "episodic"
  | "habitual"
  | "generic"
  | "dispositional"
  | "law-like";

export type EventAspect =
  | "completed"
  | "ongoing"
  | "planned"
  | "perfective"
  | "imperfective"
  | "progressive"
  | "perfect"
  | "prospective"
  | "habitual"
  | "iterative"
  | "none"
  | "unknown";

export type TemporalRelation =
  | "before"
  | "after"
  | "meets"
  | "met-by"
  | "overlaps"
  | "overlapped-by"
  | "starts"
  | "started-by"
  | "during"
  | "contains"
  | "finishes"
  | "finished-by"
  | "equals"
  | "unknown";

export type ModalityDimension =
  | "epistemic"
  | "alethic"
  | "deontic"
  | "dynamic-capability"
  | "volitional"
  | "predictive";

export type ModalStrength =
  | "impossible"
  | "unlikely"
  | "possible"
  | "likely"
  | "necessary";

export interface ModalitySpec {
  kind:
    | "asserted"
    | "possible"
    | "probable"
    | "necessary"
    | "permitted"
    | "required"
    | "forbidden"
    | "intended"
    | "capable"
    | "hypothetical"
    | "counterfactual";
  /** Legacy scalar retained for compatibility; ordinalStrength is normative. */
  strength?: number;
  dimension?: ModalityDimension;
  operator?: string;
  ordinalStrength?: ModalStrength;
  source?: SemanticRef;
  scope?: SemanticRef;
  contextAnchor?: SemanticRef;
  calibratedProbability?: number;
}

export type ConditionalKind =
  | "factual"
  | "predictive"
  | "hypothetical"
  | "counterfactual"
  | "instructional-guard"
  | "biconditional"
  | "unless";

export interface CounterfactualMetadata {
  antecedentStatus: "contrary-to-fact" | "remote" | "unknown";
  consequentStatus?: "expected" | "possible" | "remote" | "unknown";
  referenceWorld?: SemanticRef;
}

export interface ConditionalSemantics {
  kind: ConditionalKind;
  antecedent: SemanticRef;
  consequent: SemanticRef;
  modality?: ModalitySpec;
  temporalRelation?: TemporalRelation;
  counterfactual?: CounterfactualMetadata;
  contextAnchor?: SemanticRef;
}

export type CommitmentStatus =
  | "asserted-by-speaker"
  | "presupposed"
  | "attributed-to-source"
  | "believed-by-agent"
  | "hypothesized"
  | "verified"
  | "unknown";

export interface EpistemicSpec {
  status:
    | "asserted"
    | "believed"
    | "suspected"
    | "reported"
    | "questioned"
    | "hypothesized"
    | "verified"
    | "presupposed"
    | "unknown";
  source?: SemanticRef;
  commitment?: CommitmentStatus;
}

export type DeixisKind =
  | "person"
  | "spatial"
  | "temporal"
  | "discourse"
  | "social";

export type DeicticAnchorRole =
  | "speaker"
  | "addressee"
  | "speaker-location"
  | "speaker-time"
  | "discourse-time"
  | "discourse-focus"
  | "participant-perspective"
  | "social-anchor";

export interface SocialDeicticAnchor {
  relation: string;
  participant: SemanticRef;
}

export interface DeicticContextSpec {
  speaker?: SemanticRef;
  addressee?: SemanticRef;
  speakerTime?: SemanticRef;
  speakerLocation?: SemanticRef;
  discourseTime?: SemanticRef;
  discourseFocus?: SemanticRef;
  locale?: string;
  participantPerspective?: SemanticRef;
  socialAnchors?: SocialDeicticAnchor[];
}

export interface DeicticReferenceSpec {
  kind: DeixisKind;
  context: SemanticRef;
  anchorRole: DeicticAnchorRole;
  socialRelation?: string;
}

export type QuotationMode = "direct" | "indirect";

export interface QuotationContextSpec {
  mode: QuotationMode;
  quotedSpeaker: SemanticRef;
  quotedAddressee?: SemanticRef;
  quotedTimeAnchor?: SemanticRef;
  quotedLocationAnchor?: SemanticRef;
  reporter?: SemanticRef;
  sourceSpan?: SpanRef;
  attributionConfidence?: number;
  exactWording: boolean;
}

export type AttitudeKind =
  | "believe"
  | "know"
  | "suspect"
  | "hope"
  | "want"
  | "intend"
  | "fear"
  | "imagine"
  | "remember"
  | "forget";

export interface AttitudeContextSpec {
  holder: SemanticRef;
  attitude: AttitudeKind;
  contentRefs: SemanticRef[];
  factive?: boolean;
}

export type SemanticContextKind = "deictic" | "quotation" | "attitude";

export type EvidentialityMode =
  | "direct-observation"
  | "inference"
  | "hearsay"
  | "reported-statement"
  | "document-tool-result"
  | "user-assertion"
  | "system-computation"
  | "unknown";

export interface EvidentialitySpec {
  mode: EvidentialityMode;
  source?: SemanticRef;
  sourceDetail?: string;
}

export type PresuppositionStatus =
  | "triggered"
  | "satisfied"
  | "accommodated-local"
  | "accommodated-global"
  | "linked"
  | "challenged"
  | "unresolved";

export interface PresuppositionSpec {
  status: PresuppositionStatus;
  triggerId: string;
  host?: SemanticRef;
  context?: SemanticRef;
  linkedRef?: SemanticRef;
}

export interface PragmaticInferenceSpec {
  status: "active" | "cancelled";
  strength: "defeasible";
  sourceKind: "rule" | "jev-decision";
  sourceId: string;
  premiseRefs: SemanticRef[];
  cancellationReason?: string;
}

export interface ScopeSpec {
  kind: "resolved" | "underspecified";
  scopeId?: SemanticId;
}

export type ScopeRelation =
  | "outscopes"
  | "qeq"
  | "same-scope"
  | "disjoint"
  | "unknown";

export type ScopeConstraintStatus =
  | "asserted"
  | "derived"
  | "candidate";

export type QuantifierKind =
  | "existential"
  | "universal"
  | "negative"
  | "cardinal"
  | "proportional"
  | "comparative"
  | "approximate"
  | "most"
  | "few"
  | "many"
  | "exactly-N"
  | "at-least-N"
  | "at-most-N"
  | "between-N-M";

export type QuantityConstraint =
  | { kind: "exact"; value: number }
  | { kind: "at-least"; value: number }
  | { kind: "at-most"; value: number }
  | { kind: "between"; minimum: number; maximum: number }
  | { kind: "proportion"; value: number }
  | {
      kind: "comparative";
      operator: "more-than" | "less-than" | "at-least" | "at-most";
      value: number;
    }
  | { kind: "approximate"; value: number; tolerance?: number };

export type Distributivity =
  | "collective"
  | "distributive"
  | "ambiguous";

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

export type MentionExpressionType =
  | "name"
  | "pronoun"
  | "description"
  | "demonstrative"
  | "zero"
  | "other";

export interface MentionNode extends JsgNodeBase<"mention"> {
  entityRef: SemanticRef;
  sourceSpan?: SpanRef;
  expressionType: MentionExpressionType;
  language?: string;
  salience: number;
}

export interface EventNode extends JsgNodeBase<"event"> {
  /** Event occurrence identity is this node's id; eventClass is its type/class. */
  predicate: ConceptRef;
  eventClass?: ConceptRef;
  eventCategory?: EventCategory;
  eventMode?: EventMode;
  roles: RoleBinding[];
  temporal?: SemanticRef;
  aspect?: EventAspect;
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
  context?: SemanticRef;
  presupposition?: PresuppositionSpec;
  pragmaticInference?: PragmaticInferenceSpec;
}

export interface ContextNode extends JsgNodeBase<"context"> {
  contextKind: SemanticContextKind;
  parentContext?: SemanticRef;
  deictic?: DeicticContextSpec;
  quotation?: QuotationContextSpec;
  attitude?: AttitudeContextSpec;
}

export interface ScopeNode extends JsgNodeBase<"scope"> {
  operatorRef: SemanticRef;
  bodyRef?: SemanticRef;
}

export interface ScopeConstraintNode extends JsgNodeBase<"scope-constraint"> {
  left: SemanticRef;
  relation: ScopeRelation;
  right: SemanticRef;
  status: ScopeConstraintStatus;
}

export interface QuantifierNode extends JsgNodeBase<"quantifier"> {
  quantifierKind: QuantifierKind;
  restrictor: SemanticRef;
  body: SemanticRef;
  cardinality?: QuantityConstraint;
  distributivity?: Distributivity;
  scope: SemanticRef;
}

export interface NegationNode extends JsgNodeBase<"negation"> {
  body: SemanticRef;
  scope: SemanticRef;
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
  anchor?: SemanticRef;
  start?: string;
  end?: string;
  durationIso?: string;
  calendar?: string;
  granularity?: "year" | "month" | "day" | "hour" | "minute" | "second" | "unknown";
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
  conditional?: ConditionalSemantics;
}

export interface AlternativeSetNode extends JsgNodeBase<"alternative-set"> {
  alternatives: Array<{ ref: SemanticRef; probability?: number }>;
  resolved?: SemanticRef;
}

export interface ReferenceNode extends JsgNodeBase<"reference"> {
  candidates: SemanticRef[];
  resolved?: SemanticRef;
  deictic?: DeicticReferenceSpec;
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
  evidentiality?: EvidentialitySpec;
}

export interface UnknownConceptNode extends JsgNodeBase<"unknown-concept"> {
  mention: StringLikeValue;
  expectedParents: ConceptRef[];
  candidateConcepts: ConceptRef[];
}

export type JsgNode =
  | EntityNode
  | MentionNode
  | EventNode
  | StateNode
  | ActionNode
  | PropertyNode
  | RelationNode
  | PropositionNode
  | ContextNode
  | ScopeNode
  | ScopeConstraintNode
  | QuantifierNode
  | NegationNode
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
