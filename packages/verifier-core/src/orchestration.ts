import {
  canonicalJson,
  createTraceId,
  err,
  ok,
  sha256,
  StructuredError,
  type JsonValue,
  type Result,
  type TraceId,
} from "../../core-types/src/index.ts";
import {
  InMemoryTraceRecorder,
  createReplayBundle,
  createReplayManifest,
  type ReplayBundle,
} from "../../trace-replay/src/index.ts";
import type { Diagnostic } from "../../semantic-graph/src/index.ts";
import {
  selectAuthoritativeResult,
  strongestEvidenceGrade,
  verificationSatisfiesObligation,
  type EvidenceGrade,
  type VerificationObligation,
  type VerificationResult,
  type Verifier,
  type VerifierManifest,
  type VerifyContext,
} from "./framework.ts";

interface RegisteredVerifier {
  manifest: VerifierManifest;
  canVerify(
    obligation: VerificationObligation,
    subject: unknown,
  ): boolean;
  verify(
    obligation: VerificationObligation,
    subject: unknown,
    context: VerifyContext,
  ): Promise<VerificationResult>;
}

export class VerificationRegistry {
  readonly #verifiers = new Map<string, RegisteredVerifier>();

  register<T>(verifier: Verifier<T>): Result<void> {
    const id = verifier.manifest.id.trim();
    if (id === "") {
      return err(
        new StructuredError(
          "VERIFY_REGISTRY_ID",
          "Verifier id must be non-empty.",
        ),
      );
    }
    if (this.#verifiers.has(id)) {
      return err(
        new StructuredError(
          "VERIFY_REGISTRY_DUPLICATE",
          `Verifier already registered: ${id}.`,
        ),
      );
    }

    this.#verifiers.set(id, {
      manifest: structuredClone(verifier.manifest),
      canVerify: (obligation, subject) =>
        verifier.canVerify(obligation, subject as T),
      verify: (obligation, subject, context) =>
        verifier.verify(obligation, subject as T, context),
    });
    return ok(undefined);
  }

  get(id: string): RegisteredVerifier | undefined {
    return this.#verifiers.get(id);
  }

  list(): VerifierManifest[] {
    return [...this.#verifiers.values()]
      .map((entry) => structuredClone(entry.manifest))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}

export interface VerificationPlanItem {
  obligation: VerificationObligation;
  subject: unknown;
}

export interface VerificationReplayConfig {
  traceId?: TraceId;
  determinism?: "D0" | "D1" | "D2" | "D3";
  configurationVersions?: Record<string, string>;
  schemaVersions?: Record<string, string>;
  ontologyVersions?: Record<string, string>;
  languagePackVersions?: Record<string, string>;
  decisionPackVersions?: Record<string, string>;
  graphRevisions?: string[];
  featureFlags?: string[];
  inputSourceDigests?: string[];
}

export interface VerificationPlanEntry {
  obligation: VerificationObligation;
  candidateVerifierIds: string[];
  results: VerificationResult[];
  authoritative: VerificationResult;
  satisfied: boolean;
}

export interface VerificationSuiteReport {
  status: "pass" | "fail" | "unknown";
  entries: VerificationPlanEntry[];
  requiredSatisfied: string[];
  requiredFailed: string[];
  requiredUnknown: string[];
  recommendedUnsatisfied: string[];
  evidenceGrade: EvidenceGrade;
  diagnostics: Diagnostic[];
  replay: ReplayBundle;
}

const unavailableResult = (
  obligation: VerificationObligation,
  code: string,
  message: string,
): VerificationResult => ({
  obligationId: obligation.id,
  status: "unknown",
  evidence: [],
  diagnostics: [
    {
      code,
      severity:
        obligation.severity === "required"
          ? "error"
          : obligation.severity === "recommended"
            ? "warning"
            : "info",
      message,
    },
  ],
  verifier: {
    id: "verifier.orchestrator",
    version: "1.0.0",
    mode: "deterministic",
    evidenceGrade: "unverified",
  },
});

const selectedVerifiers = (
  registry: VerificationRegistry,
  item: VerificationPlanItem,
): RegisteredVerifier[] => {
  const allowed =
    item.obligation.verifierCandidates.length === 0
      ? undefined
      : new Set(item.obligation.verifierCandidates);

  return registry
    .list()
    .filter(
      (manifest) =>
        allowed === undefined || allowed.has(manifest.id),
    )
    .map((manifest) => registry.get(manifest.id))
    .filter(
      (entry): entry is RegisteredVerifier =>
        entry !== undefined &&
        entry.canVerify(item.obligation, item.subject),
    );
};

const reportStatus = (
  entries: readonly VerificationPlanEntry[],
): VerificationSuiteReport["status"] => {
  const required = entries.filter(
    (entry) => entry.obligation.severity === "required",
  );
  if (
    required.some(
      (entry) => entry.authoritative.status === "fail",
    )
  ) {
    return "fail";
  }
  if (
    required.some(
      (entry) =>
        entry.authoritative.status === "unknown" ||
        entry.authoritative.status === "skipped",
    )
  ) {
    return "unknown";
  }
  return "pass";
};

export const runVerificationPlan = async (input: {
  registry: VerificationRegistry;
  items: VerificationPlanItem[];
  context?: VerifyContext;
  replay?: VerificationReplayConfig;
}): Promise<Result<VerificationSuiteReport>> => {
  const traceId = input.replay?.traceId ?? createTraceId();
  const trace = new InMemoryTraceRecorder(traceId);
  const configuration: JsonValue = {
    registeredVerifiers: input.registry
      .list()
      .map((manifest) => `${manifest.id}@${manifest.version}`),
    obligationIds: input.items.map((item) => item.obligation.id),
  };
  const configDigest = sha256(canonicalJson(configuration));
  const root = trace.record({
    parentIds: [],
    stage: "verification-plan",
    inputRefs: input.items.map(
      (item) => item.obligation.subject,
    ),
    outputRefs: [],
    configDigest,
    metadata: {
      obligationCount: input.items.length,
    },
  });

  const entries: VerificationPlanEntry[] = [];

  for (const item of input.items) {
    const candidates = selectedVerifiers(input.registry, item);
    const results: VerificationResult[] = [];

    if (candidates.length === 0) {
      results.push(
        unavailableResult(
          item.obligation,
          "VERIFIER_UNAVAILABLE",
          "No registered verifier can satisfy this verification obligation.",
        ),
      );
    } else {
      for (const candidate of candidates) {
        const started = trace.record({
          parentIds: [root.id],
          stage: "verifier-start",
          inputRefs: [item.obligation.subject],
          outputRefs: [],
          configDigest,
          metadata: {
            obligationId: item.obligation.id,
            verifierId: candidate.manifest.id,
          },
        });

        try {
          const result = await candidate.verify(
            item.obligation,
            item.subject,
            {
              ...(input.context ?? {}),
              traceId,
            },
          );
          results.push(result);
          trace.record({
            parentIds: [started.id],
            stage: "verifier-finish",
            inputRefs: [item.obligation.subject],
            outputRefs: result.evidence,
            configDigest,
            metadata: {
              obligationId: item.obligation.id,
              verifierId: candidate.manifest.id,
              status: result.status,
              evidenceGrade: result.verifier.evidenceGrade,
            },
          });
        } catch (error) {
          const result = unavailableResult(
            item.obligation,
            "VERIFIER_EXECUTION_ERROR",
            error instanceof Error
              ? error.message
              : "Verifier execution failed with an unknown error.",
          );
          results.push(result);
          trace.record({
            parentIds: [started.id],
            stage: "verifier-error",
            inputRefs: [item.obligation.subject],
            outputRefs: [],
            configDigest,
            metadata: {
              obligationId: item.obligation.id,
              verifierId: candidate.manifest.id,
              code: "VERIFIER_EXECUTION_ERROR",
            },
          });
        }
      }
    }

    const authoritative =
      selectAuthoritativeResult(results) ??
      unavailableResult(
        item.obligation,
        "VERIFIER_NO_RESULT",
        "Verification produced no result.",
      );

    entries.push({
      obligation: structuredClone(item.obligation),
      candidateVerifierIds: candidates.map(
        (candidate) => candidate.manifest.id,
      ),
      results: structuredClone(results),
      authoritative: structuredClone(authoritative),
      satisfied: verificationSatisfiesObligation(
        item.obligation,
        authoritative,
      ),
    });
  }

  const manifest = createReplayManifest({
    traceId,
    version: "1.0.0",
    determinism: input.replay?.determinism ?? "D0",
    inputSourceDigests: [
      ...(input.replay?.inputSourceDigests ?? []),
    ],
    configurationVersions:
      input.replay?.configurationVersions ?? {
        verificationOrchestrator: "1.0.0",
      },
    schemaVersions: input.replay?.schemaVersions ?? {},
    ontologyVersions: input.replay?.ontologyVersions ?? {},
    languagePackVersions:
      input.replay?.languagePackVersions ?? {},
    decisionPackVersions:
      input.replay?.decisionPackVersions ?? {},
    graphRevisions: input.replay?.graphRevisions ?? [],
    featureFlags: [...(input.replay?.featureFlags ?? [])],
  });
  const replay = createReplayBundle(manifest, trace.events());
  if (!replay.ok) return err(replay.error);

  const required = entries.filter(
    (entry) => entry.obligation.severity === "required",
  );
  const recommended = entries.filter(
    (entry) => entry.obligation.severity === "recommended",
  );

  return ok({
    status: reportStatus(entries),
    entries,
    requiredSatisfied: required
      .filter((entry) => entry.satisfied)
      .map((entry) => entry.obligation.id),
    requiredFailed: required
      .filter((entry) => entry.authoritative.status === "fail")
      .map((entry) => entry.obligation.id),
    requiredUnknown: required
      .filter(
        (entry) =>
          entry.authoritative.status === "unknown" ||
          entry.authoritative.status === "skipped",
      )
      .map((entry) => entry.obligation.id),
    recommendedUnsatisfied: recommended
      .filter((entry) => !entry.satisfied)
      .map((entry) => entry.obligation.id),
    evidenceGrade: strongestEvidenceGrade(
      entries.map(
        (entry) => entry.authoritative.verifier.evidenceGrade,
      ),
    ),
    diagnostics: entries.flatMap(
      (entry) => entry.authoritative.diagnostics,
    ),
    replay: replay.value,
  });
};
