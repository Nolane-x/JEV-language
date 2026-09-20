import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageManifest from "../../packages/manifest.json";
import {
  buildV1ConformanceReport,
  validateV1PackageEvidence,
  type V1PackageEvidence,
  type V1PackageMaturity,
} from "../../packages/evaluation-core/src/index.ts";

type PackageManifestShape = {
  schemaVersion: string;
  packages: Record<
    string,
    {
      maturity: V1PackageMaturity;
      layer: number;
      dependencies: string[];
    }
  >;
};

const manifest =
  packageManifest as unknown as PackageManifestShape;

describe("M20 v1.0 conformance framework", () => {
  it("blocks the current repository rather than treating an empty stable-package set as v1-ready", () => {
    const requiredCorePackageIds = Object.keys(manifest.packages).sort();
    expect(requiredCorePackageIds.length).toBeGreaterThan(0);

    const packages: V1PackageEvidence[] = requiredCorePackageIds.map(
      (packageId) => ({
        packageId,
        maturity: manifest.packages[packageId]!.maturity,
        publicApiDocsRef: existsSync(
          `packages/${packageId}/PACKAGE.md`,
        )
          ? `packages/${packageId}/PACKAGE.md`
          : "",
        abiSchemaVersionRefs: [],
        conformanceRefs: [],
        migrationPolicyRef: "docs/MIGRATION-POLICY.md",
        benchmarkBaselineRefs: ["docs/BENCHMARK-BASELINE.md"],
        knownLimitationsRef: "docs/KNOWN-LIMITATIONS.md",
        replayableDemoRefs: ["examples/native-v0.4-roundtrip.ts"],
        zeroGenerativeAuditRef:
          "tests/conformance/v0.4-release-gates.conformance.test.ts",
      }),
    );

    const report = buildV1ConformanceReport({
      releaseId: "v1.0-readiness-current",
      requiredCorePackageIds,
      packages,
      global: {
        releaseGatesVerified: true,
        originalM19Status: "pending-human-data",
        migrationPolicyRef: "docs/MIGRATION-POLICY.md",
        benchmarkBaselineRef: "docs/BENCHMARK-BASELINE.md",
        knownLimitationsRef: "docs/KNOWN-LIMITATIONS.md",
        replayableDemoIndexRef: "examples/README.md",
        nativeZeroGenerativeAuditRef:
          "tests/conformance/v0.4-release-gates.conformance.test.ts",
      },
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.status).toBe("blocked");
    expect(report.value.stablePackageCount).toBe(0);
    expect(
      report.value.blockers.map((blocker) => blocker.code),
    ).toContain("V1_PACKAGE_NOT_STABLE");
    expect(
      report.value.blockers.map((blocker) => blocker.code),
    ).toContain("V1_PACKAGE_EVIDENCE_INCOMPLETE");
    expect(
      report.value.blockers.map((blocker) => blocker.code),
    ).toContain("V1_M19_INCOMPLETE");
    expect(
      report.value.blockers.map((blocker) => blocker.code),
    ).not.toContain("V1_GLOBAL_EVIDENCE_INCOMPLETE");
  });

  it("rejects vacuous readiness checks with no required core packages", () => {
    const report = buildV1ConformanceReport({
      releaseId: "invalid-empty",
      requiredCorePackageIds: [],
      packages: [],
      global: {
        releaseGatesVerified: true,
        originalM19Status: "complete",
        migrationPolicyRef: "docs/MIGRATION-POLICY.md",
        benchmarkBaselineRef: "docs/BENCHMARK-BASELINE.md",
        knownLimitationsRef: "docs/KNOWN-LIMITATIONS.md",
        replayableDemoIndexRef: "examples/README.md",
        nativeZeroGenerativeAuditRef: "evidence:zero-gen",
      },
    });
    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.error.code).toBe("EVAL_V1_REQUIRED_PACKAGES");
    }
  });

  it("requires every stable package to carry every M20 evidence class", () => {
    const incomplete: V1PackageEvidence = {
      packageId: "core-types",
      maturity: "stable",
      publicApiDocsRef: "packages/core-types/PACKAGE.md",
      abiSchemaVersionRefs: [],
      conformanceRefs: ["tests/conformance/core-types.test.ts"],
      migrationPolicyRef: "docs/MIGRATION-POLICY.md",
      benchmarkBaselineRefs: ["docs/BENCHMARK-BASELINE.md"],
      knownLimitationsRef: "docs/KNOWN-LIMITATIONS.md",
      replayableDemoRefs: ["examples/core-types.json"],
      zeroGenerativeAuditRef: "evidence:zero-gen",
    };
    expect(validateV1PackageEvidence(incomplete).ok).toBe(false);
  });

  it("can report ready-for-v1 only for a non-empty fully evidenced stable set after M19 completion", () => {
    const packageEvidence: V1PackageEvidence = {
      packageId: "core-types",
      maturity: "stable",
      publicApiDocsRef: "packages/core-types/PACKAGE.md",
      abiSchemaVersionRefs: ["schema:core-types:1.0.0"],
      conformanceRefs: ["test:core-types:v1"],
      migrationPolicyRef: "docs/MIGRATION-POLICY.md",
      benchmarkBaselineRefs: ["benchmark:core-types:v1"],
      knownLimitationsRef: "docs/KNOWN-LIMITATIONS.md",
      replayableDemoRefs: ["demo:core-types:v1"],
      zeroGenerativeAuditRef: "audit:zero-gen:v1",
    };
    const report = buildV1ConformanceReport({
      releaseId: "synthetic-positive-mechanics-fixture",
      requiredCorePackageIds: ["core-types"],
      packages: [packageEvidence],
      global: {
        releaseGatesVerified: true,
        originalM19Status: "complete",
        migrationPolicyRef: "docs/MIGRATION-POLICY.md",
        benchmarkBaselineRef: "docs/BENCHMARK-BASELINE.md",
        knownLimitationsRef: "docs/KNOWN-LIMITATIONS.md",
        replayableDemoIndexRef: "examples/README.md",
        nativeZeroGenerativeAuditRef: "audit:zero-gen:v1",
      },
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.status).toBe("ready-for-v1");
    expect(report.value.blockers).toEqual([]);
  });
});
