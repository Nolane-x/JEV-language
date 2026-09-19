import {
  canonicalJson,
  sha256,
  type Digest,
  type JsonValue,
} from "../../core-types/src/index.ts";
import {
  InMemoryTraceRecorder,
  createReplayManifest,
  type ReplayManifest,
  type TraceEvent,
} from "../../trace-replay/src/index.ts";
import type {
  CapabilityManifest,
  ExpressionArtifact,
  ExpressionRequest,
  ExpressionResult,
  ExpressionTarget,
  ParseRequest,
  ResultEnvelope,
  TransformRequest,
  UniversalExpressionApi,
  VerifyRequest,
} from "./index.ts";

export interface ParserAdapter {
  readonly id: string;
  readonly sourceLanguages?: readonly string[];
  readonly outputTargets?: readonly ExpressionTarget[];
  parse(request: ParseRequest): Promise<ResultEnvelope<ExpressionArtifact[]>>;
}

export interface RealizerAdapter {
  readonly id: string;
  readonly targets: readonly ExpressionTarget[];
  readonly languages?: readonly string[];
  realize(request: ExpressionRequest): Promise<ExpressionResult>;
}

export interface TransformerAdapter {
  readonly id: string;
  readonly sourceArtifactTypes?: readonly ExpressionArtifact["artifactType"][];
  readonly targets: readonly ExpressionTarget[];
  transform(request: TransformRequest): Promise<ExpressionResult>;
}

export interface ExpressionVerifierAdapter {
  readonly id: string;
  readonly profiles?: readonly string[];
  verify(request: VerifyRequest): Promise<ResultEnvelope<boolean>>;
}

export interface UniversalRuntimeConfig {
  apiVersion?: string;
  configuration?: JsonValue;
  schemaVersions?: Record<string, string>;
  ontologyVersions?: Record<string, string>;
  languagePackVersions?: Record<string, string>;
  decisionPackVersions?: Record<string, string>;
  featureFlags?: string[];
  determinism?: "D0" | "D1" | "D2" | "D3";
}

export interface TracedUniversalExpressionApi extends UniversalExpressionApi {
  traceEvents(): TraceEvent[];
  replayManifest(): ReplayManifest;
}

class AdapterRegistry {
  readonly parsers: ParserAdapter[] = [];
  readonly realizers: RealizerAdapter[] = [];
  readonly transformers: TransformerAdapter[] = [];
  readonly verifiers: ExpressionVerifierAdapter[] = [];
  readonly #ids = new Set<string>();

  #claim(id: string): void {
    if (id.trim() === "") {
      throw new Error("Adapter id must be non-empty.");
    }
    if (this.#ids.has(id)) {
      throw new Error(`Duplicate universal-expression adapter id: ${id}.`);
    }
    this.#ids.add(id);
  }

  addParser(adapter: ParserAdapter): void {
    this.#claim(adapter.id);
    this.parsers.push(adapter);
  }

  addRealizer(adapter: RealizerAdapter): void {
    this.#claim(adapter.id);
    this.realizers.push(adapter);
  }

  addTransformer(adapter: TransformerAdapter): void {
    this.#claim(adapter.id);
    this.transformers.push(adapter);
  }

  addVerifier(adapter: ExpressionVerifierAdapter): void {
    this.#claim(adapter.id);
    this.verifiers.push(adapter);
  }
}

export interface UniversalRuntimeAdapters {
  parsers?: ParserAdapter[];
  realizers?: RealizerAdapter[];
  transformers?: TransformerAdapter[];
  verifiers?: ExpressionVerifierAdapter[];
}

const languageMatches = (
  supported: readonly string[] | undefined,
  requested: string | undefined,
): boolean =>
  supported === undefined ||
  requested === undefined ||
  supported.includes(requested);

const unsupported = <T>(
  code: string,
  message: string,
): ResultEnvelope<T> => ({
  status: "unsupported",
  diagnostics: [{ code, message, severity: "error" }],
  evidence: [],
  provenance: [],
});

const attachTrace = <T>(
  envelope: ResultEnvelope<T>,
  trace: InMemoryTraceRecorder,
): ResultEnvelope<T> => ({
  ...envelope,
  trace: trace.traceId,
});

const artifactRefs = (artifacts: readonly ExpressionArtifact[] | undefined): string[] =>
  artifacts?.map((artifact, index) => `${artifact.artifactType}:${index}`) ?? [];

const selectOne = <T extends { id: string }>(
  candidates: T[],
): T | "ambiguous" | undefined => {
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1) return "ambiguous";
  return candidates[0];
};

export const createRegistryUniversalExpressionApi = (
  adapters: UniversalRuntimeAdapters,
  config: UniversalRuntimeConfig = {},
): TracedUniversalExpressionApi => {
  const registry = new AdapterRegistry();
  for (const adapter of adapters.parsers ?? []) registry.addParser(adapter);
  for (const adapter of adapters.realizers ?? []) registry.addRealizer(adapter);
  for (const adapter of adapters.transformers ?? []) registry.addTransformer(adapter);
  for (const adapter of adapters.verifiers ?? []) registry.addVerifier(adapter);

  const configuration = config.configuration ?? {};
  const configDigest: Digest = sha256(canonicalJson(configuration));
  const trace = new InMemoryTraceRecorder();

  const recordStart = (stage: string, metadata?: JsonValue): string =>
    trace.record({
      parentIds: [],
      stage,
      inputRefs: [],
      outputRefs: [],
      configDigest,
      ...(metadata === undefined ? {} : { metadata }),
    }).id;

  const recordFinish = (
    parentId: string,
    stage: string,
    outputRefs: string[],
    metadata?: JsonValue,
  ): void => {
    trace.record({
      parentIds: [parentId],
      stage,
      inputRefs: [],
      outputRefs,
      configDigest,
      ...(metadata === undefined ? {} : { metadata }),
    });
  };

  const capabilities = (): CapabilityManifest => {
    const targets = new Set<ExpressionTarget>();
    const languages = new Set<string>();
    for (const adapter of registry.realizers) {
      adapter.targets.forEach((target) => targets.add(target));
      adapter.languages?.forEach((language) => languages.add(language));
    }
    for (const adapter of registry.transformers) {
      adapter.targets.forEach((target) => targets.add(target));
    }
    for (const adapter of registry.parsers) {
      adapter.outputTargets?.forEach((target) => targets.add(target));
      adapter.sourceLanguages?.forEach((language) => languages.add(language));
    }

    return {
      apiVersion: config.apiVersion ?? "0.1.0",
      targets: [...targets].sort(),
      operations: ["parse", "realize", "express", "transform", "verify"],
      languagePacks: [...languages].sort(),
      backends: [
        ...registry.parsers.map((entry) => entry.id),
        ...registry.realizers.map((entry) => entry.id),
        ...registry.transformers.map((entry) => entry.id),
      ].sort(),
      verifiers: registry.verifiers.map((entry) => entry.id).sort(),
      unsupported: [],
    };
  };

  const parse = async (
    request: ParseRequest,
  ): Promise<ResultEnvelope<ExpressionArtifact[]>> => {
    const parent = recordStart("source-ingest");
    const candidates = registry.parsers.filter(
      (adapter) =>
        languageMatches(adapter.sourceLanguages, request.sourceLanguage) &&
        (request.expectedTarget === undefined ||
          adapter.outputTargets === undefined ||
          adapter.outputTargets.includes(request.expectedTarget)),
    );
    const selected = selectOne(candidates);
    if (selected === undefined || selected === "ambiguous") {
      const result = unsupported<ExpressionArtifact[]>(
        selected === undefined
          ? "EXPRESSION_PARSE_UNSUPPORTED"
          : "EXPRESSION_PARSE_ADAPTER_AMBIGUOUS",
        selected === undefined
          ? "No parser adapter supports this request."
          : "Multiple parser adapters match without an explicit routing rule.",
      );
      recordFinish(parent, "artifact-emit", []);
      return attachTrace(result, trace);
    }
    const result = await selected.parse(request);
    recordFinish(parent, "semantic-commit", artifactRefs(result.value), {
      adapterId: selected.id,
    });
    return attachTrace(result, trace);
  };

  const materialize = async (
    operation: "realize" | "express",
    request: ExpressionRequest,
  ): Promise<ExpressionResult> => {
    const parent = recordStart(operation, { target: request.target });
    const candidates = registry.realizers.filter(
      (adapter) =>
        adapter.targets.includes(request.target) &&
        languageMatches(adapter.languages, request.language),
    );
    const selected = selectOne(candidates);
    if (selected === undefined || selected === "ambiguous") {
      const result: ExpressionResult = {
        ...unsupported<ExpressionArtifact[]>(
          selected === undefined
            ? `EXPRESSION_${operation.toUpperCase()}_UNSUPPORTED`
            : `EXPRESSION_${operation.toUpperCase()}_ADAPTER_AMBIGUOUS`,
          selected === undefined
            ? `No realizer adapter supports this ${operation} request.`
            : `Multiple realizer adapters match the ${operation} request without an explicit routing rule.`,
        ),
      };
      recordFinish(parent, "artifact-emit", []);
      return attachTrace(result, trace) as ExpressionResult;
    }
    const result = await selected.realize(request);
    recordFinish(parent, "artifact-emit", artifactRefs(result.value), {
      adapterId: selected.id,
      operation,
    });
    return attachTrace(result, trace) as ExpressionResult;
  };

  const realize = (request: ExpressionRequest): Promise<ExpressionResult> =>
    materialize("realize", request);

  const express = (request: ExpressionRequest): Promise<ExpressionResult> =>
    materialize("express", request);

  const transform = async (
    request: TransformRequest,
  ): Promise<ExpressionResult> => {
    const parent = recordStart("transform", { target: request.target });
    const candidates = registry.transformers.filter(
      (adapter) =>
        adapter.targets.includes(request.target) &&
        (adapter.sourceArtifactTypes === undefined ||
          adapter.sourceArtifactTypes.includes(request.input.artifactType)),
    );
    const selected = selectOne(candidates);
    if (selected === undefined || selected === "ambiguous") {
      const result: ExpressionResult = {
        ...unsupported<ExpressionArtifact[]>(
          selected === undefined
            ? "EXPRESSION_TRANSFORM_UNSUPPORTED"
            : "EXPRESSION_TRANSFORM_ADAPTER_AMBIGUOUS",
          selected === undefined
            ? "No transform adapter supports this request."
            : "Multiple transform adapters match without an explicit routing rule.",
        ),
      };
      recordFinish(parent, "artifact-emit", []);
      return attachTrace(result, trace) as ExpressionResult;
    }
    const result = await selected.transform(request);
    recordFinish(parent, "artifact-emit", artifactRefs(result.value), {
      adapterId: selected.id,
    });
    return attachTrace(result, trace) as ExpressionResult;
  };

  const verify = async (
    request: VerifyRequest,
  ): Promise<ResultEnvelope<boolean>> => {
    const parent = recordStart("verify");
    const candidates = registry.verifiers.filter(
      (adapter) =>
        request.profile === undefined ||
        adapter.profiles === undefined ||
        adapter.profiles.includes(request.profile),
    );
    if (candidates.length === 0) {
      const result = unsupported<boolean>(
        "EXPRESSION_VERIFY_UNSUPPORTED",
        "No verifier adapter supports this request.",
      );
      recordFinish(parent, "verify", []);
      return attachTrace(result, trace);
    }

    const results = await Promise.all(
      candidates.map((adapter) => adapter.verify(request)),
    );
    const diagnostics = results.flatMap((result) => result.diagnostics);
    const evidence = results.flatMap((result) => result.evidence);
    const provenance = results.flatMap((result) => result.provenance);
    const failedOperation = results.find(
      (result) => result.status === "error" || result.status === "unsupported",
    );
    const value = results.every(
      (result) => result.status === "ok" && result.value === true,
    );
    const result: ResultEnvelope<boolean> = failedOperation
      ? {
          status: "partial",
          value,
          diagnostics,
          evidence,
          provenance,
        }
      : {
          status: "ok",
          value,
          diagnostics,
          evidence,
          provenance,
        };
    recordFinish(parent, "verify", [], {
      verifierIds: candidates.map((candidate) => candidate.id),
    });
    return attachTrace(result, trace);
  };

  return {
    capabilities,
    parse,
    realize,
    express,
    transform,
    verify,
    traceEvents: () => trace.events(),
    replayManifest: () =>
      createReplayManifest({
        traceId: trace.traceId,
        version: "0.1.0",
        determinism: config.determinism ?? "D0",
        inputSourceDigests: [],
        configurationVersions: {
          universalExpressionApi: config.apiVersion ?? "0.1.0",
        },
        schemaVersions: config.schemaVersions ?? {},
        ontologyVersions: config.ontologyVersions ?? {},
        languagePackVersions: config.languagePackVersions ?? {},
        decisionPackVersions: config.decisionPackVersions ?? {},
        graphRevisions: [],
        featureFlags: [...(config.featureFlags ?? [])],
      }),
  };
};
