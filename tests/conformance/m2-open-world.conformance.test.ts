import { describe, expect, it } from "vitest";
import {
  InMemoryOpaqueValueRegistry,
  makeUtf16Span,
  opaqueRedaction,
  parseKnownLiteral,
  resolveUtf16Span,
  type GroundingSource,
} from "../../packages/open-world-values/src/index.ts";
import {
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
