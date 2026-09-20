import { describe, expect, it } from "vitest";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import type {
  GraphSnapshot,
  QuantityNode,
} from "../../packages/semantic-graph/src/index.ts";
import {
  certifyConversationSurfaceDraft,
} from "../../packages/universal-expression/src/index.ts";

const provenance = ["prov:conversation-cert"] as ProvenanceRef[];

const snapshot = (amount: number): GraphSnapshot => {
  const quantity: QuantityNode = {
    id: "quantity:conversation-cert",
    kind: "quantity",
    schemaVersion: "0.1.0",
    ontologyVersion: "0.1.0",
    provenance: [...provenance],
    trust: "user-content",
    amount,
    unit: "concept:test.file",
    comparator: "at-most",
    approximate: false,
  };
  return {
    schemaVersion: "0.1.0",
    ontologyVersion: "0.1.0",
    revision: `conversation-cert:${amount}`,
    nodes: [quantity],
  };
};

const draft = () => ({
  id: "candidate:vi:1",
  surface: "Dịch vụ không được xóa quá 3 tệp.",
  language: "vi",
  register: "neutral" as const,
  sourceFamily: "direct",
  constructionIds: ["construction:vi:constraint"],
  annotations: {
    sourceFrameId: "frame:vi:1",
  },
});

describe("conversation semantic certification", () => {
  it("mints verified ranking evidence only after deterministic semantic preservation passes", () => {
    const source = snapshot(3);
    const result = certifyConversationSurfaceDraft({
      draft: draft(),
      sourceSemantics: source,
      recoveredCandidateSemantics: structuredClone(source),
      additionalEvidenceRefs: ["evidence:parser:vi:controlled"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.draft.semanticPreservationVerified).toBe(true);
    expect(result.value.draft.semanticEvidenceRefs).toEqual(
      expect.arrayContaining([
        "evidence:semantic-preservation:semantic-preservation.critical-v1@1.0.0",
        "evidence:parser:vi:controlled",
      ]),
    );
    expect(
      result.value.draft.semanticEvidenceRefs.some((ref) =>
        ref.startsWith("evidence:conversation-source-jsg:"),
      ),
    ).toBe(true);
    expect(
      result.value.draft.semanticEvidenceRefs.some((ref) =>
        ref.startsWith("evidence:conversation-recovered-jsg:"),
      ),
    ).toBe(true);
    expect(
      result.value.draft.semanticEvidenceRefs.some((ref) =>
        ref.startsWith("evidence:conversation-surface:"),
      ),
    ).toBe(true);
  });

  it("fails closed when a candidate changes an exact semantic quantity", () => {
    const result = certifyConversationSurfaceDraft({
      draft: draft(),
      sourceSemantics: snapshot(3),
      recoveredCandidateSemantics: snapshot(4),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "EXPRESSION_CONVERSATION_SEMANTIC_DRIFT",
      );
      expect(JSON.stringify(result.error.details)).toContain(
        "SEM_QUANTITY_CHANGED",
      );
    }
  });

  it("binds certification evidence to source graph, recovered graph, and exact surface", () => {
    const source = snapshot(3);
    const first = certifyConversationSurfaceDraft({
      draft: draft(),
      sourceSemantics: source,
      recoveredCandidateSemantics: structuredClone(source),
    });
    const changedSurface = draft();
    changedSurface.surface = "Dịch vụ không được xóa quá ba tệp.";
    const second = certifyConversationSurfaceDraft({
      draft: changedSurface,
      sourceSemantics: source,
      recoveredCandidateSemantics: structuredClone(source),
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.value.digests.sourceSemantics).toBe(
      second.value.digests.sourceSemantics,
    );
    expect(first.value.digests.recoveredCandidateSemantics).toBe(
      second.value.digests.recoveredCandidateSemantics,
    );
    expect(first.value.digests.surface).not.toBe(second.value.digests.surface);
  });

  it("does not accept a bare evidence string as a substitute for a semantic check", () => {
    const result = certifyConversationSurfaceDraft({
      draft: draft(),
      sourceSemantics: snapshot(3),
      recoveredCandidateSemantics: snapshot(5),
      additionalEvidenceRefs: ["evidence:claimed-pass"],
    });

    expect(result.ok).toBe(false);
  });
});
