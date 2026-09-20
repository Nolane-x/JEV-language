import {
  canonicalJson,
  err,
  ok,
  sha256,
  StructuredError,
  type Digest,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type { PirProgram } from "../../program-ir/src/index.ts";
import {
  applySourcePatches,
  type SourceDocument,
  type SourcePatch,
} from "./backend.ts";

export type SourcePipelineStage = "cst" | "ast" | "resolved" | "pir";

const PIPELINE_ORDER: Record<SourcePipelineStage, number> = {
  cst: 0,
  ast: 1,
  resolved: 2,
  pir: 3,
};

export interface SourcePipelineStageEvidence {
  stage: SourcePipelineStage;
  artifactRef: string;
  evidenceRefs: string[];
}

export interface SourcePipelineTrace {
  sourceId: string;
  sourceRevision: string;
  stages: SourcePipelineStageEvidence[];
}

export const validateSourcePipelineTrace = (
  trace: SourcePipelineTrace,
): Result<SourcePipelineTrace> => {
  if (
    trace.sourceId.trim() === "" ||
    trace.sourceRevision.trim() === "" ||
    trace.stages.length === 0
  ) {
    return err(
      new StructuredError(
        "BACKEND_PIPELINE_TRACE",
        "Source pipeline trace requires source id, revision, and at least one stage.",
      ),
    );
  }
  let previous = -1;
  const seen = new Set<SourcePipelineStage>();
  for (const stage of trace.stages) {
    const rank = PIPELINE_ORDER[stage.stage];
    if (
      stage.artifactRef.trim() === "" ||
      stage.evidenceRefs.length === 0 ||
      stage.evidenceRefs.some((ref) => ref.trim() === "") ||
      new Set(stage.evidenceRefs).size !== stage.evidenceRefs.length ||
      seen.has(stage.stage) ||
      rank <= previous
    ) {
      return err(
        new StructuredError(
          "BACKEND_PIPELINE_ORDER",
          "Pipeline stages must be unique, ordered CST→AST→resolved→PIR, and evidence-bound.",
        ),
      );
    }
    seen.add(stage.stage);
    previous = rank;
  }
  return ok(structuredClone(trace));
};

export interface StableSourceAnchor {
  id: string;
  sourceId: string;
  sourceRevision: string;
  start: number;
  end: number;
  textDigest: Digest;
}

export const createStableSourceAnchor = (
  document: SourceDocument,
  input: { id: string; start: number; end: number },
): Result<StableSourceAnchor> => {
  if (
    input.id.trim() === "" ||
    document.sourceId.trim() === "" ||
    document.version === undefined ||
    document.version.trim() === "" ||
    !Number.isSafeInteger(input.start) ||
    !Number.isSafeInteger(input.end) ||
    input.start < 0 ||
    input.end < input.start ||
    input.end > document.text.length
  ) {
    return err(
      new StructuredError(
        "BACKEND_SOURCE_ANCHOR",
        "Stable source anchors require versioned source and valid text coordinates.",
      ),
    );
  }
  return ok({
    id: input.id,
    sourceId: document.sourceId,
    sourceRevision: document.version,
    start: input.start,
    end: input.end,
    textDigest: sha256(document.text.slice(input.start, input.end)),
  });
};

export type SourceAnchorStatus =
  | "current"
  | "stale-revision"
  | "stale-content"
  | "wrong-source"
  | "invalid-range";

export const inspectSourceAnchor = (
  document: SourceDocument,
  anchor: StableSourceAnchor,
): SourceAnchorStatus => {
  if (document.sourceId !== anchor.sourceId) return "wrong-source";
  if (
    anchor.start < 0 ||
    anchor.end < anchor.start ||
    anchor.end > document.text.length
  ) {
    return "invalid-range";
  }
  if (document.version !== anchor.sourceRevision) return "stale-revision";
  return sha256(document.text.slice(anchor.start, anchor.end)) ===
    anchor.textDigest
    ? "current"
    : "stale-content";
};

export type CommentPlacement = "leading" | "trailing" | "dangling";

export interface CommentAttachment {
  id: string;
  anchorId: string;
  placement: CommentPlacement;
  text: string;
  start: number;
  end: number;
}

export const validateCommentAttachments = (
  document: SourceDocument,
  anchors: readonly StableSourceAnchor[],
  comments: readonly CommentAttachment[],
): Result<void> => {
  const anchorIds = new Set(anchors.map((anchor) => anchor.id));
  const ids = new Set<string>();
  for (const comment of comments) {
    if (
      comment.id.trim() === "" ||
      ids.has(comment.id) ||
      !anchorIds.has(comment.anchorId) ||
      comment.text.length === 0 ||
      !Number.isSafeInteger(comment.start) ||
      !Number.isSafeInteger(comment.end) ||
      comment.start < 0 ||
      comment.end < comment.start ||
      comment.end > document.text.length ||
      document.text.slice(comment.start, comment.end) !== comment.text
    ) {
      return err(
        new StructuredError(
          "BACKEND_COMMENT_ATTACHMENT",
          "Comment attachments require unique ids, known anchors, and exact source ranges.",
        ),
      );
    }
    ids.add(comment.id);
  }
  return ok(undefined);
};

export type FormattingBoundaryMode = "preserve-exact" | "allow-local-format";

export interface FormattingPreservationBoundary {
  id: string;
  sourceId: string;
  start: number;
  end: number;
  mode: FormattingBoundaryMode;
}

const rangesOverlap = (
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean => leftStart < rightEnd && rightStart < leftEnd;

export const validateFormattingBoundaries = (
  document: SourceDocument,
  boundaries: readonly FormattingPreservationBoundary[],
  patches: readonly SourcePatch[],
): Result<void> => {
  const ids = new Set<string>();
  for (const boundary of boundaries) {
    if (
      boundary.id.trim() === "" ||
      ids.has(boundary.id) ||
      boundary.sourceId !== document.sourceId ||
      !Number.isSafeInteger(boundary.start) ||
      !Number.isSafeInteger(boundary.end) ||
      boundary.start < 0 ||
      boundary.end < boundary.start ||
      boundary.end > document.text.length
    ) {
      return err(
        new StructuredError(
          "BACKEND_FORMAT_BOUNDARY",
          "Formatting boundaries require unique ids and valid source ranges.",
        ),
      );
    }
    ids.add(boundary.id);
    if (boundary.mode !== "preserve-exact") continue;
    if (
      patches.some((patch) =>
        rangesOverlap(
          patch.start,
          patch.end,
          boundary.start,
          boundary.end,
        ),
      )
    ) {
      return err(
        new StructuredError(
          "BACKEND_FORMAT_PRESERVATION",
          `Patch touches preserve-exact boundary ${boundary.id}.`,
        ),
      );
    }
  }
  return ok(undefined);
};

export interface MinimalDiffMetrics {
  patchCount: number;
  replacedCharacters: number;
  insertedCharacters: number;
  objectiveScore: number;
}

export const scoreMinimalDiff = (
  patches: readonly SourcePatch[],
): MinimalDiffMetrics => {
  const replacedCharacters = patches.reduce(
    (sum, patch) => sum + (patch.end - patch.start),
    0,
  );
  const insertedCharacters = patches.reduce(
    (sum, patch) => sum + patch.replacement.length,
    0,
  );
  return {
    patchCount: patches.length,
    replacedCharacters,
    insertedCharacters,
    objectiveScore:
      replacedCharacters + insertedCharacters + patches.length * 8,
  };
};

export interface PatchConflict {
  code:
    | "STALE_REVISION"
    | "STALE_ANCHOR"
    | "SOURCE_MISMATCH"
    | "INVALID_PATCH";
  sourceId: string;
  message: string;
  anchorId?: string;
}

export const detectPatchConflicts = (input: {
  document: SourceDocument;
  expectedRevision?: string;
  anchors?: readonly StableSourceAnchor[];
  patches: readonly SourcePatch[];
}): PatchConflict[] => {
  const conflicts: PatchConflict[] = [];
  if (
    input.expectedRevision !== undefined &&
    input.document.version !== input.expectedRevision
  ) {
    conflicts.push({
      code: "STALE_REVISION",
      sourceId: input.document.sourceId,
      message: `Expected revision ${input.expectedRevision}, found ${input.document.version ?? "<none>"}.`,
    });
  }
  for (const anchor of input.anchors ?? []) {
    const status = inspectSourceAnchor(input.document, anchor);
    if (status !== "current") {
      conflicts.push({
        code:
          status === "wrong-source"
            ? "SOURCE_MISMATCH"
            : "STALE_ANCHOR",
        sourceId: input.document.sourceId,
        anchorId: anchor.id,
        message: `Anchor ${anchor.id} is ${status}.`,
      });
    }
  }
  for (const patch of input.patches) {
    if (
      patch.sourceId !== input.document.sourceId ||
      !Number.isSafeInteger(patch.start) ||
      !Number.isSafeInteger(patch.end) ||
      patch.start < 0 ||
      patch.end < patch.start ||
      patch.end > input.document.text.length
    ) {
      conflicts.push({
        code:
          patch.sourceId !== input.document.sourceId
            ? "SOURCE_MISMATCH"
            : "INVALID_PATCH",
        sourceId: input.document.sourceId,
        message: "Patch source/range is invalid for the current document.",
      });
    }
  }
  return conflicts;
};

export interface StagedFilePatch {
  document: SourceDocument;
  expectedRevision?: string;
  anchors?: StableSourceAnchor[];
  boundaries?: FormattingPreservationBoundary[];
  patches: SourcePatch[];
}

export interface MultiFilePatchTransactionResult {
  documents: SourceDocument[];
  metrics: Record<string, MinimalDiffMetrics>;
}

export const applyMultiFilePatchTransaction = (
  stages: readonly StagedFilePatch[],
): Result<MultiFilePatchTransactionResult> => {
  const sourceIds = stages.map((stage) => stage.document.sourceId);
  if (
    sourceIds.length === 0 ||
    sourceIds.some((id) => id.trim() === "") ||
    new Set(sourceIds).size !== sourceIds.length
  ) {
    return err(
      new StructuredError(
        "BACKEND_PATCH_TRANSACTION_FILES",
        "Multi-file patch transaction requires unique non-empty source ids.",
      ),
    );
  }

  for (const stage of stages) {
    const conflicts = detectPatchConflicts(stage);
    if (conflicts.length > 0) {
      return err(
        new StructuredError(
          "BACKEND_PATCH_TRANSACTION_CONFLICT",
          canonicalJson(conflicts as unknown as JsonValue),
        ),
      );
    }
    const boundaries = validateFormattingBoundaries(
      stage.document,
      stage.boundaries ?? [],
      stage.patches,
    );
    if (!boundaries.ok) return err(boundaries.error);

    const comments = (stage.boundaries ?? [])
      .filter((boundary) => boundary.mode === "preserve-exact")
      .map((boundary) => stage.document.text.slice(boundary.start, boundary.end));
    const applied = applySourcePatches(stage.document, stage.patches);
    if (!applied.ok) return err(applied.error);
    for (const comment of comments) {
      if (!applied.value.text.includes(comment)) {
        return err(
          new StructuredError(
            "BACKEND_PATCH_PRESERVATION_LOST",
            "A preserve-exact source fragment disappeared after staging.",
          ),
        );
      }
    }
  }

  const documents: SourceDocument[] = [];
  const metrics: Record<string, MinimalDiffMetrics> = {};
  for (const stage of stages) {
    const applied = applySourcePatches(stage.document, stage.patches);
    if (!applied.ok) return err(applied.error);
    documents.push(applied.value);
    metrics[stage.document.sourceId] = scoreMinimalDiff(stage.patches);
  }
  return ok({
    documents: documents.sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    metrics,
  });
};

export type StructuralDiffKind = "added" | "removed" | "changed";

export interface StructuralSemanticDiffEntry {
  path: string;
  kind: StructuralDiffKind;
  before?: JsonValue;
  after?: JsonValue;
}

const isObject = (value: JsonValue): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const structuralDiff = (
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  path: string,
  output: StructuralSemanticDiffEntry[],
): void => {
  if (before === undefined) {
    if (after !== undefined) output.push({ path, kind: "added", after });
    return;
  }
  if (after === undefined) {
    output.push({ path, kind: "removed", before });
    return;
  }
  if (canonicalJson(before) === canonicalJson(after)) return;

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      structuralDiff(
        before[index],
        after[index],
        `${path}[${index}]`,
        output,
      );
    }
    return;
  }
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      structuralDiff(before[key], after[key], `${path}.${key}`, output);
    }
    return;
  }
  output.push({ path, kind: "changed", before, after });
};

export const structuralSemanticDiff = (
  before: JsonValue,
  after: JsonValue,
): StructuralSemanticDiffEntry[] => {
  const output: StructuralSemanticDiffEntry[] = [];
  structuralDiff(before, after, "$", output);
  return output;
};

export type BackendCompletenessStatus =
  | "supported"
  | "partial"
  | "unsupported";

export interface BackendCompletenessEntry {
  feature: string;
  status: BackendCompletenessStatus;
  evidenceRefs: string[];
  limitations?: string[];
}

export interface BackendCompletenessMatrix {
  schemaVersion: "jl-backend-completeness-1";
  backendId: string;
  backendVersion: string;
  pirVersion: string;
  entries: BackendCompletenessEntry[];
}

export const validateBackendCompletenessMatrix = (
  matrix: BackendCompletenessMatrix,
): Result<BackendCompletenessMatrix> => {
  if (
    matrix.schemaVersion !== "jl-backend-completeness-1" ||
    matrix.backendId.trim() === "" ||
    matrix.backendVersion.trim() === "" ||
    matrix.pirVersion.trim() === "" ||
    matrix.entries.length === 0
  ) {
    return err(
      new StructuredError(
        "BACKEND_COMPLETENESS_SCHEMA",
        "Completeness matrix requires schema version, backend identity/version, PIR version and entries.",
      ),
    );
  }
  const features = new Set<string>();
  for (const entry of matrix.entries) {
    if (
      entry.feature.trim() === "" ||
      features.has(entry.feature) ||
      !["supported", "partial", "unsupported"].includes(entry.status) ||
      (entry.status !== "unsupported" && entry.evidenceRefs.length === 0) ||
      entry.evidenceRefs.some((ref) => ref.trim() === "") ||
      new Set(entry.evidenceRefs).size !== entry.evidenceRefs.length
    ) {
      return err(
        new StructuredError(
          "BACKEND_COMPLETENESS_ENTRY",
          "Completeness entries need unique features, valid statuses, and evidence for claimed support.",
        ),
      );
    }
    features.add(entry.feature);
  }
  return ok(structuredClone(matrix));
};

export interface SourcePreservationBenchmarkCase {
  id: string;
  before: SourceDocument;
  stages: StagedFilePatch[];
  expectedPreservedFragments: string[];
  expectedChangedFragments: string[];
  semanticBefore?: PirProgram;
  semanticAfter?: PirProgram;
}

export interface SourcePreservationBenchmarkResult {
  id: string;
  passed: boolean;
  diagnostics: string[];
  metrics: Record<string, MinimalDiffMetrics>;
}

export const runSourcePreservationBenchmark = (
  testCase: SourcePreservationBenchmarkCase,
): Result<SourcePreservationBenchmarkResult> => {
  if (testCase.id.trim() === "") {
    return err(
      new StructuredError(
        "BACKEND_SOURCE_BENCHMARK_ID",
        "Source-preservation benchmark requires a non-empty id.",
      ),
    );
  }
  const transaction = applyMultiFilePatchTransaction(testCase.stages);
  if (!transaction.ok) return err(transaction.error);
  const primary =
    transaction.value.documents.find(
      (document) => document.sourceId === testCase.before.sourceId,
    ) ?? transaction.value.documents[0];
  if (primary === undefined) {
    return err(
      new StructuredError(
        "BACKEND_SOURCE_BENCHMARK_OUTPUT",
        "Source-preservation benchmark produced no document.",
      ),
    );
  }
  const diagnostics: string[] = [];
  for (const fragment of testCase.expectedPreservedFragments) {
    if (!primary.text.includes(fragment)) {
      diagnostics.push(`PRESERVED_FRAGMENT_MISSING:${fragment}`);
    }
  }
  for (const fragment of testCase.expectedChangedFragments) {
    if (!primary.text.includes(fragment)) {
      diagnostics.push(`EXPECTED_CHANGE_MISSING:${fragment}`);
    }
  }
  return ok({
    id: testCase.id,
    passed: diagnostics.length === 0,
    diagnostics,
    metrics: transaction.value.metrics,
  });
};
