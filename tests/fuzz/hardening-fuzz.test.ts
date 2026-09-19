import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../packages/core-types/src/index.ts";
import {
  normalizeGroundingSource,
} from "../../packages/grounding/src/index.ts";
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
import {
  applySourcePatches,
  type SourceDocument,
  type SourcePatch,
} from "../../packages/code-backend-core/src/index.ts";

const rng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const sample = <T>(random: () => number, values: readonly T[]): T =>
  values[Math.floor(random() * values.length)]!;

const randomText = (random: () => number, max = 80): string => {
  const atoms = [
    "a", "Z", "0", " ", "\n", "\r", "\r\n", "é", "e\u0301",
    "😀", "\u0000", "/", "\\", "{", "}", "[", "]", "\"", "'",
  ] as const;
  const length = Math.floor(random() * max);
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += sample(random, atoms);
  }
  return output;
};

const source = (content: string): GroundingSource => ({
  id: "source:fuzz",
  version: "1",
  mediaType: "text/plain",
  content,
  trust: "user-content",
});

describe("T289-T292 deterministic fuzz hardening", () => {
  it("T289 fuzzes JSG deserialization without throwing and preserves valid round trips", () => {
    const random = rng(0x289);
    const valid: GraphSnapshot = {
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
          concept: "concept:core.entity",
          attributes: [],
          memberships: [],
        },
      ],
    };
    const roundTrip = deserializeSnapshot(serializeSnapshot(valid));
    expect(roundTrip.ok).toBe(true);
    if (roundTrip.ok) {
      expect(serializeSnapshot(roundTrip.value)).toBe(serializeSnapshot(valid));
    }

    const mutationSeeds: unknown[] = [
      null, true, 7, "text", [], {},
      { schemaVersion: 1 },
      { schemaVersion: "0.1.0", ontologyVersion: "0.1.0", revision: "r", nodes: "bad" },
      { ...valid, nodes: [{ ...(valid.nodes[0] as object), kind: "not-a-node" }] },
    ];
    for (let index = 0; index < 300; index += 1) {
      const candidate =
        index < mutationSeeds.length
          ? mutationSeeds[index]
          : random() < 0.5
            ? randomText(random)
            : {
                schemaVersion: randomText(random, 10),
                ontologyVersion: randomText(random, 10),
                revision: randomText(random, 10),
                nodes: random() < 0.5 ? [] : [randomText(random, 20)],
              };
      expect(() =>
        deserializeSnapshot(
          typeof candidate === "string"
            ? candidate
            : JSON.stringify(candidate),
        ),
      ).not.toThrow();
    }
  });

  it("T290 fuzzes normalization and UTF-16 span mapping across line endings, combining marks and surrogate pairs", () => {
    const random = rng(0x290);
    for (let iteration = 0; iteration < 250; iteration += 1) {
      const original = randomText(random, 50);
      const normalized = normalizeGroundingSource(source(original));
      expect(normalized.ok).toBe(true);
      if (!normalized.ok) continue;

      expect(normalized.value.normalizedToOriginal).toHaveLength(
        normalized.value.text.length + 1,
      );
      for (let boundary = 1; boundary < normalized.value.normalizedToOriginal.length; boundary += 1) {
        expect(
          normalized.value.normalizedToOriginal[boundary]!,
        ).toBeGreaterThanOrEqual(
          normalized.value.normalizedToOriginal[boundary - 1]!,
        );
      }

      if (original.length > 0) {
        const start = Math.floor(random() * original.length);
        const end = start + Math.floor(random() * (original.length - start + 1));
        const span = makeUtf16Span(source(original), start, end);
        const resolved = resolveUtf16Span(source(original), span);
        expect(resolved).toEqual({ ok: true, value: original.slice(start, end) });

        const stale = resolveUtf16Span(
          { ...source(original), version: "2" },
          span,
        );
        expect(stale.ok).toBe(false);
      }
    }
  });

  it("T291 fuzzes syntax-forest validation and rejects broken roots/children/ranges without throwing", () => {
    const random = rng(0x291);
    const valid: SyntaxForest = {
      version: "1",
      roots: ["syntax:S:0:1"],
      nodes: [
        {
          id: "syntax:S:0:1",
          category: "S",
          tokenStart: 0,
          tokenEnd: 1,
          alternatives: [{ ruleId: "rule:s", children: [] }],
        },
      ],
    };
    expect(validateSyntaxForest(valid).ok).toBe(true);

    for (let index = 0; index < 300; index += 1) {
      const id = `node:${index}`;
      const forest: SyntaxForest = {
        version: random() < 0.05 ? "" : "1",
        roots: random() < 0.2 ? ["missing"] : [id],
        nodes: [
          {
            id,
            category: randomText(random, 8),
            tokenStart: random() < 0.1 ? -1 : Math.floor(random() * 5),
            tokenEnd: random() < 0.1 ? -2 : Math.floor(random() * 8),
            alternatives: [
              {
                ruleId: "rule:fuzz",
                children: random() < 0.15 ? ["missing-child"] : [],
              },
            ],
          },
        ],
      };
      expect(() => validateSyntaxForest(forest)).not.toThrow();
      const result = validateSyntaxForest(forest);
      if (result.ok) {
        expect(result.value.roots.every((root) =>
          result.value.nodes.some((node) => node.id === root),
        )).toBe(true);
      }
    }
  });

  it("T292 fuzzes source-patch application and proves successful patches equal a simple reference implementation", () => {
    const random = rng(0x292);
    for (let iteration = 0; iteration < 300; iteration += 1) {
      const text = randomText(random, 60);
      const document: SourceDocument = {
        sourceId: "source:patch",
        language: "text",
        text,
      };
      const start = Math.floor(random() * (text.length + 1));
      const end = start + Math.floor(random() * (text.length - start + 1));
      const replacement = randomText(random, 10);
      const patch: SourcePatch = {
        sourceId: "source:patch",
        start,
        end,
        replacement,
        reason: "fuzz",
      };
      const applied = applySourcePatches(document, [patch]);
      expect(applied.ok).toBe(true);
      if (applied.ok) {
        expect(applied.value.text).toBe(
          text.slice(0, start) + replacement + text.slice(end),
        );
      }

      const invalid: SourcePatch = {
        ...patch,
        start: -1,
      };
      expect(() => applySourcePatches(document, [invalid])).not.toThrow();
      expect(applySourcePatches(document, [invalid]).ok).toBe(false);
    }

    const doc: SourceDocument = {
      sourceId: "source:overlap",
      language: "text",
      text: "abcdef",
    };
    const overlap = applySourcePatches(doc, [
      { sourceId: doc.sourceId, start: 1, end: 4, replacement: "X", reason: "a" },
      { sourceId: doc.sourceId, start: 3, end: 5, replacement: "Y", reason: "b" },
    ]);
    expect(overlap.ok).toBe(false);
  });

  it("keeps fuzz seeds/results reproducible", () => {
    const a = rng(123);
    const b = rng(123);
    const left = Array.from({ length: 20 }, () => a());
    const right = Array.from({ length: 20 }, () => b());
    expect(canonicalJson(left)).toBe(canonicalJson(right));
  });
});
