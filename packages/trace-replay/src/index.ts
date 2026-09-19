import {
  canonicalJson,
  createTraceId,
  err,
  ok,
  sha256,
  StructuredError,
  type Digest,
  type JsonValue,
  type Result,
  type TraceId,
} from "../../core-types/src/index.ts";

export interface TraceEvent {
  id: string;
  parentIds: string[];
  timestamp?: string;
  stage: string;
  inputRefs: string[];
  outputRefs: string[];
  configDigest: Digest;
  metadata?: JsonValue;
}

export interface ReplayManifest {
  version: string;
  traceId: TraceId;
  determinism: "D0" | "D1" | "D2" | "D3";
  inputSourceDigests: Digest[];
  configurationVersions: Record<string, string>;
  schemaVersions: Record<string, string>;
  ontologyVersions: Record<string, string>;
  languagePackVersions: Record<string, string>;
  decisionPackVersions: Record<string, string>;
  jevModelId?: string;
  graphRevisions: string[];
  featureFlags: string[];
  randomSeeds?: number[];
  recordedDecisionRefs?: string[];
  externalVerifierRefs?: string[];
  annotations?: Record<string, JsonValue>;
}

export interface ReplayBundle {
  manifest: ReplayManifest;
  events: TraceEvent[];
  bundleDigest: Digest;
}

export type ReplayMode = "exact" | "live" | "partial";

const validateEventShape = (event: TraceEvent): StructuredError | undefined => {
  if (event.id.trim() === "") {
    return new StructuredError("TRACE_EVENT_ID", "Trace event id is required.");
  }
  if (event.stage.trim() === "") {
    return new StructuredError(
      "TRACE_EVENT_STAGE",
      `Trace event ${event.id} requires a stage.`,
    );
  }
  if (event.parentIds.includes(event.id)) {
    return new StructuredError(
      "TRACE_EVENT_SELF_PARENT",
      `Trace event ${event.id} cannot parent itself.`,
    );
  }
  return undefined;
};

export const validateTraceGraph = (
  events: readonly TraceEvent[],
): Result<TraceEvent[]> => {
  const byId = new Map<string, TraceEvent>();
  for (const event of events) {
    const error = validateEventShape(event);
    if (error) return err(error);
    if (byId.has(event.id)) {
      return err(
        new StructuredError(
          "TRACE_EVENT_DUPLICATE",
          `Duplicate trace event id: ${event.id}.`,
        ),
      );
    }
    byId.set(event.id, event);
  }

  for (const event of events) {
    for (const parent of event.parentIds) {
      if (!byId.has(parent)) {
        return err(
          new StructuredError(
            "TRACE_PARENT_MISSING",
            `Trace event ${event.id} references missing parent ${parent}.`,
          ),
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visited.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const event = byId.get(id);
    for (const parent of event?.parentIds ?? []) {
      if (visit(parent)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  for (const id of byId.keys()) {
    if (visit(id)) {
      return err(
        new StructuredError(
          "TRACE_CYCLE",
          "Trace parent relationships must form a DAG.",
        ),
      );
    }
  }

  return ok(events.map((event) => structuredClone(event)));
};

const manifestJson = (manifest: ReplayManifest): JsonValue => {
  const value: Record<string, JsonValue> = {
    version: manifest.version,
    traceId: manifest.traceId,
    determinism: manifest.determinism,
    inputSourceDigests: manifest.inputSourceDigests,
    configurationVersions: manifest.configurationVersions,
    schemaVersions: manifest.schemaVersions,
    ontologyVersions: manifest.ontologyVersions,
    languagePackVersions: manifest.languagePackVersions,
    decisionPackVersions: manifest.decisionPackVersions,
    graphRevisions: manifest.graphRevisions,
    featureFlags: manifest.featureFlags,
  };
  if (manifest.jevModelId !== undefined) value.jevModelId = manifest.jevModelId;
  if (manifest.randomSeeds !== undefined) value.randomSeeds = manifest.randomSeeds;
  if (manifest.recordedDecisionRefs !== undefined) {
    value.recordedDecisionRefs = manifest.recordedDecisionRefs;
  }
  if (manifest.externalVerifierRefs !== undefined) {
    value.externalVerifierRefs = manifest.externalVerifierRefs;
  }
  if (manifest.annotations !== undefined) value.annotations = manifest.annotations;
  return value;
};

export const validateReplayManifest = (
  manifest: ReplayManifest,
): Result<ReplayManifest> => {
  if (manifest.version.trim() === "") {
    return err(
      new StructuredError(
        "REPLAY_MANIFEST_VERSION",
        "Replay manifest version is required.",
      ),
    );
  }
  const maps = [
    manifest.configurationVersions,
    manifest.schemaVersions,
    manifest.ontologyVersions,
    manifest.languagePackVersions,
    manifest.decisionPackVersions,
  ];
  for (const map of maps) {
    if (
      Object.entries(map).some(
        ([key, value]) => key.trim() === "" || value.trim() === "",
      )
    ) {
      return err(
        new StructuredError(
          "REPLAY_MANIFEST_VERSION_ENTRY",
          "Replay version maps require non-empty keys and values.",
        ),
      );
    }
  }
  return ok(structuredClone(manifest));
};

export const createReplayBundle = (
  manifest: ReplayManifest,
  events: readonly TraceEvent[],
): Result<ReplayBundle> => {
  const validManifest = validateReplayManifest(manifest);
  if (!validManifest.ok) return validManifest;
  const validTrace = validateTraceGraph(events);
  if (!validTrace.ok) return validTrace;

  const payload: JsonValue = {
    manifest: manifestJson(validManifest.value),
    events: validTrace.value.map((event) => {
      const value: Record<string, JsonValue> = {
        id: event.id,
        parentIds: event.parentIds,
        stage: event.stage,
        inputRefs: event.inputRefs,
        outputRefs: event.outputRefs,
        configDigest: event.configDigest,
      };
      if (event.timestamp !== undefined) value.timestamp = event.timestamp;
      if (event.metadata !== undefined) value.metadata = event.metadata;
      return value;
    }),
  };

  return ok({
    manifest: validManifest.value,
    events: validTrace.value,
    bundleDigest: sha256(canonicalJson(payload)),
  });
};

export class InMemoryTraceRecorder {
  readonly traceId: TraceId;
  readonly #events: TraceEvent[] = [];

  constructor(traceId: TraceId = createTraceId()) {
    this.traceId = traceId;
  }

  record(event: Omit<TraceEvent, "id"> & { id?: string }): TraceEvent {
    const id = event.id ?? `${this.traceId}:event:${this.#events.length + 1}`;
    const next: TraceEvent = { ...structuredClone(event), id };
    const candidate = [...this.#events, next];
    const valid = validateTraceGraph(candidate);
    if (!valid.ok) throw valid.error;
    this.#events.push(next);
    return structuredClone(next);
  }

  events(): TraceEvent[] {
    return this.#events.map((event) => structuredClone(event));
  }
}

export const createReplayManifest = (
  input: Omit<ReplayManifest, "traceId"> & { traceId?: TraceId },
): ReplayManifest => ({
  ...structuredClone(input),
  traceId: input.traceId ?? createTraceId(),
});


export const verifyReplayBundleIntegrity = (
  bundle: ReplayBundle,
): Result<ReplayBundle> => {
  const rebuilt = createReplayBundle(bundle.manifest, bundle.events);
  if (!rebuilt.ok) return rebuilt;
  if (rebuilt.value.bundleDigest !== bundle.bundleDigest) {
    return err(
      new StructuredError(
        "REPLAY_BUNDLE_DIGEST_MISMATCH",
        "Replay bundle digest does not match its canonical manifest/event content.",
        {
          expected: rebuilt.value.bundleDigest,
          actual: bundle.bundleDigest,
        },
      ),
    );
  }
  return ok(structuredClone(bundle));
};
