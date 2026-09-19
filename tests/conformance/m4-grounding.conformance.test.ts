import { describe, expect, it } from "vitest";
import { createSemanticId } from "../../packages/core-types/src/index.ts";
import {
  groundSource,
  mapNormalizedRangeToSourceSpan,
  normalizeGroundingSource,
  type GroundingSource,
} from "../../packages/grounding/src/index.ts";
import { createCoreOntology } from "../../packages/ontology/src/index.ts";
import {
  AmbiguityResolverRegistry,
  buildParseCandidates,
  commitParseCandidate,
  deterministicHighestScoreResolver,
  validateSyntaxForest,
  type ParseCandidate,
  type SemanticConstructionRule,
  type SyntaxForest,
} from "../../packages/parser-core/src/index.ts";
import {
  InMemorySemanticGraph,
  type EntityNode,
} from "../../packages/semantic-graph/src/index.ts";
import { validateSnapshot } from "../../packages/semantic-validator/src/index.ts";
import { resolveUtf16Span } from "../../packages/open-world-values/src/index.ts";

const source = (content: string, languageHint = "en"): GroundingSource => ({
  id: "source:m4-fixture",
  version: "1",
  mediaType: "text/plain",
  languageHint,
  content,
  trust: "user-content",
});

describe("M4 grounding pipeline", () => {
  it("normalizes line endings and NFC while preserving a reversible source span", () => {
    const original = source("Cafe\u0301\r\nCount 42.");
    const normalized = normalizeGroundingSource(original);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    expect(normalized.value.text).toBe("Café\nCount 42.");
    expect(normalized.value.edits.map((edit) => edit.kind)).toEqual([
      "line-ending",
      "unicode-nfc",
    ]);

    const end = normalized.value.text.indexOf("\n");
    const span = mapNormalizedRangeToSourceSpan(normalized.value, 0, end);
    expect(span.ok).toBe(true);
    if (!span.ok) return;

    expect(resolveUtf16Span(original, span.value)).toEqual({
      ok: true,
      value: "Cafe\u0301",
    });
  });

  it("segments, tokenizes, tags language, and extracts literals without Jev", () => {
    const result = groundSource(
      source("The service uses 42 files. See https://example.com"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.segments).toHaveLength(2);
    expect(result.value.languageSpans).toEqual([
      {
        start: 0,
        end: result.value.normalized.text.length,
        language: "en",
        source: "hint",
      },
    ]);
    expect(result.value.literals.map((entry) => entry.literal.kind)).toEqual([
      "number",
      "url",
    ]);

    const service = result.value.tokens.find((token) => token.text === "service");
    expect(service?.sourceSpan.sourceId).toBe("source:m4-fixture");
  });

  it("does not discard unknown lexical material when no lexicon provider recognizes it", () => {
    const result = groundSource(source("The quuxFluxNode activates."));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.tokens.some((token) => token.text === "quuxFluxNode")).toBe(
      true,
    );
    expect(result.value.lexiconMatches).toEqual([]);
  });
});

describe("M4 packed parsing and ambiguity", () => {
  const forest: SyntaxForest = {
    version: "0.1.0",
    roots: ["syntax:s"],
    nodes: [
      {
        id: "syntax:np",
        category: "NP",
        tokenStart: 0,
        tokenEnd: 1,
        alternatives: [],
      },
      {
        id: "syntax:vp",
        category: "VP",
        tokenStart: 1,
        tokenEnd: 2,
        alternatives: [],
      },
      {
        id: "syntax:s",
        category: "S",
        tokenStart: 0,
        tokenEnd: 2,
        alternatives: [
          {
            ruleId: "grammar.s.np-vp",
            children: ["syntax:np", "syntax:vp"],
          },
        ],
      },
    ],
  };

  it("validates a packed forest and rejects dangling syntax children", () => {
    expect(validateSyntaxForest(forest).ok).toBe(true);

    const broken = structuredClone(forest);
    broken.nodes[2]?.alternatives[0]?.children.push("syntax:missing");
    const result = validateSyntaxForest(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PARSER_FOREST_CHILD_MISSING");
    }
  });

  it("preserves unresolved ambiguity instead of guessing", async () => {
    const grounding = groundSource(source("alpha beta"));
    expect(grounding.ok).toBe(true);
    if (!grounding.ok) return;

    const candidates: ParseCandidate[] = [
      {
        id: "candidate:a",
        rootNodeId: "syntax:s",
        operations: [],
        ambiguityTags: ["semantic"],
        deterministicScore: 0.5,
      },
      {
        id: "candidate:b",
        rootNodeId: "syntax:s",
        operations: [],
        ambiguityTags: ["semantic"],
        deterministicScore: 0.5,
      },
    ];

    const registry = new AmbiguityResolverRegistry();
    registry.register(deterministicHighestScoreResolver());
    const result = await registry.resolve(candidates, {
      grounding: grounding.value,
      forest,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("preserved");
    expect(result.value.selected).toBeUndefined();
  });

  it("builds a semantic candidate and commits it through JSG validation", () => {
    const grounding = groundSource(source("service runs"));
    expect(grounding.ok).toBe(true);
    if (!grounding.ok) return;

    const entityId = createSemanticId("entity");
    const rule: SemanticConstructionRule = {
      id: "semantic.fixture.entity",
      supports(node) {
        return node.category === "S";
      },
      construct() {
        const entity: EntityNode = {
          id: entityId,
          kind: "entity",
          schemaVersion: "0.1.0",
          ontologyVersion: "0.1.0",
          provenance: [],
          trust: "user-content",
          concept: "concept:core.entity",
          attributes: [],
          memberships: [],
        };
        return {
          ok: true,
          value: [{ kind: "add-node", node: entity }],
        };
      },
    };

    const candidates = buildParseCandidates(
      forest,
      grounding.value,
      [rule],
      undefined,
    );
    expect(candidates.ok).toBe(true);
    if (!candidates.ok) return;

    const graph = new InMemorySemanticGraph();
    const ontology = createCoreOntology();
    const committed = commitParseCandidate(
      graph,
      candidates.value[0]!,
      (snapshot) => validateSnapshot(snapshot, { ontology }),
    );
    expect(committed.ok).toBe(true);
    expect(graph.has(entityId)).toBe(true);
  });
});
