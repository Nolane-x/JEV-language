import { describe, expect, it } from "vitest";
import {
  applySourcePatches,
  type SourceDocument,
  type SourcePatch,
} from "../../packages/code-backend-core/src/index.ts";
import {
  mapNormalizedRangeToSourceSpan,
  normalizeGroundingSource,
} from "../../packages/grounding/src/pipeline.ts";
import {
  makeUtf16Span,
  resolveUtf16Span,
  type GroundingSource,
} from "../../packages/open-world-values/src/index.ts";
import {
  validateSyntaxForest,
  type SyntaxForest,
} from "../../packages/parser-core/src/index.ts";
import {
  deserializeSnapshot,
  serializeSnapshot,
  type GraphSnapshot,
} from "../../packages/semantic-graph/src/index.ts";

const baseSnapshot = (): GraphSnapshot => ({
  schemaVersion: "0.1.0",
  ontologyVersion: "0.1.0",
  revision: "rev:fuzz",
  nodes: [
    {
      id: "entity:fuzz",
      kind: "entity",
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      provenance: ["prov:fuzz"],
      trust: "user-content",
      concept: "concept:fuzz",
      attributes: [],
      memberships: [],
    },
  ],
});

const malformedJsonCorpus = (): string[] => {
  const atoms = [
    "",
    "null",
    "[]",
    "{}",
    "{",
    "[",
    '"text"',
    "0",
    "true",
    '{"schemaVersion":0}',
    '{"schemaVersion":"0.1.0","ontologyVersion":"0.1.0","revision":"r","nodes":{}}',
    '{"schemaVersion":"0.1.0","ontologyVersion":"0.1.0","revision":"r","nodes":[null]}',
    '{"schemaVersion":"0.1.0","ontologyVersion":"0.1.0","revision":"r","nodes":[{"id":""}]}',
    '{"schemaVersion":"0.1.0","ontologyVersion":"0.1.0","revision":"r","nodes":[{"id":"x","kind":"unknown"}]}',
    "\u0000",
    "😀",
    '{"x":"\\ud800"}',
  ];

  const generated: string[] = [];
  for (let index = 0; index < 48; index += 1) {
    const left = atoms[index % atoms.length]!;
    const right = atoms[(index * 7 + 3) % atoms.length]!;
    generated.push(left + right);
  }
  return [...atoms, ...generated];
};

const baseForest = (): SyntaxForest => ({
  version: "1.0.0",
  roots: ["syntax:S:0:2"],
  nodes: [
    {
      id: "syntax:TOKEN:0:1",
      category: "TOKEN",
      tokenStart: 0,
      tokenEnd: 1,
      alternatives: [{ ruleId: "terminal", children: [] }],
    },
    {
      id: "syntax:TOKEN:1:2",
      category: "TOKEN",
      tokenStart: 1,
      tokenEnd: 2,
      alternatives: [{ ruleId: "terminal", children: [] }],
    },
    {
      id: "syntax:S:0:2",
      category: "S",
      tokenStart: 0,
      tokenEnd: 2,
      alternatives: [
        {
          ruleId: "rule:s",
          children: ["syntax:TOKEN:0:1", "syntax:TOKEN:1:2"],
        },
      ],
    },
  ],
});

describe("T289-T292 deterministic fuzz-smoke hardening", () => {
  it("T289 fuzzes the JSG deserializer without throwing or accepting malformed structural roots", () => {
    for (const source of malformedJsonCorpus()) {
      expect(() => deserializeSnapshot(source)).not.toThrow();
      const result = deserializeSnapshot(source);
      if (result.ok) {
        expect(result.value.schemaVersion).toEqual(expect.any(String));
        expect(Array.isArray(result.value.nodes)).toBe(true);
      } else {
        expect(result.error.code).toMatch(/^JSG_DESERIALIZE_/u);
      }
    }

    const valid = serializeSnapshot(baseSnapshot());
    const parsed = deserializeSnapshot(valid);
    expect(parsed.ok).toBe(true);
  });

  it("T290 fuzzes normalization and UTF-16 span mapping across Unicode and line-ending cases", () => {
    const corpus = [
      "",
      "plain ascii",
      "a\r\nb\rc\n",
      "e\u0301cole",
      "Tiếng Việt 😀",
      "👨‍👩‍👧‍👦 family",
      "a\u0000b",
      "x".repeat(128),
    ];

    for (let index = 0; index < corpus.length; index += 1) {
      const source: GroundingSource = {
        id: `source:fuzz:${index}`,
        version: "1",
        mediaType: "text/plain",
        content: corpus[index]!,
        trust: "user-content",
      };
      const normalized = normalizeGroundingSource(source);
      expect(normalized.ok).toBe(true);
      if (!normalized.ok) continue;
      expect(normalized.value.normalizedToOriginal).toHaveLength(
        normalized.value.text.length + 1,
      );

      const boundaries = [
        0,
        Math.floor(normalized.value.text.length / 2),
        normalized.value.text.length,
      ];
      for (const start of boundaries) {
        for (const end of boundaries.filter((value) => value >= start)) {
          const mapped = mapNormalizedRangeToSourceSpan(
            normalized.value,
            start,
            end,
          );
          expect(mapped.ok).toBe(true);
          if (!mapped.ok) continue;
          const resolved = resolveUtf16Span(source, mapped.value);
          expect(resolved.ok).toBe(true);
        }
      }

      for (const [start, end] of [
        [-1, 0],
        [1, 0],
        [0, normalized.value.text.length + 1],
        [0.5, 1],
      ] as const) {
        expect(
          mapNormalizedRangeToSourceSpan(normalized.value, start, end).ok,
        ).toBe(false);
      }

      if (typeof source.content === "string" && source.content.length > 0) {
        const span = makeUtf16Span(source, 0, source.content.length);
        const stale = {
          ...span,
          sourceVersion: "stale",
        };
        expect(resolveUtf16Span(source, stale).ok).toBe(false);
      }
    }
  });

  it("T291 fuzzes packed syntax-forest integrity failures without partial acceptance", () => {
    expect(validateSyntaxForest(baseForest()).ok).toBe(true);

    const corruptions: SyntaxForest[] = [
      { ...baseForest(), version: "" },
      { ...baseForest(), roots: ["syntax:missing"] },
      {
        ...baseForest(),
        nodes: [...baseForest().nodes, structuredClone(baseForest().nodes[0]!)],
      },
      {
        ...baseForest(),
        nodes: baseForest().nodes.map((node, index) =>
          index === 0 ? { ...node, tokenStart: -1 } : node,
        ),
      },
      {
        ...baseForest(),
        nodes: baseForest().nodes.map((node) =>
          node.id === "syntax:S:0:2"
            ? {
                ...node,
                alternatives: [
                  { ruleId: "rule:bad-child", children: ["syntax:missing"] },
                ],
              }
            : node,
        ),
      },
    ];

    for (const forest of corruptions) {
      expect(() => validateSyntaxForest(forest)).not.toThrow();
      expect(validateSyntaxForest(forest).ok).toBe(false);
    }

    for (let count = 1; count <= 32; count += 1) {
      const nodes = Array.from({ length: count }, (_, index) => ({
        id: `syntax:TOKEN:${index}:${index + 1}`,
        category: "TOKEN",
        tokenStart: index,
        tokenEnd: index + 1,
        alternatives: [{ ruleId: "terminal", children: [] }],
      }));
      const forest: SyntaxForest = {
        version: "1.0.0",
        roots: [nodes[0]!.id],
        nodes,
      };
      expect(validateSyntaxForest(forest).ok).toBe(true);
    }
  });

  it("T292 fuzzes patch application and rejects invalid/overlapping ranges atomically", () => {
    const document: SourceDocument = {
      sourceId: "source:patch-fuzz",
      language: "typescript",
      text: "abcdefghijklmnopqrstuvwxyz",
    };

    for (let start = 0; start < document.text.length; start += 3) {
      const end = Math.min(document.text.length, start + 2);
      const patch: SourcePatch = {
        sourceId: document.sourceId,
        start,
        end,
        replacement: `<${start}>`,
        reason: "fuzz-valid",
      };
      const result = applySourcePatches(document, [patch]);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.text).toBe(
        document.text.slice(0, start) +
          patch.replacement +
          document.text.slice(end),
      );
    }

    const invalid: SourcePatch[][] = [
      [
        {
          sourceId: "wrong-source",
          start: 0,
          end: 1,
          replacement: "x",
          reason: "wrong-source",
        },
      ],
      [
        {
          sourceId: document.sourceId,
          start: -1,
          end: 1,
          replacement: "x",
          reason: "negative",
        },
      ],
      [
        {
          sourceId: document.sourceId,
          start: 4,
          end: 2,
          replacement: "x",
          reason: "reversed",
        },
      ],
      [
        {
          sourceId: document.sourceId,
          start: 0,
          end: document.text.length + 1,
          replacement: "x",
          reason: "overflow",
        },
      ],
      [
        {
          sourceId: document.sourceId,
          start: 2,
          end: 8,
          replacement: "a",
          reason: "overlap-a",
        },
        {
          sourceId: document.sourceId,
          start: 5,
          end: 10,
          replacement: "b",
          reason: "overlap-b",
        },
      ],
    ];

    for (const patches of invalid) {
      expect(() => applySourcePatches(document, patches)).not.toThrow();
      expect(applySourcePatches(document, patches).ok).toBe(false);
      expect(document.text).toBe("abcdefghijklmnopqrstuvwxyz");
    }
  });
});
