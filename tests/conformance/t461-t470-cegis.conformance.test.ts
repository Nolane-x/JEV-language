import { describe, expect, it } from "vitest";
import {
  BestFirstSearchStrategy,
  CandidateRankerFamilyAdapter,
  deterministicStateExpansion,
  hierarchicalCandidateExpansion,
  minimizeCounterexample,
  nextGrammarProfile,
  runCegis,
  validateCounterexample,
  validateValidationPartition,
  type Counterexample,
  type CounterexampleShrinker,
  type ExpansionCandidate,
  type CandidateRanker,
  type CandidateRankingRequest,
  type SynthesisState,
} from "../../packages/synthesis-core/src/index.ts";

const numberType = { kind: "number" } as const;

const candidate = (
  id: string,
  family: ExpansionCandidate["provenance"]["kind"],
  cost: number,
): ExpansionCandidate => ({
  id,
  replacement: {
    kind: "expression",
    value: {
      kind: "literal",
      value: cost,
      type: numberType,
    },
  },
  newHoles: [],
  proofObligations: [],
  heuristicCost: cost,
  provenance: {
    kind: family,
    generatorId: `generator:${family}`,
    evidenceRefs: [`evidence:${id}`],
  },
  resultType: numberType,
  effects: [],
});

describe("T461-T470 search and CEGIS foundation", () => {
  it("T461 preserves explicit SynthesisState as the search-state carrier", () => {
    const state: SynthesisState = {
      id: "state:0",
      program: {
        version: "1",
        functions: [],
      },
      openHoles: [],
      obligations: [],
      accumulatedCost: 0,
      depth: 0,
      history: [],
      verifierFacts: ["fact:type-safe"],
    };
    expect(state.id).toBe("state:0");
    expect(state.verifierFacts).toEqual(["fact:type-safe"]);
  });

  it("T462 exposes SearchStrategy independently from a concrete frontier", () => {
    const strategy = new BestFirstSearchStrategy();
    const frontier = strategy.createFrontier();
    expect(strategy.id).toBe("search.best-first.v1");
    expect(strategy.deterministic).toBe(true);
    expect(frontier.kind).toBe("best-first");
  });

  it("T463 baseline best-first enumerator orders by accumulated cost deterministically", () => {
    const strategy = new BestFirstSearchStrategy();
    const frontier = strategy.createFrontier();
    const base = {
      program: { version: "1", functions: [] },
      openHoles: [],
      obligations: [],
      depth: 0,
      history: [],
      verifierFacts: [],
    };
    frontier.push({
      ...base,
      id: "state:expensive",
      accumulatedCost: 5,
    });
    frontier.push({
      ...base,
      id: "state:cheap",
      accumulatedCost: 1,
    });
    expect(frontier.pop()?.id).toBe("state:cheap");
    expect(frontier.pop()?.id).toBe("state:expensive");
  });

  it("T464 adapts a bounded candidate ranker into family ordering without inventing candidates", async () => {
    const ranker: CandidateRanker = {
      id: "ranker:mock",
      async rank(request: CandidateRankingRequest) {
        return request.candidates.map((item) => item.id).reverse();
      },
    };
    const adapter = new CandidateRankerFamilyAdapter(ranker);
    const candidates = [
      candidate("literal:a", "literal", 1),
      candidate("call:a", "function-call", 2),
      candidate("literal:b", "literal", 3),
    ];
    const ranked = await adapter.rankFamilies({
      problemId: "problem:1",
      holeId: "hole:1",
      requirements: ["return number"],
      candidates,
    });
    expect(ranked.candidateOrder).toEqual([
      "literal:b",
      "call:a",
      "literal:a",
    ]);
    expect(ranked.familyOrder).toEqual(["literal", "function-call"]);
    expect(
      ranked.candidateOrder.every((id) => candidates.some((item) => item.id === id)),
    ).toBe(true);
  });

  it("T465 performs hierarchical family expansion with deterministic in-family ordering", () => {
    const expanded = hierarchicalCandidateExpansion(
      [
        candidate("call:b", "function-call", 4),
        candidate("literal:b", "literal", 3),
        candidate("call:a", "function-call", 2),
        candidate("literal:a", "literal", 1),
      ],
      ["function-call", "literal"],
    );
    expect(expanded.map((item) => item.family)).toEqual([
      "function-call",
      "literal",
    ]);
    expect(expanded[0]?.candidates.map((item) => item.id)).toEqual([
      "call:a",
      "call:b",
    ]);
    expect(expanded[1]?.candidates.map((item) => item.id)).toEqual([
      "literal:a",
      "literal:b",
    ]);
  });

  it("T466-T467 runs CEGIS where a plausible first candidate fails and the next satisfies the counterexample", async () => {
    type Candidate = { limit: number };
    const result = await runCegis<Candidate>({
      initialProfile: "G0",
      wideningPolicy: {
        order: ["G0", "G1", "G2", "G3"],
        permittedReasons: [
          "no-candidates",
          "counterexample-stagnation",
          "expressiveness-gap",
        ],
        maxProfile: "G2",
      },
      partition: {
        development: ["case:1"],
        validation: ["case:2"],
        heldOut: ["case:3"],
      },
      maxIterations: 4,
      propose({ counterexamples }) {
        return counterexamples.length === 0 ? { limit: 1 } : { limit: 2 };
      },
      verify({ candidate: proposed }) {
        if (proposed.limit < 2) {
          return {
            accepted: false,
            counterexamples: [
              {
                schemaVersion: "jl-counterexample-1",
                id: "counterexample:limit-two",
                verifierId: "verifier:held-out",
                input: { requested: 2, noise: "remove-me" },
                expected: { accepted: true },
                observed: { accepted: false },
                violatedConstraints: ["must accept value two"],
                evidenceRefs: ["held-out:case:3"],
              },
            ],
            evidenceRefs: ["verify:first"],
          };
        }
        return {
          accepted: true,
          counterexamples: [],
          evidenceRefs: ["verify:corrected"],
        };
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("success");
      if (result.value.status === "success") {
        expect(result.value.candidate).toEqual({ limit: 2 });
        expect(result.value.iterations).toHaveLength(2);
        expect(result.value.counterexamples.map((item) => item.id)).toEqual([
          "counterexample:limit-two",
        ]);
        expect(result.value.evidenceRefs).toEqual([
          "verify:corrected",
          "verify:first",
        ]);
      }
    }
  });

  it("T467 rejects counterexamples without violated constraints or evidence", () => {
    expect(
      validateCounterexample({
        schemaVersion: "jl-counterexample-1",
        id: "counterexample:bad",
        verifierId: "verifier:test",
        input: null,
        violatedConstraints: [],
        evidenceRefs: [],
      }).ok,
    ).toBe(false);
  });

  it("T468 shrinks a counterexample only when the smaller form still fails", async () => {
    const original: Counterexample = {
      schemaVersion: "jl-counterexample-1",
      id: "counterexample:large",
      verifierId: "verifier:test",
      input: { value: 2, noise: "xxxxxxxxxxxxxxxx" },
      violatedConstraints: ["value two fails"],
      evidenceRefs: ["evidence:test"],
    };
    const shrinker: CounterexampleShrinker = {
      id: "shrinker:drop-noise",
      shrink(input) {
        return [
          {
            ...structuredClone(input),
            id: "counterexample:small",
            input: { value: 2 },
          },
        ];
      },
    };
    const result = await minimizeCounterexample({
      counterexample: original,
      shrinkers: [shrinker],
      stillFails: (proposal) =>
        typeof proposal.input === "object" &&
        proposal.input !== null &&
        !Array.isArray(proposal.input) &&
        proposal.input.value === 2,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("counterexample:small");
      expect(result.value.minimizedFrom).toBe("counterexample:large");
    }
  });

  it("T469 enforces disjoint held-out validation partitions", () => {
    expect(
      validateValidationPartition({
        development: ["case:dev"],
        validation: ["case:validation"],
        heldOut: ["case:held-out"],
      }).ok,
    ).toBe(true);
    expect(
      validateValidationPartition({
        development: ["case:shared"],
        validation: [],
        heldOut: ["case:shared"],
      }).ok,
    ).toBe(false);
  });

  it("T470 widens grammar only for permitted reasons and never past maxProfile", () => {
    const policy = {
      order: ["G0", "G1", "G2", "G3"] as const,
      permittedReasons: ["no-candidates", "counterexample-stagnation"] as const,
      maxProfile: "G2" as const,
    };
    expect(nextGrammarProfile("G0", "no-candidates", {
      order: [...policy.order],
      permittedReasons: [...policy.permittedReasons],
      maxProfile: policy.maxProfile,
    })).toEqual({ ok: true, value: "G1" });
    expect(nextGrammarProfile("G2", "no-candidates", {
      order: [...policy.order],
      permittedReasons: [...policy.permittedReasons],
      maxProfile: policy.maxProfile,
    })).toEqual({ ok: true, value: "G2" });
    expect(nextGrammarProfile("G1", "expressiveness-gap", {
      order: [...policy.order],
      permittedReasons: [...policy.permittedReasons],
      maxProfile: policy.maxProfile,
    }).ok).toBe(false);
  });

  it("keeps deterministic state expansion ordered and cloned", () => {
    const original: SynthesisState = {
      id: "state:root",
      program: { version: "1", functions: [] },
      openHoles: [],
      obligations: [],
      accumulatedCost: 0,
      depth: 0,
      history: [],
      verifierFacts: [],
    };
    const output = deterministicStateExpansion(
      {
        id: "expand:mock",
        expand() {
          return [
            { ...structuredClone(original), id: "state:b", accumulatedCost: 2 },
            { ...structuredClone(original), id: "state:a", accumulatedCost: 1 },
          ];
        },
      },
      original,
    );
    expect(output.map((state) => state.id)).toEqual(["state:a", "state:b"]);
    output[0]!.verifierFacts.push("mutated");
    expect(original.verifierFacts).toEqual([]);
  });
});
