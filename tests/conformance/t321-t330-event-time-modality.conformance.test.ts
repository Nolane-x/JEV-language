import { describe, expect, it } from "vitest";
import type { SemanticId } from "../../packages/core-types/src/index.ts";
import {
  runBenchmark,
  type DatasetManifest,
} from "../../packages/evaluation-core/src/index.ts";
import type {
  TemporalAspectProvider,
} from "../../packages/language-pack-core/src/index.ts";
import { createCoreOntology } from "../../packages/ontology/src/index.ts";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import {
  TemporalObjectRegistry,
  deserializeSnapshot,
  eventOccurrenceIdentity,
  serializeSnapshot,
  validateTemporalModalGraph,
  type ConstraintNode,
  type EventNode,
  type GraphSnapshot,
  type PropositionNode,
  type TemporalNode,
} from "../../packages/semantic-graph/src/index.ts";
import { validateSnapshot } from "../../packages/semantic-validator/src/index.ts";
import { verifySemanticPreservation } from "../../packages/verifier-core/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;
const provenance = ["prov:t321"] as ProvenanceRef[];

const common = {
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance,
  trust: "user-content" as const,
};

const proposition = (id: string): PropositionNode => ({
  ...common,
  provenance: [...provenance],
  id: sid(id),
  kind: "proposition",
  predicate: sid("concept:test.proposition"),
  arguments: [],
  polarity: "positive",
});

const instant = (
  id: string,
  iso: string,
): TemporalNode => ({
  ...common,
  provenance: [...provenance],
  id: sid(id),
  kind: "temporal",
  temporalKind: "instant",
  value: { iso },
  start: iso,
  end: iso,
  granularity: "second",
  calendar: "iso8601",
});

const interval = (
  id: string,
  start: string,
  end: string,
): TemporalNode => ({
  ...common,
  provenance: [...provenance],
  id: sid(id),
  kind: "temporal",
  temporalKind: "interval",
  value: { start, end },
  start,
  end,
  granularity: "second",
  calendar: "iso8601",
});

const event = (
  id: string,
  temporal: SemanticId,
  input: Partial<EventNode> = {},
): EventNode => ({
  ...common,
  provenance: [...provenance],
  id: sid(id),
  kind: "event",
  predicate: sid("concept:core.activity"),
  eventClass: sid("concept:core.activity"),
  eventCategory: "activity",
  eventMode: "episodic",
  roles: [],
  temporal,
  aspect: "progressive",
  polarity: "positive",
  ...input,
});

const condition = (
  id: string,
  antecedent: SemanticId,
  consequent: SemanticId,
  input: Partial<ConstraintNode["conditional"]> = {},
): ConstraintNode => ({
  ...common,
  provenance: [...provenance],
  id: sid(id),
  kind: "constraint",
  constraintKind: "condition",
  subject: antecedent,
  predicate: sid("concept:core.condition"),
  parameters: [],
  conditional: {
    kind: "predictive",
    antecedent,
    consequent,
    temporalRelation: "before",
    ...input,
  },
});

const snapshot = (
  nodes: GraphSnapshot["nodes"],
  revision = "rev:t321",
): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision,
  nodes,
});

describe("T321-T330 event/time/modality/conditional conformance", () => {
  it("T321 refines the core event ontology without collapsing process/transition classes", () => {
    const ontology = createCoreOntology();
    expect(
      ontology.isA(
        sid("concept:core.process"),
        sid("concept:core.event"),
      ),
    ).toBe(true);
    expect(
      ontology.isA(
        sid("concept:core.transition"),
        sid("concept:core.event"),
      ),
    ).toBe(true);
    expect(
      ontology.isA(
        sid("concept:core.achievement"),
        sid("concept:core.transition"),
      ),
    ).toBe(true);
    expect(
      ontology.isA(
        sid("concept:core.activity"),
        sid("concept:core.process"),
      ),
    ).toBe(true);
  });

  it("T322 keeps event-token identity separate from event class/type", () => {
    const time = instant("temporal:build", "2026-09-19T15:00:00Z");
    const occurrence = event("event:build-20260919-001", time.id);
    expect(eventOccurrenceIdentity(occurrence)).toEqual({
      token: sid("event:build-20260919-001"),
      eventClass: sid("concept:core.activity"),
    });
    expect(occurrence.id).not.toBe(occurrence.eventClass);

    const collapsed = event("event:collapsed", time.id, {
      eventClass: sid("event:collapsed"),
    });
    expect(
      validateTemporalModalGraph(snapshot([time, collapsed])).map(
        (entry) => entry.code,
      ),
    ).toContain("JSG080_EVENT_TYPE_TOKEN_COLLAPSED");
  });

  it("T323 registers temporal objects transactionally and rejects invalid intervals", () => {
    const registry = new TemporalObjectRegistry();
    const start = instant("temporal:start", "2026-09-19T15:00:00Z");
    const window = interval(
      "temporal:window",
      "2026-09-19T15:00:00Z",
      "2026-09-19T16:00:00Z",
    );

    expect(registry.register(start).ok).toBe(true);
    expect(registry.register(window).ok).toBe(true);
    expect(registry.register(window).ok).toBe(false);
    expect(registry.list().map((entry) => entry.id)).toEqual([
      sid("temporal:start"),
      sid("temporal:window"),
    ]);

    const reversed = interval(
      "temporal:reversed",
      "2026-09-19T17:00:00Z",
      "2026-09-19T16:00:00Z",
    );
    expect(registry.register(reversed).ok).toBe(false);
  });

  it("T324 enforces interval-relation endpoints, inverses, and hard conflicts", () => {
    const registry = new TemporalObjectRegistry();
    const a = instant("temporal:a", "2026-09-19T15:00:00Z");
    const b = instant("temporal:b", "2026-09-19T16:00:00Z");
    expect(registry.register(a).ok).toBe(true);
    expect(registry.register(b).ok).toBe(true);

    expect(
      registry.addConstraint({
        id: "temporal-constraint:a-before-b",
        left: a.id,
        relation: "before",
        right: b.id,
        status: "asserted",
      }).ok,
    ).toBe(true);
    expect(
      registry.addConstraint({
        id: "temporal-constraint:b-after-a",
        left: b.id,
        relation: "after",
        right: a.id,
        status: "derived",
      }).ok,
    ).toBe(true);
    expect(
      registry.addConstraint({
        id: "temporal-constraint:b-before-a",
        left: b.id,
        relation: "before",
        right: a.id,
        status: "asserted",
      }).ok,
    ).toBe(false);
  });

  it("T325-T326 keeps grammatical tense separate from semantic time and maps aspect explicitly", () => {
    const provider: TemporalAspectProvider = {
      id: "test.temporal-aspect",
      language: "en",
      mapTense(input) {
        return {
          tense: input.tense,
          ...(input.semanticTimeRef === undefined
            ? {}
            : { semanticTimeRef: input.semanticTimeRef }),
          ...(input.deicticAnchorRef === undefined
            ? {}
            : { deicticAnchorRef: input.deicticAnchorRef }),
        };
      },
      mapAspect(input) {
        return {
          semanticAspect: input.semanticAspect,
          languageFeatures:
            input.semanticAspect === "progressive"
              ? { auxiliary: "be", participle: "present" }
              : {},
        };
      },
    };

    const timeRef = sid("temporal:semantic-time");
    expect(
      provider.mapTense({
        tense: "past",
        semanticTimeRef: timeRef,
      }),
    ).toEqual({
      tense: "past",
      semanticTimeRef: timeRef,
    });
    expect(
      provider.mapAspect({
        semanticAspect: "progressive",
        eventCategory: "activity",
      }),
    ).toEqual({
      semanticAspect: "progressive",
      languageFeatures: {
        auxiliary: "be",
        participle: "present",
      },
    });
  });

  it("T327 represents modal dimension/ordinal strength separately from calibrated probability", () => {
    const time = instant("temporal:modal", "2026-09-19T15:00:00Z");
    const source = proposition("proposition:authority");
    const modalEvent = event("event:deploy", time.id, {
      modality: {
        kind: "possible",
        dimension: "epistemic",
        operator: "may",
        ordinalStrength: "possible",
        source: source.id,
        calibratedProbability: 0.62,
      },
    });
    expect(validateSnapshot(snapshot([time, source, modalEvent]))).toEqual([]);

    const invalid = event("event:bad-modal", time.id, {
      modality: {
        kind: "possible",
        dimension: "epistemic",
        ordinalStrength: "possible",
        calibratedProbability: 1.4,
      },
    });
    expect(
      validateSnapshot(snapshot([time, invalid])).map((entry) => entry.code),
    ).toContain("JSG073_MODAL_PROBABILITY_INVALID");
  });

  it("T328-T329 preserves conditional variants and counterfactual metadata", () => {
    const antecedent = proposition("proposition:test-passed");
    const consequent = proposition("proposition:deploy-continued");
    const counterfactual = condition(
      "constraint:counterfactual",
      antecedent.id,
      consequent.id,
      {
        kind: "counterfactual",
        modality: {
          kind: "counterfactual",
          dimension: "alethic",
          ordinalStrength: "unlikely",
        },
        counterfactual: {
          antecedentStatus: "contrary-to-fact",
          consequentStatus: "remote",
        },
      },
    );
    const good = snapshot([antecedent, consequent, counterfactual]);
    expect(validateSnapshot(good)).toEqual([]);

    const bad = condition(
      "constraint:counterfactual-missing-metadata",
      antecedent.id,
      consequent.id,
      { kind: "counterfactual" },
    );
    expect(
      validateSnapshot(snapshot([antecedent, consequent, bad])).map(
        (entry) => entry.code,
      ),
    ).toContain("JSG077_COUNTERFACTUAL_METADATA_REQUIRED");

    const serialized = serializeSnapshot(good);
    const restored = deserializeSnapshot(serialized);
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(serializeSnapshot(restored.value)).toBe(serialized);
    }
  });

  it("semantic preservation detects event temporal/type and conditional semantic drift", () => {
    const time = instant("temporal:preserve", "2026-09-19T15:00:00Z");
    const antecedent = proposition("proposition:antecedent");
    const consequent = proposition("proposition:consequent");
    const occurrence = event("event:preserve", time.id);
    const guard = condition(
      "constraint:preserve",
      antecedent.id,
      consequent.id,
      {
        kind: "counterfactual",
        counterfactual: {
          antecedentStatus: "remote",
        },
      },
    );
    const source = snapshot([time, antecedent, consequent, occurrence, guard]);
    const candidate = structuredClone(source);
    const candidateEvent = candidate.nodes.find(
      (node): node is EventNode => node.kind === "event",
    );
    const candidateGuard = candidate.nodes.find(
      (node): node is ConstraintNode => node.kind === "constraint",
    );
    expect(candidateEvent).toBeDefined();
    expect(candidateGuard).toBeDefined();
    if (candidateEvent === undefined || candidateGuard === undefined) return;

    candidateEvent.aspect = "perfective";
    if (candidateGuard.conditional !== undefined) {
      candidateGuard.conditional.kind = "hypothetical";
    }

    const report = verifySemanticPreservation(source, candidate);
    expect(report.ok).toBe(false);
    expect(report.violations.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "SEM_EVENT_TEMPORAL_CHANGED",
        "SEM_CONDITION_CHANGED",
      ]),
    );
  });

  it("T330 runs a deterministic temporal/modal/counterfactual adversarial benchmark", async () => {
    const validTime = interval(
      "temporal:valid-window",
      "2026-09-19T15:00:00Z",
      "2026-09-19T16:00:00Z",
    );
    const a = proposition("proposition:a");
    const b = proposition("proposition:b");
    const validEvent = event("event:valid", validTime.id, {
      modality: {
        kind: "probable",
        dimension: "predictive",
        ordinalStrength: "likely",
      },
    });
    const validConditional = condition(
      "constraint:valid-predictive",
      a.id,
      b.id,
      { kind: "predictive" },
    );

    const reversed = interval(
      "temporal:bad-window",
      "2026-09-19T17:00:00Z",
      "2026-09-19T16:00:00Z",
    );
    const badCounterfactual = condition(
      "constraint:bad-counterfactual",
      a.id,
      b.id,
      { kind: "counterfactual" },
    );

    const cases = [
      {
        id: "valid-temporal-modal",
        graph: snapshot([validTime, validEvent]),
        expectedValid: true,
      },
      {
        id: "valid-predictive-condition",
        graph: snapshot([a, b, validConditional]),
        expectedValid: true,
      },
      {
        id: "reversed-interval",
        graph: snapshot([reversed]),
        expectedValid: false,
      },
      {
        id: "counterfactual-without-metadata",
        graph: snapshot([a, b, badCounterfactual]),
        expectedValid: false,
      },
    ];

    const dataset: DatasetManifest = {
      schemaVersion: "jl-eval-dataset-1",
      id: "t330-temporal-modal-roundtrip",
      version: "1.0.0",
      domain: "semantic",
      split: "test",
      itemCount: cases.length,
      contentDigest: "sha256:t330-temporal-modal-roundtrip",
      labelsProvenance: "deterministic-derived",
      tags: ["T330", "temporal", "modality", "conditional", "counterfactual"],
      heldOutCombinations: true,
    };

    const report = await runBenchmark({
      benchmarkId: "t330-temporal-modal-roundtrip",
      benchmarkVersion: "1.0.0",
      dataset,
      cases,
      evaluate(benchmarkCase) {
        const diagnostics = validateSnapshot(benchmarkCase.graph);
        const observedValid = !diagnostics.some(
          (item) => item.severity === "error" || item.severity === "fatal",
        );
        const roundTrip = deserializeSnapshot(
          serializeSnapshot(benchmarkCase.graph),
        );
        return {
          status:
            observedValid === benchmarkCase.expectedValid && roundTrip.ok
              ? "pass"
              : "fail",
          metrics: {
            correctDiagnosis:
              observedValid === benchmarkCase.expectedValid ? 1 : 0,
            structuralRoundTrip: roundTrip.ok ? 1 : 0,
          },
        };
      },
    });

    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.summary).toMatchObject({
        cases: 4,
        passed: 4,
        failed: 0,
        unknown: 0,
        passRate: 1,
      });
    }
  });
});
