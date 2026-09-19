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

const isScopeRelation = (value: unknown): boolean =>
  value === "outscopes" ||
  value === "qeq" ||
  value === "same-scope" ||
  value === "disjoint" ||
  value === "unknown";

const isScopeConstraintStatus = (value: unknown): boolean =>
  value === "asserted" || value === "derived" || value === "candidate";

const isQuantifierKind = (value: unknown): boolean =>
  value === "existential" ||
  value === "universal" ||
  value === "negative" ||
  value === "cardinal" ||
  value === "proportional" ||
  value === "comparative" ||
  value === "approximate" ||
  value === "most" ||
  value === "few" ||
  value === "many" ||
  value === "exactly-N" ||
  value === "at-least-N" ||
  value === "at-most-N" ||
  value === "between-N-M";

const isQuantityConstraint = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "exact":
    case "at-least":
    case "at-most":
    case "proportion":
      return typeof value.value === "number" && Number.isFinite(value.value);
    case "between":
      return (
        typeof value.minimum === "number" &&
        Number.isFinite(value.minimum) &&
        typeof value.maximum === "number" &&
        Number.isFinite(value.maximum)
      );
    case "comparative":
      return (
        (value.operator === "more-than" ||
          value.operator === "less-than" ||
          value.operator === "at-least" ||
          value.operator === "at-most") &&
        typeof value.value === "number" &&
        Number.isFinite(value.value)
      );
    case "approximate":
      return (
        typeof value.value === "number" &&
        Number.isFinite(value.value) &&
        (value.tolerance === undefined ||
          (typeof value.tolerance === "number" &&
            Number.isFinite(value.tolerance)))
      );
    default:
      return false;
  }
};

const isDistributivity = (value: unknown): boolean =>
  value === "collective" ||
  value === "distributive" ||
  value === "ambiguous";

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

const isPresuppositionSpec = (value: unknown): boolean =>
  isRecord(value) &&
  (value.status === "triggered" ||
    value.status === "satisfied" ||
    value.status === "accommodated-local" ||
    value.status === "accommodated-global" ||
    value.status === "linked" ||
    value.status === "challenged" ||
    value.status === "unresolved") &&
  typeof value.triggerId === "string" &&
  optionalString(value.host) &&
  optionalString(value.context) &&
  optionalString(value.linkedRef);

const isPragmaticInferenceSpec = (value: unknown): boolean =>
  isRecord(value) &&
  (value.status === "active" || value.status === "cancelled") &&
  value.strength === "defeasible" &&
  (value.sourceKind === "rule" || value.sourceKind === "jev-decision") &&
  typeof value.sourceId === "string" &&
  isStringArray(value.premiseRefs) &&
  optionalString(value.cancellationReason);

const isCommitmentStatus = (value: unknown): boolean =>
  value === "asserted-by-speaker" ||
  value === "presupposed" ||
  value === "attributed-to-source" ||
  value === "believed-by-agent" ||
  value === "hypothesized" ||
  value === "verified" ||
  value === "unknown";

const isEpistemicSpec = (value: unknown): boolean =>
  isRecord(value) &&
  (value.status === "asserted" ||
    value.status === "believed" ||
    value.status === "suspected" ||
    value.status === "reported" ||
    value.status === "questioned" ||
    value.status === "hypothesized" ||
    value.status === "verified" ||
    value.status === "presupposed" ||
    value.status === "unknown") &&
  optionalString(value.source) &&
  (value.commitment === undefined || isCommitmentStatus(value.commitment));

const isDeicticContextSpec = (value: unknown): boolean =>
  isRecord(value) &&
  optionalString(value.speaker) &&
  optionalString(value.addressee) &&
  optionalString(value.speakerTime) &&
  optionalString(value.speakerLocation) &&
  optionalString(value.discourseTime) &&
  optionalString(value.discourseFocus) &&
  optionalString(value.locale) &&
  optionalString(value.participantPerspective) &&
  (value.socialAnchors === undefined ||
    (Array.isArray(value.socialAnchors) &&
      value.socialAnchors.every(
        (item) =>
          isRecord(item) &&
          typeof item.relation === "string" &&
          item.relation.trim() !== "" &&
          typeof item.participant === "string",
      )));

const isDeicticReferenceSpec = (value: unknown): boolean =>
  isRecord(value) &&
  (value.kind === "person" ||
    value.kind === "spatial" ||
    value.kind === "temporal" ||
    value.kind === "discourse" ||
    value.kind === "social") &&
  typeof value.context === "string" &&
  (value.anchorRole === "speaker" ||
    value.anchorRole === "addressee" ||
    value.anchorRole === "speaker-location" ||
    value.anchorRole === "speaker-time" ||
    value.anchorRole === "discourse-time" ||
    value.anchorRole === "discourse-focus" ||
    value.anchorRole === "participant-perspective" ||
    value.anchorRole === "social-anchor") &&
  optionalString(value.socialRelation);

const isQuotationContextSpec = (value: unknown): boolean =>
  isRecord(value) &&
  (value.mode === "direct" || value.mode === "indirect") &&
  typeof value.quotedSpeaker === "string" &&
  optionalString(value.quotedAddressee) &&
  optionalString(value.quotedTimeAnchor) &&
  optionalString(value.quotedLocationAnchor) &&
  optionalString(value.reporter) &&
  (value.sourceSpan === undefined || isSpanRef(value.sourceSpan)) &&
  optionalNumber(value.attributionConfidence) &&
  typeof value.exactWording === "boolean";

const isAttitudeContextSpec = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.holder === "string" &&
  (value.attitude === "believe" ||
    value.attitude === "know" ||
    value.attitude === "suspect" ||
    value.attitude === "hope" ||
    value.attitude === "want" ||
    value.attitude === "intend" ||
    value.attitude === "fear" ||
    value.attitude === "imagine" ||
    value.attitude === "remember" ||
    value.attitude === "forget") &&
  isStringArray(value.contentRefs) &&
  (value.factive === undefined || typeof value.factive === "boolean");

const isEvidentialitySpec = (value: unknown): boolean =>
  isRecord(value) &&
  (value.mode === "direct-observation" ||
    value.mode === "inference" ||
    value.mode === "hearsay" ||
    value.mode === "reported-statement" ||
    value.mode === "document-tool-result" ||
    value.mode === "user-assertion" ||
    value.mode === "system-computation" ||
    value.mode === "unknown") &&
  optionalString(value.source) &&
  optionalString(value.sourceDetail);

const isEventCategory = (value: unknown): boolean =>
  value === "event" ||
  value === "state" ||
  value === "process" ||
  value === "transition" ||
  value === "achievement" ||
  value === "activity";

const isEventMode = (value: unknown): boolean =>
  value === "episodic" ||
  value === "habitual" ||
  value === "generic" ||
  value === "dispositional" ||
  value === "law-like";

const isEventAspect = (value: unknown): boolean =>
  value === "completed" ||
  value === "ongoing" ||
  value === "planned" ||
  value === "perfective" ||
  value === "imperfective" ||
  value === "progressive" ||
  value === "perfect" ||
  value === "prospective" ||
  value === "habitual" ||
  value === "iterative" ||
  value === "none" ||
  value === "unknown";

const isTemporalRelation = (value: unknown): boolean =>
  value === "before" ||
  value === "after" ||
  value === "meets" ||
  value === "met-by" ||
  value === "overlaps" ||
  value === "overlapped-by" ||
  value === "starts" ||
  value === "started-by" ||
  value === "during" ||
  value === "contains" ||
  value === "finishes" ||
  value === "finished-by" ||
  value === "equals" ||
  value === "unknown";

const isModalitySpec = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  const validKind =
    value.kind === "asserted" ||
    value.kind === "possible" ||
    value.kind === "probable" ||
    value.kind === "necessary" ||
    value.kind === "permitted" ||
    value.kind === "required" ||
    value.kind === "forbidden" ||
    value.kind === "intended" ||
    value.kind === "capable" ||
    value.kind === "hypothetical" ||
    value.kind === "counterfactual";
  const validDimension =
    value.dimension === undefined ||
    value.dimension === "epistemic" ||
    value.dimension === "alethic" ||
    value.dimension === "deontic" ||
    value.dimension === "dynamic-capability" ||
    value.dimension === "volitional" ||
    value.dimension === "predictive";
  const validOrdinal =
    value.ordinalStrength === undefined ||
    value.ordinalStrength === "impossible" ||
    value.ordinalStrength === "unlikely" ||
    value.ordinalStrength === "possible" ||
    value.ordinalStrength === "likely" ||
    value.ordinalStrength === "necessary";
  return (
    validKind &&
    validDimension &&
    validOrdinal &&
    optionalString(value.operator) &&
    optionalString(value.source) &&
    optionalString(value.scope) &&
    optionalString(value.contextAnchor) &&
    optionalNumber(value.strength) &&
    optionalNumber(value.calibratedProbability)
  );
};

const isConditionalSemantics = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const validKind =
    value.kind === "factual" ||
    value.kind === "predictive" ||
    value.kind === "hypothetical" ||
    value.kind === "counterfactual" ||
    value.kind === "instructional-guard" ||
    value.kind === "biconditional" ||
    value.kind === "unless";
  const validCounterfactual =
    value.counterfactual === undefined ||
    (isRecord(value.counterfactual) &&
      (value.counterfactual.antecedentStatus === "contrary-to-fact" ||
        value.counterfactual.antecedentStatus === "remote" ||
        value.counterfactual.antecedentStatus === "unknown") &&
      (value.counterfactual.consequentStatus === undefined ||
        value.counterfactual.consequentStatus === "expected" ||
        value.counterfactual.consequentStatus === "possible" ||
        value.counterfactual.consequentStatus === "remote" ||
        value.counterfactual.consequentStatus === "unknown") &&
      optionalString(value.counterfactual.referenceWorld));
  return (
    validKind &&
    typeof value.antecedent === "string" &&
    typeof value.consequent === "string" &&
    (value.modality === undefined || isModalitySpec(value.modality)) &&
    (value.temporalRelation === undefined ||
      isTemporalRelation(value.temporalRelation)) &&
    validCounterfactual &&
    optionalString(value.contextAnchor)
  );
};

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
        optionalString(value.eventClass) &&
        (value.eventCategory === undefined ||
          isEventCategory(value.eventCategory)) &&
        (value.eventMode === undefined || isEventMode(value.eventMode)) &&
        isRoleBindings(value.roles) &&
        isPolarity(value.polarity) &&
        optionalString(value.temporal) &&
        (value.aspect === undefined || isEventAspect(value.aspect)) &&
        (value.modality === undefined || isModalitySpec(value.modality))
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
        optionalString(value.attribution) &&
        optionalString(value.context) &&
        (value.epistemic === undefined || isEpistemicSpec(value.epistemic)) &&
        (value.presupposition === undefined ||
          isPresuppositionSpec(value.presupposition)) &&
        (value.pragmaticInference === undefined ||
          isPragmaticInferenceSpec(value.pragmaticInference)) &&
        (value.modality === undefined || isModalitySpec(value.modality))
      );
    case "context":
      return (
        (value.contextKind === "deictic" ||
          value.contextKind === "quotation" ||
          value.contextKind === "attitude") &&
        optionalString(value.parentContext) &&
        (value.deictic === undefined || isDeicticContextSpec(value.deictic)) &&
        (value.quotation === undefined ||
          isQuotationContextSpec(value.quotation)) &&
        (value.attitude === undefined || isAttitudeContextSpec(value.attitude))
      );
    case "scope":
      return (
        typeof value.operatorRef === "string" &&
        optionalString(value.bodyRef)
      );
    case "scope-constraint":
      return (
        typeof value.left === "string" &&
        isScopeRelation(value.relation) &&
        typeof value.right === "string" &&
        isScopeConstraintStatus(value.status)
      );
    case "quantifier":
      return (
        isQuantifierKind(value.quantifierKind) &&
        typeof value.restrictor === "string" &&
        typeof value.body === "string" &&
        (value.cardinality === undefined ||
          isQuantityConstraint(value.cardinality)) &&
        (value.distributivity === undefined ||
          isDistributivity(value.distributivity)) &&
        typeof value.scope === "string"
      );
    case "negation":
      return (
        typeof value.body === "string" &&
        typeof value.scope === "string"
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
      return (
        (value.temporalKind === "instant" ||
          value.temporalKind === "interval" ||
          value.temporalKind === "duration" ||
          value.temporalKind === "recurrence" ||
          value.temporalKind === "relative") &&
        isJsonValue(value.value) &&
        optionalString(value.anchor) &&
        optionalString(value.start) &&
        optionalString(value.end) &&
        optionalString(value.durationIso) &&
        optionalString(value.calendar) &&
        (value.granularity === undefined ||
          value.granularity === "year" ||
          value.granularity === "month" ||
          value.granularity === "day" ||
          value.granularity === "hour" ||
          value.granularity === "minute" ||
          value.granularity === "second" ||
          value.granularity === "unknown")
      );
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
        isRoleBindings(value.parameters) &&
        (value.conditional === undefined ||
          isConditionalSemantics(value.conditional))
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
      return (
        isStringArray(value.candidates) &&
        optionalString(value.resolved) &&
        (value.deictic === undefined || isDeicticReferenceSpec(value.deictic))
      );
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
        isSemanticValue(value.payload) &&
        (value.evidentiality === undefined ||
          isEvidentialitySpec(value.evidentiality))
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
