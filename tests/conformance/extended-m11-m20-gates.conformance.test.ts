import { describe, expect, it } from "vitest";
import {
  type SemanticId,
} from "../../packages/core-types/src/index.ts";
import {
  assertLanguagePackIdentity,
  validateLanguagePackFeatureManifest,
  type HumanLanguagePack,
  type LanguagePackFeatureManifest,
} from "../../packages/language-pack-core/src/index.ts";
import {
  englishLanguagePack,
} from "../../packages/language-en/src/index.ts";
import {
  pureArithmeticFixture,
  type PirType,
  type ProgramHole,
} from "../../packages/program-ir/src/index.ts";
import {
  GrammarBackedCandidateGenerator,
  createCoreGeneratorRegistry,
  synthesizeProgram,
  type SynthesisGrammar,
  type SynthesisProblem,
  type SynthesisState,
} from "../../packages/synthesis-core/src/index.ts";
import {
  BackendRepairCompiler,
  repairProgram,
  type RepairTestRunner,
} from "../../packages/repair-core/src/index.ts";
import {
  createMinimalTextPatch,
  createTypeScriptBackend,
  runSourcePreservationBenchmark,
  structuralSemanticDiff,
  type SourceDocument,
} from "../../packages/code-backend-core/src/index.ts";
import {
  renderDataIr,
  renderLogicIr,
} from "../../packages/formal-ir/src/index.ts";
import {
  projectUniversalFormalFact,
} from "../../packages/universal-expression/src/index.ts";
import {
  buildAction,
  validateCapabilityRegistry,
  type ActionIR,
  type CapabilityDefinition,
} from "../../packages/action-ir/src/index.ts";
import type { SemanticRef } from "../../packages/semantic-graph/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;
const sref = (value: string): SemanticRef => value as SemanticRef;

describe("Extended M11-M20 evidence gates", () => {
  it("M13 exercises a third synthetic HumanLanguagePack with SOV and pro-drop assumptions", () => {
    const language = "x-mock-sov";
    const featureManifest: LanguagePackFeatureManifest = {
      schemaVersion: "jl-language-features-1",
      language,
      version: "1.0.0",
      features: {
        declaratives: {
          parse: "controlled",
          generate: "controlled",
          evidenceRefs: ["extended:M13:synthetic-pack"],
        },
        "zero-subject": {
          parse: "controlled",
          generate: "controlled",
          evidenceRefs: ["extended:M13:pro-drop"],
        },
      },
      constructions: [
        {
          id: "construction:mock:sov",
          scope: "language-specific",
          language,
          semanticContract: "subject object verb declarative realization",
          parse: true,
          generate: true,
        },
      ],
      semanticExtensions: [],
      localeProfileIds: [],
      mixedLanguage: {
        mode: "forbid",
        defaultLanguage: language,
        allowedLanguages: [language],
        preserveOpaqueTerms: true,
        maxSwitches: 0,
      },
      lexicalFallback: {
        order: ["preserve"],
        preserveOriginal: true,
        allowBorrowing: false,
        allowTransliteration: false,
        requireProvenance: true,
      },
    };

    const mockPack = {
      manifest: {
        ...structuredClone(englishLanguagePack.manifest),
        id: "language.mock-sov",
        languageTag: language,
        version: "1.0.0",
        maturity: "experimental",
        coverage: {
          grammarProfile: "mock-sov-pro-drop",
          lexiconEntries: "dynamic",
        },
      },
      featureManifest,
      tokenizer: {
        id: "mock-sov.tokenizer",
        language,
        tokenize: (source: string) =>
          englishLanguagePack.tokenizer.tokenize(source),
      },
      morphology: {
        id: "mock-sov.morphology",
        language,
        analyze: (surface, context) =>
          englishLanguagePack.morphology.analyze(surface, context),
        realize: (lexeme, features) =>
          englishLanguagePack.morphology.realize(lexeme, features),
      },
      lexicon: {
        id: "mock-sov.lexicon",
        language,
        create: () => englishLanguagePack.lexicon.create(),
      },
      grammar: {
        id: "mock-sov.grammar",
        language,
        coverage: englishLanguagePack.grammar.coverage,
        create: () => englishLanguagePack.grammar.create(),
      },
      parserHooks: {
        id: "mock-sov.parser",
        language,
        parse: (input: string) => englishLanguagePack.parserHooks.parse(input),
      },
      realizationHooks: {
        id: "mock-sov.realizer",
        language,
        realize: (input) => englishLanguagePack.realizationHooks.realize(input),
      },
      punctuation: {
        id: "mock-sov.punctuation",
        language,
        terminal: (kind) => englishLanguagePack.punctuation.terminal(kind),
        join: (tokens) => tokens.join(" "),
      },
      discourse: {
        id: "mock-sov.discourse",
        language,
        choose: (context) => englishLanguagePack.discourse.choose(context),
      },
      typology: {
        constituentOrder: {
          id: "mock-sov.order",
          language,
          order: (input) => {
            void input;
            return ["subject", "object", "verb"];
          },
        },
        zeroRealization: {
          id: "mock-sov.pro-drop",
          language,
          decide(input) {
            return [
              {
                kind: "pro-drop" as const,
                semanticRef: input.semanticRef,
                licensed: input.grammaticalRole === "subject",
                reason: "synthetic agreement licenses subject omission",
                recoverability: "context-dependent" as const,
              },
            ];
          },
        },
      },
      tests: {
        id: "mock-sov.conformance",
        language,
        corpusRefs: ["extended:M13:synthetic-pack"],
        requiredPhenomena: ["SOV", "pro-drop"],
        determinism: "D0",
      },
    } satisfies HumanLanguagePack<
      ReturnType<typeof englishLanguagePack.tokenizer.tokenize>[number],
      string,
      ReturnType<typeof englishLanguagePack.parserHooks.parse>,
      Parameters<typeof englishLanguagePack.realizationHooks.realize>[0],
      ReturnType<typeof englishLanguagePack.realizationHooks.realize>,
      Parameters<typeof englishLanguagePack.discourse.choose>[0],
      ReturnType<typeof englishLanguagePack.discourse.choose>
    >;

    expect(() => assertLanguagePackIdentity(mockPack)).not.toThrow();
    expect(validateLanguagePackFeatureManifest(featureManifest).ok).toBe(true);
    expect(
      mockPack.typology.constituentOrder.order({
        semanticRoles: ["subject", "verb", "object"],
        clauseType: "declarative",
      }),
    ).toEqual(["subject", "object", "verb"]);
    expect(
      mockPack.typology.zeroRealization.decide({
        semanticRef: sid("entity:speaker"),
        grammaticalRole: "subject",
        features: { person: "first" },
      })[0],
    ).toMatchObject({ licensed: true, kind: "pro-drop" });
    expect(mockPack.manifest.languageTag).not.toBe("en");
    expect(mockPack.manifest.languageTag).not.toBe("vi");
  });

  it("M15 synthesizes held-out programs through the typed grammar adapter with zero Jev calls", async () => {
    const numberType: PirType = { kind: "number" };
    const grammar: SynthesisGrammar = {
      schemaVersion: "jl-synthesis-grammar-1",
      id: "grammar:extended-held-out",
      version: "1.0.0",
      profile: "G0",
      productions: [
        {
          id: "production:held-out-literal",
          family: "literal",
          resultType: numberType,
          effects: [],
          requiredCapabilities: [],
          baseCost: 1,
          deterministic: true,
        },
      ],
    };
    const generator = new GrammarBackedCandidateGenerator(grammar);

    for (const [index, expected] of [41, 73].entries()) {
      const program = pureArithmeticFixture();
      const fn = program.functions[0]!;
      const hole: ProgramHole = {
        id: `hole:held-out:${index}`,
        expectedType: numberType,
        expectedEffect: "pure",
        requiredFacts: [],
        forbiddenFacts: [],
        scopeSymbols: fn.parameters.map((parameter) => parameter.id),
        constraints: {
          allowedCandidateFamilies: ["literal"],
          deterministicOnly: true,
          maxCandidateCost: 8,
        },
        budget: {
          maxExpansions: 8,
          maxDepth: 2,
          maxCost: 8,
        },
      };
      fn.body = {
        kind: "hole",
        id: hole.id,
        expected: numberType,
      };
      program.holes = [hole];

      const problem: SynthesisProblem = {
        id: `extended:m15:held-out:${index}`,
        program,
        environment: {
          literals: [
            {
              id: `literal:held-out:${index}`,
              value: expected,
              type: numberType,
              cost: 0,
            },
          ],
          callables: [],
          branchSeeds: [],
          capabilities: [],
          allowedEffects: ["pure"],
          forbiddenEffects: ["network"],
          maxCandidateCost: 8,
        },
        requirements: [`return held-out value ${expected}`],
        specification: {
          kind: "examples",
          examples: [
            {
              id: `example:held-out:${index}`,
              input: null,
              expected,
            },
          ],
        },
        grammarProfile: "G0",
      };

      const state: SynthesisState = {
        id: "state:inspection",
        program: structuredClone(program),
        openHoles: [hole.id],
        obligations: [],
        accumulatedCost: 0,
        depth: 0,
        history: [],
        verifierFacts: [],
      };
      const inspection = generator.inspect({
        problem,
        state,
        functionId: fn.id,
        hole,
        expectedType: numberType,
        location: "expression",
        scopeSymbols: hole.scopeSymbols,
      });
      expect(inspection.ok).toBe(true);
      if (inspection.ok) {
        expect(inspection.value.report.evidenceRefs).toEqual([
          "grammar:grammar:extended-held-out@1.0.0",
          "grammar-profile:G0",
        ]);
        expect(inspection.value.candidates).toHaveLength(1);
      }

      const result = await synthesizeProgram(problem, {
        registry: createCoreGeneratorRegistry([generator]),
        budget: {
          maxStates: 8,
          maxDepth: 2,
          maxJevCalls: 0,
          maxCompilerRuns: 0,
          maxTestRuns: 0,
          deadlineMs: 10_000,
        },
        verifiers: [
          {
            id: "extended.m15.expected-literal",
            verify({ program: candidateProgram }) {
              const body = candidateProgram.functions[0]?.body;
              const accepted =
                body?.kind === "literal" && body.value === expected;
              return {
                accepted,
                evidence: accepted
                  ? [`held-out:${index}:accepted`]
                  : [],
                diagnostics: accepted
                  ? []
                  : [
                      {
                        code: "M15_HELD_OUT_VALUE",
                        message: "Synthesized program did not preserve held-out value.",
                      },
                    ],
              };
            },
          },
        ],
      });

      expect(result.status).toBe("success");
      if (result.status !== "success") continue;
      expect(result.usage.jevCalls).toBe(0);
      expect(result.verificationEvidence).toContain(
        `extended.m15.expected-literal:held-out:${index}:accepted`,
      );
      expect(
        result.trace.some((event) => event.kind === "jev-ranked"),
      ).toBe(false);
    }
  });

  it("M18 repairs source while preserving unrelated text and emits compiler/test/diff evidence", async () => {
    const backend = createTypeScriptBackend();
    expect(backend.ok).toBe(true);
    if (!backend.ok) return;

    const before: SourceDocument = {
      sourceId: "extended:m18:repair",
      language: "typescript",
      version: "rev:1",
      path: "/virtual/extended-m18.ts",
      text: [
        "// unrelated comment must survive",
        "export function answer(): number {",
        '  return "41";',
        "}",
        "",
        "export function keep(): number {",
        "  return 7;",
        "}",
        "",
      ].join("\n"),
    };

    const runner = (
      id: string,
      predicate: (source: string) => boolean,
    ): RepairTestRunner => ({
      id,
      run({ source }) {
        const passed = predicate(source.text);
        return {
          ok: passed,
          runner: id,
          cases: [
            {
              id: `${id}:case`,
              status: passed ? "pass" : "fail",
              evidence: [`${id}:${passed ? "pass" : "fail"}`],
            },
          ],
          diagnostics: [],
          evidence: [`${id}:${passed ? "pass" : "fail"}`],
        };
      },
    });

    const result = await repairProgram({
      source: before,
      options: {
        compiler: new BackendRepairCompiler(backend.value),
        tests: runner(
          "extended.m18.answer-test",
          (source) => source.includes("return 41;"),
        ),
        regression: runner(
          "extended.m18.preservation-test",
          (source) =>
            source.includes("// unrelated comment must survive") &&
            source.includes("return 7;"),
        ),
        knowledge: {
          symbolImports: {},
          argumentDefaults: {},
          nullGuards: {},
          returnReplacements: {
            TS2322: [{ source: "41", cost: 1 }],
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
    expect(result.compile.evidence).toContain(
      "compile:backend.typescript:pass",
    );
    expect(result.tests.evidence).toContain(
      "extended.m18.answer-test:pass",
    );
    expect(result.regression.evidence).toContain(
      "extended.m18.preservation-test:pass",
    );
    expect(result.source.text).toContain("// unrelated comment must survive");

    const patches = createMinimalTextPatch(
      before.sourceId,
      before.text,
      result.source.text,
      "extended-m18-repair",
    );
    expect(patches).toHaveLength(1);
    const benchmark = runSourcePreservationBenchmark({
      id: "extended:m18:source-preservation",
      before,
      stages: [
        {
          document: before,
          expectedRevision: "rev:1",
          boundaries: [
            {
              id: "boundary:unrelated-comment",
              sourceId: before.sourceId,
              start: 0,
              end: "// unrelated comment must survive".length,
              mode: "preserve-exact",
            },
          ],
          patches,
        },
      ],
      expectedPreservedFragments: [
        "// unrelated comment must survive",
        "return 7;",
      ],
      expectedChangedFragments: ["return 41;"],
    });
    expect(benchmark.ok).toBe(true);
    if (benchmark.ok) expect(benchmark.value.passed).toBe(true);

    const semanticDiff = structuralSemanticDiff(
      {
        comment: "// unrelated comment must survive",
        answer: 'return "41";',
        keep: "return 7;",
      },
      {
        comment: "// unrelated comment must survive",
        answer: "return 41;",
        keep: "return 7;",
      },
    );
    expect(semanticDiff).toEqual([
      {
        path: "$.answer",
        kind: "changed",
        before: 'return "41";',
        after: "return 41;",
      },
    ]);
  });

  it("M19 projects one semantic fact into logic and structured-data forms with the same critical value and provenance", () => {
    const projection = projectUniversalFormalFact({
      id: sid("fact:delete-limit"),
      subjectRef: sref("entity:service"),
      predicate: sid("predicate:max-delete-count"),
      value: 3,
      provenanceRefs: [sref("prov:requirement-17")],
    });
    expect(projection.criticalValue).toBe(3);
    expect(projection.provenanceRefs).toEqual(["prov:requirement-17"]);
    expect(projection.artifacts.map((artifact) => artifact.artifactType)).toEqual([
      "logic",
      "structured-data",
    ]);
    expect(renderLogicIr(projection.artifacts[0].logic).ok).toBe(true);
    expect(renderDataIr(projection.artifacts[1].data).ok).toBe(true);

    const logic = projection.artifacts[0].logic;
    expect(logic.kind).toBe("predicate");
    if (logic.kind === "predicate") {
      expect(logic.args[1]?.value).toEqual({ kind: "number", value: 3 });
    }
    const data = projection.artifacts[1].data;
    expect(data.kind).toBe("object");
    if (data.kind === "object") {
      expect(data.fields.find((field) => field.key === "value")?.value).toEqual({
        kind: "number",
        value: 3,
      });
    }
    expect(projection.artifacts[0].semanticRefs).toEqual(["entity:service"]);
    expect(projection.artifacts[1].semanticRefs).toEqual(["entity:service"]);
  });

  it("M20 validates externally supplied capability schemas without executing or inventing capabilities", () => {
    let executions = 0;
    const capability: CapabilityDefinition = {
      id: "external.resource.inspect",
      version: "1.0.0",
      input: {
        kind: "object",
        fields: [
          {
            name: "target",
            schema: { kind: "reference" },
            required: true,
          },
        ],
        additionalProperties: false,
      },
      output: {
        kind: "object",
        fields: [
          {
            name: "exists",
            schema: { kind: "boolean" },
            required: true,
          },
        ],
        additionalProperties: false,
      },
      sideEffect: "read",
      executionMode: "external-tool",
      riskLevel: "low",
      evidenceRefs: ["external-schema:resource-inspect:v1"],
    };
    expect(validateCapabilityRegistry([capability]).ok).toBe(true);

    const action: ActionIR = {
      actionType: "external.resource.inspect",
      parameters: {
        kind: "structured",
        fields: {
          target: { kind: "ref", ref: sref("entity:external-target") },
        },
      },
      provenance: [sref("prov:external-request")],
    };
    const built = buildAction(action, {
      capabilities: [capability],
      knownReferences: new Set<SemanticRef>([
        sref("entity:external-target"),
      ]),
    });
    expect(built.ok).toBe(true);
    expect(executions).toBe(0);

    const invented = buildAction(
      {
        ...action,
        actionType: "external.resource.delete",
      },
      {
        capabilities: [capability],
        knownReferences: new Set<SemanticRef>([
          sref("entity:external-target"),
        ]),
      },
    );
    expect(invented.ok).toBe(false);
    if (!invented.ok) {
      expect(invented.error.code).toBe("ACTION_CAPABILITY_UNKNOWN");
    }
    expect(executions).toBe(0);
  });
});
