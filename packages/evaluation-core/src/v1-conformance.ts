import {
  canonicalJson,
  err,
  ok,
  sha256,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";

export const V1_CONFORMANCE_REQUIREMENTS = [
  "public-api-docs",
  "abi-schema-versioning",
  "conformance-suites",
  "migration-policy",
  "benchmark-baseline",
  "known-limitations",
  "replayable-demos",
  "zero-generative-audit",
] as const;

export type V1ConformanceRequirement =
  (typeof V1_CONFORMANCE_REQUIREMENTS)[number];

export interface StablePackageV1Evidence {
  packageId: string;
  packageVersion: string;
  maturity: "stable";
  abiVersion: string;
  schemaVersions: Record<string, string>;
  artifacts: Record<V1ConformanceRequirement, string[]>;
}

export interface V1ReleaseCiEvidence {
  runId: string;
  conclusion: "success" | "failure" | "cancelled" | "unknown";
  boundariesPassed: boolean;
  typecheckPassed: boolean;
  testFilesPassed: number;
  testFilesTotal: number;
  testsPassed: number;
  testsTotal: number;
}

export interface V1ConformanceInput {
  releaseId: string;
  releaseVersion: string;
  specVersion: string;
  commit: string;
  expectedStablePackages: string[];
  packages: StablePackageV1Evidence[];
  ci: V1ReleaseCiEvidence;
  knownFailures: string[];
  blockedItems: string[];
}

export type V1ConformanceBlockerCode =
  | "V1_NO_STABLE_PACKAGES"
  | "V1_STABLE_PACKAGE_SET_MISMATCH"
  | "V1_PACKAGE_VERSION_INVALID"
  | "V1_PACKAGE_ARTIFACT_MISSING"
  | "V1_SCHEMA_VERSION_MISSING"
  | "V1_CI_NOT_GREEN"
  | "V1_TESTS_INCOMPLETE"
  | "V1_KNOWN_FAILURE"
  | "V1_BLOCKED_ITEM";

export interface V1ConformanceBlocker {
  code: V1ConformanceBlockerCode;
  message: string;
  refs: string[];
}

export interface V1PackageConformanceSummary {
  packageId: string;
  packageVersion: string;
  abiVersion: string;
  schemaVersionCount: number;
  artifactCounts: Record<V1ConformanceRequirement, number>;
}

export interface V1ConformanceReport {
  releaseId: string;
  releaseVersion: string;
  specVersion: string;
  commit: string;
  status: "pass" | "blocked";
  stablePackageCount: number;
  packages: V1PackageConformanceSummary[];
  blockers: V1ConformanceBlocker[];
  ci: V1ReleaseCiEvidence;
  evidenceDigest: string;
}

const semver =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

const nonEmptyUniqueStrings = (values: readonly string[]): boolean =>
  values.length > 0 &&
  values.every((value) => value.trim() !== "") &&
  new Set(values).size === values.length;

const exactSet = (
  left: readonly string[],
  right: readonly string[],
): boolean => {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return (
    a.length === b.length &&
    a.every((value, index) => value === b[index])
  );
};

export const validateStablePackageV1Evidence = (
  evidence: StablePackageV1Evidence,
): Result<StablePackageV1Evidence> => {
  if (
    evidence.packageId.trim() === "" ||
    evidence.maturity !== "stable" ||
    !semver.test(evidence.packageVersion) ||
    !semver.test(evidence.abiVersion)
  ) {
    return err(
      new StructuredError(
        "V1_PACKAGE_IDENTITY",
        "Stable v1 package evidence requires non-empty identity, stable maturity, and semver package/ABI versions.",
      ),
    );
  }

  const schemaEntries = Object.entries(evidence.schemaVersions);
  if (
    schemaEntries.length === 0 ||
    schemaEntries.some(
      ([id, version]) => id.trim() === "" || !semver.test(version),
    )
  ) {
    return err(
      new StructuredError(
        "V1_PACKAGE_SCHEMA_VERSION",
        "Stable v1 package evidence requires at least one named semver schema version.",
      ),
    );
  }

  for (const requirement of V1_CONFORMANCE_REQUIREMENTS) {
    const refs = evidence.artifacts[requirement];
    if (!nonEmptyUniqueStrings(refs)) {
      return err(
        new StructuredError(
          "V1_PACKAGE_ARTIFACT",
          `Stable package ${evidence.packageId} lacks unique non-empty artifact refs for ${requirement}.`,
        ),
      );
    }
  }

  return ok(structuredClone(evidence));
};

export const buildV1ConformanceReport = (
  input: V1ConformanceInput,
): Result<V1ConformanceReport> => {
  if (
    input.releaseId.trim() === "" ||
    !semver.test(input.releaseVersion) ||
    input.specVersion.trim() === "" ||
    input.commit.trim() === "" ||
    input.ci.runId.trim() === "" ||
    !nonEmptyUniqueStrings(input.expectedStablePackages)
  ) {
    return err(
      new StructuredError(
        "V1_CONFORMANCE_INPUT",
        "v1 conformance requires release/spec/commit/CI identity and a non-empty expected stable-package set.",
      ),
    );
  }

  const blockers: V1ConformanceBlocker[] = [];
  if (input.packages.length === 0) {
    blockers.push({
      code: "V1_NO_STABLE_PACKAGES",
      message:
        "A v1 stable-core profile may not pass vacuously with zero stable packages.",
      refs: [],
    });
  }

  const packageIds = input.packages.map((item) => item.packageId);
  if (
    packageIds.some((id) => id.trim() === "") ||
    new Set(packageIds).size !== packageIds.length ||
    !exactSet(packageIds, input.expectedStablePackages)
  ) {
    blockers.push({
      code: "V1_STABLE_PACKAGE_SET_MISMATCH",
      message:
        "Reported package evidence must exactly match the declared stable-package target set.",
      refs: [
        ...input.expectedStablePackages.map((id) => `expected:${id}`),
        ...packageIds.map((id) => `reported:${id}`),
      ].sort(),
    });
  }

  const summaries: V1PackageConformanceSummary[] = [];
  for (const packageEvidence of input.packages) {
    const validated = validateStablePackageV1Evidence(packageEvidence);
    if (!validated.ok) {
      const error = validated.error;
      const code: V1ConformanceBlockerCode =
        error.code === "V1_PACKAGE_SCHEMA_VERSION"
          ? "V1_SCHEMA_VERSION_MISSING"
          : error.code === "V1_PACKAGE_ARTIFACT"
            ? "V1_PACKAGE_ARTIFACT_MISSING"
            : "V1_PACKAGE_VERSION_INVALID";
      blockers.push({
        code,
        message: error.message,
        refs: [packageEvidence.packageId],
      });
      continue;
    }

    summaries.push({
      packageId: packageEvidence.packageId,
      packageVersion: packageEvidence.packageVersion,
      abiVersion: packageEvidence.abiVersion,
      schemaVersionCount: Object.keys(packageEvidence.schemaVersions).length,
      artifactCounts: Object.fromEntries(
        V1_CONFORMANCE_REQUIREMENTS.map((requirement) => [
          requirement,
          packageEvidence.artifacts[requirement].length,
        ]),
      ) as Record<V1ConformanceRequirement, number>,
    });
  }

  if (
    input.ci.conclusion !== "success" ||
    !input.ci.boundariesPassed ||
    !input.ci.typecheckPassed
  ) {
    blockers.push({
      code: "V1_CI_NOT_GREEN",
      message:
        "v1 conformance requires green CI, package boundaries, and strict typecheck evidence.",
      refs: [input.ci.runId],
    });
  }

  if (
    input.ci.testFilesPassed !== input.ci.testFilesTotal ||
    input.ci.testsPassed !== input.ci.testsTotal
  ) {
    blockers.push({
      code: "V1_TESTS_INCOMPLETE",
      message: "v1 conformance requires every declared test file/test to pass.",
      refs: [input.ci.runId],
    });
  }

  if (input.knownFailures.length > 0) {
    blockers.push({
      code: "V1_KNOWN_FAILURE",
      message: "Known failures remain open for the v1 stable-core profile.",
      refs: [...input.knownFailures].sort(),
    });
  }

  if (input.blockedItems.length > 0) {
    blockers.push({
      code: "V1_BLOCKED_ITEM",
      message: "Blocked items remain open for the v1 stable-core profile.",
      refs: [...input.blockedItems].sort(),
    });
  }

  const canonicalEvidence = {
    releaseId: input.releaseId,
    releaseVersion: input.releaseVersion,
    specVersion: input.specVersion,
    commit: input.commit,
    expectedStablePackages: [...input.expectedStablePackages].sort(),
    packages: [...input.packages].sort((a, b) =>
      a.packageId.localeCompare(b.packageId),
    ),
    ci: input.ci,
    knownFailures: [...input.knownFailures].sort(),
    blockedItems: [...input.blockedItems].sort(),
  } as unknown as JsonValue;

  return ok({
    releaseId: input.releaseId,
    releaseVersion: input.releaseVersion,
    specVersion: input.specVersion,
    commit: input.commit,
    status: blockers.length === 0 ? "pass" : "blocked",
    stablePackageCount: summaries.length,
    packages: summaries.sort((a, b) =>
      a.packageId.localeCompare(b.packageId),
    ),
    blockers,
    ci: structuredClone(input.ci),
    evidenceDigest: sha256(canonicalJson(canonicalEvidence)),
  });
};
