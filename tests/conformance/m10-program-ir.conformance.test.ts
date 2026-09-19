import { describe, expect, it } from "vitest";
import {
  InMemoryPirGraph,
  activeUserFilterGoal,
  analyzeDefUse,
  deserializePirProgram,
  lowerFunctionToCfg,
  m10ProgramCorpus,
  serializePirProgram,
  validatePirProgram,
  validateSourceBinding,
  type PirFunction,
  type PirProgram,
  type PirSymbol,
} from "../../packages/program-ir/src/index.ts";

describe("M10 Program IR conformance", () => {
  it("validates every required M10 program-corpus fixture", () => {
    const corpus = m10ProgramCorpus();
    expect(Object.keys(corpus).sort()).toEqual([
      "async-call",
      "collection-filter-map",
      "conditional-validation",
      "error-handling",
      "multi-function-module",
      "pure-arithmetic",
      "simple-generic-function",
      "state-mutation",
    ]);

    for (const [id, program] of Object.entries(corpus)) {
      const result = validatePirProgram(program);
      expect(result, id).toEqual({ ok: true, value: undefined });
      expect(program.modules?.length, id).toBeGreaterThan(0);
      expect(program.functions.length, id).toBeGreaterThan(0);
    }
  });

  it("derives CFGs from expression and structured-statement function bodies", () => {
    const corpus = m10ProgramCorpus();

    for (const program of Object.values(corpus)) {
      for (const fn of program.functions) {
        const cfg = lowerFunctionToCfg(fn);
        expect(cfg.ok, fn.id).toBe(true);
        if (!cfg.ok) continue;

        expect(cfg.value.functionId).toBe(fn.id);
        expect(cfg.value.blocks.length).toBeGreaterThan(0);
        expect(
          cfg.value.blocks.some((block) => block.id === cfg.value.entry),
        ).toBe(true);

        for (const block of cfg.value.blocks) {
          for (const successor of block.successors) {
            expect(
              cfg.value.blocks.some((candidate) => candidate.id === successor),
            ).toBe(true);
          }
        }
      }
    }

    const conditional = corpus["conditional-validation"].functions[0]!;
    const cfg = lowerFunctionToCfg(conditional);
    expect(cfg.ok).toBe(true);
    if (cfg.ok) {
      expect(cfg.value.blocks.some((block) => block.terminator === "branch")).toBe(
        true,
      );
      expect(cfg.value.blocks.some((block) => block.terminator === "return")).toBe(
        true,
      );
      expect(cfg.value.blocks.some((block) => block.terminator === "throw")).toBe(
        true,
      );
    }
  });

  it("derives def-use facts instead of duplicating data flow in canonical PIR", () => {
    const program = m10ProgramCorpus()["state-mutation"];
    const fn = program.functions[0]!;
    const facts = analyzeDefUse(fn);

    const state = facts.find(
      (fact) => fact.symbolId === "param:increment:state",
    );
    expect(state).toBeDefined();
    expect(state?.definitions).toContain("function-entry");
    expect((state?.uses.length ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it("preserves modules, functions, contracts, effects, generics and source bindings through canonical serialization", () => {
    const program = m10ProgramCorpus()["pure-arithmetic"];
    const serialized = serializePirProgram(program);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;

    const recovered = deserializePirProgram(serialized.value);
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;

    const reserialized = serializePirProgram(recovered.value);
    expect(reserialized).toEqual(serialized);

    const fn = recovered.value.functions[0]!;
    expect(fn.effects).toEqual([{ kind: "pure" }]);
    expect(fn.contract?.provenance[0]?.source).toBe("requirement");
    expect(fn.sourceBinding).toMatchObject({
      sourceId: "fixture:pure-arithmetic",
      existingName: "add",
    });

    const generic = m10ProgramCorpus()["simple-generic-function"].functions[0]!;
    expect(generic.typeParameters?.[0]).toMatchObject({
      kind: "type-variable",
      id: "type:T",
      name: "T",
    });
  });

  it("keeps graph transactions atomic, revisioned and rollback-safe", () => {
    const initial = m10ProgramCorpus()["pure-arithmetic"];
    const graph = new InMemoryPirGraph(initial);
    const before = graph.snapshot();

    const extra: PirFunction = {
      kind: "function",
      id: "function:constant-one",
      name: "constantOne",
      parameters: [],
      returnType: { kind: "number" },
      body: { kind: "literal", value: 1, type: { kind: "number" } },
      effects: [{ kind: "pure" }],
    };

    const transaction = graph.beginTransaction([
      { kind: "add-function", value: extra },
    ]);
    const rolledBack = graph.rollback(transaction);
    expect(rolledBack.ok).toBe(true);
    expect(graph.revision).toBe(before.revision);
    expect(graph.snapshot().program.functions).toHaveLength(
      before.program.functions.length,
    );

    const committed = graph.commit(transaction);
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.value.parentRevision).toBe(before.revision);
    expect(committed.value.revision).not.toBe(before.revision);
    expect(
      committed.value.program.functions.some((fn) => fn.id === extra.id),
    ).toBe(true);

    const stale = graph.commit(transaction);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe("PIR_GRAPH_STALE_TRANSACTION");
    }
  });

  it("rejects invalid transactions without mutating graph state", () => {
    const initial = m10ProgramCorpus()["pure-arithmetic"];
    const graph = new InMemoryPirGraph(initial);
    const revision = graph.revision;
    const before = serializePirProgram(graph.snapshot().program);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const duplicate = structuredClone(initial.functions[0]!);
    const failed = graph.commit(
      graph.beginTransaction([{ kind: "add-function", value: duplicate }]),
    );
    expect(failed.ok).toBe(false);
    expect(graph.revision).toBe(revision);

    const after = serializePirProgram(graph.snapshot().program);
    expect(after).toEqual(before);
  });

  it("represents typed holes as explicit incomplete program locations", () => {
    const program = activeUserFilterGoal();
    expect(validatePirProgram(program).ok).toBe(true);

    expect(program.holes).toHaveLength(1);
    const hole = program.holes?.[0];
    expect(hole).toMatchObject({
      id: "hole:filter-active-users-body",
      expectedType: { kind: "list" },
      expectedEffect: "pure",
      scopeSymbols: ["param:users"],
    });

    expect(program.functions[0]?.body).toMatchObject({
      kind: "hole",
      id: "hole:filter-active-users-body",
    });
  });

  it("validates source-binding ranges and keeps existing names explicit", () => {
    expect(
      validateSourceBinding({
        sourceId: "source:existing.ts",
        existingName: "preserveMe",
        start: 10,
        end: 20,
      }),
    ).toEqual({ ok: true, value: undefined });

    const invalid = validateSourceBinding({
      sourceId: "source:existing.ts",
      start: 20,
      end: 10,
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe("PIR_SOURCE_BINDING_RANGE");
    }
  });

  it("represents symbols independently from backend source syntax", () => {
    const symbol: PirSymbol = {
      id: "symbol:counter",
      symbolKind: "variable",
      namingIntent: {
        preferredTerms: ["counter"],
        style: "backend-default",
      },
      type: { kind: "number" },
      visibility: "internal",
      semanticPurpose: "semantic:counter",
    };

    const program: PirProgram = {
      version: "1.0.0",
      modules: [
        {
          id: "module:symbol-test",
          kind: "module",
          nameIntent: { preferredTerms: ["symbol test"] },
          exports: [],
          imports: [],
          declarations: [symbol.id],
        },
      ],
      symbols: [symbol],
      functions: [],
    };

    expect(validatePirProgram(program)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("keeps effect distinctions needed for later synthesis pruning", () => {
    const corpus = m10ProgramCorpus();
    expect(corpus["pure-arithmetic"].functions[0]?.effects).toEqual([
      { kind: "pure" },
    ]);
    expect(corpus["state-mutation"].functions[0]?.effects).toEqual([
      { kind: "write-memory" },
    ]);
    expect(corpus["error-handling"].functions[0]?.effects).toEqual([
      { kind: "throw" },
    ]);
    expect(corpus["async-call"].functions[0]?.effects).toEqual([
      { kind: "network" },
      { kind: "async" },
    ]);
  });
});
