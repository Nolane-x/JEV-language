import {
  canonicalJson,
  err,
  ok,
  sha256,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";

export type V1PackageMaturity =
  | "prototype"
  | "experimental"
  | "candidate"
  | "stable";

export interface V1PackageEvidence {
  packageId: string;
  maturity: V1PackageMaturity;
  publicApiDocsRef: string;
  abiSchemaVersionRefs: string[];
  conformanceRefs: string[];
  migrationPolicyRef: string;
  benchmarkBaselineRefs: string[];
  knownLimitationsRef: string;
  replayableDemoRefs: string[];
  zeroGenerativeAuditRef: string;
}

export interface V1GlobalEvidence {
  releaseGatesVerified: boolean;
  originalM19Status:
    | "not-started"
    | "pending-human-data"
    | "incomplete-measurements"
    | "complete";
  migrationPolicyRef: string;
  benchmarkBaselineRef: string;
  knownLimitationsRef: string;
  replayableDemoIndexRef: string;
  nativeZeroGenerativeAuditRef: string;
}

export type V1BlockerCode =
  | "V1_REQUIRED_PACKAGE_SET_EMPTY"
  | "V1_REQUIRED_PACKAGE_MISSING"
  | "V1_PACKAGE_NOT_STABLE"
  | "V1_PACKAGE_EVIDENCE_INCOMPLETE"
  | "V1_RELEASE_GATES_UNVERIFIED"
  | "V1_M19_INCOMPLETE"
  | "V1_GLOBAL_EVIDENCE_INCOMPLETE";

export interface V1Blocker {
  code: V1BlockerCode;
  refs: string[];
  message: string;
}

export interface V1ConformanceReport {
  schemaVersion: "jl-v1-conformance-1";
  releaseId: string;
  status: "blocked" | "ready-for-v1";
  requiredCorePackages: string[];
  stablePackageCount: number;
  packageCount: number;
  blockers: V1Blocker[];
  evidenceDigest: string;
}

const nonEmpty = (value: string): boolean => value.trim() !== "";

const uniqueNonEmpty = (values: readonly string[]): boolean =>
  values.length > 0 &&
  values.every(nonEmpty) &&
  new Set(values).size === values.length;

export const validateV1PackageEvidence = (
  value: V1PackageEvidence,
): Result<V1PackageEvidence> => {
  if (
    !nonEmpty(value.packageId) ||
    !["prototype", "experimental", "candidate", "stable"].includes(
      value.maturity,
    ) ||
    !nonEmpty(value.publicApiDocsRef) ||
    !uniqueNonEmpty(value.abiSchemaVersionRefs) ||
    !uniqueNonEmpty(value.conformanceRefs) ||
    !nonEmpty(value.migrationPolicyRef) ||
    !uniqueNonEmpty(value.benchmarkBaselineRefs) ||
    !nonEmpty(value.knownLimitationsRef) ||
    !uniqueNonEmpty(value.replayableDemoRefs) ||
    !nonEmpty(value.zeroGenerativeAuditRef)
  ) {
    return err(
      new StructuredError(
        "EVAL_V1_PACKAGE_EVIDENCE",
        "V1 package evidence requires public API docs, ABI/schema version refs, conformance, migration, benchmark, limitations, replay demo, and zero-generative audit evidence.",
      ),
    );
  }
  return ok(structuredClone(value));
};

export const buildV1ConformanceReport = (input: {
  releaseId: string;
  requiredCorePackageIds: string[];
  packages: V1PackageEvidence[];
  global: V1GlobalEvidence;
}): Result<V1ConformanceReport> => {
  if (!nonEmpty(input.releaseId)) {
    return err(
      new StructuredError(
        "EVAL_V1_RELEASE_ID",
        "V1 conformance requires a non-empty release id.",
      ),
    );
  }
  if (
    input.requiredCorePackageIds.length === 0 ||
    !uniqueNonEmpty(input.requiredCorePackageIds)
  ) {
    return err(
      new StructuredError(
        "EVAL_V1_REQUIRED_PACKAGES",
        "V1 conformance forbids a vacuous empty stable-package set and requires unique non-empty core package ids.",
      ),
    );
  }

  const packageIds = input.packages.map((item) => item.packageId);
  if (
    packageIds.some((id) => !nonEmpty(id)) ||
    new Set(packageIds).size !== packageIds.length
  ) {
    return err(
      new StructuredError(
        "EVAL_V1_PACKAGE_DUPLICATE",
        "V1 package evidence requires unique non-empty package ids.",
      ),
    );
  }

  const blockers: V1Blocker[] = [];
  const byId = new Map(
    input.packages.map((item) => [item.packageId, item] as const),
  );

  for (const packageId of [...input.requiredCorePackageIds].sort()) {
    const item = byId.get(packageId);
    if (item === undefined) {
      blockers.push({
        code: "V1_REQUIRED_PACKAGE_MISSING",
        refs: [packageId],
        message: "Required core package has no v1 conformance evidence.",
      });
      continue;
    }
    const valid = validateV1PackageEvidence(item);
    if (!valid.ok) {
      blockers.push({
        code: "V1_PACKAGE_EVIDENCE_INCOMPLETE",
        refs: [packageId, valid.error.code],
        message: valid.error.message,
      });
    }
    if (item.maturity !== "stable") {
      blockers.push({
        code: "V1_PACKAGE_NOT_STABLE",
        refs: [packageId, `maturity:${item.maturity}`],
        message: "Required core package has not been explicitly promoted to stable.",
      });
    }
  }

  if (!input.global.releaseGatesVerified) {
    blockers.push({
      code: "V1_RELEASE_GATES_UNVERIFIED",
      refs: ["RELEASE-GATES"],
      message: "v1.0 cannot close before the §§963-980 release gates are verified.",
    });
  }

  if (input.global.originalM19Status !== "complete") {
    blockers.push({
      code: "V1_M19_INCOMPLETE",
      refs: [`M19:${input.global.originalM19Status}`],
      message:
        "Original M19 natural-conversation measurement is not complete; human data may not be fabricated or replaced by proxies.",
    });
  }

  const globalRefs = [
    input.global.migrationPolicyRef,
    input.global.benchmarkBaselineRef,
    input.global.knownLimitationsRef,
    input.global.replayableDemoIndexRef,
    input.global.nativeZeroGenerativeAuditRef,
  ];
  if (!globalRefs.every(nonEmpty)) {
    blockers.push({
      code: "V1_GLOBAL_EVIDENCE_INCOMPLETE",
      refs: globalRefs.filter((ref) => !nonEmpty(ref)),
      message:
        "V1 global evidence requires migration, benchmark baseline, known limitations, replayable demo index, and native zero-generative audit.",
    });
  }

  const canonical = canonicalJson({
    releaseId: input.releaseId,
    requiredCorePackageIds: [...input.requiredCorePackageIds].sort(),
    packages: [...input.packages].sort((a, b) =>
      a.packageId.localeCompare(b.packageId),
    ),
    global: input.global,
    blockers,
  } as unknown as JsonValue);

  return ok({
    schemaVersion: "jl-v1-conformance-1",
    releaseId: input.releaseId,
    status: blockers.length === 0 ? "ready-for-v1" : "blocked",
    requiredCorePackages: [...input.requiredCorePackageIds].sort(),
    stablePackageCount: input.packages.filter(
      (item) => item.maturity === "stable",
    ).length,
    packageCount: input.packages.length,
    blockers: blockers.sort(
      (a, b) =>
        a.code.localeCompare(b.code) ||
        a.refs.join("\u0000").localeCompare(b.refs.join("\u0000")),
    ),
    evidenceDigest: sha256(canonical),
  });
};
