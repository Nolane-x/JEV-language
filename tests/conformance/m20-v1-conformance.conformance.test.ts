import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CORE_TYPES_ABI_VERSION,
  CORE_TYPES_PACKAGE_VERSION,
  CORE_TYPES_SCHEMA_VERSIONS,
  canonicalJson,
  sha256,
  type JsonValue,
} from "../../packages/core-types/src/index.ts";
import {
  InMemoryProvenanceStore,
  PROVENANCE_ABI_VERSION,
  PROVENANCE_PACKAGE_VERSION,
  PROVENANCE_SCHEMA_VERSIONS,
  type ProvenanceRecord,
} from "../../packages/provenance/src/index.ts";
import {
  V1_CONFORMANCE_REQUIREMENTS,
  auditZeroGenerative,
  buildV1ConformanceReport,
  validateStablePackageV1Evidence,
  type StablePackageV1Evidence,
} from "../../packages/evaluation-core/src/index.ts";

interface V1ManifestFile {
  schemaVersion: "jl-v1-conformance-manifest-1";
  releaseId: string;
  releaseVersion: string;
  specVersion: string;
  expectedStablePackages: string[];
  packages: StablePackageV1Evidence[];
}

interface ReplayFixture {
  schemaVersion: "jl-v1-stable-core-demo-1";
  zeroGenerativeAudit: {
    generativeModelCalls: number;
    generativeEmbeddingCalls: number;
    externalGenerationServices: number;
    jevNative: boolean;
    violations: string[];
  };
  records: ProvenanceRecord[];
  expected: {
    snapshotIds: string[];
    canonicalDigest: string;
  };
}

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

describe("M20 v1 stable-core conformance", () => {
  const manifest = readJson<V1ManifestFile>("docs/v1.0-conformance.json");
  const packageManifest = readJson<{
    packages: Record<string, { maturity: string }>;
  }>("packages/manifest.json");
  const baseline = readJson<{
    sourceCi: {
      runNumber: number;
      commit: string;
      testFilesPassed: number;
      testFilesTotal: number;
      testsPassed: number;
      testsTotal: number;
      boundariesPassed: boolean;
      typecheckPassed: boolean;
    };
  }>("evals/manifests/v1-stable-core-baseline.json");

  it("requires a non-vacuous exact stable package target", () => {
    const stablePackages = Object.entries(packageManifest.packages)
      .filter(([, value]) => value.maturity === "stable")
      .map(([id]) => id)
      .sort();

    expect(stablePackages).toEqual(
      [...manifest.expectedStablePackages].sort(),
    );
    expect(stablePackages).toEqual(["core-types", "provenance"]);
  });

  it("pins package and schema versions in public runtime exports", () => {
    expect(CORE_TYPES_PACKAGE_VERSION).toBe("1.0.0");
    expect(CORE_TYPES_ABI_VERSION).toBe("1.0.0");
    expect(CORE_TYPES_SCHEMA_VERSIONS).toEqual({
      "jl-result-envelope": "1.0.0",
      "jl-runtime-schema": "1.0.0",
    });

    expect(PROVENANCE_PACKAGE_VERSION).toBe("1.0.0");
    expect(PROVENANCE_ABI_VERSION).toBe("1.0.0");
    expect(PROVENANCE_SCHEMA_VERSIONS).toEqual({
      "jl-provenance-record": "1.0.0",
      "jl-provenance-store-snapshot": "1.0.0",
    });
  });

  it("requires all eight M20 artifact classes for every stable package", () => {
    expect(manifest.schemaVersion).toBe("jl-v1-conformance-manifest-1");
    for (const packageEvidence of manifest.packages) {
      const valid = validateStablePackageV1Evidence(packageEvidence);
      expect(valid.ok).toBe(true);

      expect(Object.keys(packageEvidence.artifacts).sort()).toEqual(
        [...V1_CONFORMANCE_REQUIREMENTS].sort(),
      );

      for (const requirement of V1_CONFORMANCE_REQUIREMENTS) {
        const refs = packageEvidence.artifacts[requirement];
        expect(refs.length).toBeGreaterThan(0);
        for (const ref of refs) {
          expect(existsSync(ref), `missing M20 artifact: ${ref}`).toBe(true);
        }
      }
    }
  });

  it("replays the stable-core demo to the exact canonical digest", () => {
    const fixture = readJson<ReplayFixture>(
      "examples/v1/stable-core-replay.json",
    );
    const store = new InMemoryProvenanceStore();
    for (const record of fixture.records) store.add(record);

    const snapshot = store.snapshot();
    expect(snapshot.map((record) => record.id)).toEqual(
      fixture.expected.snapshotIds,
    );
    expect(
      sha256(canonicalJson(snapshot as unknown as JsonValue)),
    ).toBe(fixture.expected.canonicalDigest);
  });

  it("audits the native replay demo as zero-generative", () => {
    const fixture = readJson<ReplayFixture>(
      "examples/v1/stable-core-replay.json",
    );
    const audit = auditZeroGenerative({
      generativeModelCalls:
        fixture.zeroGenerativeAudit.generativeModelCalls,
      generativeEmbeddingCalls:
        fixture.zeroGenerativeAudit.generativeEmbeddingCalls,
      externalGenerationServices:
        fixture.zeroGenerativeAudit.externalGenerationServices,
    });
    expect(audit.ok).toBe(true);
    if (audit.ok) {
      expect(audit.value.jevNative).toBe(true);
      expect(audit.value.violations).toEqual([]);
      expect(fixture.zeroGenerativeAudit.jevNative).toBe(true);
      expect(fixture.zeroGenerativeAudit.violations).toEqual([]);
    }
  });

  it("builds a passing stable-core v1 report from frozen baseline evidence", () => {
    const report = buildV1ConformanceReport({
      releaseId: manifest.releaseId,
      releaseVersion: manifest.releaseVersion,
      specVersion: manifest.specVersion,
      commit: baseline.sourceCi.commit,
      expectedStablePackages: manifest.expectedStablePackages,
      packages: manifest.packages,
      ci: {
        runId: `github-actions:${baseline.sourceCi.runNumber}`,
        conclusion: "success",
        boundariesPassed: baseline.sourceCi.boundariesPassed,
        typecheckPassed: baseline.sourceCi.typecheckPassed,
        testFilesPassed: baseline.sourceCi.testFilesPassed,
        testFilesTotal: baseline.sourceCi.testFilesTotal,
        testsPassed: baseline.sourceCi.testsPassed,
        testsTotal: baseline.sourceCi.testsTotal,
      },
      knownFailures: [],
      blockedItems: [],
    });
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.status).toBe("pass");
      expect(report.value.stablePackageCount).toBe(2);
      expect(report.value.blockers).toEqual([]);
    }
  });

  it("blocks vacuous, incomplete, or mismatched v1 evidence", () => {
    const noPackages = buildV1ConformanceReport({
      releaseId: manifest.releaseId,
      releaseVersion: manifest.releaseVersion,
      specVersion: manifest.specVersion,
      commit: baseline.sourceCi.commit,
      expectedStablePackages: manifest.expectedStablePackages,
      packages: [],
      ci: {
        runId: "ci:test",
        conclusion: "success",
        boundariesPassed: true,
        typecheckPassed: true,
        testFilesPassed: 1,
        testFilesTotal: 1,
        testsPassed: 1,
        testsTotal: 1,
      },
      knownFailures: [],
      blockedItems: [],
    });
    expect(noPackages.ok).toBe(true);
    if (noPackages.ok) {
      expect(noPackages.value.status).toBe("blocked");
      expect(
        noPackages.value.blockers.some(
          (blocker) => blocker.code === "V1_NO_STABLE_PACKAGES",
        ),
      ).toBe(true);
    }

    const incomplete = structuredClone(manifest.packages[0]!);
    incomplete.artifacts["known-limitations"] = [];
    expect(validateStablePackageV1Evidence(incomplete).ok).toBe(false);

    const mismatched = buildV1ConformanceReport({
      releaseId: manifest.releaseId,
      releaseVersion: manifest.releaseVersion,
      specVersion: manifest.specVersion,
      commit: baseline.sourceCi.commit,
      expectedStablePackages: manifest.expectedStablePackages,
      packages: [manifest.packages[0]!],
      ci: {
        runId: "ci:test",
        conclusion: "success",
        boundariesPassed: true,
        typecheckPassed: true,
        testFilesPassed: 1,
        testFilesTotal: 1,
        testsPassed: 1,
        testsTotal: 1,
      },
      knownFailures: [],
      blockedItems: [],
    });
    expect(mismatched.ok).toBe(true);
    if (mismatched.ok) {
      expect(mismatched.value.status).toBe("blocked");
      expect(
        mismatched.value.blockers.some(
          (blocker) =>
            blocker.code === "V1_STABLE_PACKAGE_SET_MISMATCH",
        ),
      ).toBe(true);
    }
  });
});
