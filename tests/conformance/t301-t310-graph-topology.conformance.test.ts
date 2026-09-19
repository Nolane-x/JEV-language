import { describe, expect, it } from "vitest";
import type { SemanticId } from "../../packages/core-types/src/index.ts";
import type { SpanRef } from "../../packages/open-world-values/src/index.ts";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import {
  CyclePermissionRegistry,
  MentionIndex,
  canonicalGraphViewProjector,
  canonicalSnapshotJson,
  createCanonicalGraphView,
  createProvisionalGraphFragment,
  deserializeSnapshot,
  mergeGraphFragments,
  projectSemanticView,
  serializeSnapshot,
  validateGraphTopology,
  type EntityNode,
  type EventNode,
  type GraphSnapshot,
  type MentionNode,
} from "../../packages/semantic-graph/src/index.ts";
import { validateSnapshot } from "../../packages/semantic-validator/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;
const provenance = ["prov:t301"] as ProvenanceRef[];

const base = {
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance,
  trust: "user-content" as const,
};

const entity = (
  id: SemanticId,
  memberships: SemanticId[] = [],
): EntityNode => ({
  ...base,
  provenance: [...provenance],
  id,
  kind: "entity",
  concept: sid("concept:test.person"),
  attributes: [],
  memberships,
});

const event = (
  id: SemanticId,
  agent: SemanticId,
): EventNode => ({
  ...base,
  provenance: [...provenance],
  id,
  kind: "event",
  predicate: sid("concept:test.event"),
  roles: [
    {
      role: sid("role:test.agent"),
      value: { kind: "ref", ref: agent },
    },
  ],
  polarity: "positive",
});

const snapshot = (
  nodes: GraphSnapshot["nodes"],
  revision = "rev:t301",
): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision,
  nodes,
});

const span: SpanRef = {
  sourceId: "source:dialogue",
  sourceVersion: "1",
  start: 0,
  end: 3,
  coordinateSystem: "utf16",
  digest: "sha256:lan",
};

const mention = (
  id: SemanticId,
  entityRef: SemanticId,
  language = "vi",
): MentionNode => ({
  ...base,
  provenance: [...provenance],
  id,
  kind: "mention",
  entityRef,
  sourceSpan: { ...span },
  expressionType: "name",
  language,
  salience: 1,
});

describe("T301-T310 graph topology and semantic views", () => {
  it("T301-T302 exposes a canonical graph view and preserves shared reentrant identity", () => {
    const lan = entity(sid("entity:lan"));
    const say = event(sid("event:say"), lan.id);
    const leave = event(sid("event:leave"), lan.id);
    const graph = snapshot([leave, lan, say]);

    const view = createCanonicalGraphView(graph);
    expect(view.nodes.map((node) => node.id)).toEqual([
      lan.id,
      leave.id,
      say.id,
    ].sort());
    expect(view.reentrantTargets).toContainEqual({
      id: lan.id,
      incomingEdges: 2,
      incomingSources: [leave.id, say.id].sort(),
    });
    expect(validateGraphTopology(graph)).toEqual([]);
  });

  it("T303 projection never mutates the canonical snapshot and is stable under node ordering", () => {
    const lan = entity(sid("entity:lan"));
    const say = event(sid("event:say"), lan.id);
    const graph = snapshot([say, lan]);
    const before = canonicalSnapshotJson(graph);

    const projected = projectSemanticView(graph, canonicalGraphViewProjector);
    expect(projected.sourceRevision).toBe(graph.revision);
    expect(projected.value).toEqual(createCanonicalGraphView(graph));
    expect(canonicalSnapshotJson(graph)).toBe(before);

    const reordered = snapshot([lan, say]);
    expect(createCanonicalGraphView(reordered)).toEqual(
      createCanonicalGraphView(graph),
    );

    const mutatingProjection = projectSemanticView(graph, {
      id: "test.clone-isolation",
      project(clone) {
        clone.nodes.length = 0;
        return clone.nodes.length;
      },
    });
    expect(mutatingProjection.value).toBe(0);
    expect(graph.nodes).toHaveLength(2);
    expect(canonicalSnapshotJson(graph)).toBe(before);
  });

  it("T304-T305 keeps mentions separate from entities and indexes by span/entity/language", () => {
    const lan = entity(sid("entity:lan"));
    const name = mention(sid("mention:lan-name"), lan.id);
    const pronoun: MentionNode = {
      ...mention(sid("mention:she"), lan.id, "en"),
      sourceSpan: {
        ...span,
        start: 10,
        end: 13,
        digest: "sha256:she",
      },
      expressionType: "pronoun",
      salience: 0.8,
    };
    const graph = snapshot([lan, pronoun, name]);
    const index = new MentionIndex(graph);

    expect(index.byEntity(lan.id).map((item) => item.id)).toEqual([
      name.id,
      pronoun.id,
    ].sort());
    expect(index.byLanguage("vi").map((item) => item.id)).toEqual([name.id]);
    expect(index.bySourceSpan(span).map((item) => item.id)).toEqual([name.id]);

    const parsed = deserializeSnapshot(serializeSnapshot(graph));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.nodes.find((node) => node.id === name.id)?.kind).toBe(
        "mention",
      );
    }
  });

  it("T306 validates reentrant shared nodes without duplicating semantic identity", () => {
    const lan = entity(sid("entity:lan"));
    const graph = snapshot([
      lan,
      event(sid("event:said"), lan.id),
      event(sid("event:left"), lan.id),
      mention(sid("mention:lan"), lan.id),
      {
        ...mention(sid("mention:she"), lan.id, "en"),
        expressionType: "pronoun",
      },
    ]);

    const view = createCanonicalGraphView(graph);
    const lanNodes = view.nodes.filter((node) => node.id === lan.id);
    expect(lanNodes).toHaveLength(1);
    expect(
      view.edges.filter((edge) => edge.target === lan.id).length,
    ).toBe(4);
    expect(validateSnapshot(graph)).toEqual([]);
  });

  it("T307-T308 supports disconnected provisional fragments and deterministic merge diagnostics", () => {
    const lan = entity(sid("entity:lan"));
    const leave = event(sid("event:leave"), lan.id);

    const eventFragment = createProvisionalGraphFragment({
      id: "fragment:event",
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      nodes: [leave],
    });
    const entityFragment = createProvisionalGraphFragment({
      id: "fragment:entity",
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      nodes: [lan],
    });
    expect(eventFragment.ok).toBe(true);
    expect(entityFragment.ok).toBe(true);
    if (!eventFragment.ok || !entityFragment.ok) return;

    expect(eventFragment.value.unresolvedRefs).toEqual([lan.id]);

    const merged = mergeGraphFragments(
      snapshot([], "rev:empty"),
      [eventFragment.value, entityFragment.value],
    );
    expect(merged.snapshot).toBeDefined();
    expect(merged.unresolvedRefs).toEqual([]);
    expect(merged.diagnostics).toEqual([]);
    expect(merged.snapshot?.nodes.map((node) => node.id)).toEqual([
      lan.id,
      leave.id,
    ].sort());

    const conflictingLan = entity(lan.id);
    conflictingLan.concept = sid("concept:test.other-person");
    const conflict = createProvisionalGraphFragment({
      id: "fragment:conflict",
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      nodes: [conflictingLan],
    });
    expect(conflict.ok).toBe(true);
    if (!conflict.ok) return;

    const conflictReport = mergeGraphFragments(
      snapshot([lan], "rev:base"),
      [conflict.value],
    );
    expect(conflictReport.snapshot).toBeUndefined();
    expect(conflictReport.diagnostics.map((item) => item.code)).toContain(
      "JSG_FRAGMENT_NODE_CONFLICT",
    );
  });

  it("T309 rejects cycles by default and allows only explicitly registered cycle shapes", () => {
    const left = entity(sid("entity:left"), [sid("entity:right")]);
    const right = entity(sid("entity:right"), [sid("entity:left")]);
    const cyclic = snapshot([left, right]);

    expect(validateGraphTopology(cyclic).map((item) => item.code)).toContain(
      "JSG050_UNPERMITTED_CYCLE",
    );
    expect(validateSnapshot(cyclic).map((item) => item.code)).toContain(
      "JSG050_UNPERMITTED_CYCLE",
    );

    const registry = new CyclePermissionRegistry();
    expect(
      registry.register({
        id: "entity-membership-cycle",
        sourceKind: "entity",
        targetKind: "entity",
        label: "entity.membership",
      }).ok,
    ).toBe(true);

    expect(validateGraphTopology(cyclic, registry)).toEqual([]);
    expect(
      validateSnapshot(cyclic, { cyclePermissions: registry }).map(
        (item) => item.code,
      ),
    ).not.toContain("JSG050_UNPERMITTED_CYCLE");
  });

  it("T304 boundary validation rejects malformed mention metadata", () => {
    const lan = entity(sid("entity:lan"));
    const bad = {
      ...mention(sid("mention:bad"), lan.id),
      salience: -1,
    };
    const source = JSON.stringify(snapshot([lan, bad as MentionNode]));
    const parsed = deserializeSnapshot(source);
    expect(parsed.ok).toBe(false);
  });
});
