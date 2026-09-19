import ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";
import {
  createTypeScriptBackend,
  type SourceDocument,
} from "../../packages/code-backend-core/src/index.ts";
import {
  BackendRepairCompiler,
  normalizeRepairDiagnostic,
  repairProgram,
  type NormalizedTestResult,
  type RepairTestRunner,
} from "../../packages/repair-core/src/index.ts";

const document = (
  sourceId: string,
  text: string,
): SourceDocument => ({
  sourceId,
  language: "typescript",
  path: `/virtual/${sourceId}.ts`,
  text,
});

const executeModule = (
  source: SourceDocument,
): Record<string, unknown> => {
  const emitted = ts.transpileModule(source.text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      strict: true,
    },
    fileName: source.path,
    reportDiagnostics: false,
  });

  const moduleRecord: { exports: Record<string, unknown> } = {
    exports: {},
  };
  const run = new Function(
    "exports",
    "module",
    emitted.outputText,
  ) as (
    exports: Record<string, unknown>,
    module: { exports: Record<string, unknown> },
  ) => void;
  run(moduleRecord.exports, moduleRecord);
  return moduleRecord.exports;
};

class ExportBehaviorRunner implements RepairTestRunner {
  constructor(
    readonly id: string,
    readonly exportName: string,
    readonly expected: unknown,
  ) {}

  run(input: {
    source: SourceDocument;
  }): NormalizedTestResult {
    try {
      const exports = executeModule(input.source);
      const exported = exports[this.exportName];
      if (typeof exported !== "function") {
        const diagnostic = normalizeRepairDiagnostic({
          backendId: "test.typescript-runtime",
          source: input.source,
          compiler: {
            code: "TEST_EXPORT_MISSING",
            severity: "error",
            message: `Expected callable export ${this.exportName}.`,
            sourceId: input.source.path,
            category: "test",
          },
        });
        return {
          ok: false,
          runner: this.id,
          cases: [
            {
              id: this.exportName,
              status: "fail",
              message: diagnostic.compiler.message,
            },
          ],
          diagnostics: [diagnostic],
          evidence: [],
        };
      }

      const actual = (exported as () => unknown)();
      if (!Object.is(actual, this.expected)) {
        const diagnostic = normalizeRepairDiagnostic({
          backendId: "test.typescript-runtime",
          source: input.source,
          compiler: {
            code: "TEST_BEHAVIOR_MISMATCH",
            severity: "error",
            message:
              `Export ${this.exportName} returned ${JSON.stringify(actual)} ` +
              `instead of ${JSON.stringify(this.expected)}.`,
            sourceId: input.source.path,
            category: "test",
          },
        });
        return {
          ok: false,
          runner: this.id,
          cases: [
            {
              id: this.exportName,
              status: "fail",
              message: diagnostic.compiler.message,
            },
          ],
          diagnostics: [diagnostic],
          evidence: [],
        };
      }

      return {
        ok: true,
        runner: this.id,
        cases: [
          {
            id: this.exportName,
            status: "pass",
            evidence: [
              `runtime:${this.exportName}=${JSON.stringify(actual)}`,
            ],
          },
        ],
        diagnostics: [],
        evidence: [
          `runtime:${this.exportName}=${JSON.stringify(actual)}`,
        ],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      const diagnostic = normalizeRepairDiagnostic({
        backendId: "test.typescript-runtime",
        source: input.source,
        compiler: {
          code: "TEST_RUNTIME_EXCEPTION",
          severity: "error",
          message,
          sourceId: input.source.path,
          category: "test",
        },
      });
      return {
        ok: false,
        runner: this.id,
        cases: [
          {
            id: this.exportName,
            status: "fail",
            message,
          },
        ],
        diagnostics: [diagnostic],
        evidence: [],
      };
    }
  }
}

describe("M14 compiler/test repair loop", () => {
  it("repairs broken TypeScript deterministically and verifies behavior plus regression", async () => {
    const backend = createTypeScriptBackend();
    expect(backend.ok).toBe(true);
    if (!backend.ok) return;

    const source = document(
      "m14-broken-answer",
      [
        "export function answer(): number {",
        '  return "41";',
        "}",
        "",
        "export function keep(): number {",
        "  return 7;",
        "}",
        "",
      ].join("\n"),
    );

    const compiler = new BackendRepairCompiler(backend.value);
    const initial = compiler.compile({ source });
    expect(initial.ok).toBe(false);
    expect(
      initial.diagnostics.map((diagnostic) => diagnostic.compiler.code),
    ).toContain("TS2322");

    const result = await repairProgram({
      source,
      options: {
        compiler,
        tests: new ExportBehaviorRunner(
          "test.answer",
          "answer",
          41,
        ),
        regression: new ExportBehaviorRunner(
          "test.keep",
          "keep",
          7,
        ),
        knowledge: {
          symbolImports: {},
          argumentDefaults: {},
          nullGuards: {},
          returnReplacements: {
            TS2322: [
              {
                source: "41",
                cost: 1,
              },
            ],
          },
        },
        budget: {
          maxIterations: 3,
          maxCandidatesPerIteration: 4,
          maxCompileRuns: 5,
          maxTestRuns: 5,
          deadlineMs: 10_000,
        },
      },
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    expect(result.compile.ok).toBe(true);
    expect(result.tests.ok).toBe(true);
    expect(result.regression.ok).toBe(true);
    expect(result.source.text).toContain("return 41;");
    expect(result.source.text).toContain("return 7;");
    expect(result.candidateHistory).toHaveLength(1);
    expect(result.candidateHistory[0]).toMatchObject({
      kind: "return-type",
      expectedRemovedCodes: ["TS2322"],
    });
    expect(result.usage).toMatchObject({
      iterations: 1,
      candidatesTried: 1,
      compileRuns: 2,
      testRuns: 2,
      rollbacks: 0,
    });
    expect(
      result.trace.map((event) => event.kind),
    ).toEqual(
      expect.arrayContaining([
        "diagnostic",
        "candidate-generated",
        "candidate-selected",
        "candidate-applied",
        "compile-pass",
        "test-pass",
        "verified",
      ]),
    );
  });

  it("rolls back a non-improving repair instead of accepting compiler failure", async () => {
    const backend = createTypeScriptBackend();
    expect(backend.ok).toBe(true);
    if (!backend.ok) return;

    const source = document(
      "m14-rollback",
      'export function answer(): number { return "41"; }\n',
    );
    const compiler = new BackendRepairCompiler(backend.value);
    const result = await repairProgram({
      source,
      options: {
        compiler,
        tests: new ExportBehaviorRunner(
          "test.answer",
          "answer",
          41,
        ),
        regression: new ExportBehaviorRunner(
          "test.answer-regression",
          "answer",
          41,
        ),
        knowledge: {
          symbolImports: {},
          argumentDefaults: {},
          nullGuards: {},
          returnReplacements: {
            TS2322: [
              {
                source: '"still-wrong"',
                cost: 1,
              },
            ],
          },
        },
        budget: {
          maxIterations: 2,
          maxCandidatesPerIteration: 2,
          maxCompileRuns: 4,
          maxTestRuns: 3,
          deadlineMs: 10_000,
        },
      },
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.kind).toBe("compile-failed");
    expect(result.usage.rollbacks).toBe(1);
    expect(result.source.text).toBe(source.text);
    expect(result.trace).toContainEqual(
      expect.objectContaining({
        kind: "rollback",
      }),
    );
  });

  it("halts on compile budget exhaustion with structured failure", async () => {
    const backend = createTypeScriptBackend();
    expect(backend.ok).toBe(true);
    if (!backend.ok) return;

    const source = document(
      "m14-budget",
      'export function answer(): number { return "41"; }\n',
    );
    const result = await repairProgram({
      source,
      options: {
        compiler: new BackendRepairCompiler(backend.value),
        tests: new ExportBehaviorRunner(
          "test.answer",
          "answer",
          41,
        ),
        regression: new ExportBehaviorRunner(
          "test.answer-regression",
          "answer",
          41,
        ),
        knowledge: {
          symbolImports: {},
          argumentDefaults: {},
          nullGuards: {},
          returnReplacements: {
            TS2322: [{ source: "41" }],
          },
        },
        budget: {
          maxIterations: 2,
          maxCandidatesPerIteration: 2,
          maxCompileRuns: 1,
          maxTestRuns: 3,
          deadlineMs: 10_000,
        },
      },
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.kind).toBe("budget");
    expect(result.usage.compileRuns).toBe(1);
  });
});
