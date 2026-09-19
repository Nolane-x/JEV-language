import { describe, expect, it } from "vitest";
import {
  NodeSha256DigestProvider,
  StructuredError,
  canonicalJson,
  createTraceId,
  runtimeSchema,
  sha256,
} from "../../packages/core-types/src/index.ts";

describe("M0 repository and contract conformance", () => {
  it("keeps hashing behind a stable DigestProvider contract", () => {
    const provider = new NodeSha256DigestProvider();
    expect(provider.algorithm).toBe("sha256");
    expect(provider.digest("jev-language")).toBe(sha256("jev-language"));
    expect(provider.digest(new TextEncoder().encode("jev-language"))).toBe(
      sha256("jev-language"),
    );
    expect(provider.digest("jev-language")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("serializes structured errors canonically", () => {
    const error = new StructuredError(
      "M0_TEST_ERROR",
      "Canonical failure",
      { z: 1, a: true },
    );
    expect(canonicalJson(error.toJSON())).toBe(
      '{"code":"M0_TEST_ERROR","details":{"a":true,"z":1},"message":"Canonical failure","name":"StructuredError"}',
    );
  });

  it("enforces runtime schema boundaries without untyped exceptions", () => {
    const schema = runtimeSchema<{ value: string }>(
      "M0StringRecord",
      (input): input is { value: string } =>
        typeof input === "object" &&
        input !== null &&
        "value" in input &&
        typeof (input as { value?: unknown }).value === "string",
      "M0_SCHEMA_INVALID",
    );

    expect(schema.parse({ value: "ok" })).toEqual({
      ok: true,
      value: { value: "ok" },
    });
    const invalid = schema.parse({ value: 42 });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe("M0_SCHEMA_INVALID");
    }
  });

  it("creates trace IDs that remain distinguishable from semantic IDs", () => {
    const first = createTraceId();
    const second = createTraceId();
    expect(first).toMatch(/^trace:/);
    expect(second).toMatch(/^trace:/);
    expect(first).not.toBe(second);
  });
});
