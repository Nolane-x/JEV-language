import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";

export interface InformationStructureOverlay {
  id: string;
  topicRefs: SemanticId[];
  focusRefs: SemanticId[];
  givenRefs: SemanticId[];
  newRefs: SemanticId[];
  contrastiveFocusRefs: SemanticId[];
}

export interface FocusOperatorAssociation {
  operatorRef: SemanticId;
  focusRefs: SemanticId[];
  interpretation:
    | "only"
    | "also"
    | "even"
    | "again"
    | "contrast"
    | "other";
}

export const validateInformationStructureOverlay = (
  overlay: InformationStructureOverlay,
): Result<void> => {
  if (overlay.id.trim() === "") {
    return err(
      new StructuredError(
        "DIR_INFO_STRUCTURE_ID",
        "Information-structure overlays require a stable id.",
      ),
    );
  }
  for (const [name, refs] of Object.entries({
    topicRefs: overlay.topicRefs,
    focusRefs: overlay.focusRefs,
    givenRefs: overlay.givenRefs,
    newRefs: overlay.newRefs,
    contrastiveFocusRefs: overlay.contrastiveFocusRefs,
  })) {
    if (
      refs.some((ref) => ref.trim() === "") ||
      new Set(refs).size !== refs.length
    ) {
      return err(
        new StructuredError(
          "DIR_INFO_STRUCTURE_REFS",
          `${name} must contain unique non-empty semantic references.`,
        ),
      );
    }
  }
  const given = new Set(overlay.givenRefs);
  if (overlay.newRefs.some((ref) => given.has(ref))) {
    return err(
      new StructuredError(
        "DIR_INFO_STRUCTURE_GIVEN_NEW_CONFLICT",
        "A semantic ref cannot be marked both given and new in the same overlay.",
      ),
    );
  }
  const focus = new Set(overlay.focusRefs);
  if (overlay.contrastiveFocusRefs.some((ref) => !focus.has(ref))) {
    return err(
      new StructuredError(
        "DIR_INFO_STRUCTURE_CONTRASTIVE_FOCUS",
        "Contrastive focus must be a subset of focus.",
      ),
    );
  }
  return ok(undefined);
};

export interface TopicFrame {
  id: string;
  semanticRefs: SemanticId[];
  introducedTurn: number;
  lastActivatedTurn: number;
}

export class InformationTopicStack {
  readonly #topics = new Map<string, TopicFrame>();
  readonly #stack: string[] = [];

  push(topic: TopicFrame): Result<void> {
    if (
      topic.id.trim() === "" ||
      topic.semanticRefs.length === 0 ||
      this.#topics.has(topic.id)
    ) {
      return err(
        new StructuredError(
          "DIR_TOPIC_PUSH",
          "Information topics require unique ids and semantic refs.",
        ),
      );
    }
    this.#topics.set(topic.id, structuredClone(topic));
    this.#stack.push(topic.id);
    return ok(undefined);
  }

  activate(topicId: string, turn: number): Result<void> {
    const topic = this.#topics.get(topicId);
    if (topic === undefined) {
      return err(
        new StructuredError(
          "DIR_TOPIC_MISSING",
          `Unknown information topic: ${topicId}`,
        ),
      );
    }
    this.#stack.splice(
      0,
      this.#stack.length,
      ...this.#stack.filter((id) => id !== topicId),
      topicId,
    );
    topic.lastActivatedTurn = turn;
    return ok(undefined);
  }

  pop(): TopicFrame | undefined {
    const id = this.#stack.pop();
    const topic = id === undefined ? undefined : this.#topics.get(id);
    return topic === undefined ? undefined : structuredClone(topic);
  }

  active(): TopicFrame | undefined {
    const id = this.#stack.at(-1);
    const topic = id === undefined ? undefined : this.#topics.get(id);
    return topic === undefined ? undefined : structuredClone(topic);
  }

  snapshot(): TopicFrame[] {
    return this.#stack
      .map((id) => this.#topics.get(id))
      .filter((topic): topic is TopicFrame => topic !== undefined)
      .map((topic) => structuredClone(topic));
  }
}

export type RegisteredDiscourseRelationKind =
  | "cause"
  | "evidence"
  | "contrast"
  | "elaboration"
  | "condition"
  | "example"
  | "sequence"
  | "restatement"
  | "supports"
  | "explains"
  | "qualifies"
  | "precondition-for"
  | "result-of"
  | "enumeration"
  | "list-member";

export interface DiscourseRelationDefinitionRecord {
  kind: RegisteredDiscourseRelationKind;
  directed: boolean;
  allowsSelf: boolean;
  description: string;
}

export class DiscourseRelationRegistry {
  readonly #definitions = new Map<
    RegisteredDiscourseRelationKind,
    DiscourseRelationDefinitionRecord
  >();

  register(definition: DiscourseRelationDefinitionRecord): Result<void> {
    if (
      definition.description.trim() === "" ||
      this.#definitions.has(definition.kind)
    ) {
      return err(
        new StructuredError(
          "DIR_RELATION_REGISTRY_DUPLICATE",
          `Invalid or duplicate discourse relation: ${definition.kind}`,
        ),
      );
    }
    this.#definitions.set(definition.kind, structuredClone(definition));
    return ok(undefined);
  }

  get(
    kind: RegisteredDiscourseRelationKind,
  ): DiscourseRelationDefinitionRecord | undefined {
    const value = this.#definitions.get(kind);
    return value === undefined ? undefined : structuredClone(value);
  }
}

export interface DiscourseGraphUnit {
  id: string;
  semanticRefs: SemanticId[];
}

export interface DiscourseGraphEdge {
  id: string;
  kind: RegisteredDiscourseRelationKind;
  source: string;
  target: string;
}

export interface DiscourseGraph {
  units: DiscourseGraphUnit[];
  edges: DiscourseGraphEdge[];
}

export const validateDiscourseGraph = (
  graph: DiscourseGraph,
  registry: DiscourseRelationRegistry,
): Result<void> => {
  const units = new Set<string>();
  for (const unit of graph.units) {
    if (
      unit.id.trim() === "" ||
      units.has(unit.id) ||
      unit.semanticRefs.some((ref) => ref.trim() === "")
    ) {
      return err(
        new StructuredError(
          "DIR_GRAPH_UNIT",
          "Discourse graph units require unique ids and valid semantic refs.",
        ),
      );
    }
    units.add(unit.id);
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    const definition = registry.get(edge.kind);
    if (
      edge.id.trim() === "" ||
      edgeIds.has(edge.id) ||
      definition === undefined ||
      !units.has(edge.source) ||
      !units.has(edge.target)
    ) {
      return err(
        new StructuredError(
          "DIR_GRAPH_EDGE",
          "Discourse graph edges require registered relations and existing endpoints.",
        ),
      );
    }
    if (!definition.allowsSelf && edge.source === edge.target) {
      return err(
        new StructuredError(
          "DIR_GRAPH_SELF_EDGE",
          `Relation ${edge.kind} does not permit self edges.`,
        ),
      );
    }
    edgeIds.add(edge.id);
  }
  return ok(undefined);
};

export interface ParagraphPlan {
  id: string;
  unitIds: string[];
  topicRefs: SemanticId[];
  purpose:
    | "answer"
    | "explain"
    | "compare"
    | "instruct"
    | "enumerate"
    | "transition"
    | "summary"
    | "other";
}

export interface MultiParagraphPlan {
  id: string;
  paragraphs: ParagraphPlan[];
  ordering: Array<{ before: string; after: string }>;
}

export const validateMultiParagraphPlan = (
  plan: MultiParagraphPlan,
): Result<void> => {
  if (plan.id.trim() === "" || plan.paragraphs.length === 0) {
    return err(
      new StructuredError(
        "DIR_PARAGRAPH_PLAN",
        "Multi-paragraph plans require id and at least one paragraph.",
      ),
    );
  }
  const ids = new Set<string>();
  for (const paragraph of plan.paragraphs) {
    if (
      paragraph.id.trim() === "" ||
      ids.has(paragraph.id) ||
      paragraph.unitIds.length === 0
    ) {
      return err(
        new StructuredError(
          "DIR_PARAGRAPH_ID",
          "Paragraph ids must be unique and each paragraph must contain units.",
        ),
      );
    }
    ids.add(paragraph.id);
  }
  for (const order of plan.ordering) {
    if (
      !ids.has(order.before) ||
      !ids.has(order.after) ||
      order.before === order.after
    ) {
      return err(
        new StructuredError(
          "DIR_PARAGRAPH_ORDER",
          "Paragraph ordering must connect distinct existing paragraphs.",
        ),
      );
    }
  }
  return ok(undefined);
};

export interface SemanticStatementSignature {
  id: string;
  predicate: SemanticId;
  argumentRefs: SemanticId[];
  polarity: "positive" | "negative";
  modality?: string;
  contextRef?: SemanticId;
}

const signatureKey = (
  statement: SemanticStatementSignature,
  includePolarity = true,
): string =>
  [
    statement.predicate,
    [...statement.argumentRefs].sort().join(","),
    includePolarity ? statement.polarity : "*",
    statement.modality ?? "",
    statement.contextRef ?? "",
  ].join("|");

export interface RedundancyReport {
  duplicateGroups: string[][];
  uniqueIds: string[];
}

export const detectSemanticRedundancy = (
  statements: readonly SemanticStatementSignature[],
): RedundancyReport => {
  const groups = new Map<string, string[]>();
  for (const statement of statements) {
    const key = signatureKey(statement);
    const ids = groups.get(key) ?? [];
    ids.push(statement.id);
    groups.set(key, ids);
  }
  return {
    duplicateGroups: [...groups.values()]
      .filter((ids) => ids.length > 1)
      .map((ids) => [...ids].sort())
      .sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? "")),
    uniqueIds: [...groups.values()]
      .filter((ids) => ids.length === 1)
      .map((ids) => ids[0]!)
      .sort(),
  };
};

export interface ContradictionPair {
  leftId: string;
  rightId: string;
  reason: "opposite-polarity-same-proposition";
}

export const detectGeneratedContradictions = (
  statements: readonly SemanticStatementSignature[],
): ContradictionPair[] => {
  const byCore = new Map<string, SemanticStatementSignature[]>();
  for (const statement of statements) {
    const key = signatureKey(statement, false);
    const values = byCore.get(key) ?? [];
    values.push(statement);
    byCore.set(key, values);
  }

  const output: ContradictionPair[] = [];
  for (const values of byCore.values()) {
    const positives = values
      .filter((value) => value.polarity === "positive")
      .sort((a, b) => a.id.localeCompare(b.id));
    const negatives = values
      .filter((value) => value.polarity === "negative")
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const positive of positives) {
      for (const negative of negatives) {
        output.push({
          leftId: positive.id,
          rightId: negative.id,
          reason: "opposite-polarity-same-proposition",
        });
      }
    }
  }
  return output.sort(
    (a, b) =>
      a.leftId.localeCompare(b.leftId) ||
      a.rightId.localeCompare(b.rightId),
  );
};

export interface EnumerationSemantics {
  id: string;
  collectionRef: SemanticId;
  members: SemanticId[];
  ordered: boolean;
  exhaustive: boolean | "unknown";
}

export const validateEnumerationSemantics = (
  enumeration: EnumerationSemantics,
): Result<void> => {
  if (
    enumeration.id.trim() === "" ||
    enumeration.collectionRef.trim() === "" ||
    enumeration.members.length === 0 ||
    enumeration.members.some((ref) => ref.trim() === "") ||
    new Set(enumeration.members).size !== enumeration.members.length
  ) {
    return err(
      new StructuredError(
        "DIR_ENUMERATION_INVALID",
        "Enumeration semantics require collection identity and unique members.",
      ),
    );
  }
  return ok(undefined);
};
