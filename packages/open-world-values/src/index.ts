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

export const spanDigest = (
  source: GroundingSource,
  start: number,
  end: number,
): Digest => {
  if (typeof source.content !== "string") {
    throw new StructuredError(
      "OWV_NON_TEXT_SPAN",
      "Text span digest requested for non-text grounding source.",
    );
  }
  return sha256(source.content.slice(start, end));
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

export type ParsedLiteral =
  | { kind: "number"; value: number; source: string }
  | { kind: "boolean"; value: boolean; source: string }
  | { kind: "url"; value: string; source: string }
  | { kind: "email"; value: string; source: string }
  | { kind: "path"; value: string; source: string }
  | { kind: "date"; value: string; source: string }
  | { kind: "text"; value: string; source: string };

export const resolveUtf16Span = (
  source: GroundingSource,
  span: SpanRef,
): Result<string> => {
  if (typeof source.content !== "string") {
    return err(
      new StructuredError(
        "OWV_NON_TEXT_SOURCE",
        "Cannot resolve a UTF-16 span against a non-text source.",
      ),
    );
  }
  if (span.coordinateSystem !== "utf16") {
    return err(
      new StructuredError(
        "OWV_COORDINATE_MISMATCH",
        "Only UTF-16 span resolution is implemented in the bootstrap runtime.",
      ),
    );
  }
  if (span.sourceId !== source.id || span.sourceVersion !== source.version) {
    return err(
      new StructuredError(
        "OWV_STALE_SPAN",
        "Span source identity/version no longer matches the grounding source.",
      ),
    );
  }
  if (
    span.start < 0 ||
    span.end < span.start ||
    span.end > source.content.length
  ) {
    return err(
      new StructuredError("OWV_SPAN_BOUNDS", "Span is outside source bounds."),
    );
  }
  const value = source.content.slice(span.start, span.end);
  if (sha256(value) !== span.digest) {
    return err(
      new StructuredError(
        "OWV_STALE_SPAN",
        "Span digest no longer matches the referenced source content.",
      ),
    );
  }
  return ok(value);
};

export const parseKnownLiteral = (source: string): ParsedLiteral => {
  const value = source.trim();
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
    return { kind: "number", value: Number(value), source };
  }
  if (/^(true|false)$/i.test(value)) {
    return { kind: "boolean", value: value.toLowerCase() === "true", source };
  }
  if (/^https?:\/\/[^\s]+$/i.test(value)) {
    return { kind: "url", value, source };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { kind: "email", value, source };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { kind: "date", value, source };
  }
  if (
    /^(?:[A-Za-z]:[\\/]|\.{0,2}[\\/]|\/)[^\0]*$/.test(value) ||
    /^[\w.-]+(?:[\\/][\w .-]+)+$/.test(value)
  ) {
    return { kind: "path", value, source };
  }
  return { kind: "text", value: source, source };
};

export const opaqueRedaction = (ref: OpaqueValueRef): string =>
  `<opaque:${ref.sensitivity}:${ref.digest.slice("sha256:".length, "sha256:".length + 12)}>`;
