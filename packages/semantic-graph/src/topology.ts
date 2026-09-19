import {
  canonicalJson,
  err,
  ok,
  sha256,
  StructuredError,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type { SpanRef } from "../../open-world-values/src/index.ts";
import type {
  Diagnostic,
  GraphSnapshot,
  JsgNode,
  JsgNodeKind,
  MentionNode,
  SemanticValue,
} from "./nodes.ts";

export interface GraphViewNode {
  id: SemanticId;
  kind: JsgNodeKind;
}

export interface GraphViewEdge {
  source: SemanticId;
  target: SemanticId;
  label: string;
  relation?: SemanticId;
}

export interface ReentrantTarget {
  id: SemanticId;
  incomingEdges: number;
  incomingSources: SemanticId[];
}

export interface CanonicalGraphView {
  schemaVersion: string;
  ontologyVersion: string;
  revision: string;
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  components: SemanticId[][];
  reentrantTargets: ReentrantTarget[];
}

interface RefUse {
  target: SemanticId;
  label: string;
  relation?: SemanticId;
}

const refsFromValue = (
  value: SemanticValue,
  label: string,
  relation?: SemanticId,
): RefUse[] => {
  switch (value.kind) {
    case "ref":
      return [{ target: value.ref, label, ...(relation === undefined ? {} : { relation }) }];
    case "collection":
      return value.values.flatMap((member, index) =>
        refsFromValue(member, `${label}.collection[${index}]`, relation),
      );
    case "structured":
      return Object.entries(value.fields).flatMap(([field, member]) =>
        refsFromValue(member, `${label}.field:${field}`, relation),
      );
    case "unknown":
      return (
        value.candidates?.flatMap((candidate, index) =>
          refsFromValue(candidate, `${label}.candidate[${index}]`, relation),
        ) ?? []
      );
    default:
      return [];
  }
};

const directRefs = (node: JsgNode): RefUse[] => {
  switch (node.kind) {
    case "entity":
      return [
        ...node.memberships.map((target) => ({
          target,
          label: "entity.membership",
        })),
        ...node.attributes.flatMap((attribute) =>
          refsFromValue(
            attribute.value,
            `entity.attribute:${attribute.relation}`,
            attribute.relation,
          ),
        ),
      ];
    case "mention":
      return [{ target: node.entityRef, label: "mention.entity" }];
    case "event":
      return [
        ...(node.temporal === undefined
          ? []
          : [{ target: node.temporal, label: "event.temporal" }]),
        ...node.roles.flatMap((binding) =>
          refsFromValue(
            binding.value,
            `event.role:${binding.role}`,
            binding.role,
          ),
        ),
      ];
    case "state":
      return [
        ...(node.holder === undefined
          ? []
          : [{ target: node.holder, label: "state.holder" }]),
        ...(node.temporal === undefined
          ? []
          : [{ target: node.temporal, label: "state.temporal" }]),
        ...node.arguments.flatMap((binding) =>
          refsFromValue(
            binding.value,
            `state.role:${binding.role}`,
            binding.role,
          ),
        ),
      ];
    case "action":
      return [
        ...(node.actor === undefined
          ? []
          : [{ target: node.actor, label: "action.actor" }]),
        ...(node.target === undefined
          ? []
          : [{ target: node.target, label: "action.target" }]),
        ...node.preconditions.map((target) => ({
          target,
          label: "action.precondition",
        })),
        ...node.intendedEffects.map((target) => ({
          target,
          label: "action.effect",
        })),
        ...node.parameters.flatMap((binding) =>
          refsFromValue(
            binding.value,
            `action.parameter:${binding.role}`,
            binding.role,
          ),
        ),
      ];
    case "property":
      return [
        { target: node.subject, label: "property.subject" },
        ...refsFromValue(
          node.value,
          `property.value:${node.property}`,
          node.property,
        ),
      ];
    case "relation":
      return [
        {
          target: node.source,
          label: "relation.source",
          relation: node.relation,
        },
        {
          target: node.target,
          label: "relation.target",
          relation: node.relation,
        },
      ];
    case "proposition":
      return [
        ...(node.temporal === undefined
          ? []
          : [{ target: node.temporal, label: "proposition.temporal" }]),
        ...(node.attribution === undefined
          ? []
          : [{ target: node.attribution, label: "proposition.attribution" }]),
        ...(node.epistemic?.source === undefined
          ? []
          : [{ target: node.epistemic.source, label: "proposition.epistemic-source" }]),
        ...node.arguments.flatMap((binding) =>
          refsFromValue(
            binding.value,
            `proposition.role:${binding.role}`,
            binding.role,
          ),
        ),
      ];
    case "scope":
      return [
        { target: node.operatorRef, label: "scope.operator" },
        ...(node.bodyRef === undefined
          ? []
          : [{ target: node.bodyRef, label: "scope.body" }]),
      ];
    case "scope-constraint":
      return [
        { target: node.left, label: "scope-constraint.left" },
        { target: node.right, label: "scope-constraint.right" },
      ];
    case "quantifier":
      return [
        { target: node.restrictor, label: "quantifier.restrictor" },
        { target: node.body, label: "quantifier.body" },
        { target: node.scope, label: "quantifier.scope" },
      ];
    case "negation":
      return [
        { target: node.body, label: "negation.body" },
        { target: node.scope, label: "negation.scope" },
      ];
    case "quantity":
    case "temporal":
      return [];
    case "location":
      return refsFromValue(node.value, "location.value");
    case "intent":
      return node.content === undefined
        ? []
        : [{ target: node.content, label: "intent.content" }];
    case "goal":
      return [{ target: node.desired, label: "goal.desired" }];
    case "constraint":
      return [
        { target: node.subject, label: "constraint.subject" },
        ...node.parameters.flatMap((binding) =>
          refsFromValue(
            binding.value,
            `constraint.parameter:${binding.role}`,
            binding.role,
          ),
        ),
      ];
    case "alternative-set":
      return [
        ...node.alternatives.map((alternative, index) => ({
          target: alternative.ref,
          label: `alternative-set.option[${index}]`,
        })),
        ...(node.resolved === undefined
          ? []
          : [{ target: node.resolved, label: "alternative-set.resolved" }]),
      ];
    case "reference":
      return [
        ...node.candidates.map((target, index) => ({
          target,
          label: `reference.candidate[${index}]`,
        })),
        ...(node.resolved === undefined
          ? []
          : [{ target: node.resolved, label: "reference.resolved" }]),
      ];
    case "collection":
      return node.members.map((target, index) => ({
        target,
        label: `collection.member[${index}]`,
      }));
    case "type":
      return (node.members ?? []).map((target, index) => ({
        target,
        label: `type.member[${index}]`,
      }));
    case "definition":
      return refsFromValue(node.definition, "definition.value");
    case "capability":
      return node.description === undefined
        ? []
        : refsFromValue(node.description, "capability.description");
    case "evidence":
      return [
        ...node.supports.map((target) => ({
          target,
          label: "evidence.supports",
        })),
        ...node.contradicts.map((target) => ({
          target,
          label: "evidence.contradicts",
        })),
        ...refsFromValue(node.payload, "evidence.payload"),
      ];
    case "unknown-concept":
      return [];
  }
};

export const graphEdges = (snapshot: GraphSnapshot): GraphViewEdge[] =>
  snapshot.nodes
    .flatMap((node) =>
      directRefs(node).map((ref) => ({
        source: node.id,
        target: ref.target,
        label: ref.label,
        ...(ref.relation === undefined ? {} : { relation: ref.relation }),
      })),
    )
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target) ||
        left.label.localeCompare(right.label) ||
        (left.relation ?? "").localeCompare(right.relation ?? ""),
    );

const connectedComponents = (
  nodes: readonly GraphViewNode[],
  edges: readonly GraphViewEdge[],
): SemanticId[][] => {
  const existing = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<SemanticId, Set<SemanticId>>();
  for (const node of nodes) adjacency.set(node.id, new Set());
  for (const edge of edges) {
    if (!existing.has(edge.target)) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const seen = new Set<SemanticId>();
  const components: SemanticId[][] = [];
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (seen.has(node.id)) continue;
    const queue: SemanticId[] = [node.id];
    const component: SemanticId[] = [];
    seen.add(node.id);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      component.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component.sort());
  }
  return components.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
};

export const createCanonicalGraphView = (
  snapshot: GraphSnapshot,
): CanonicalGraphView => {
  const nodes = snapshot.nodes
    .map((node) => ({ id: node.id, kind: node.kind }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges = graphEdges(snapshot);
  const incoming = new Map<SemanticId, GraphViewEdge[]>();
  for (const edge of edges) {
    const bucket = incoming.get(edge.target) ?? [];
    bucket.push(edge);
    incoming.set(edge.target, bucket);
  }
  const reentrantTargets = [...incoming.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([id, values]) => ({
      id,
      incomingEdges: values.length,
      incomingSources: [...new Set(values.map((edge) => edge.source))].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    schemaVersion: snapshot.schemaVersion,
    ontologyVersion: snapshot.ontologyVersion,
    revision: snapshot.revision,
    nodes,
    edges,
    components: connectedComponents(nodes, edges),
    reentrantTargets,
  };
};

export interface SemanticViewProjector<TView> {
  id: string;
  project(snapshot: GraphSnapshot): TView;
}

export interface SemanticViewProjection<TView> {
  projectorId: string;
  sourceRevision: string;
  sourceDigest: string;
  value: TView;
}

export const projectSemanticView = <TView>(
  snapshot: GraphSnapshot,
  projector: SemanticViewProjector<TView>,
): SemanticViewProjection<TView> => {
  if (projector.id.trim() === "") {
    throw new StructuredError(
      "JSG_VIEW_PROJECTOR_ID",
      "Semantic view projector id must be non-empty.",
    );
  }
  const source = structuredClone(snapshot);
  return {
    projectorId: projector.id,
    sourceRevision: snapshot.revision,
    sourceDigest: sha256(
      canonicalJson(snapshot as unknown as JsonValue),
    ),
    value: projector.project(source),
  };
};

export const canonicalGraphViewProjector: SemanticViewProjector<CanonicalGraphView> = {
  id: "jsg.canonical-graph-view.v1",
  project: createCanonicalGraphView,
};

const spanKey = (span: SpanRef): string =>
  [
    span.sourceId,
    span.sourceVersion,
    span.coordinateSystem,
    span.start,
    span.end,
    span.digest,
  ].join("|");

export class MentionIndex {
  readonly #mentions: MentionNode[];
  readonly #byEntity = new Map<SemanticId, MentionNode[]>();
  readonly #byLanguage = new Map<string, MentionNode[]>();
  readonly #bySpan = new Map<string, MentionNode[]>();

  constructor(snapshot: GraphSnapshot) {
    this.#mentions = snapshot.nodes
      .filter((node): node is MentionNode => node.kind === "mention")
      .map((node) => structuredClone(node))
      .sort((a, b) => a.id.localeCompare(b.id));

    for (const mention of this.#mentions) {
      this.#append(this.#byEntity, mention.entityRef, mention);
      if (mention.language !== undefined) {
        this.#append(this.#byLanguage, mention.language, mention);
      }
      if (mention.sourceSpan !== undefined) {
        this.#append(this.#bySpan, spanKey(mention.sourceSpan), mention);
      }
    }
  }

  all(): MentionNode[] {
    return this.#mentions.map((mention) => structuredClone(mention));
  }

  byEntity(entityRef: SemanticId): MentionNode[] {
    return (this.#byEntity.get(entityRef) ?? []).map((mention) =>
      structuredClone(mention),
    );
  }

  byLanguage(language: string): MentionNode[] {
    return (this.#byLanguage.get(language) ?? []).map((mention) =>
      structuredClone(mention),
    );
  }

  bySourceSpan(span: SpanRef): MentionNode[] {
    return (this.#bySpan.get(spanKey(span)) ?? []).map((mention) =>
      structuredClone(mention),
    );
  }

  #append<K extends string>(
    index: Map<K, MentionNode[]>,
    key: K,
    mention: MentionNode,
  ): void {
    const values = index.get(key) ?? [];
    values.push(mention);
    values.sort((a, b) => a.id.localeCompare(b.id));
    index.set(key, values);
  }
}

export interface GraphFragment {
  id: string;
  schemaVersion: string;
  ontologyVersion: string;
  status: "provisional";
  nodes: JsgNode[];
  unresolvedRefs: SemanticId[];
}

const unresolvedRefs = (nodes: readonly JsgNode[]): SemanticId[] => {
  const ids = new Set(nodes.map((node) => node.id));
  const snapshot: GraphSnapshot = {
    schemaVersion: nodes[0]?.schemaVersion ?? "0.1.0",
    ontologyVersion: nodes[0]?.ontologyVersion ?? "0.1.0",
    revision: "rev:fragment-analysis",
    nodes: nodes.map((node) => structuredClone(node)),
  };
  return [...new Set(graphEdges(snapshot).map((edge) => edge.target))]
    .filter((ref) => !ids.has(ref))
    .sort();
};

export const createProvisionalGraphFragment = (input: {
  id: string;
  schemaVersion: string;
  ontologyVersion: string;
  nodes: readonly JsgNode[];
}): Result<GraphFragment> => {
  if (input.id.trim() === "") {
    return err(
      new StructuredError(
        "JSG_FRAGMENT_ID",
        "Graph fragment id must be non-empty.",
      ),
    );
  }
  const duplicateIds = input.nodes
    .map((node) => node.id)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    return err(
      new StructuredError(
        "JSG_FRAGMENT_DUPLICATE_ID",
        "Graph fragment contains duplicate node identifiers.",
        { nodeRefs: [...new Set(duplicateIds)].sort() } as unknown as JsonValue,
      ),
    );
  }
  for (const node of input.nodes) {
    if (
      node.schemaVersion !== input.schemaVersion ||
      node.ontologyVersion !== input.ontologyVersion
    ) {
      return err(
        new StructuredError(
          "JSG_FRAGMENT_VERSION",
          `Fragment node ${node.id} does not match fragment schema/ontology versions.`,
        ),
      );
    }
  }
  const nodes = input.nodes
    .map((node) => structuredClone(node))
    .sort((a, b) => a.id.localeCompare(b.id));
  return ok({
    id: input.id,
    schemaVersion: input.schemaVersion,
    ontologyVersion: input.ontologyVersion,
    status: "provisional",
    nodes,
    unresolvedRefs: unresolvedRefs(nodes),
  });
};

export interface GraphFragmentMergeReport {
  snapshot?: GraphSnapshot;
  diagnostics: Diagnostic[];
  unresolvedRefs: SemanticId[];
}

const nodeCanonical = (node: JsgNode): string =>
  canonicalJson(node as unknown as JsonValue);

export const mergeGraphFragments = (
  base: GraphSnapshot,
  fragments: readonly GraphFragment[],
): GraphFragmentMergeReport => {
  const diagnostics: Diagnostic[] = [];
  const nodes = new Map<SemanticId, JsgNode>(
    base.nodes.map((node) => [node.id, structuredClone(node)] as const),
  );

  for (const fragment of [...fragments].sort((a, b) => a.id.localeCompare(b.id))) {
    if (
      fragment.schemaVersion !== base.schemaVersion ||
      fragment.ontologyVersion !== base.ontologyVersion
    ) {
      diagnostics.push({
        code: "JSG_FRAGMENT_VERSION_CONFLICT",
        severity: "error",
        message: `Fragment ${fragment.id} is incompatible with the base graph versions.`,
      });
      continue;
    }
    for (const node of fragment.nodes) {
      const existing = nodes.get(node.id);
      if (existing === undefined) {
        nodes.set(node.id, structuredClone(node));
        continue;
      }
      if (nodeCanonical(existing) !== nodeCanonical(node)) {
        diagnostics.push({
          code: "JSG_FRAGMENT_NODE_CONFLICT",
          severity: "error",
          message: `Fragment ${fragment.id} conflicts on semantic node ${node.id}.`,
          nodeRefs: [node.id],
        });
      }
    }
  }

  const blocking = diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" || diagnostic.severity === "fatal",
  );
  const mergedNodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const unresolved = unresolvedRefs(mergedNodes);
  for (const ref of unresolved) {
    diagnostics.push({
      code: "JSG_FRAGMENT_UNRESOLVED_REFERENCE",
      severity: "warning",
      message: `Merged graph still contains unresolved reference ${ref}.`,
      nodeRefs: [ref],
    });
  }

  if (blocking) return { diagnostics, unresolvedRefs: unresolved };

  const revisionHash = sha256(
    canonicalJson({
      parentRevision: base.revision,
      fragments: [...fragments].map((fragment) => fragment.id).sort(),
      nodes: mergedNodes as unknown as JsonValue,
    }),
  ).slice("sha256:".length);

  return {
    snapshot: {
      schemaVersion: base.schemaVersion,
      ontologyVersion: base.ontologyVersion,
      revision: `rev:${revisionHash}`,
      parentRevision: base.revision,
      nodes: mergedNodes,
    },
    diagnostics,
    unresolvedRefs: unresolved,
  };
};

export interface CyclePermissionRule {
  id: string;
  sourceKind?: JsgNodeKind;
  targetKind?: JsgNodeKind;
  label?: string;
  relation?: SemanticId;
}

export class CyclePermissionRegistry {
  readonly #rules = new Map<string, CyclePermissionRule>();

  register(rule: CyclePermissionRule): Result<void> {
    if (rule.id.trim() === "") {
      return err(
        new StructuredError(
          "JSG_CYCLE_RULE_ID",
          "Cycle permission rule id must be non-empty.",
        ),
      );
    }
    if (
      rule.sourceKind === undefined &&
      rule.targetKind === undefined &&
      rule.label === undefined &&
      rule.relation === undefined
    ) {
      return err(
        new StructuredError(
          "JSG_CYCLE_RULE_EMPTY",
          "Cycle permission rule must constrain a relation, label, or node kind.",
        ),
      );
    }
    if (this.#rules.has(rule.id)) {
      return err(
        new StructuredError(
          "JSG_CYCLE_RULE_DUPLICATE",
          `Cycle permission rule already exists: ${rule.id}.`,
        ),
      );
    }
    this.#rules.set(rule.id, { ...rule });
    return ok(undefined);
  }

  list(): CyclePermissionRule[] {
    return [...this.#rules.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((rule) => ({ ...rule }));
  }

  permits(
    edge: GraphViewEdge,
    source: JsgNode,
    target: JsgNode,
  ): boolean {
    return this.list().some(
      (rule) =>
        (rule.sourceKind === undefined || rule.sourceKind === source.kind) &&
        (rule.targetKind === undefined || rule.targetKind === target.kind) &&
        (rule.label === undefined || rule.label === edge.label) &&
        (rule.relation === undefined || rule.relation === edge.relation),
    );
  }
}

export const createCoreCyclePermissionRegistry = (): CyclePermissionRegistry => {
  const registry = new CyclePermissionRegistry();
  const rules: CyclePermissionRule[] = [
    {
      id: "core.scope-quantifier-operator",
      sourceKind: "scope",
      targetKind: "quantifier",
      label: "scope.operator",
    },
    {
      id: "core.quantifier-scope",
      sourceKind: "quantifier",
      targetKind: "scope",
      label: "quantifier.scope",
    },
    {
      id: "core.scope-negation-operator",
      sourceKind: "scope",
      targetKind: "negation",
      label: "scope.operator",
    },
    {
      id: "core.negation-scope",
      sourceKind: "negation",
      targetKind: "scope",
      label: "negation.scope",
    },
  ];
  for (const rule of rules) {
    const registered = registry.register(rule);
    if (!registered.ok) throw registered.error;
  }
  return registry;
};

const stronglyConnectedComponents = (
  snapshot: GraphSnapshot,
  edges: readonly GraphViewEdge[],
): SemanticId[][] => {
  const ids = new Set(snapshot.nodes.map((node) => node.id));
  const adjacency = new Map<SemanticId, SemanticId[]>();
  for (const id of ids) adjacency.set(id, []);
  for (const edge of edges) {
    if (ids.has(edge.target)) adjacency.get(edge.source)?.push(edge.target);
  }
  for (const targets of adjacency.values()) targets.sort();

  let index = 0;
  const indexById = new Map<SemanticId, number>();
  const lowLink = new Map<SemanticId, number>();
  const stack: SemanticId[] = [];
  const onStack = new Set<SemanticId>();
  const components: SemanticId[][] = [];

  const visit = (id: SemanticId): void => {
    indexById.set(id, index);
    lowLink.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);

    for (const target of adjacency.get(id) ?? []) {
      if (!indexById.has(target)) {
        visit(target);
        lowLink.set(
          id,
          Math.min(lowLink.get(id) ?? 0, lowLink.get(target) ?? 0),
        );
      } else if (onStack.has(target)) {
        lowLink.set(
          id,
          Math.min(lowLink.get(id) ?? 0, indexById.get(target) ?? 0),
        );
      }
    }

    if (lowLink.get(id) !== indexById.get(id)) return;
    const component: SemanticId[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      onStack.delete(current);
      component.push(current);
      if (current === id) break;
    }
    components.push(component.sort());
  };

  for (const id of [...ids].sort()) {
    if (!indexById.has(id)) visit(id);
  }
  return components;
};

export const validateGraphTopology = (
  snapshot: GraphSnapshot,
  registry: CyclePermissionRegistry = createCoreCyclePermissionRegistry(),
): Diagnostic[] => {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node] as const));
  const edges = graphEdges(snapshot);
  const diagnostics: Diagnostic[] = [];

  for (const component of stronglyConnectedComponents(snapshot, edges)) {
    const members = new Set(component);
    const internal = edges.filter(
      (edge) => members.has(edge.source) && members.has(edge.target),
    );
    const cyclic =
      component.length > 1 ||
      internal.some((edge) => edge.source === edge.target);
    if (!cyclic) continue;

    const disallowed = internal.filter((edge) => {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (source === undefined || target === undefined) return false;
      return !registry.permits(edge, source, target);
    });
    if (disallowed.length === 0) continue;

    diagnostics.push({
      code: "JSG050_UNPERMITTED_CYCLE",
      severity: "error",
      message: `Semantic cycle is not permitted for component ${component.join(", ")}.`,
      nodeRefs: component,
      details: {
        edges: disallowed.map((edge) => ({
          source: edge.source,
          target: edge.target,
          label: edge.label,
          ...(edge.relation === undefined ? {} : { relation: edge.relation }),
        })),
      } as unknown as JsonValue,
    });
  }

  return diagnostics;
};
