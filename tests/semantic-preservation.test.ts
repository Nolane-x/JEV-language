import { describe, expect, it } from "vitest";
import type { ProvenanceRef } from "../packages/provenance/src/index.ts";
import type {
  ConstraintNode,
  EntityNode,
  EventNode,
  GraphSnapshot,
  PropositionNode,
  QuantityNode,
  ReferenceNode,
  RelationNode,
  UnknownConceptNode,
} from "../packages/semantic-graph/src/index.ts";
import {
  SemanticPreservationVerifier,
  criticalSemanticPreservationProfile,
  selectAuthoritativeResult,
  strongestEvidenceGrade,
  verifySemanticPreservation,
  type VerificationObligation,
  type VerificationResult,
} from "../packages/verifier-core/src/index.ts";

const provenance = ["prov:test-source"] as ProvenanceRef[];

const snapshot = (nodes: GraphSnapshot["nodes"]): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision: "fixture",
  nodes,
});

const entity = (): EntityNode => ({
  id: "entity:service",
  kind: "entity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  concept: "concept:test.service",
  attributes: [],
  memberships: [],
});

const quantity = (
  amount = 3,
  unit: QuantityNode["unit"] = "concept:test.file",
): QuantityNode => ({
  id: "quantity:limit",
  kind: "quantity",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  amount,
  unit,
  comparator: "at-most",
  approximate: false,
});

const event = (polarity: "positive" | "negative" = "negative"): EventNode => ({
  id: "event:delete",
  kind: "event",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  predicate: "concept:test.delete",
  roles: [],
  polarity,
  modality: { kind: "forbidden" },
});

const proposition = (): PropositionNode => ({
  id: "proposition:requirement",
  kind: "proposition",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  predicate: "concept:test.requirement",
  arguments: [],
  polarity: "positive",
  modality: { kind: "required" },
  attribution: "entity:service",
  scope: { kind: "resolved", scopeId: "scope:root" },
});

const reference = (): ReferenceNode => ({
  id: "reference:target",
  kind: "reference",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  candidates: ["entity:a", "entity:b"],
  resolved: "entity:a",
});

const condition = (): ConstraintNode => ({
  id: "constraint:condition",
  kind: "constraint",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  constraintKind: "condition",
  subject: "event:delete",
  predicate: "concept:test.within-limit",
  parameters: [{ role: "role:test.limit", value: { kind: "ref", ref: "quantity:limit" } }],
});

const causal = (
  source: RelationNode["source"] = "event:a",
  target: RelationNode["target"] = "event:b",
): RelationNode => ({
  id: "relation:cause",
  kind: "relation",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  relation: "concept:test.cause",
  source,
  target,
  polarity: "positive",
});

const unknown = (): UnknownConceptNode => ({
  id: "unknown:term",
  kind: "unknown-concept",
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  provenance: [...provenance],
  trust: "user-content",
  mention: {
    kind: "surface-literal",
    value: "novel-term",
    origin: "parsed-literal",
  },
  expectedParents: ["concept:test.parent"],
  candidateConcepts: ["concept:test.a", "concept:test.b"],
});

const allNodes = (): GraphSnapshot["nodes"] => [
  entity(),
  quantity(),
  event(),
  proposition(),
  reference(),
  condition(),
  causal(),
  unknown(),
];

describe("critical semantic preservation", () => {
  it("passes an unchanged strict snapshot", () => {
    const source = snapshot(allNodes());
    const report = verifySemanticPreservation(source, structuredClone(source));
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it("fails exact quantity/unit drift", () => {
    const source = snapshot([quantity()]);
    const report = verifySemanticPreservation(source, snapshot([quantity(4)]));
    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => v.code)).toContain("SEM_QUANTITY_CHANGED");
  });

  it("fails when a source quantity disappears", () => {
    const report = verifySemanticPreservation(snapshot([quantity()]), snapshot([]));
    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => v.code)).toContain("SEM_QUANTITY_DROPPED");
  });

  it("fails negation reversal", () => {
    const report = verifySemanticPreservation(
      snapshot([event("negative")]),
      snapshot([event("positive")]),
    );
    expect(report.violations.map((v) => v.code)).toContain("SEM_NEGATION_CHANGED");
  });

  it("fails reference resolution drift", () => {
    const changed = reference();
    changed.resolved = "entity:b";
    const report = verifySemanticPreservation(snapshot([reference()]), snapshot([changed]));
    expect(report.violations.map((v) => v.code)).toContain("SEM_REFERENCE_CHANGED");
  });

  it("fails scope, attribution, and modality drift independently", () => {
    const changed = proposition();
    changed.scope = { kind: "underspecified" };
    changed.attribution = "entity:other";
    changed.modality = { kind: "possible" };
    const report = verifySemanticPreservation(
      snapshot([proposition()]),
      snapshot([changed]),
    );
    const codes = report.violations.map((v) => v.code);
    expect(codes).toContain("SEM_SCOPE_CHANGED");
    expect(codes).toContain("SEM_ATTRIBUTION_CHANGED");
    expect(codes).toContain("SEM_MODALITY_CHANGED");
  });

  it("fails semantic condition drift", () => {
    const changed = condition();
    changed.predicate = "concept:test.other";
    const report = verifySemanticPreservation(snapshot([condition()]), snapshot([changed]));
    expect(report.violations.map((v) => v.code)).toContain("SEM_CONDITION_CHANGED");
  });

  it("fails provenance or trust loss", () => {
    const changed = entity();
    changed.provenance = [];
    changed.trust = "untrusted-generated";
    const report = verifySemanticPreservation(snapshot([entity()]), snapshot([changed]));
    expect(report.violations.map((v) => v.code)).toContain("SEM_PROVENANCE_CHANGED");
  });

  it("fails silent narrowing of unresolved concepts", () => {
    const changed = unknown();
    changed.candidateConcepts = ["concept:test.a"];
    const report = verifySemanticPreservation(snapshot([unknown()]), snapshot([changed]));
    expect(report.violations.map((v) => v.code)).toContain("SEM_UNKNOWN_CHANGED");
  });

  it("fails reversed causal direction", () => {
    const report = verifySemanticPreservation(
      snapshot([causal("event:a", "event:b")]),
      snapshot([causal("event:b", "event:a")]),
    );
    expect(report.violations.map((v) => v.code)).toContain(
      "SEM_CAUSAL_DIRECTION_CHANGED",
    );
  });

  it("permits an explicitly relaxed quantity profile without weakening other gates", () => {
    const profile = {
      ...criticalSemanticPreservationProfile,
      id: "test.relaxed-quantity",
      preserveQuantities: "relaxed" as const,
    };
    const changed = event("positive");
    const report = verifySemanticPreservation(
      snapshot([quantity(3), event("negative")]),
      snapshot([quantity(99), changed]),
      profile,
    );
    expect(report.violations.map((v) => v.code)).not.toContain("SEM_QUANTITY_CHANGED");
    expect(report.violations.map((v) => v.code)).toContain("SEM_NEGATION_CHANGED");
  });
});

describe("verification framework", () => {
  const obligation: VerificationObligation = {
    id: "verify:semantic-1",
    kind: "semantic-preservation",
    subject: "artifact:candidate",
    severity: "required",
    verifierCandidates: ["verifier.semantic-preservation"],
    provenance: [...provenance],
  };

  it("executes semantic preservation through the generic verifier ABI", async () => {
    const verifier = new SemanticPreservationVerifier();
    const result = await verifier.verify(
      obligation,
      {
        source: snapshot([quantity(3)]),
        candidate: snapshot([quantity(4)]),
      },
      {},
    );
    expect(result.status).toBe("fail");
    expect(result.verifier.mode).toBe("deterministic");
    expect(result.verifier.evidenceGrade).toBe("formal-deterministic-proof");
  });

  it("keeps evidence strength ordered and never upgrades weak evidence", () => {
    expect(
      strongestEvidenceGrade([
        "jev-judgment",
        "executable-test-evidence",
        "structured-heuristic-evidence",
      ]),
    ).toBe("executable-test-evidence");
    expect(strongestEvidenceGrade([])).toBe("unverified");
  });

  it("gives a determinate deterministic result precedence over Jev judgment", () => {
    const baseResult = (
      mode: VerificationResult["verifier"]["mode"],
      status: VerificationResult["status"],
    ): VerificationResult => ({
      obligationId: obligation.id,
      status,
      evidence: [],
      diagnostics: [],
      verifier: {
        id: "v:" + mode,
        version: "1.0.0",
        mode,
        evidenceGrade:
          mode === "deterministic"
            ? "formal-deterministic-proof"
            : "jev-judgment",
      },
    });
    const chosen = selectAuthoritativeResult([
      baseResult("jev-assisted", "pass"),
      baseResult("deterministic", "fail"),
    ]);
    expect(chosen?.status).toBe("fail");
    expect(chosen?.verifier.mode).toBe("deterministic");
  });
});
