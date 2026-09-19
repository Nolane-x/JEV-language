import type { SourceDocument } from "../../code-backend-core/src/backend.ts";
import {
  normalizeRepairDiagnostic,
} from "./diagnostics.ts";
import type {
  NormalizedTestCaseResult,
  NormalizedTestResult,
} from "./model.ts";

export interface RawRepairTestCaseResult {
  id: string;
  status: "pass" | "fail" | "skipped";
  message?: string;
  evidence?: string[];
}

export const normalizeRepairTestResult = (input: {
  runner: string;
  source: SourceDocument;
  cases: readonly RawRepairTestCaseResult[];
  evidence?: string[];
}): NormalizedTestResult => {
  const cases = input.cases.map((entry) => structuredClone(entry));
  const diagnostics = cases
    .filter((entry) => entry.status === "fail")
    .map((entry) =>
      normalizeRepairDiagnostic({
        backendId: `test:${input.runner}`,
        source: input.source,
        compiler: {
          code: "TEST_CASE_FAILED",
          severity: "error",
          message:
            entry.message ??
            `Repair verification test failed: ${entry.id}.`,
          sourceId: input.source.path ?? input.source.sourceId,
          category: "test",
        },
        metadata: {
          runner: input.runner,
          caseId: entry.id,
        },
      }),
    );

  return {
    ok: diagnostics.length === 0,
    runner: input.runner,
    cases,
    diagnostics,
    evidence: [
      ...(input.evidence ?? []),
      ...cases.flatMap((entry) => entry.evidence ?? []),
    ],
  };
};
