import { describe, expect, it } from "vitest";
import { sha256, type JsonValue, type SemanticId } from "../../packages/core-types/src/index.ts";
import {
  runBenchmark,
  type DatasetManifest,
} from "../../packages/evaluation-core/src/index.ts";
import type { SpanRef } from "../../packages/open-world-values/src/index.ts";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import {
  QuotationContextStack,
  globalAssertionPropositions,
  graphEdges,
  resolveDeicticReference,
  serializeSnapshot,
  deserializeSnapshot,
  type ContextNode,
  type EntityNode,
  type EvidenceNode,
  type GraphSnapshot,
  type LocationNode,
  type PropositionNode,
  type ReferenceNode,
  type TemporalNode,
} from "../../packages/semantic-graph/src/index.ts";
import { validateSnapshot } from "../../packages/semantic-validator/src/index.ts";
import { verifySemanticPreservation } from "../../packages/verifier-core/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;
const provenance = ["prov:t331"] as ProvenanceRef[];
const common = {
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance,
  trust: "user-content" as const,
};

const entity = (id: string): EntityNode => ({
  ...common,
  provenance: [...provenance],
  id: sid(id),
  kind: "entity",
  concept: sid("concept:core.person"),
  attributes: [],
  memberships: [],
});

const time = (id: string, iso: string): TemporalNode => ({
  ...common,
  provenance: [...provenance],
  id: sid(id),
  kind: "temporal",
  temporalKind: "instant",
  value: { iso },
  start: iso,
  end: iso,
  granularity: "second",
});

const location = (id: string): LocationNode => ({
  ...common,
  provenance: [...provenance],
  id: sid(id),
  kind: "location",
  locationKind: "physical",
  value: {
    kind: "structured",
    fields: {
      label: {
        kind: "string",
        value: {
          kind: "surface-literal",
          value: id,
          origin: "parsed-literal",
        },
      },
    },
  },
});

const proposition = (
  id: string,
  input: Partial<PropositionNode> = {},
): PropositionNode => ({
  ...common,
  provenance: [...provenance],
  id: sid(id),
  kind: "proposition",
  predicate: sid("concept:test.claim"),
  arguments: [],
  polarity: "positive",
  ...input,
});

const snapshot = (
  nodes: GraphSnapshot["nodes"],
  revision = "rev:t331",
): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision,
  nodes,
});

const sourceSpan: SpanRef = {
  sourceId: "source:t331",
  sourceVersion: "1",
  coordinateSystem: "utf16",
  start: 0,
  end: 12,
  digest: sha256("t331 quote"),
};

describe("T331-T340 deixis, attitudes, and evidence conformance", () => {
  it("T331-T332 resolves person/spatial/temporal/discourse/social deixis against context", () => {
    const speaker = entity("entity:speaker");
    const addressee = entity("entity:addressee");
    const honorificTarget = entity("entity:honorific-target");
    const now = time("temporal:now", "2026-09-19T15:30:00Z");
    const here = location("location:here");
    const focus = proposition("proposition:focus");

    const context: ContextNode = {
      ...common,
      provenance: [...provenance],
      id: sid("context:deictic"),
      kind: "context",
      contextKind: "deictic",
      deictic: {
        speaker: speaker.id,
        addressee: addressee.id,
        speakerTime: now.id,
        speakerLocation: here.id,
        discourseTime: now.id,
        discourseFocus: focus.id,
        participantPerspective: speaker.id,
        socialAnchors: [
          {
            relation: "honorific-target",
            participant: honorificTarget.id,
          },
        ],
      },
    };

    const refs: ReferenceNode[] = [
      {
        ...common,
        provenance: [...provenance],
        id: sid("reference:I"),
        kind: "reference",
        candidates: [speaker.id],
        deictic: {
          kind: "person",
          context: context.id,
          anchorRole: "speaker",
        },
      },
      {
        ...common,
        provenance: [...provenance],
        id: sid("reference:here"),
        kind: "reference",
        candidates: [here.id],
        deictic: {
          kind: "spatial",
          context: context.id,
          anchorRole: "speaker-location",
        },
      },
      {
        ...common,
        provenance: [...provenance],
        id: sid("reference:now"),
        kind: "reference",
        candidates: [now.id],
        deictic: {
          kind: "temporal",
          context: context.id,
          anchorRole: "speaker-time",
        },
      },
      {
        ...common,
        provenance: [...provenance],
        id: sid("reference:this"),
        kind: "reference",
        candidates: [focus.id],
        deictic: {
          kind: "discourse",
          context: context.id,
          anchorRole: "discourse-focus",
        },
      },
      {
        ...common,
        provenance: [...provenance],
        id: sid("reference:honorific"),
        kind: "reference",
        candidates: [honorificTarget.id],
        deictic: {
          kind: "social",
          context: context.id,
          anchorRole: "social-anchor",
          socialRelation: "honorific-target",
        },
      },
    ];

    const graph = snapshot([
      speaker,
      addressee,
      honorificTarget,
      now,
      here,
      focus,
      context,
      ...refs,
    ]);
    expect(validateSnapshot(graph)).toEqual([]);

    const expected = new Map([
      ["reference:I", speaker.id],
      ["reference:here", here.id],
      ["reference:now", now.id],
      ["reference:this", focus.id],
      ["reference:honorific", honorificTarget.id],
    ]);

    for (const ref of refs) {
      const resolved = resolveDeicticReference(graph, ref.id);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.value.status).toBe("resolved");
        expect(resolved.value.resolved).toBe(expected.get(ref.id));
      }
    }
  });

  it("T333 maintains a nested quotation context stack with shifted speaker/addressee/time/location", () => {
    const outerSpeaker = entity("entity:outer-speaker");
    const innerSpeaker = entity("entity:inner-speaker");
    const addressee = entity("entity:quote-addressee");
    const outerTime = time("temporal:outer", "2026-09-19T10:00:00Z");
    const innerTime = time("temporal:inner", "2026-09-18T09:00:00Z");
    const outerLocation = location("location:outer");
    const innerLocation = location("location:inner");

    const outer: ContextNode = {
      ...common,
      provenance: [...provenance],
      id: sid("context:quote-outer"),
      kind: "context",
      contextKind: "quotation",
      deictic: {
        speaker: outerSpeaker.id,
        addressee: addressee.id,
        speakerTime: outerTime.id,
        speakerLocation: outerLocation.id,
      },
      quotation: {
        mode: "direct",
        quotedSpeaker: outerSpeaker.id,
        quotedAddressee: addressee.id,
        quotedTimeAnchor: outerTime.id,
        quotedLocationAnchor: outerLocation.id,
        sourceSpan,
        attributionConfidence: 0.99,
        exactWording: true,
      },
    };

    const inner: ContextNode = {
      ...common,
      provenance: [...provenance],
      id: sid("context:quote-inner"),
      kind: "context",
      contextKind: "quotation",
      parentContext: outer.id,
      deictic: {
        speaker: innerSpeaker.id,
        addressee: outerSpeaker.id,
        speakerTime: innerTime.id,
        speakerLocation: innerLocation.id,
      },
      quotation: {
        mode: "direct",
        quotedSpeaker: innerSpeaker.id,
        quotedAddressee: outerSpeaker.id,
        quotedTimeAnchor: innerTime.id,
        quotedLocationAnchor: innerLocation.id,
        sourceSpan: { ...sourceSpan, start: 2, end: 10 },
        attributionConfidence: 0.96,
        exactWording: true,
      },
    };

    const stack = new QuotationContextStack();
    expect(stack.push(outer).ok).toBe(true);
    expect(stack.push(inner).ok).toBe(true);
    expect(stack.current()?.id).toBe(inner.id);
    expect(stack.snapshot().map((frame) => frame.id)).toEqual([
      outer.id,
      inner.id,
    ]);
    expect(stack.pop()?.id).toBe(inner.id);
    expect(stack.current()?.id).toBe(outer.id);
  });

  it("T334 distinguishes indirect speech from exact direct quotation", () => {
    const reporter = entity("entity:reporter");
    const source = entity("entity:reported-speaker");
    const indirect: ContextNode = {
      ...common,
      provenance: [...provenance],
      id: sid("context:indirect"),
      kind: "context",
      contextKind: "quotation",
      quotation: {
        mode: "indirect",
        quotedSpeaker: source.id,
        reporter: reporter.id,
        attributionConfidence: 0.8,
        exactWording: false,
      },
    };

    expect(validateSnapshot(snapshot([reporter, source, indirect]))).toEqual([]);

    const falseExact: ContextNode = {
      ...indirect,
      id: sid("context:false-exact"),
      quotation: {
        ...indirect.quotation!,
        exactWording: true,
      },
    };
    expect(
      validateSnapshot(snapshot([reporter, source, falseExact])).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("JSG096_INDIRECT_SPEECH_EXACTNESS_FORBIDDEN");
  });

  it("T335-T336 isolates embedded attitude content from global assertions", () => {
    const mina = entity("entity:mina");
    const embedded = proposition("proposition:server-offline", {
      epistemic: {
        status: "believed",
        commitment: "believed-by-agent",
        source: mina.id,
      },
      context: sid("context:mina-belief"),
    });
    const belief: ContextNode = {
      ...common,
      provenance: [...provenance],
      id: sid("context:mina-belief"),
      kind: "context",
      contextKind: "attitude",
      attitude: {
        holder: mina.id,
        attitude: "believe",
        contentRefs: [embedded.id],
        factive: false,
      },
    };
    const global = proposition("proposition:service-checked", {
      epistemic: {
        status: "verified",
        commitment: "verified",
      },
    });

    const graph = snapshot([mina, belief, embedded, global]);
    expect(validateSnapshot(graph)).toEqual([]);
    expect(globalAssertionPropositions(graph).map((node) => node.id)).toEqual([
      global.id,
    ]);

    const edges = graphEdges(graph);
    expect(
      edges.some(
        (edge) =>
          edge.source === belief.id &&
          edge.target === embedded.id &&
          edge.label === "context.attitude-content",
      ),
    ).toBe(true);
    expect(
      edges.some(
        (edge) =>
          edge.source === embedded.id &&
          edge.target === belief.id &&
          edge.label === "proposition.context",
      ),
    ).toBe(true);
  });

  it("T337-T338 keeps evidential source mode, epistemic confidence, and provenance independent", () => {
    const tool = entity("entity:tool");
    const claim = proposition("proposition:tool-claim");
    const toolEvidence: EvidenceNode = {
      ...common,
      provenance: ["prov:tool-output"] as ProvenanceRef[],
      id: sid("evidence:tool"),
      kind: "evidence",
      supports: [claim.id],
      contradicts: [],
      payload: { kind: "boolean", value: true },
      confidence: {
        source: "rule",
        probability: 0.97,
      },
      evidentiality: {
        mode: "document-tool-result",
        source: tool.id,
        sourceDetail: "compiler diagnostic adapter",
      },
    };
    const userEvidence: EvidenceNode = {
      ...common,
      provenance: ["prov:user-assertion"] as ProvenanceRef[],
      id: sid("evidence:user"),
      kind: "evidence",
      supports: [claim.id],
      contradicts: [],
      payload: { kind: "boolean", value: true },
      evidentiality: {
        mode: "user-assertion",
      },
    };

    const graph = snapshot([tool, claim, toolEvidence, userEvidence]);
    expect(validateSnapshot(graph)).toEqual([]);
    expect(toolEvidence.evidentiality?.mode).toBe("document-tool-result");
    expect(toolEvidence.confidence?.probability).toBe(0.97);
    expect(toolEvidence.provenance).toEqual(["prov:tool-output"]);
    expect(userEvidence.confidence).toBeUndefined();
    expect(userEvidence.provenance).toEqual(["prov:user-assertion"]);
  });

  it("T339 validates nested attribution and detects preservation drift", () => {
    const reporter = entity("entity:nested-reporter");
    const quoted = entity("entity:nested-quoted");
    const holder = entity("entity:nested-holder");
    const quoteTime = time("temporal:nested-quote", "2026-09-18T09:00:00Z");

    const quote: ContextNode = {
      ...common,
      provenance: [...provenance],
      id: sid("context:nested-quote"),
      kind: "context",
      contextKind: "quotation",
      deictic: {
        speaker: quoted.id,
        addressee: reporter.id,
        speakerTime: quoteTime.id,
      },
      quotation: {
        mode: "direct",
        quotedSpeaker: quoted.id,
        quotedAddressee: reporter.id,
        quotedTimeAnchor: quoteTime.id,
        reporter: reporter.id,
        sourceSpan,
        attributionConfidence: 0.9,
        exactWording: true,
      },
    };

    const embedded = proposition("proposition:nested-belief", {
      context: sid("context:nested-attitude"),
      attribution: quoted.id,
      epistemic: {
        status: "believed",
        source: holder.id,
        commitment: "believed-by-agent",
      },
    });

    const attitude: ContextNode = {
      ...common,
      provenance: [...provenance],
      id: sid("context:nested-attitude"),
      kind: "context",
      contextKind: "attitude",
      parentContext: quote.id,
      attitude: {
        holder: holder.id,
        attitude: "suspect",
        contentRefs: [embedded.id],
      },
    };

    const sourceGraph = snapshot([
      reporter,
      quoted,
      holder,
      quoteTime,
      quote,
      attitude,
      embedded,
    ]);
    expect(validateSnapshot(sourceGraph)).toEqual([]);

    const roundTrip = deserializeSnapshot(serializeSnapshot(sourceGraph));
    expect(roundTrip.ok).toBe(true);
    if (roundTrip.ok) {
      expect(serializeSnapshot(roundTrip.value)).toBe(
        serializeSnapshot(sourceGraph),
      );
    }

    const candidate = structuredClone(sourceGraph);
    const candidateQuote = candidate.nodes.find(
      (node): node is ContextNode =>
        node.kind === "context" && node.id === quote.id,
    );
    expect(candidateQuote).toBeDefined();
    if (candidateQuote?.quotation !== undefined) {
      candidateQuote.quotation.quotedSpeaker = reporter.id;
    }
    const preservation = verifySemanticPreservation(sourceGraph, candidate);
    expect(preservation.ok).toBe(false);
    expect(preservation.violations.map((item) => item.code)).toContain(
      "SEM_CONTEXT_CHANGED",
    );
  });

  it("rejects attitude content that is not explicitly isolated in its context", () => {
    const holder = entity("entity:bad-holder");
    const content = proposition("proposition:bad-content");
    const context: ContextNode = {
      ...common,
      provenance: [...provenance],
      id: sid("context:bad-attitude"),
      kind: "context",
      contextKind: "attitude",
      attitude: {
        holder: holder.id,
        attitude: "believe",
        contentRefs: [content.id],
      },
    };

    expect(
      validateSnapshot(snapshot([holder, content, context])).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain("JSG099_ATTITUDE_CONTEXT_ISOLATION_INVALID");
  });

  it("T340 benchmarks deictic shift, quotation exactness, and belief isolation", async () => {
    const alice = entity("entity:alice");
    const bob = entity("entity:bob");
    const outerTime = time("temporal:benchmark-outer", "2026-09-19T12:00:00Z");
    const innerTime = time("temporal:benchmark-inner", "2026-09-18T08:00:00Z");

    const outerContext: ContextNode = {
      ...common,
      provenance: [...provenance],
      id: sid("context:benchmark-outer"),
      kind: "context",
      contextKind: "deictic",
      deictic: {
        speaker: alice.id,
        addressee: bob.id,
        speakerTime: outerTime.id,
      },
    };
    const innerContext: ContextNode = {
      ...common,
      provenance: [...provenance],
      id: sid("context:benchmark-inner"),
      kind: "context",
      contextKind: "quotation",
      parentContext: outerContext.id,
      deictic: {
        speaker: bob.id,
        addressee: alice.id,
        speakerTime: innerTime.id,
      },
      quotation: {
        mode: "direct",
        quotedSpeaker: bob.id,
        quotedAddressee: alice.id,
        quotedTimeAnchor: innerTime.id,
        sourceSpan,
        exactWording: true,
      },
    };
    const outerI: ReferenceNode = {
      ...common,
      provenance: [...provenance],
      id: sid("reference:benchmark-outer-I"),
      kind: "reference",
      candidates: [alice.id],
      deictic: {
        kind: "person",
        context: outerContext.id,
        anchorRole: "speaker",
      },
    };
    const innerI: ReferenceNode = {
      ...common,
      provenance: [...provenance],
      id: sid("reference:benchmark-inner-I"),
      kind: "reference",
      candidates: [bob.id],
      deictic: {
        kind: "person",
        context: innerContext.id,
        anchorRole: "speaker",
      },
    };

    const badIndirect: ContextNode = {
      ...common,
      provenance: [...provenance],
      id: sid("context:benchmark-bad-indirect"),
      kind: "context",
      contextKind: "quotation",
      quotation: {
        mode: "indirect",
        quotedSpeaker: bob.id,
        reporter: alice.id,
        exactWording: true,
      },
    };

    const embedded = proposition("proposition:benchmark-belief", {
      context: sid("context:benchmark-attitude"),
      epistemic: {
        status: "believed",
        commitment: "believed-by-agent",
        source: bob.id,
      },
    });
    const attitude: ContextNode = {
      ...common,
      provenance: [...provenance],
      id: sid("context:benchmark-attitude"),
      kind: "context",
      contextKind: "attitude",
      attitude: {
        holder: bob.id,
        attitude: "believe",
        contentRefs: [embedded.id],
      },
    };
    const asserted = proposition("proposition:benchmark-global", {
      epistemic: {
        status: "asserted",
        commitment: "asserted-by-speaker",
        source: alice.id,
      },
    });

    const shiftGraph = snapshot([
      alice,
      bob,
      outerTime,
      innerTime,
      outerContext,
      innerContext,
      outerI,
      innerI,
    ]);
    const badIndirectGraph = snapshot([alice, bob, badIndirect]);
    const beliefGraph = snapshot([alice, bob, attitude, embedded, asserted]);

    const cases = [
      {
        id: "deictic-shift",
        evaluate: () => {
          const outer = resolveDeicticReference(shiftGraph, outerI.id);
          const inner = resolveDeicticReference(shiftGraph, innerI.id);
          return (
            outer.ok &&
            inner.ok &&
            outer.value.resolved === alice.id &&
            inner.value.resolved === bob.id
          );
        },
      },
      {
        id: "indirect-not-exact",
        evaluate: () =>
          validateSnapshot(badIndirectGraph).some(
            (item) =>
              item.code === "JSG096_INDIRECT_SPEECH_EXACTNESS_FORBIDDEN",
          ),
      },
      {
        id: "belief-not-global-fact",
        evaluate: () =>
          globalAssertionPropositions(beliefGraph).map((node) => node.id).join(",") ===
          asserted.id,
      },
    ];

    const dataset: DatasetManifest = {
      schemaVersion: "jl-eval-dataset-1",
      id: "t340-deictic-shift-quotation",
      version: "1.0.0",
      domain: "semantic",
      split: "test",
      itemCount: cases.length,
      contentDigest: "sha256:t340-deictic-shift-quotation",
      labelsProvenance: "deterministic-derived",
      tags: ["T340", "deixis", "quotation", "attitude", "evidentiality"],
      heldOutCombinations: true,
    };

    const report = await runBenchmark({
      benchmarkId: "t340-deictic-shift-quotation",
      benchmarkVersion: "1.0.0",
      dataset,
      cases,
      evaluate(testCase) {
        const passed = testCase.evaluate();
        return {
          status: passed ? "pass" : "fail",
          metrics: { semanticCorrectness: passed ? 1 : 0 },
          metadata: {
            category: testCase.id,
          } as Record<string, JsonValue>,
        };
      },
    });

    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.summary).toMatchObject({
        cases: 3,
        passed: 3,
        failed: 0,
        unknown: 0,
        passRate: 1,
      });
    }
  });
});
