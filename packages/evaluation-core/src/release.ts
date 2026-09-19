import {
  canonicalJson,
  err,
  ok,
  sha256,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";

export type ReleaseTaskStatus =
  | "todo"
  | "partial"
  | "implemented"
  | "verified";

export interface ReleaseTaskEvidence {
  id: string;
  status: ReleaseTaskStatus;
}

export interface ReleaseCiEvidence {
  runId: string;
  conclusion: "success" | "failure" | "cancelled" | "unknown";
  boundariesPassed: boolean;
  typecheckPassed: boolean;
  testFilesPassed: number;
  testFilesTotal: number;
  testsPassed: number;
  testsTotal: number;
}

export interface ReleaseZeroGenerativeEvidence {
  jevNative: boolean;
  generativeModelCalls: number;
  violations: string[];
}

export interface ReleaseConformanceInput {
  releaseId: string;
  specVersion: string;
  commit: string;
  requiredTasks: ReleaseTaskEvidence[];
  ci: ReleaseCiEvidence;
  zeroGenerative: ReleaseZeroGenerativeEvidence;
  knownFailures: string[];
  blockedItems: string[];
}

export type ReleaseBlockerCode =
  | "RELEASE_TASK_UNVERIFIED"
  | "RELEASE_CI_NOT_GREEN"
  | "RELEASE_TESTS_INCOMPLETE"
  | "RELEASE_GENERATIVE_VIOLATION"
  | "RELEASE_KNOWN_FAILURE"
  | "RELEASE_BLOCKED_ITEM";

export interface ReleaseBlocker {
  code: ReleaseBlockerCode;
  message: string;
  refs: string[];
}

export interface ReleaseConformanceReport {
  releaseId: string;
  specVersion: string;
  commit: string;
  status: "pass" | "blocked";
  blockers: ReleaseBlocker[];
  verifiedTaskCount: number;
  requiredTaskCount: number;
  ci: ReleaseCiEvidence;
  zeroGenerative: ReleaseZeroGenerativeEvidence;
  evidenceDigest: string;
}

export const buildReleaseConformanceReport = (
  input: ReleaseConformanceInput,
): Result<ReleaseConformanceReport> => {
  if (
    input.releaseId.trim() === "" ||
    input.specVersion.trim() === "" ||
    input.commit.trim() === "" ||
    input.ci.runId.trim() === "" ||
    input.requiredTasks.length === 0
  ) {
    return err(
      new StructuredError(
        "EVAL_RELEASE_INPUT",
        "Release conformance requires release/spec/commit/CI identities and at least one required task.",
      ),
    );
  }

  const ids = new Set<string>();
  for (const task of input.requiredTasks) {
    if (task.id.trim() === "" || ids.has(task.id)) {
      return err(
        new StructuredError(
          "EVAL_RELEASE_TASKS",
          "Release task evidence requires unique non-empty task ids.",
        ),
      );
    }
    ids.add(task.id);
  }

  const blockers: ReleaseBlocker[] = [];
  const unverified = input.requiredTasks
    .filter((task) => task.status !== "verified")
    .map((task) => task.id)
    .sort();
  if (unverified.length > 0) {
    blockers.push({
      code: "RELEASE_TASK_UNVERIFIED",
      message: "Required release tasks remain below verified status.",
      refs: unverified,
    });
  }

  if (
    input.ci.conclusion !== "success" ||
    !input.ci.boundariesPassed ||
    !input.ci.typecheckPassed
  ) {
    blockers.push({
      code: "RELEASE_CI_NOT_GREEN",
      message: "Required CI, package-boundary, or typecheck evidence is not green.",
      refs: [input.ci.runId],
    });
  }

  if (
    input.ci.testFilesPassed !== input.ci.testFilesTotal ||
    input.ci.testsPassed !== input.ci.testsTotal
  ) {
    blockers.push({
      code: "RELEASE_TESTS_INCOMPLETE",
      message: "Not every declared release test file/test passed.",
      refs: [input.ci.runId],
    });
  }

  if (
    !input.zeroGenerative.jevNative ||
    input.zeroGenerative.generativeModelCalls !== 0 ||
    input.zeroGenerative.violations.length > 0
  ) {
    blockers.push({
      code: "RELEASE_GENERATIVE_VIOLATION",
      message: "Zero-generative Jev-native release evidence is not clean.",
      refs: [...input.zeroGenerative.violations].sort(),
    });
  }

  if (input.knownFailures.length > 0) {
    blockers.push({
      code: "RELEASE_KNOWN_FAILURE",
      message: "Known release failures remain open.",
      refs: [...input.knownFailures].sort(),
    });
  }

  if (input.blockedItems.length > 0) {
    blockers.push({
      code: "RELEASE_BLOCKED_ITEM",
      message: "Release-blocking items remain open.",
      refs: [...input.blockedItems].sort(),
    });
  }

  const canonicalEvidence = {
    releaseId: input.releaseId,
    specVersion: input.specVersion,
    commit: input.commit,
    requiredTasks: [...input.requiredTasks].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    ci: input.ci,
    zeroGenerative: {
      ...input.zeroGenerative,
      violations: [...input.zeroGenerative.violations].sort(),
    },
    knownFailures: [...input.knownFailures].sort(),
    blockedItems: [...input.blockedItems].sort(),
  } as unknown as JsonValue;

  return ok({
    releaseId: input.releaseId,
    specVersion: input.specVersion,
    commit: input.commit,
    status: blockers.length === 0 ? "pass" : "blocked",
    blockers,
    verifiedTaskCount: input.requiredTasks.filter(
      (task) => task.status === "verified",
    ).length,
    requiredTaskCount: input.requiredTasks.length,
    ci: structuredClone(input.ci),
    zeroGenerative: structuredClone(input.zeroGenerative),
    evidenceDigest: sha256(canonicalJson(canonicalEvidence)),
  });
};
