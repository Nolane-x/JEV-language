import { describe, expect, it } from "vitest";
import { err, ok, StructuredError } from "../../packages/core-types/src/index.ts";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import type { GraphSnapshot, QuantityNode } from "../../packages/semantic-graph/src/index.ts";
import { certifyConversationSurfaceDraftFromParser } from "../../packages/universal-expression/src/index.ts";

const provenance = ["prov:conversation-parser-cert"] as ProvenanceRef[];

const snapshot = (amount: number): GraphSnapshot => {
  const quantity: QuantityNode = {
    id: "quantity:conversation-parser-cert",
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
    revision: `conversation-parser-cert:${amount}`,
    nodes: [quantity],
  };
};

const draft = () => ({
  id: "candidate:parser-bound:1",
  surface: "Dịch vụ không được xóa quá 3 tệp.",
  language: "vi",
  register: "neutral" as const,
  sourceFamily: "direct",
  constructionIds: ["construction:vi:constraint"],
});

describe("parser-bound conversation semantic certification", () => {
  it("parses the exact candidate surface before semantic certification", async () => {
    const source = snapshot(3);
    const seen: Array<{ surface: string; language: string }> = [];
    const result = await certifyConversationSurfaceDraftFromParser({
      draft: draft(),
      sourceSemantics: source,
      parserIdentity: { id: "parser.vi.controlled", version: "1.2.0" },
      parser(surface, language) {
        seen.push({ surface, language });
        return ok(structuredClone(source));
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen).toEqual([{
      surface: "Dịch vụ không được xóa quá 3 tệp.",
      language: "vi",
    }]);
    expect(result.value.draft.semanticPreservationVerified).toBe(true);
    expect(result.value.parser).toEqual({
      id: "parser.vi.controlled",
      version: "1.2.0",
    });
    expect(result.value.draft.semanticEvidenceRefs).toContain(
      "evidence:conversation-parser:parser.vi.controlled@1.2.0",
    );
  });

  it("fails closed when the exact surface cannot be parsed", async () => {
    const result = await certifyConversationSurfaceDraftFromParser({
      draft: draft(),
      sourceSemantics: snapshot(3),
      parserIdentity: { id: "parser.vi.controlled", version: "1.2.0" },
      parser() {
        return err(new StructuredError("PARSER_UNSUPPORTED", "Unsupported surface."));
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXPRESSION_CONVERSATION_PARSE_FAILED");
      expect(JSON.stringify(result.error.details)).toContain("PARSER_UNSUPPORTED");
    }
  });

  it("rejects semantic drift even when parsing itself succeeds", async () => {
    const result = await certifyConversationSurfaceDraftFromParser({
      draft: draft(),
      sourceSemantics: snapshot(3),
      parserIdentity: { id: "parser.vi.controlled", version: "1.2.0" },
      parser() {
        return ok(snapshot(4));
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXPRESSION_CONVERSATION_SEMANTIC_DRIFT");
      expect(JSON.stringify(result.error.details)).toContain("SEM_QUANTITY_CHANGED");
    }
  });

  it("normalizes parser throws into a stable certification error", async () => {
    const result = await certifyConversationSurfaceDraftFromParser({
      draft: draft(),
      sourceSemantics: snapshot(3),
      parserIdentity: { id: "parser.vi.controlled", version: "1.2.0" },
      parser() {
        throw new Error("parser crashed");
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXPRESSION_CONVERSATION_PARSE_THROW");
      expect(JSON.stringify(result.error.details)).toContain("parser crashed");
    }
  });

  it("supports asynchronous parsers without weakening the same gate", async () => {
    const source = snapshot(3);
    const result = await certifyConversationSurfaceDraftFromParser({
      draft: draft(),
      sourceSemantics: source,
      parserIdentity: { id: "parser.vi.async", version: "0.3.0" },
      async parser() {
        return ok(structuredClone(source));
      },
      additionalEvidenceRefs: ["evidence:parse-profile:vi-controlled"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.semanticEvidenceRefs).toEqual(
      expect.arrayContaining([
        "evidence:conversation-parser:parser.vi.async@0.3.0",
        "evidence:parse-profile:vi-controlled",
      ]),
    );
  });
});
