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
import {
  InMemoryTraceRecorder,
  createReplayBundle,
  createReplayManifest,
  verifyReplayBundleIntegrity,
  type ReplayBundle,
} from "../../trace-replay/src/index.ts";
import type { Diagnostic } from "../../semantic-graph/src/index.ts";
import {
  strongestEvidenceGrade,
  verificationSatisfiesObligation,
  weakestEvidenceGrade,
  type EvidenceGrade,
  type VerificationObligation,
  type VerificationResult,
  type Verifier,
  type VerifierExecutionMode,
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
  inputSourceDigests?: Digest[];
  jevModelId?: string;
  randomSeeds?: number[];
  recordedDecisionRefs?: string[];
  externalVerifierRefs?: string[];
}

export interface VerificationPlanEntry {
  obligation: VerificationObligation;
  candidateVerifierIds: string[];
  results: VerificationResult[];
  resultDigests: Digest[];
  authoritative: VerificationResult;
  authoritativeDigest: Digest;
  satisfied: boolean;
  conflict: boolean;
}

export interface VerificationSuiteReport {
  status: "pass" | "fail" | "unknown";
  entries: VerificationPlanEntry[];
  requiredSatisfied: string[];
  requiredFailed: string[];
  requiredUnknown: string[];
  recommendedUnsatisfied: string[];
  evidenceGrade: EvidenceGrade;
  requiredEvidenceFloor: EvidenceGrade;
  diagnostics: Diagnostic[];
  replay: ReplayBundle;
}

const jsonValue = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

export const verificationResultDigest = (
  result: VerificationResult,
): Digest => sha256(canonicalJson(jsonValue(result)));

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

const validateVerifierResult = (
  obligation: VerificationObligation,
  manifest: VerifierManifest,
  result: VerificationResult,
): VerificationResult => {
  if (result.obligationId !== obligation.id) {
    return unavailableResult(
      obligation,
      "VERIFIER_OBLIGATION_MISMATCH",
      `Verifier ${manifest.id} returned result for ${result.obligationId} instead of ${obligation.id}.`,
    );
  }
  if (
    result.verifier.id !== manifest.id ||
    result.verifier.version !== manifest.version ||
    result.verifier.mode !== manifest.mode
  ) {
    return unavailableResult(
      obligation,
      "VERIFIER_IDENTITY_MISMATCH",
      `Verifier ${manifest.id} returned evidence under a mismatched verifier identity.`,
    );
  }
  if (result.status === "pass" && result.evidence.length === 0) {
    return unavailableResult(
      obligation,
      "VERIFIER_PASS_WITHOUT_EVIDENCE",
      `Verifier ${manifest.id} reported pass without any evidence reference.`,
    );
  }
  return structuredClone(result);
};

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

const modeOrder: readonly VerifierExecutionMode[] = [
  "deterministic",
  "external-tool",
  "jev-assisted",
];

const conflictResult = (
  obligation: VerificationObligation,
  mode: VerifierExecutionMode,
  tier: readonly VerificationResult[],
): VerificationResult => ({
  obligationId: obligation.id,
  status: "unknown",
  evidence: [...new Set(tier.flatMap((result) => result.evidence))].sort(),
  diagnostics: [
    {
      code: "VERIFIER_AUTHORITATIVE_CONFLICT",
      severity:
        obligation.severity === "required"
          ? "error"
          : obligation.severity === "recommended"
            ? "warning"
            : "info",
      message:
        `Authoritative ${mode} verifiers disagree on the same obligation; the orchestrator refuses to convert disagreement into pass.`,
      details: {
        verifierIds: tier.map((result) => result.verifier.id).sort(),
        statuses: tier.map((result) => result.status).sort(),
      },
    },
  ],
  verifier: {
    id: "verifier.orchestrator-conflict",
    version: "1.0.0",
    mode: "deterministic",
    evidenceGrade: "unverified",
  },
});

export const resolveAuthoritativeVerification = (
  obligation: VerificationObligation,
  results: readonly VerificationResult[],
): { result: VerificationResult; conflict: boolean } => {
  const ordered = [...results].sort((a, b) =>
    a.verifier.id.localeCompare(b.verifier.id),
  );

  for (const mode of modeOrder) {
    const tier = ordered.filter(
      (result) =>
        result.verifier.mode === mode &&
        (result.status === "pass" || result.status === "fail"),
    );
    if (tier.length === 0) continue;

    const statuses = new Set(tier.map((result) => result.status));
    if (statuses.size > 1) {
      return {
        result: conflictResult(obligation, mode, tier),
        conflict: true,
      };
    }

    return {
      result: structuredClone(
        tier.find((result) => result.status === "fail") ?? tier[0]!,
      ),
      conflict: false,
    };
  }

  const unknown =
    ordered.find((result) => result.status === "unknown") ??
    ordered.find((result) => result.status === "skipped") ??
    unavailableResult(
      obligation,
      "VERIFIER_NO_RESULT",
      "Verification produced no result.",
    );

  return { result: structuredClone(unknown), conflict: false };
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

const verificationPlanInputDigest = (
  items: readonly VerificationPlanItem[],
  registry: VerificationRegistry,
): Digest =>
  sha256(
    canonicalJson(
      jsonValue({
        verifiers: registry
          .list()
          .map((manifest) => ({
            id: manifest.id,
            version: manifest.version,
            mode: manifest.mode,
            kinds: [...manifest.kinds].sort(),
          })),
        obligations: items.map((item) => ({
          id: item.obligation.id,
          kind: item.obligation.kind,
          subject: item.obligation.subject,
          severity: item.obligation.severity,
          verifierCandidates: [
            ...item.obligation.verifierCandidates,
          ].sort(),
          provenance: [...item.obligation.provenance].sort(),
        })),
      }),
    ),
  );

const verificationExecutionPlanDigest = (
  entries: readonly Pick<
    VerificationPlanEntry,
    "obligation" | "candidateVerifierIds"
  >[],
): Digest =>
  sha256(
    canonicalJson(
      jsonValue({
        obligations: entries.map((entry) => ({
          id: entry.obligation.id,
          kind: entry.obligation.kind,
          subject: entry.obligation.subject,
          severity: entry.obligation.severity,
          verifierCandidates: [
            ...entry.obligation.verifierCandidates,
          ].sort(),
          provenance: [...entry.obligation.provenance].sort(),
          candidateVerifierIds: [
            ...entry.candidateVerifierIds,
          ].sort(),
        })),
      }),
    ),
  );

export const runVerificationPlan = async (input: {
  registry: VerificationRegistry;
  items: VerificationPlanItem[];
  context?: VerifyContext;
  replay?: VerificationReplayConfig;
}): Promise<Result<VerificationSuiteReport>> => {
  const traceId = input.replay?.traceId ?? createTraceId();
  const trace = new InMemoryTraceRecorder(traceId);
  const planInputDigest = verificationPlanInputDigest(
    input.items,
    input.registry,
  );
  const configuration: JsonValue = {
    planInputDigest,
    registeredVerifiers: input.registry
      .list()
      .map((manifest) => `${manifest.id}@${manifest.version}`),
    obligationIds: input.items.map(
      (item) => item.obligation.id,
    ),
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
      planInputDigest,
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

        let result: VerificationResult;
        try {
          const raw = await candidate.verify(
            item.obligation,
            item.subject,
            {
              ...(input.context ?? {}),
              traceId,
            },
          );
          result = validateVerifierResult(
            item.obligation,
            candidate.manifest,
            raw,
          );
        } catch (error) {
          result = unavailableResult(
            item.obligation,
            "VERIFIER_EXECUTION_ERROR",
            error instanceof Error
              ? error.message
              : "Verifier execution failed with an unknown error.",
          );
        }

        results.push(result);
        const resultDigest = verificationResultDigest(result);
        trace.record({
          parentIds: [started.id],
          stage:
            result.verifier.id === "verifier.orchestrator" &&
            result.diagnostics.some(
              (diagnostic) =>
                diagnostic.code === "VERIFIER_EXECUTION_ERROR",
            )
              ? "verifier-error"
              : "verifier-finish",
          inputRefs: [item.obligation.subject],
          outputRefs: [
            ...result.evidence,
            `verification-result:${resultDigest}`,
          ],
          configDigest,
          metadata: {
            obligationId: item.obligation.id,
            verifierId: candidate.manifest.id,
            reportedVerifierId: result.verifier.id,
            status: result.status,
            evidenceGrade: result.verifier.evidenceGrade,
            resultDigest,
          },
        });
      }
    }

    const resolved = resolveAuthoritativeVerification(
      item.obligation,
      results,
    );
    const authoritativeDigest = verificationResultDigest(
      resolved.result,
    );

    const resultDigestsForEntry = results.map(
      verificationResultDigest,
    );
    const candidateVerifierIds = candidates.map(
      (candidate) => candidate.manifest.id,
    );

    trace.record({
      parentIds: [root.id],
      stage: "verification-authoritative",
      inputRefs: [item.obligation.subject],
      outputRefs: [
        ...resultDigestsForEntry.map(
          (digest) => `verification-result:${digest}`,
        ),
        `verification-authoritative:${authoritativeDigest}`,
      ],
      configDigest,
      metadata: {
        obligationId: item.obligation.id,
        status: resolved.result.status,
        conflict: resolved.conflict,
        authoritativeVerifierId: resolved.result.verifier.id,
        authoritativeDigest,
      },
    });

    entries.push({
      obligation: structuredClone(item.obligation),
      candidateVerifierIds,
      results: structuredClone(results),
      resultDigests: resultDigestsForEntry,
      authoritative: structuredClone(resolved.result),
      authoritativeDigest,
      satisfied: verificationSatisfiesObligation(
        item.obligation,
        resolved.result,
      ),
      conflict: resolved.conflict,
    });
  }

  const required = entries.filter(
    (entry) => entry.obligation.severity === "required",
  );
  const recommended = entries.filter(
    (entry) => entry.obligation.severity === "recommended",
  );
  const status = reportStatus(entries);
  const evidenceGrade = strongestEvidenceGrade(
    entries.map(
      (entry) => entry.authoritative.verifier.evidenceGrade,
    ),
  );
  const requiredEvidenceFloor = weakestEvidenceGrade(
    required.map(
      (entry) => entry.authoritative.verifier.evidenceGrade,
    ),
  );
  const planDigest = verificationExecutionPlanDigest(entries);
  const resultDigests = entries
    .flatMap((entry) => entry.resultDigests)
    .sort();
  const authoritativeDigests = entries
    .map((entry) => entry.authoritativeDigest)
    .sort();

  const externalVerifierRefs = [
    ...new Set([
      ...(input.replay?.externalVerifierRefs ?? []),
      ...entries.flatMap((entry) =>
        entry.results
          .filter(
            (result) =>
              result.verifier.mode === "external-tool",
          )
          .map((result) => result.verifier.id),
      ),
    ]),
  ].sort();
  const jevVerifierRefs = [
    ...new Set([
      ...(input.replay?.recordedDecisionRefs ?? []),
      ...entries.flatMap((entry) =>
        entry.results
          .filter(
            (result) =>
              result.verifier.mode === "jev-assisted",
          )
          .flatMap((result) => result.evidence),
      ),
    ]),
  ].sort();

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
    ...(input.replay?.jevModelId === undefined
      ? {}
      : { jevModelId: input.replay.jevModelId }),
    graphRevisions: input.replay?.graphRevisions ?? [],
    featureFlags: [...(input.replay?.featureFlags ?? [])],
    ...(input.replay?.randomSeeds === undefined
      ? {}
      : { randomSeeds: [...input.replay.randomSeeds] }),
    ...(jevVerifierRefs.length === 0
      ? {}
      : { recordedDecisionRefs: jevVerifierRefs }),
    ...(externalVerifierRefs.length === 0
      ? {}
      : { externalVerifierRefs }),
    annotations: {
      verificationPlanDigest: planDigest,
      verificationResultDigests: resultDigests,
      verificationAuthoritativeDigests: authoritativeDigests,
      suiteStatus: status,
      evidenceGrade,
      requiredEvidenceFloor,
    },
  });

  const replay = createReplayBundle(manifest, trace.events());
  if (!replay.ok) return err(replay.error);

  const report: VerificationSuiteReport = {
    status,
    entries,
    requiredSatisfied: required
      .filter((entry) => entry.satisfied)
      .map((entry) => entry.obligation.id),
    requiredFailed: required
      .filter(
        (entry) => entry.authoritative.status === "fail",
      )
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
    evidenceGrade,
    requiredEvidenceFloor,
    diagnostics: entries.flatMap(
      (entry) => entry.authoritative.diagnostics,
    ),
    replay: replay.value,
  };

  const replayIntegrity = verifyVerificationReplay(report);
  return replayIntegrity.ok
    ? ok(report)
    : err(replayIntegrity.error);
};

export const verifyVerificationReplay = (
  report: VerificationSuiteReport,
): Result<ReplayBundle> => {
  const integrity = verifyReplayBundleIntegrity(report.replay);
  if (!integrity.ok) return integrity;

  const annotations = report.replay.manifest.annotations;
  const planDigest = annotations?.verificationPlanDigest;
  const resultDigests = annotations?.verificationResultDigests;
  const authoritativeDigests =
    annotations?.verificationAuthoritativeDigests;
  const recomputedPlanDigest =
    verificationExecutionPlanDigest(report.entries);

  if (
    typeof planDigest !== "string" ||
    !Array.isArray(resultDigests) ||
    !Array.isArray(authoritativeDigests)
  ) {
    return err(
      new StructuredError(
        "VERIFY_REPLAY_ANNOTATIONS_MISSING",
        "Verification replay is missing plan/result/authoritative digest annotations.",
      ),
    );
  }

  if (planDigest !== recomputedPlanDigest) {
    return err(
      new StructuredError(
        "VERIFY_REPLAY_PLAN_DIGEST_MISMATCH",
        "Verification replay plan digest does not match the report execution plan.",
        {
          expected: recomputedPlanDigest,
          actual: planDigest,
        },
      ),
    );
  }

  const expectedResultDigests = report.entries
    .flatMap((entry) =>
      entry.results.map(verificationResultDigest),
    )
    .sort();
  const recordedResultDigests = resultDigests
    .filter(
      (value): value is string => typeof value === "string",
    )
    .sort();

  if (
    canonicalJson(jsonValue(expectedResultDigests)) !==
    canonicalJson(jsonValue(recordedResultDigests))
  ) {
    return err(
      new StructuredError(
        "VERIFY_REPLAY_RESULT_DIGEST_MISMATCH",
        "Verification replay result digests do not match the report results.",
      ),
    );
  }

  const expectedAuthoritativeDigests = report.entries
    .map((entry) => verificationResultDigest(entry.authoritative))
    .sort();
  const recordedAuthoritativeDigests = authoritativeDigests
    .filter(
      (value): value is string => typeof value === "string",
    )
    .sort();
  if (
    canonicalJson(jsonValue(expectedAuthoritativeDigests)) !==
    canonicalJson(jsonValue(recordedAuthoritativeDigests))
  ) {
    return err(
      new StructuredError(
        "VERIFY_REPLAY_AUTHORITATIVE_DIGEST_MISMATCH",
        "Verification replay authoritative digests do not match the report decisions.",
      ),
    );
  }

  const traceOutputs = new Set(
    report.replay.events.flatMap((event) => event.outputRefs),
  );
  for (const digest of expectedResultDigests) {
    if (!traceOutputs.has(`verification-result:${digest}`)) {
      return err(
        new StructuredError(
          "VERIFY_REPLAY_RESULT_TRACE_MISSING",
          `Verification result digest is not referenced by the trace: ${digest}.`,
        ),
      );
    }
  }
  for (const digest of expectedAuthoritativeDigests) {
    if (
      !traceOutputs.has(
        `verification-authoritative:${digest}`,
      )
    ) {
      return err(
        new StructuredError(
          "VERIFY_REPLAY_AUTHORITATIVE_TRACE_MISSING",
          `Authoritative verification digest is not referenced by the trace: ${digest}.`,
        ),
      );
    }
  }

  return ok(integrity.value);
};
