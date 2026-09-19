import {
  createSemanticId,
  err,
  ok,
  sha256,
  StructuredError,
  type Digest,
  type JsonValue,
  type Result,
  type SemanticId,
  type SensitivityLabel,
  type TrustLabel,
} from "../../core-types/src/index.ts";
import type { ProvenanceRef } from "../../provenance/src/index.ts";

export interface SpanRef {
  sourceId: string;
  sourceVersion: string;
  start: number;
  end: number;
  coordinateSystem: "utf16" | "unicode-scalar" | "byte";
  digest: Digest;
}

export interface GroundingSource {
  id: string;
  version: string;
  mediaType: string;
  languageHint?: string;
  content: string | Uint8Array;
  trust: TrustLabel;
  metadata?: JsonValue;
}

export type OpaqueValueId = SemanticId;

export interface OpaqueValueRef {
  kind: "opaque";
  id: OpaqueValueId;
  digest: Digest;
  sensitivity: SensitivityLabel;
}

export interface OpaqueValueRecord {
  id: OpaqueValueId;
  digest: Digest;
  content: string | Uint8Array;
  sensitivity: SensitivityLabel;
  provenance: ProvenanceRef[];
}

export interface OpaqueReadPolicy {
  allowed: ReadonlySet<SensitivityLabel>;
}

export interface OpaqueValueRegistry {
  put(
    content: string | Uint8Array,
    sensitivity: SensitivityLabel,
    provenance?: ProvenanceRef[],
  ): OpaqueValueRef;
  get(id: OpaqueValueId, policy: OpaqueReadPolicy): Result<OpaqueValueRecord>;
  verify(ref: OpaqueValueRef): boolean;
}

const copyContent = (content: string | Uint8Array): string | Uint8Array =>
  typeof content === "string" ? content : new Uint8Array(content);

export class InMemoryOpaqueValueRegistry implements OpaqueValueRegistry {
  #records = new Map<OpaqueValueId, OpaqueValueRecord>();

  put(
    content: string | Uint8Array,
    sensitivity: SensitivityLabel,
    provenance: ProvenanceRef[] = [],
  ): OpaqueValueRef {
    const id = createSemanticId("opaque");
    const digest = sha256(content);
    const record: OpaqueValueRecord = {
      id,
      digest,
      content: copyContent(content),
      sensitivity,
      provenance: [...provenance],
    };
    this.#records.set(id, record);
    return { kind: "opaque", id, digest, sensitivity };
  }

  get(id: OpaqueValueId, policy: OpaqueReadPolicy): Result<OpaqueValueRecord> {
    const record = this.#records.get(id);
    if (record === undefined) {
      return err(
        new StructuredError("OWV_OPAQUE_NOT_FOUND", `Opaque value not found: ${id}`),
      );
    }
    if (!policy.allowed.has(record.sensitivity)) {
      return err(
        new StructuredError(
          "OWV_OPAQUE_ACCESS_DENIED",
          "Opaque value sensitivity is not permitted by this read policy.",
          { id, sensitivity: record.sensitivity },
        ),
      );
    }
    return ok({
      ...record,
      content: copyContent(record.content),
      provenance: [...record.provenance],
    });
  }

  verify(ref: OpaqueValueRef): boolean {
    const record = this.#records.get(ref.id);
    return record !== undefined && record.digest === ref.digest;
  }
}

export interface ConstructionPlan {
  operation: "join" | "identifier";
  parts: StringLikeValue[];
  separator?: string;
  casing?: "preserve" | "camel" | "pascal" | "snake" | "kebab";
}

export interface LexemeRef {
  language: string;
  lemma: string;
  sense?: string;
}

export type StringLikeValue =
  | { kind: "span-ref"; span: SpanRef }
  | OpaqueValueRef
  | { kind: "constructed"; plan: ConstructionPlan }
  | { kind: "lexeme"; lexeme: LexemeRef }
  | {
      kind: "surface-literal";
      value: string;
      origin: "parsed-literal" | "deterministic-realizer" | "configured";
    };

const assertTextSpanBounds = (
  source: GroundingSource,
  start: number,
  end: number,
): string => {
  if (typeof source.content !== "string") {
    throw new StructuredError(
      "OWV_NON_TEXT_SPAN",
      "Text span operation requested for non-text grounding source.",
    );
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > source.content.length
  ) {
    throw new StructuredError(
      "OWV_INVALID_SPAN",
      `Invalid UTF-16 span [${start}, ${end}) for source length ${source.content.length}.`,
    );
  }
  return source.content;
};

export const spanDigest = (
  source: GroundingSource,
  start: number,
  end: number,
): Digest => {
  const content = assertTextSpanBounds(source, start, end);
  return sha256(content.slice(start, end));
};

export const makeUtf16Span = (
  source: GroundingSource,
  start: number,
  end: number,
): SpanRef => ({
  sourceId: source.id,
  sourceVersion: source.version,
  start,
  end,
  coordinateSystem: "utf16",
  digest: spanDigest(source, start, end),
});

export const resolveUtf16Span = (
  source: GroundingSource,
  span: SpanRef,
): Result<string> => {
  if (span.coordinateSystem !== "utf16") {
    return err(
      new StructuredError(
        "OWV_SPAN_COORDINATE_MISMATCH",
        `Expected utf16 span, got ${span.coordinateSystem}.`,
      ),
    );
  }
  if (span.sourceId !== source.id) {
    return err(
      new StructuredError(
        "OWV_SPAN_SOURCE_MISMATCH",
        "Span belongs to a different grounding source.",
      ),
    );
  }
  if (span.sourceVersion !== source.version) {
    return err(
      new StructuredError(
        "OWV_STALE_SPAN",
        `Span source version ${span.sourceVersion} does not match current version ${source.version}.`,
      ),
    );
  }
  try {
    const content = assertTextSpanBounds(source, span.start, span.end);
    const value = content.slice(span.start, span.end);
    if (sha256(value) !== span.digest) {
      return err(
        new StructuredError(
          "OWV_SPAN_DIGEST_MISMATCH",
          "Span digest no longer matches the referenced source content.",
        ),
      );
    }
    return ok(value);
  } catch (error) {
    if (error instanceof StructuredError) return err(error);
    throw error;
  }
};

export * from "./literals.ts";
