import { describe, expect, it } from "vitest";
import {
  BoundedBooleanSolver,
  ProofObligationRegistry,
  ScriptedConstraintSolver,
  TheoryRequirementRegistry,
  joinProofStatus,
  type LogicIr,
  type SymbolicExecutionAdapter,
  type TerminationAnalysisHook,
} from "../../packages/formal-ir/src/index.ts";

const ref = (id: string): LogicIr => ({
  kind: "proposition-ref",
  ref: id as never,
});

describe("T471-T480 solver/proof conformance", () => {
  it("T471 exposes a solver-neutral ConstraintSolver contract with a real bounded adapter", async () => {
    const solver = new BoundedBooleanSolver();
    const result = await solver.solve({
      id: "solver-request:sat",
      constraints: [ref("p")],
      theoryIds: ["logic.propositional.boolean.v1"],
      timeoutMs: 1000,
      maxVariables: 4,
      maxAssignments: 16,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("SAT");
      expect(result.value.evidence.solverId).toBe(
        "solver.boolean-exhaustive.v1",
      );
      expect(result.value.evidence.model).toEqual({ p: true });
    }
  });

  it("T472 distinguishes SAT, UNSAT, UNKNOWN and TIMEOUT without conflation", async () => {
    const solver = new BoundedBooleanSolver();
    const base = {
      theoryIds: ["logic.propositional.boolean.v1"],
      maxVariables: 4,
      maxAssignments: 16,
      timeoutMs: 1000,
    };
    const sat = await solver.solve({
      ...base,
      id: "status:sat",
      constraints: [ref("p")],
    });
    const unsat = await solver.solve({
      ...base,
      id: "status:unsat",
      constraints: [
        ref("p"),
        { kind: "not", value: ref("p") },
      ],
    });
    const unknown = await solver.solve({
      ...base,
      id: "status:unknown",
      constraints: [
        {
          kind: "modal",
          operator: "necessary",
          body: ref("p"),
        },
      ],
    });
    const timeout = await solver.solve({
      ...base,
      id: "status:timeout",
      constraints: [ref("p")],
      timeoutMs: 0,
    });

    expect(sat.ok && sat.value.status === "SAT").toBe(true);
    expect(unsat.ok && unsat.value.status === "UNSAT").toBe(true);
    expect(unknown.ok && unknown.value.status === "UNKNOWN").toBe(true);
    expect(timeout.ok && timeout.value.status === "TIMEOUT").toBe(true);
  });

  it("T473 registers proof obligations with explicit theories and assumptions", () => {
    const registry = new ProofObligationRegistry();
    expect(
      registry.register({
        id: "proof:no-contradiction",
        description: "p and not p cannot both hold",
        formula: {
          kind: "not",
          value: {
            kind: "and",
            values: [ref("p"), { kind: "not", value: ref("p") }],
          },
        },
        requiredTheoryIds: ["logic.propositional.boolean.v1"],
        assumptions: ["classical Boolean semantics"],
        bounded: { maxVariables: 4, maxAssignments: 16 },
      }).ok,
    ).toBe(true);
    expect(registry.list().map((item) => item.id)).toEqual([
      "proof:no-contradiction",
    ]);
    expect(
      registry.register({
        id: "proof:no-contradiction",
        description: "duplicate",
        formula: { kind: "boolean", value: true },
        requiredTheoryIds: [],
        assumptions: [],
      }).ok,
    ).toBe(false);
  });

  it("T474 keeps proof status lattice honest under conflicting evidence", () => {
    expect(joinProofStatus("UNPROVED", "PROVED")).toBe("PROVED");
    expect(joinProofStatus("UNKNOWN", "TIMEOUT")).toBe("UNKNOWN");
    expect(joinProofStatus("PROVED", "DISPROVED")).toBe("UNKNOWN");
    expect(joinProofStatus("DISPROVED", "UNPROVED")).toBe("DISPROVED");
  });

  it("T475 resolves declared theory requirements and rejects unknown theory ids", () => {
    const registry = new TheoryRequirementRegistry();
    expect(
      registry.register({
        id: "logic.propositional.boolean.v1",
        description: "Finite classical propositional Boolean logic.",
        mandatory: true,
      }).ok,
    ).toBe(true);
    expect(
      registry.resolve(["logic.propositional.boolean.v1"]).ok,
    ).toBe(true);
    expect(registry.resolve(["theory:missing"]).ok).toBe(false);
  });

  it("T476 records whether exhaustive evidence is complete within explicit bounds", async () => {
    const solver = new BoundedBooleanSolver();
    const complete = await solver.solve({
      id: "bounded:complete",
      constraints: [
        ref("p"),
        { kind: "not", value: ref("p") },
      ],
      theoryIds: ["logic.propositional.boolean.v1"],
      timeoutMs: 1000,
      maxVariables: 2,
      maxAssignments: 4,
    });
    expect(complete.ok).toBe(true);
    if (complete.ok) {
      expect(complete.value.status).toBe("UNSAT");
      expect(complete.value.evidence.bounded.completeWithinBound).toBe(true);
    }

    const incomplete = await solver.solve({
      id: "bounded:incomplete",
      constraints: [
        {
          kind: "or",
          values: [ref("p"), ref("q")],
        },
      ],
      theoryIds: ["logic.propositional.boolean.v1"],
      timeoutMs: 1000,
      maxVariables: 2,
      maxAssignments: 1,
    });
    expect(incomplete.ok).toBe(true);
    if (incomplete.ok) {
      expect(incomplete.value.status).toBe("UNKNOWN");
      expect(incomplete.value.evidence.bounded.completeWithinBound).toBe(false);
    }
  });

  it("T477 defines a symbolic-execution adapter boundary with explicit completeness", () => {
    const adapter: SymbolicExecutionAdapter<{ x: number }> = {
      id: "symbolic:mock",
      execute(request) {
        return {
          ok: true,
          value: {
            terminalStates: [{ x: request.initialState.x + 1 }],
            pathConditions: [{ kind: "boolean", value: true }],
            exploredSteps: 1,
            complete: request.maxSteps >= 1,
          },
        };
      },
    };
    const result = adapter.execute({
      id: "symbolic:case",
      initialState: { x: 1 },
      maxSteps: 1,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        terminalStates: [{ x: 2 }],
        pathConditions: [{ kind: "boolean", value: true }],
        exploredSteps: 1,
        complete: true,
      },
    });
  });

  it("T478 defines a termination-analysis hook that can report UNKNOWN", () => {
    const hook: TerminationAnalysisHook = {
      id: "termination:bounded-loop",
      analyze(request) {
        return {
          ok: true,
          value:
            request.boundedIterations === undefined
              ? {
                  status: "UNKNOWN",
                  rationale: "No ranking function or explicit bound supplied.",
                  evidenceRefs: ["termination:no-bound"],
                }
              : {
                  status: "PROVED",
                  rationale: "Explicit finite iteration bound.",
                  evidenceRefs: ["termination:explicit-bound"],
                },
        };
      },
    };
    expect(
      hook.analyze({ id: "loop:unknown" }),
    ).toEqual({
      ok: true,
      value: {
        status: "UNKNOWN",
        rationale: "No ranking function or explicit bound supplied.",
        evidenceRefs: ["termination:no-bound"],
      },
    });
    expect(
      hook.analyze({ id: "loop:bounded", boundedIterations: 10 }),
    ).toEqual({
      ok: true,
      value: {
        status: "PROVED",
        rationale: "Explicit finite iteration bound.",
        evidenceRefs: ["termination:explicit-bound"],
      },
    });
  });

  it("T479 emits replayable solver-proof evidence with assumptions, theory ids, bounds and model/status", async () => {
    const solver = new BoundedBooleanSolver();
    const result = await solver.solve({
      id: "evidence:model",
      constraints: [
        {
          kind: "iff",
          left: ref("p"),
          right: { kind: "boolean", value: true },
        },
      ],
      theoryIds: ["logic.propositional.boolean.v1"],
      assumptions: ["classical Boolean semantics"],
      timeoutMs: 1000,
      maxVariables: 1,
      maxAssignments: 2,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.evidence).toMatchObject({
        schemaVersion: "jl-solver-proof-1",
        solverId: "solver.boolean-exhaustive.v1",
        requestId: "evidence:model",
        status: "SAT",
        theoryIds: ["logic.propositional.boolean.v1"],
        assumptions: ["classical Boolean semantics"],
      });
      expect(result.value.evidence.bounded.exploredAssignments).toBeGreaterThan(0);
    }
  });

  it("T480 provides both a scripted conformance mock and one real exhaustive Boolean adapter", async () => {
    const mock = new ScriptedConstraintSolver(["UNKNOWN", "UNSAT"]);
    const request = {
      id: "mock:1",
      constraints: [] as LogicIr[],
      theoryIds: ["mock"],
      timeoutMs: 1,
      maxVariables: 0,
      maxAssignments: 0,
    };
    const first = await mock.solve(request);
    const second = await mock.solve({ ...request, id: "mock:2" });
    expect(first.ok && first.value.status === "UNKNOWN").toBe(true);
    expect(second.ok && second.value.status === "UNSAT").toBe(true);

    const real = new BoundedBooleanSolver();
    const realResult = await real.solve({
      id: "real:unsat",
      constraints: [
        ref("p"),
        { kind: "not", value: ref("p") },
      ],
      theoryIds: ["logic.propositional.boolean.v1"],
      timeoutMs: 1000,
      maxVariables: 1,
      maxAssignments: 2,
    });
    expect(realResult.ok && realResult.value.status === "UNSAT").toBe(true);
  });
});
