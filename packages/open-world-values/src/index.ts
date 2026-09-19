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
  validate(ref: OpaqueValueRef): Result<void>;
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

  validate(ref: OpaqueValueRef): Result<void> {
    const record = this.#records.get(ref.id);
    if (record === undefined) {
      return err(
        new StructuredError(
          "OWV_OPAQUE_NOT_FOUND",
          `Opaque value not found: ${ref.id}`,
        ),
      );
    }
    if (record.digest !== ref.digest) {
      return err(
        new StructuredError(
          "OWV_OPAQUE_DIGEST_MISMATCH",
          "Opaque reference digest does not match the stored exact value.",
          { id: ref.id },
        ),
      );
    }
    if (record.sensitivity !== ref.sensitivity) {
      return err(
        new StructuredError(
          "OWV_OPAQUE_SENSITIVITY_MISMATCH",
          "Opaque reference sensitivity does not match the stored value.",
          { id: ref.id },
        ),
      );
    }
    return ok(undefined);
  }

  verify(ref: OpaqueValueRef): boolean {
    return this.validate(ref).ok;
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

export interface QuantityValue {
  magnitude: number;
  unit: string;
  exactness: "exact" | "approximate" | "range";
  comparator: "exact" | "at-least" | "at-most" | "more-than" | "less-than";
}

export interface TemporalLiteralValue {
  iso: string;
  precision: "date" | "time" | "datetime" | "duration";
}

export type ParsedLiteral =
  | { kind: "number"; value: number; source: string }
  | { kind: "quantity"; value: QuantityValue; source: string }
  | { kind: "temporal"; value: TemporalLiteralValue; source: string }
  | { kind: "boolean"; value: boolean; source: string }
  | { kind: "url"; value: string; source: string }
  | { kind: "email"; value: string; source: string }
  | { kind: "path"; value: string; source: string }
  | { kind: "filename"; value: string; source: string }
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

const commonUnitAliases: Readonly<Record<string, string>> = {
  "%": "percent",
  ms: "millisecond",
  s: "second",
  sec: "second",
  min: "minute",
  h: "hour",
  hr: "hour",
  d: "day",
  b: "byte",
  kb: "kilobyte",
  mb: "megabyte",
  gb: "gigabyte",
  tb: "terabyte",
  mm: "millimeter",
  cm: "centimeter",
  m: "meter",
  km: "kilometer",
  mg: "milligram",
  g: "gram",
  kg: "kilogram",
  file: "file",
  files: "file",
};

export const parseQuantityLiteral = (
  source: string,
): Extract<ParsedLiteral, { kind: "quantity" }> | undefined => {
  const value = source.trim();
  const match = /^(<=|>=|<|>|≤|≥|~|≈)?\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*([%A-Za-z]+)$/u.exec(
    value,
  );
  if (match === null) return undefined;

  const unitKey = (match[3] ?? "").toLocaleLowerCase();
  const unit = commonUnitAliases[unitKey];
  if (unit === undefined) return undefined;

  const marker = match[1] ?? "";
  const comparator: QuantityValue["comparator"] =
    marker === "<=" || marker === "≤"
      ? "at-most"
      : marker === ">=" || marker === "≥"
        ? "at-least"
        : marker === "<"
          ? "less-than"
          : marker === ">"
            ? "more-than"
            : "exact";
  const exactness: QuantityValue["exactness"] =
    marker === "~" || marker === "≈" ? "approximate" : "exact";

  return {
    kind: "quantity",
    value: {
      magnitude: Number(match[2]),
      unit,
      exactness,
      comparator,
    },
    source,
  };
};

export const parseTemporalLiteral = (
  source: string,
): Extract<ParsedLiteral, { kind: "temporal" }> | undefined => {
  const value = source.trim();
  if (/^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/i.test(value)) {
    return {
      kind: "temporal",
      value: { iso: value.toUpperCase(), precision: "duration" },
      source,
    };
  }
  if (/^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) {
    return {
      kind: "temporal",
      value: { iso: value, precision: "time" },
      source,
    };
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) {
    return {
      kind: "temporal",
      value: { iso: value, precision: "datetime" },
      source,
    };
  }
  return undefined;
};

export const parseKnownLiteral = (source: string): ParsedLiteral => {
  const value = source.trim();
  const quantity = parseQuantityLiteral(source);
  if (quantity !== undefined) return quantity;
  const temporal = parseTemporalLiteral(source);
  if (temporal !== undefined) return temporal;
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
  if (/^[^\s\\/]+\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    return { kind: "filename", value, source };
  }
  return { kind: "text", value: source, source };
};

export interface OpaqueStateProjectionPolicy {
  allowedContentSensitivities: ReadonlySet<SensitivityLabel>;
}

export const projectOpaqueToState = (
  ref: OpaqueValueRef,
  registry: OpaqueValueRegistry,
  policy: OpaqueStateProjectionPolicy,
): Result<JsonValue> => {
  const valid = registry.validate(ref);
  if (!valid.ok) return valid;

  if (!policy.allowedContentSensitivities.has(ref.sensitivity)) {
    return err(
      new StructuredError(
        "OWV_STATE_PROJECTION_DENIED",
        "Opaque content is not authorized for this decision-state projection.",
        {
          id: ref.id,
          sensitivity: ref.sensitivity,
          redaction: opaqueRedaction(ref),
        },
      ),
    );
  }

  const record = registry.get(ref.id, {
    allowed: policy.allowedContentSensitivities,
  });
  if (!record.ok) return record;
  if (typeof record.value.content !== "string") {
    return err(
      new StructuredError(
        "OWV_STATE_PROJECTION_BINARY_UNSUPPORTED",
        "Binary opaque content cannot be copied into JSON decision state.",
        { id: ref.id },
      ),
    );
  }
  return ok({
    kind: "opaque-content",
    id: ref.id,
    digest: ref.digest,
    sensitivity: ref.sensitivity,
    content: record.value.content,
  });
};

export const opaqueRedaction = (ref: OpaqueValueRef): string =>
  `<opaque:${ref.sensitivity}:${ref.digest.slice("sha256:".length, "sha256:".length + 12)}>`;
