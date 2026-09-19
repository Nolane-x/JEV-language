import { describe, expect, it } from "vitest";
import {
  InMemoryOpaqueValueRegistry,
  makeUtf16Span,
  parseDeterministicLiteral,
  parseQuantityLiteral,
  resolveUtf16Span,
  type GroundingSource,
} from "../packages/open-world-values/src/index.ts";
import {
  NamespaceRegistry,
  OntologyStore,
  provisionalConcept,
} from "../packages/ontology/src/index.ts";

const source = (version = "1"): GroundingSource => ({
  id: "message:1",
  version,
  mediaType: "text/plain",
  content: "alpha secret beta",
  trust: "user-content",
});

describe("open-world values", () => {
  it("resolves exact versioned spans and rejects stale versions", () => {
    const original = source("1");
    const span = makeUtf16Span(original, 6, 12);
    const resolved = resolveUtf16Span(original, span);
    expect(resolved).toEqual({ ok: true, value: "secret" });

    const stale = resolveUtf16Span(source("2"), span);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("OWV_STALE_SPAN");
  });

  it("enforces opaque sensitivity policies and digest identity", () => {
    const registry = new InMemoryOpaqueValueRegistry();
    const ref = registry.put("api-key-like-value", "secret");

    expect(
      registry.get(ref.id, { allowed: new Set(["public", "internal"]) }).ok,
    ).toBe(false);
    expect(registry.get(ref.id, { allowed: new Set(["secret"]) }).ok).toBe(true);
    expect(registry.verify(ref)).toBe(true);
    expect(registry.verify({ ...ref, digest: "sha256:deadbeef" })).toBe(false);
  });

  it("recognizes deterministic literals without Jev", () => {
    expect(parseDeterministicLiteral("2026-09-19")?.kind).toBe("date");
    expect(
      parseDeterministicLiteral("550e8400-e29b-41d4-a716-446655440000")?.kind,
    ).toBe("uuid");
    expect(parseDeterministicLiteral("https://example.com/a")?.kind).toBe("url");
    expect(parseDeterministicLiteral("v1.2.3")?.kind).toBe("semver");

    expect(parseQuantityLiteral("at most 3 files")).toMatchObject({
      kind: "quantity",
      amount: 3,
      comparator: "at-most",
      unitSurface: "files",
    });
  });
});

describe("ontology safety", () => {
  it("rejects namespace collisions", () => {
    const registry = new NamespaceRegistry();
    expect(registry.register("domain.foo", "owner-a").ok).toBe(true);
    expect(registry.register("domain.foo", "owner-b").ok).toBe(false);
  });

  it("rejects provisional concepts with missing parents", () => {
    const store = new OntologyStore();
    const result = store.addConcept(
      provisionalConcept(
        "novel-term",
        "novel term",
        ["concept:missing.parent"],
      ),
    );
    expect(result.ok).toBe(false);
  });
});
