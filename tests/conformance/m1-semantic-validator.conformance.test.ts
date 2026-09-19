import { describe, expect, it } from "vitest";
import {
  createCoreOntology,
  type OntologyStore,
} from "../../packages/ontology/src/index.ts";
import {
  InMemoryProvenanceStore,
  type ProvenanceRecord,
} from "../../packages/provenance/src/index.ts";
import type {
  EntityNode,
  EventNode,
  EvidenceNode,
  GraphSnapshot,
  PropositionNode,
  QuantityNode,
  ReferenceNode,
  RelationNode,
  StateNode,
} from "../../packages/semantic-graph/src/index.ts";
import {
  DIAGNOSTIC_REGISTRY,
  SemanticInvariantRegistry,
  VALIDATION_PIPELINE,
  createCoreInvariantRegistry,
  diagnosticDefinition,
  validateSnapshotStages,
} from "../../packages/semantic-validator/src/index.ts";

const common = {
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  trust: "user-content" as const,
  provenance: ["prov:test"] as const,
};

const entity = (id = "entity:service"): EntityNode => ({
  ...common,
  provenance: [...common.provenance],
  id,
  kind: "entity",
  concept: "concept:core.software-service",
  attributes: [],
  memberships: [],
});

const event = (
  input: Partial<EventNode> = {},
): EventNode => ({
  ...common,
  provenance: [...common.provenance],
  id: "event:delete",
  kind: "event",
  predicate: "concept:core.delete",
  roles: [],
  polarity: "positive",
  ...input,
});

const snapshot = (nodes: GraphSnapshot["nodes"]): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision: "rev:test",
  nodes,
});

const codes = (
  result: ReturnType<typeof validateSnapshotStages>,
): string[] => result.diagnostics.map((diagnostic) => diagnostic.code);

const ontologyWithStrictRoles = (): OntologyStore => {
  const ontology = createCoreOntology();
  ontology.upsertRole({
    id: "role:test.agent",
    namespace: "test",
    labels: { en: "agent" },
    domain: ["concept:core.event"],
    range: ["concept:core.entity"],
    cardinality: "exactly-one",
  });
  ontology.upsertRelation({
    id: "relation:test.owner",
    namespace: "test",
    labels: { en: "owner" },
    domain: ["concept:core.person"],
    range: ["concept:core.artifact"],
  });
  return ontology;
};

describe("M1 staged semantic validator T026-T035", () => {
  it("publishes deterministic V0-V8 stage order and stable diagnostic definitions", () => {
    expect(VALIDATION_PIPELINE).toEqual([
      "V0",
      "V1",
      "V2",
      "V3",
      "V4",
      "V5",
      "V6",
      "V7",
      "V8",
    ]);
    expect(diagnosticDefinition("JSG001_DANGLING_REFERENCE")).toEqual(
      DIAGNOSTIC_REGISTRY.JSG001_DANGLING_REFERENCE,
    );
    expect(diagnosticDefinition("JSG014_ROLE_DOMAIN_MISMATCH").stage).toBe("V3");
    expect(
      diagnosticDefinition("VAL022_UNTRUSTED_CONTROL_ESCALATION").stage,
    ).toBe("V7");
  });

  it("V0 rejects version and confidence/numeric schema violations", () => {
    const malformed = event({
      schemaVersion: "9.9.9",
      confidence: { source: "rule", probability: 2 },
    });
    const result = validateSnapshotStages(snapshot([malformed]), {}, ["V0"]);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "JSG003_SCHEMA_VERSION_MISMATCH",
        "JSG005_INVALID_CONFIDENCE",
      ]),
    );

    const invalidQuantity: QuantityNode = {
      ...common,
      provenance: [...common.provenance],
      id: "quantity:invalid",
      kind: "quantity",
      amount: Number.NaN,
      comparator: "exact",
    };
    const numeric = validateSnapshotStages(
      snapshot([invalidQuantity]),
      {},
      ["V0"],
    );
    expect(codes(numeric)).toContain("JSG006_INVALID_NUMERIC_VALUE");
  });

  it("V1 rejects dangling references while accepting closed internal references", () => {
    const dangling = event({
      roles: [
        {
          role: "role:core.agent",
          value: { kind: "ref", ref: "entity:missing" },
        },
      ],
    });
    expect(
      codes(validateSnapshotStages(snapshot([dangling]), {}, ["V1"])),
    ).toContain("JSG001_DANGLING_REFERENCE");

    const service = entity();
    const closed = event({
      roles: [
        {
          role: "role:core.agent",
          value: { kind: "ref", ref: service.id },
        },
      ],
    });
    expect(
      codes(validateSnapshotStages(snapshot([service, closed]), {}, ["V1"])),
    ).not.toContain("JSG001_DANGLING_REFERENCE");
  });

  it("V2 validates ontology references without treating open-world absence as a parser guess", () => {
    const ontology = createCoreOntology();
    const unknown = event({ predicate: "concept:missing.event" });
    const result = validateSnapshotStages(
      snapshot([unknown]),
      { ontology },
      ["V2"],
    );
    expect(codes(result)).toContain("JSG010_UNKNOWN_ONTOLOGY_REF");

    const known = event();
    expect(
      codes(
        validateSnapshotStages(snapshot([known]), { ontology }, ["V2"]),
      ),
    ).not.toContain("JSG010_UNKNOWN_ONTOLOGY_REF");
  });

  it("V3 enforces role and relation domain/range when types are known", () => {
    const ontology = ontologyWithStrictRoles();
    const service = entity();
    const wrongRange: StateNode = {
      ...common,
      provenance: [...common.provenance],
      id: "state:active",
      kind: "state",
      predicate: "concept:core.state",
      arguments: [],
      polarity: "positive",
    };
    const wrongRole = event({
      roles: [
        {
          role: "role:test.agent",
          value: { kind: "ref", ref: wrongRange.id },
        },
      ],
    });
    const roleResult = validateSnapshotStages(
      snapshot([service, wrongRange, wrongRole]),
      { ontology },
      ["V3"],
    );
    expect(codes(roleResult)).toContain("JSG015_ROLE_RANGE_MISMATCH");

    const relation: RelationNode = {
      ...common,
      provenance: [...common.provenance],
      id: "relation:owner",
      kind: "relation",
      relation: "relation:test.owner",
      source: service.id,
      target: "entity:person",
      polarity: "positive",
    };
    const person: EntityNode = {
      ...entity("entity:person"),
      concept: "concept:core.person",
    };
    const relationResult = validateSnapshotStages(
      snapshot([service, person, relation]),
      { ontology },
      ["V3"],
    );
    expect(codes(relationResult)).toEqual(
      expect.arrayContaining([
        "JSG016_RELATION_DOMAIN_MISMATCH",
        "JSG017_RELATION_RANGE_MISMATCH",
      ]),
    );
  });

  it("V4 enforces both maximum and applicable minimum role cardinality", () => {
    const ontology = ontologyWithStrictRoles();
    const one = entity("entity:one");
    const two = entity("entity:two");
    const duplicated = event({
      roles: [
        {
          role: "role:test.agent",
          value: { kind: "ref", ref: one.id },
        },
        {
          role: "role:test.agent",
          value: { kind: "ref", ref: two.id },
        },
      ],
    });
    expect(
      codes(
        validateSnapshotStages(
          snapshot([one, two, duplicated]),
          { ontology },
          ["V4"],
        ),
      ),
    ).toContain("JSG021_ROLE_CARDINALITY");

    const missing = event({ id: "event:missing-agent", roles: [] });
    expect(
      codes(
        validateSnapshotStages(
          snapshot([missing]),
          { ontology },
          ["V4"],
        ),
      ),
    ).toContain("JSG021_ROLE_CARDINALITY");
  });

  it("V5 validates scope stubs and reference/alternative bindings", () => {
    const scoped: PropositionNode = {
      ...common,
      provenance: [...common.provenance],
      id: "proposition:negative",
      kind: "proposition",
      predicate: "concept:core.requirement",
      arguments: [],
      polarity: "negative",
      scope: { kind: "resolved" },
    };
    const ref: ReferenceNode = {
      ...common,
      provenance: [...common.provenance],
      id: "reference:test",
      kind: "reference",
      candidates: ["entity:a"],
      resolved: "entity:b",
    };
    const result = validateSnapshotStages(
      snapshot([scoped, ref]),
      {},
      ["V5"],
    );
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "JSG030_SCOPE_RESOLUTION_INVALID",
        "JSG032_BINDING_RESOLUTION_INVALID",
      ]),
    );

    const underspecified: PropositionNode = {
      ...scoped,
      id: "proposition:underspecified",
      scope: { kind: "underspecified" },
    };
    expect(
      codes(
        validateSnapshotStages(snapshot([underspecified]), {}, ["V5"]),
      ),
    ).not.toContain("JSG031_NEGATION_SCOPE_AMBIGUOUS");
  });

  it("V6 exposes duplicate-safe invariant registration and runs the core invariant bundle", () => {
    const registry = new SemanticInvariantRegistry();
    const first = registry.register({
      id: "test.invariant",
      description: "test",
      check: () => [],
    });
    const duplicate = registry.register({
      id: "test.invariant",
      description: "duplicate",
      check: () => [],
    });
    expect(first.ok).toBe(true);
    expect(duplicate.ok).toBe(false);

    const quantity: QuantityNode = {
      ...common,
      provenance: [...common.provenance],
      id: "quantity:exact",
      kind: "quantity",
      amount: 2,
      comparator: "exact",
    };
    const evidence: EvidenceNode = {
      ...common,
      provenance: [...common.provenance],
      id: "evidence:conflict",
      kind: "evidence",
      supports: ["proposition:x"],
      contradicts: ["proposition:x"],
      payload: { kind: "boolean", value: true },
    };
    const result = validateSnapshotStages(
      snapshot([quantity, evidence]),
      { invariants: createCoreInvariantRegistry() },
      ["V6"],
    );
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "JSG040_EXACT_QUANTITY_WITHOUT_UNIT",
        "JSG041_EVIDENCE_CONFLICT",
      ]),
    );
  });

  it("V7 requires provenance closure when a store is supplied and prevents trust escalation", () => {
    const store = new InMemoryProvenanceStore();
    const external: ProvenanceRecord = {
      id: "prov:external",
      originType: "external-content",
      sourceRefs: [],
      trust: "external-content",
    };
    store.add(external);

    const escalated: EntityNode = {
      ...entity(),
      trust: "system-trusted",
      provenance: [external.id],
    };
    const escalation = validateSnapshotStages(
      snapshot([escalated]),
      { provenance: store },
      ["V7"],
    );
    expect(codes(escalation)).toContain(
      "VAL022_UNTRUSTED_CONTROL_ESCALATION",
    );

    const missing: EntityNode = {
      ...entity("entity:missing-provenance"),
      provenance: ["prov:not-found"],
    };
    const unresolved = validateSnapshotStages(
      snapshot([missing]),
      { provenance: store },
      ["V7"],
    );
    expect(codes(unresolved)).toContain("VAL020_UNKNOWN_PROVENANCE_REF");
  });

  it("V8 runs profile validators deterministically by id", () => {
    const seen: string[] = [];
    const result = validateSnapshotStages(
      snapshot([entity()]),
      {
        profileValidators: [
          {
            id: "z-last",
            validate: () => {
              seen.push("z-last");
              return [];
            },
          },
          {
            id: "a-first",
            validate: () => {
              seen.push("a-first");
              return [];
            },
          },
        ],
      },
      ["V8"],
    );
    expect(result.diagnostics).toEqual([]);
    expect(seen).toEqual(["a-first", "z-last"]);
  });
});
