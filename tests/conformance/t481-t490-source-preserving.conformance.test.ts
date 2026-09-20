import { describe, expect, it } from "vitest";
import {
  applyMultiFilePatchTransaction,
  createStableSourceAnchor,
  detectPatchConflicts,
  inspectSourceAnchor,
  runSourcePreservationBenchmark,
  scoreMinimalDiff,
  structuralSemanticDiff,
  validateBackendCompletenessMatrix,
  validateCommentAttachments,
  validateFormattingBoundaries,
  validateSourcePipelineTrace,
  type SourceDocument,
} from "../../packages/code-backend-core/src/index.ts";

const doc = (
  sourceId: string,
  text: string,
  version = "rev:1",
): SourceDocument => ({
  sourceId,
  language: "typescript",
  text,
  version,
  path: `${sourceId}.ts`,
});

describe("T481-T490 source-preserving transformation", () => {
  it("T481 formalizes an ordered CST->AST->resolved->PIR trace with evidence", () => {
    expect(
      validateSourcePipelineTrace({
        sourceId: "src:a",
        sourceRevision: "rev:1",
        stages: [
          { stage: "cst", artifactRef: "cst:a", evidenceRefs: ["e:cst"] },
          { stage: "ast", artifactRef: "ast:a", evidenceRefs: ["e:ast"] },
          { stage: "resolved", artifactRef: "resolved:a", evidenceRefs: ["e:resolved"] },
          { stage: "pir", artifactRef: "pir:a", evidenceRefs: ["e:pir"] },
        ],
      }).ok,
    ).toBe(true);

    expect(
      validateSourcePipelineTrace({
        sourceId: "src:a",
        sourceRevision: "rev:1",
        stages: [
          { stage: "ast", artifactRef: "ast:a", evidenceRefs: ["e:ast"] },
          { stage: "cst", artifactRef: "cst:a", evidenceRefs: ["e:cst"] },
        ],
      }).ok,
    ).toBe(false);
  });

  it("T482 creates stable revision+digest source anchors and detects staleness", () => {
    const source = doc("src:a", "const x = 1;\n");
    const anchor = createStableSourceAnchor(source, {
      id: "anchor:x",
      start: 6,
      end: 11,
    });
    expect(anchor.ok).toBe(true);
    if (!anchor.ok) return;

    expect(inspectSourceAnchor(source, anchor.value)).toBe("current");
    expect(
      inspectSourceAnchor({ ...source, version: "rev:2" }, anchor.value),
    ).toBe("stale-revision");
    expect(
      inspectSourceAnchor(
        { ...source, text: "const y = 1;\n" },
        anchor.value,
      ),
    ).toBe("stale-content");
  });

  it("T483 validates comment attachment ranges against exact source text", () => {
    const source = doc(
      "src:comments",
      "// keep this\nconst x = 1; // trailing\n",
    );
    const anchor = createStableSourceAnchor(source, {
      id: "anchor:decl",
      start: 13,
      end: 25,
    });
    expect(anchor.ok).toBe(true);
    if (!anchor.ok) return;

    expect(
      validateCommentAttachments(source, [anchor.value], [
        {
          id: "comment:leading",
          anchorId: "anchor:decl",
          placement: "leading",
          text: "// keep this",
          start: 0,
          end: 12,
        },
        {
          id: "comment:trailing",
          anchorId: "anchor:decl",
          placement: "trailing",
          text: "// trailing",
          start: 26,
          end: 37,
        },
      ]).ok,
    ).toBe(true);

    expect(
      validateCommentAttachments(source, [anchor.value], [
        {
          id: "comment:bad",
          anchorId: "anchor:decl",
          placement: "leading",
          text: "// wrong",
          start: 0,
          end: 12,
        },
      ]).ok,
    ).toBe(false);
  });

  it("T484 blocks patches that touch preserve-exact formatting boundaries", () => {
    const source = doc("src:fmt", "// sacred\nconst x = 1;\n");
    expect(
      validateFormattingBoundaries(
        source,
        [
          {
            id: "boundary:comment",
            sourceId: source.sourceId,
            start: 0,
            end: 9,
            mode: "preserve-exact",
          },
        ],
        [
          {
            sourceId: source.sourceId,
            start: 19,
            end: 20,
            replacement: "2",
            reason: "change-value",
          },
        ],
      ).ok,
    ).toBe(true);

    expect(
      validateFormattingBoundaries(
        source,
        [
          {
            id: "boundary:comment",
            sourceId: source.sourceId,
            start: 0,
            end: 9,
            mode: "preserve-exact",
          },
        ],
        [
          {
            sourceId: source.sourceId,
            start: 3,
            end: 4,
            replacement: "X",
            reason: "bad-edit",
          },
        ],
      ).ok,
    ).toBe(false);
  });

  it("T485 exposes a deterministic minimal-diff objective", () => {
    expect(
      scoreMinimalDiff([
        {
          sourceId: "src:a",
          start: 5,
          end: 8,
          replacement: "xy",
          reason: "edit",
        },
      ]),
    ).toEqual({
      patchCount: 1,
      replacedCharacters: 3,
      insertedCharacters: 2,
      objectiveScore: 13,
    });
  });

  it("T486 detects stale revision, stale anchor and invalid patch conflicts", () => {
    const source = doc("src:a", "const x = 1;\n");
    const anchor = createStableSourceAnchor(source, {
      id: "anchor:x",
      start: 6,
      end: 11,
    });
    expect(anchor.ok).toBe(true);
    if (!anchor.ok) return;

    const conflicts = detectPatchConflicts({
      document: { ...source, version: "rev:2" },
      expectedRevision: "rev:1",
      anchors: [anchor.value],
      patches: [
        {
          sourceId: "other",
          start: 0,
          end: 1,
          replacement: "x",
          reason: "bad-source",
        },
      ],
    });
    expect(conflicts.map((item) => item.code).sort()).toEqual([
      "SOURCE_MISMATCH",
      "STALE_ANCHOR",
      "STALE_REVISION",
    ]);
  });

  it("T487 applies staged multi-file patches atomically and rejects any conflicted stage", () => {
    const a = doc("src:a", "const a = 1;\n");
    const b = doc("src:b", "const b = 2;\n");

    const success = applyMultiFilePatchTransaction([
      {
        document: a,
        expectedRevision: "rev:1",
        patches: [
          {
            sourceId: "src:a",
            start: 10,
            end: 11,
            replacement: "3",
            reason: "edit-a",
          },
        ],
      },
      {
        document: b,
        expectedRevision: "rev:1",
        patches: [
          {
            sourceId: "src:b",
            start: 10,
            end: 11,
            replacement: "4",
            reason: "edit-b",
          },
        ],
      },
    ]);
    expect(success.ok).toBe(true);
    if (success.ok) {
      expect(success.value.documents.map((item) => item.text)).toEqual([
        "const a = 3;\n",
        "const b = 4;\n",
      ]);
    }

    expect(
      applyMultiFilePatchTransaction([
        {
          document: a,
          expectedRevision: "rev:old",
          patches: [],
        },
        {
          document: b,
          expectedRevision: "rev:1",
          patches: [],
        },
      ]).ok,
    ).toBe(false);
  });

  it("T488 produces structural semantic diffs with stable paths", () => {
    expect(
      structuralSemanticDiff(
        { a: 1, nested: { keep: true, x: 1 } },
        { a: 2, nested: { keep: true, y: 3 } },
      ),
    ).toEqual([
      { path: "$.a", kind: "changed", before: 1, after: 2 },
      { path: "$.nested.x", kind: "removed", before: 1 },
      { path: "$.nested.y", kind: "added", after: 3 },
    ]);
  });

  it("T489 validates evidence-bearing backend completeness matrices", () => {
    expect(
      validateBackendCompletenessMatrix({
        schemaVersion: "jl-backend-completeness-1",
        backendId: "backend.typescript",
        backendVersion: "1.0.0",
        pirVersion: "1.0.0",
        entries: [
          {
            feature: "function",
            status: "supported",
            evidenceRefs: ["test:m12"],
          },
          {
            feature: "ownership",
            status: "unsupported",
            evidenceRefs: [],
            limitations: ["not representable in current TS lowering"],
          },
        ],
      }).ok,
    ).toBe(true);

    expect(
      validateBackendCompletenessMatrix({
        schemaVersion: "jl-backend-completeness-1",
        backendId: "backend.typescript",
        backendVersion: "1.0.0",
        pirVersion: "1.0.0",
        entries: [
          {
            feature: "function",
            status: "supported",
            evidenceRefs: [],
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("T490 benchmarks source preservation while permitting the intended local change", () => {
    const source = doc(
      "src:benchmark",
      "// preserve me\nconst x = 1;\n",
    );
    const result = runSourcePreservationBenchmark({
      id: "benchmark:local-edit",
      before: source,
      stages: [
        {
          document: source,
          expectedRevision: "rev:1",
          boundaries: [
            {
              id: "boundary:comment",
              sourceId: source.sourceId,
              start: 0,
              end: 14,
              mode: "preserve-exact",
            },
          ],
          patches: [
            {
              sourceId: source.sourceId,
              start: 24,
              end: 25,
              replacement: "2",
              reason: "change-literal",
            },
          ],
        },
      ],
      expectedPreservedFragments: ["// preserve me"],
      expectedChangedFragments: ["const x = 2;"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.passed).toBe(true);
      expect(result.value.diagnostics).toEqual([]);
      expect(
        result.value.metrics["src:benchmark"]?.objectiveScore,
      ).toBeGreaterThan(0);
    }
  });
});
