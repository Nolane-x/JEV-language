import ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";
import {
  applySourcePatches,
  createTypeScriptBackend,
  type SourceDocument,
} from "../../packages/code-backend-core/src/index.ts";
import {
  BackendRepairCompiler,
  JevRepairCandidateRanker,
  classifyRepairDiagnostic,
  generateRepairCandidates,
  locateImplicatedProgramNodes,
  normalizeRepairDiagnostic,
  normalizeRepairTestResult,
  repairCandidateDecisionPack,
  repairProgram,
  type NormalizedTestResult,
  type RepairCandidate,
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
    fileName: source.path ?? `/virtual/${source.sourceId}.ts`,
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
        return normalizeRepairTestResult({
          runner: this.id,
          source: input.source,
          cases: [
            {
              id: this.exportName,
              status: "fail",
              message: `Expected callable export ${this.exportName}.`,
            },
          ],
        });
      }

      const actual = (exported as () => unknown)();
      if (!Object.is(actual, this.expected)) {
        return normalizeRepairTestResult({
          runner: this.id,
          source: input.source,
          cases: [
            {
              id: this.exportName,
              status: "fail",
              message:
                `Export ${this.exportName} returned ${JSON.stringify(actual)} ` +
                `instead of ${JSON.stringify(this.expected)}.`,
            },
          ],
        });
      }

      return normalizeRepairTestResult({
        runner: this.id,
        source: input.source,
        cases: [
          {
            id: this.exportName,
            status: "pass",
            evidence: [
              `runtime:${this.exportName}=${JSON.stringify(actual)}`,
            ],
          },
        ],
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return normalizeRepairTestResult({
        runner: this.id,
        source: input.source,
        cases: [
          {
            id: this.exportName,
            status: "fail",
            message,
          },
        ],
      });
    }
  }
}

describe("M14 compiler/test repair loop", () => {

  it("classifies stable diagnostics and maps compiler spans to implicated PIR nodes", () => {
    const source = document(
      "locator",
      "export function add(a: number): number { return missing(a); }\n",
    );
    const start = source.text.indexOf("missing");
    const compilerDiagnostic = {
      code: "TS2304",
      severity: "error" as const,
      message: "Cannot find name 'missing'.",
      sourceId: source.path ?? source.sourceId,
      start,
      length: "missing".length,
      line: 1,
      column: start + 1,
      category: "Error",
    };

    expect(classifyRepairDiagnostic(compilerDiagnostic)).toBe(
      "missing-symbol",
    );

    const program = {
      version: "1.0.0",
      modules: [
        {
          id: "module:locator",
          kind: "module" as const,
          nameIntent: { preferredTerms: ["locator"] },
          exports: ["function:add"],
          imports: [],
          declarations: ["function:add"],
          sourceBinding: {
            sourceId: source.sourceId,
            language: "typescript",
            start: 0,
            end: source.text.length,
          },
        },
      ],
      functions: [
        {
          kind: "function" as const,
          id: "function:add",
          name: "add",
          parameters: [
            {
              id: "param:add:a",
              name: "a",
              type: { kind: "number" as const },
              sourceBinding: {
                sourceId: source.sourceId,
                language: "typescript",
                existingName: "a",
                start: source.text.indexOf("a: number"),
                end: source.text.indexOf("a: number") + 1,
              },
            },
          ],
          returnType: { kind: "number" as const },
          body: {
            kind: "variable" as const,
            symbolId: "param:add:a",
          },
          sourceBinding: {
            sourceId: source.sourceId,
            language: "typescript",
            existingName: "add",
            start: 0,
            end: source.text.length,
          },
        },
      ],
    };

    const implicated = locateImplicatedProgramNodes(
      source,
      program,
      compilerDiagnostic,
    );
    expect(implicated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          refId: "function:add",
          nodeKind: "function",
          relation: "overlap",
          distance: 0,
        }),
      ]),
    );
  });

  it("generates only bounded configured guard/import/argument/return candidates", () => {
    const source = document(
      "generator",
      "const target = broken;\n",
    );
    const at = source.text.indexOf("broken");
    const diagnostics = [
      normalizeRepairDiagnostic({
        backendId: "backend.typescript",
        source,
        compiler: {
          code: "TS18048",
          severity: "error",
          message: "target is possibly undefined",
          sourceId: source.path ?? source.sourceId,
          start: at,
          length: 6,
        },
      }),
      normalizeRepairDiagnostic({
        backendId: "backend.typescript",
        source,
        compiler: {
          code: "TS2304",
          severity: "error",
          message: "Cannot find name 'helper'.",
          sourceId: source.path ?? source.sourceId,
          start: at,
          length: 6,
        },
      }),
      normalizeRepairDiagnostic({
        backendId: "backend.typescript",
        source,
        compiler: {
          code: "TS2554",
          severity: "error",
          message: "Expected 2 arguments, but got 1.",
          sourceId: source.path ?? source.sourceId,
          start: at,
          length: 6,
        },
        metadata: { callable: "helper" },
      }),
      normalizeRepairDiagnostic({
        backendId: "backend.typescript",
        source,
        compiler: {
          code: "TS2322",
          severity: "error",
          message: "Type string is not assignable to type number.",
          sourceId: source.path ?? source.sourceId,
          start: at,
          length: 6,
        },
      }),
    ];

    const candidates = generateRepairCandidates({
      source,
      diagnostics,
      knowledge: {
        nullGuards: {
          TS18048: [{ source: "target ?? 0", cost: 2 }],
        },
        symbolImports: {
          helper: [
            {
              module: "./helper",
              imported: "helper",
              cost: 1,
            },
          ],
        },
        argumentDefaults: {
          helper: [{ source: "helper(1, 2)", cost: 3 }],
        },
        returnReplacements: {
          TS2322: [{ source: "41", cost: 1 }],
        },
      },
    });

    expect(candidates.map((candidate) => candidate.kind)).toEqual(
      expect.arrayContaining([
        "add-guard",
        "import-symbol",
        "argument",
        "return-type",
      ]),
    );
    expect(candidates.every((candidate) => candidate.cost >= 0)).toBe(
      true,
    );
    expect(
      candidates.every(
        (candidate) =>
          candidate.sourcePatches.length > 0 &&
          candidate.diagnosticIds.length > 0,
      ),
    ).toBe(true);
  });

  it("keeps repair ranking bounded to existing candidate IDs and uses deterministic fallback on low confidence", async () => {
    expect(repairCandidateDecisionPack.id).toBe(
      "repair.candidate.select",
    );

    const candidates: RepairCandidate[] = [
      {
        id: "candidate:cheap",
        kind: "return-type",
        diagnosticIds: ["diagnostic:1"],
        pirOperations: [],
        sourcePatches: [],
        expectedRemovedCodes: ["TS2322"],
        cost: 1,
        rationale: "cheap deterministic repair",
        evidenceRefs: ["diagnostic:1"],
      },
      {
        id: "candidate:expensive",
        kind: "argument",
        diagnosticIds: ["diagnostic:1"],
        pirOperations: [],
        sourcePatches: [],
        expectedRemovedCodes: ["TS2322"],
        cost: 5,
        rationale: "expensive alternative",
        evidenceRefs: ["diagnostic:1"],
      },
    ];
    const diagnostic = normalizeRepairDiagnostic({
      backendId: "backend.typescript",
      source: document("rank", "const value = 1;\n"),
      compiler: {
        code: "TS2322",
        severity: "error",
        message: "Type mismatch.",
        sourceId: "/virtual/rank.ts",
        start: 0,
        length: 1,
      },
    });

    const lowConfidence = new JevRepairCandidateRanker({
      modelProfile: "recorded-repair",
      minimumConfidence: 0.8,
      executor: {
        async execute(request) {
          return {
            requestId: request.id,
            answers: [
              {
                questionId: "select_repair",
                type: "choice",
                selected: "candidate:expensive",
                probabilities: {
                  "candidate:cheap": 0.49,
                  "candidate:expensive": 0.51,
                },
                confidence: 0.51,
                model: "recorded",
                latencyMs: 0,
              },
            ],
            model: "recorded",
            usage: {
              requests: 0,
              inputTokens: 0,
              outputTokens: 0,
            },
            traceId: "trace:repair-low-confidence",
            source: "recorded",
          };
        },
      },
    });
    await expect(
      lowConfidence.rank({
        diagnostics: [diagnostic],
        candidates,
      }),
    ).resolves.toEqual([
      "candidate:cheap",
      "candidate:expensive",
    ]);

    const outOfSet = new JevRepairCandidateRanker({
      modelProfile: "recorded-repair",
      executor: {
        async execute(request) {
          return {
            requestId: request.id,
            answers: [
              {
                questionId: "select_repair",
                type: "choice",
                selected: "candidate:invented",
                probabilities: { "candidate:invented": 1 },
                confidence: 1,
                model: "recorded",
                latencyMs: 0,
              },
            ],
            model: "recorded",
            usage: {
              requests: 0,
              inputTokens: 0,
              outputTokens: 0,
            },
            traceId: "trace:repair-out-of-set",
            source: "recorded",
          };
        },
      },
    });

    await expect(
      outOfSet.rank({
        diagnostics: [diagnostic],
        candidates,
      }),
    ).rejects.toMatchObject({
      code: "REPAIR_RANKER_OUT_OF_SET",
    });
  });
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

    const previewCandidates = generateRepairCandidates({
      source,
      diagnostics: initial.diagnostics,
      knowledge: {
        symbolImports: {},
        argumentDefaults: {},
        nullGuards: {},
        returnReplacements: {
          TS2322: [{ source: "41", cost: 1 }],
        },
      },
    });
    expect(previewCandidates).toHaveLength(1);
    const preview = applySourcePatches(
      source,
      previewCandidates[0]!.sourcePatches,
    );
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value.text).toBe(
        [
          "export function answer(): number {",
          "  return 41;",
          "}",
          "",
          "export function keep(): number {",
          "  return 7;",
          "}",
          "",
        ].join("\n"),
      );
    }

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

    expect(
      result.status,
      result.status === "failure"
        ? JSON.stringify({
            kind: result.kind,
            diagnostics: result.diagnostics.map((entry) => ({
              kind: entry.kind,
              code: entry.compiler.code,
              message: entry.compiler.message,
            })),
            usage: result.usage,
            trace: result.trace,
          })
        : undefined,
    ).toBe("success");
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
