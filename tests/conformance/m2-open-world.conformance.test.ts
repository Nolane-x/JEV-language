import { describe, expect, it } from "vitest";
import {
  InMemoryOpaqueValueRegistry,
  makeUtf16Span,
  opaqueRedaction,
  parseKnownLiteral,
  parseQuantityLiteral,
  parseTemporalLiteral,
  projectOpaqueToState,
  resolveUtf16Span,
  type GroundingSource,
} from "../../packages/open-world-values/src/index.ts";
import {
  createCoreOntology,
  NamespaceRegistry,
  OntologyStore,
  provisionalConcept,
} from "../../packages/ontology/src/index.ts";

describe("M2 open-world foundations", () => {
  it("detects stale source spans", () => {
    const source: GroundingSource = {
      id: "source:1",
      version: "1",
      mediaType: "text/plain",
      content: "unknownProjectName",
      trust: "user-content",
    };
    const span = makeUtf16Span(source, 0, source.content.length);
    expect(resolveUtf16Span(source, span)).toEqual({
      ok: true,
      value: "unknownProjectName",
    });

    const changed = { ...source, version: "2" };
    expect(resolveUtf16Span(changed, span).ok).toBe(false);
  });

  it("enforces sensitivity on opaque values without losing identity", () => {
    const registry = new InMemoryOpaqueValueRegistry();
    const secret = registry.put("sk-example-secret", "secret");
    const denied = registry.get(secret.id, {
      allowed: new Set(["public", "internal"]),
    });
    expect(denied.ok).toBe(false);
    expect(registry.verify(secret)).toBe(true);
    expect(opaqueRedaction(secret)).toMatch(/^<opaque:secret:[a-f0-9]{12}>$/);
  });


  it("validates opaque digests and blocks unauthorized secret state projection", () => {
    const registry = new InMemoryOpaqueValueRegistry();
    const secret = registry.put("sk-super-secret", "secret");

    const tampered = {
      ...secret,
      digest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000" as const,
    };
    const mismatch = registry.validate(tampered);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.error.code).toBe("OWV_OPAQUE_DIGEST_MISMATCH");
    }

    const denied = projectOpaqueToState(secret, registry, {
      allowedContentSensitivities: new Set(["public", "internal"]),
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe("OWV_STATE_PROJECTION_DENIED");
      expect(JSON.stringify(denied.error.toJSON())).not.toContain(
        "sk-super-secret",
      );
    }

    const allowed = projectOpaqueToState(secret, registry, {
      allowedContentSensitivities: new Set(["secret"]),
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.value).toMatchObject({
        kind: "opaque-content",
        content: "sk-super-secret",
      });
    }
  });

  it("parses quantity/unit and temporal literals without collapsing units into numbers", () => {
    expect(parseQuantityLiteral("<= 3 files")).toMatchObject({
      kind: "quantity",
      value: {
        magnitude: 3,
        unit: "file",
        exactness: "exact",
        comparator: "at-most",
      },
    });
    expect(parseKnownLiteral("2.5 kg")).toMatchObject({
      kind: "quantity",
      value: {
        magnitude: 2.5,
        unit: "kilogram",
      },
    });
    expect(parseTemporalLiteral("2026-09-19T12:30:00+07:00")).toMatchObject({
      kind: "temporal",
      value: {
        precision: "datetime",
      },
    });
    expect(parseTemporalLiteral("P2DT3H")).toMatchObject({
      kind: "temporal",
      value: {
        iso: "P2DT3H",
        precision: "duration",
      },
    });
  });

  it("preserves unknown filenames and new technical terms instead of inventing known meanings", () => {
    expect(parseKnownLiteral("mystery-model.weights")).toMatchObject({
      kind: "filename",
      value: "mystery-model.weights",
    });

    const core = createCoreOntology();
    const provisional = provisionalConcept(
      "zero-copy-semantic-bridge",
      "zero-copy semantic bridge",
      ["concept:core.software-artifact"],
    );
    expect(core.addConcept(provisional).ok).toBe(true);
    expect(core.getConcept(provisional.id)).toMatchObject({
      status: "provisional",
      labels: { source: "zero-copy semantic bridge" },
      parents: ["concept:core.software-artifact"],
    });
  });

  it("seeds the required reusable core ontology families", () => {
    const core = createCoreOntology();
    for (const concept of [
      "concept:core.physical-object",
      "concept:core.abstract-object",
      "concept:core.person",
      "concept:core.organization",
      "concept:core.location",
      "concept:core.time",
      "concept:core.quantity",
      "concept:core.information",
      "concept:core.artifact",
      "concept:core.software-artifact",
      "concept:core.state",
      "concept:core.event",
      "concept:core.action",
      "concept:core.change",
      "concept:core.cause",
      "concept:core.condition",
      "concept:core.permission",
      "concept:core.requirement",
      "concept:core.prohibition",
      "concept:core.truth",
      "concept:core.falsehood",
      "concept:core.unknown",
    ] as const) {
      expect(core.getConcept(concept)).toBeDefined();
    }
  });

  it("builds composite concepts from existing semantic primitives and rejects invented components", () => {
    const store = createCoreOntology();
    store.upsertRelation({
      id: "relation:test.capture-object",
      namespace: "test",
      labels: { en: "captures object" },
      domain: ["concept:core.artifact"],
      range: ["concept:core.entity"],
    });

    const composed = store.composeConcept({
      id: "concept:test.carbon-capture-device",
      namespace: "test",
      labels: { en: "carbon capture device" },
      components: [
        "concept:core.artifact",
        "concept:core.action",
        "concept:core.information",
      ],
      definingRelations: [
        {
          relation: "relation:test.capture-object",
          target: "concept:core.information",
        },
      ],
      parents: ["concept:core.artifact"],
      kind: "entity",
    });
    expect(composed.ok).toBe(true);
    if (composed.ok) {
      expect(composed.value.composition?.components).toEqual([
        "concept:core.artifact",
        "concept:core.action",
        "concept:core.information",
      ]);
      expect(store.getConcept(composed.value.id)?.composition).toEqual(
        composed.value.composition,
      );
    }

    const invalid = store.composeConcept({
      id: "concept:test.invalid-composite",
      namespace: "test",
      labels: { en: "invalid composite" },
      components: ["concept:test.not-real"],
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe("ONTO_COMPOSITION_UNKNOWN_COMPONENT");
    }
  });

  it("recognizes deterministic literal classes before semantic judgment", () => {
    expect(parseKnownLiteral("42")).toMatchObject({ kind: "number", value: 42 });
    expect(parseKnownLiteral("https://example.com/a")).toMatchObject({
      kind: "url",
    });
    expect(parseKnownLiteral("hello@example.com")).toMatchObject({
      kind: "email",
    });
    expect(parseKnownLiteral("2026-09-19")).toMatchObject({ kind: "date" });
  });

  it("rejects namespace collisions and invalid provisional parents", () => {
    const namespaces = new NamespaceRegistry();
    expect(namespaces.register("domain.example", "owner-a").ok).toBe(true);
    expect(namespaces.register("domain.example", "owner-b").ok).toBe(false);

    const store = new OntologyStore();
    const invalid = store.addConcept(
      provisionalConcept(
        "unknown-term",
        "unknown term",
        ["concept:missing.parent"],
      ),
    );
    expect(invalid.ok).toBe(false);
  });

  it("merges concept batches transactionally and rejects parent cycles", () => {
    const store = new OntologyStore();
    const merged = store.mergeConcepts([
      {
        id: "concept:test.root",
        namespace: "test",
        labels: { en: "root" },
        parents: [],
        status: "domain",
      },
      {
        id: "concept:test.child",
        namespace: "test",
        labels: { en: "child" },
        parents: ["concept:test.root"],
        status: "domain",
      },
    ]);

    expect(merged.ok).toBe(true);
    expect(store.ancestorsOf("concept:test.child")).toEqual([
      "concept:test.root",
    ]);

    const cycle = store.mergeConcepts([
      {
        id: "concept:test.a",
        namespace: "test",
        labels: { en: "a" },
        parents: ["concept:test.b"],
        status: "domain",
      },
      {
        id: "concept:test.b",
        namespace: "test",
        labels: { en: "b" },
        parents: ["concept:test.a"],
        status: "domain",
      },
    ]);
    expect(cycle.ok).toBe(false);
    expect(store.getConcept("concept:test.a")).toBeUndefined();
  });

  it("resolves deprecated concepts through explicit replacements", () => {
    const store = new OntologyStore();
    expect(
      store.mergeConcepts([
        {
          id: "concept:test.old",
          namespace: "test",
          labels: { en: "old" },
          parents: [],
          status: "domain",
        },
        {
          id: "concept:test.new",
          namespace: "test",
          labels: { en: "new" },
          parents: [],
          status: "domain",
        },
      ]).ok,
    ).toBe(true);

    expect(
      store.deprecateConcept("concept:test.old", "concept:test.new").ok,
    ).toBe(true);
    expect(store.resolveConcept("concept:test.old")?.id).toBe(
      "concept:test.new",
    );
  });

  it("prevents deprecated replacement cycles", () => {
    const store = new OntologyStore();
    expect(
      store.mergeConcepts([
        {
          id: "concept:test.first",
          namespace: "test",
          labels: { en: "first" },
          parents: [],
          status: "domain",
        },
        {
          id: "concept:test.second",
          namespace: "test",
          labels: { en: "second" },
          parents: [],
          status: "domain",
        },
      ]).ok,
    ).toBe(true);

    expect(
      store.deprecateConcept("concept:test.first", "concept:test.second").ok,
    ).toBe(true);
    const cycle = store.deprecateConcept(
      "concept:test.second",
      "concept:test.first",
    );
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) {
      expect(cycle.error.code).toBe("ONTO_REPLACEMENT_CYCLE");
    }
  });
});
