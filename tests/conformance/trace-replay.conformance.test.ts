import { describe, expect, it } from "vitest";
import {
  createReplayBundle,
  createReplayManifest,
  validateTraceGraph,
  type TraceEvent,
} from "../../packages/trace-replay/src/index.ts";
import { sha256 } from "../../packages/core-types/src/index.ts";

const digest = sha256("{}");

describe("trace/replay conformance", () => {
  it("accepts a deterministic trace DAG and produces a stable replay digest", () => {
    const events: TraceEvent[] = [
      {
        id: "event:source",
        parentIds: [],
        stage: "source-ingest",
        inputRefs: ["source:1"],
        outputRefs: ["normalized:1"],
        configDigest: digest,
      },
      {
        id: "event:emit",
        parentIds: ["event:source"],
        stage: "artifact-emit",
        inputRefs: ["normalized:1"],
        outputRefs: ["artifact:1"],
        configDigest: digest,
      },
    ];

    const manifest = createReplayManifest({
      traceId: "trace:test",
      version: "0.1.0",
      determinism: "D0",
      inputSourceDigests: [sha256("input")],
      configurationVersions: { runtime: "0.1.0" },
      schemaVersions: { jsg: "0.1.0" },
      ontologyVersions: { core: "0.1.0" },
      languagePackVersions: { en: "0.1.0" },
      decisionPackVersions: {},
      graphRevisions: ["graph:1"],
      featureFlags: [],
    });

    const first = createReplayBundle(manifest, events);
    const second = createReplayBundle(manifest, events);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.bundleDigest).toBe(second.value.bundleDigest);
    expect(first.value.events).toHaveLength(2);
  });

  it("rejects missing parents and cycles", () => {
    const missingParent = validateTraceGraph([
      {
        id: "event:a",
        parentIds: ["event:missing"],
        stage: "verify",
        inputRefs: [],
        outputRefs: [],
        configDigest: digest,
      },
    ]);
    expect(missingParent.ok).toBe(false);
    if (!missingParent.ok) {
      expect(missingParent.error.code).toBe("TRACE_PARENT_MISSING");
    }

    const cyclic = validateTraceGraph([
      {
        id: "event:a",
        parentIds: ["event:b"],
        stage: "verify",
        inputRefs: [],
        outputRefs: [],
        configDigest: digest,
      },
      {
        id: "event:b",
        parentIds: ["event:a"],
        stage: "artifact-emit",
        inputRefs: [],
        outputRefs: [],
        configDigest: digest,
      },
    ]);
    expect(cyclic.ok).toBe(false);
    if (!cyclic.ok) expect(cyclic.error.code).toBe("TRACE_CYCLE");
  });
});
