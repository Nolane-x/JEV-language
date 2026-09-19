import { describe, expect, it } from "vitest";
import {
  InMemoryOpaqueValueRegistry,
  makeUtf16Span,
  opaqueRedaction,
  parseKnownLiteral,
  resolveUtf16Span,
  type GroundingSource,
} from "../../packages/open-world-values/src/index.ts";

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
});
