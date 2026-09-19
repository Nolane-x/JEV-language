import { createHash, randomUUID } from "node:crypto";

export type Maturity = "prototype" | "experimental" | "candidate" | "stable";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Namespace = string;
export type SemanticId = `${string}:${string}`;
export type TraceId = `trace:${string}`;
export type Digest = `sha256:${string}`;

export type TrustLabel =
  | "system-trusted"
  | "configured-trusted"
  | "user-instruction"
  | "user-content"
  | "external-content"
  | "untrusted-generated"
  | "unknown";

export type SensitivityLabel =
  | "public"
  | "internal"
  | "sensitive"
  | "secret";

export interface ConfidenceValue {
  probability?: number;
  calibrationProfile?: string;
  source: "jev" | "parser" | "rule" | "combined";
  evidenceCount?: number;
  notes?: string[];
}

export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

export type Result<T, E = StructuredError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(error: StructuredError): Result<T> => ({
  ok: false,
  error,
});

export class StructuredError extends Error {
  readonly code: string;
  readonly details?: JsonValue;

  constructor(code: string, message: string, details?: JsonValue) {
    super(message);
    this.name = "StructuredError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON(): JsonValue {
    const base: Record<string, JsonValue> = {
      name: this.name,
      code: this.code,
      message: this.message,
    };
    if (this.details !== undefined) base.details = this.details;
    return base;
  }
}

export interface RuntimeSchema<T> {
  readonly name: string;
  parse(input: unknown): Result<T>;
}

export const runtimeSchema = <T>(
  name: string,
  guard: (input: unknown) => input is T,
  code = "SCHEMA_INVALID",
): RuntimeSchema<T> => ({
  name,
  parse(input) {
    if (guard(input)) return ok(input);
    return err(new StructuredError(code, `Input failed runtime schema ${name}`));
  },
});

const namespacePattern = /^[a-z][a-z0-9._-]*$/i;
const semanticIdPattern = /^[a-z][a-z0-9._-]*:.+$/i;

export const isSemanticId = (value: unknown): value is SemanticId =>
  typeof value === "string" && semanticIdPattern.test(value);

export const createSemanticId = (namespace: Namespace): SemanticId => {
  if (!namespacePattern.test(namespace)) {
    throw new StructuredError(
      "CORE_INVALID_NAMESPACE",
      `Invalid semantic namespace: ${namespace}`,
    );
  }
  const time = Date.now().toString(36).padStart(10, "0");
  return `${namespace}:${time}-${randomUUID()}` as SemanticId;
};

export const createTraceId = (): TraceId =>
  `trace:${randomUUID()}` as TraceId;

export const parseVersion = (value: string): Result<Version> => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) {
    return err(
      new StructuredError("CORE_INVALID_VERSION", `Invalid version: ${value}`),
    );
  }
  const result: Version = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
  if (match[4] !== undefined) result.prerelease = match[4];
  return ok(result);
};

const canonicalizeObject = (
  input: { [key: string]: JsonValue },
): { [key: string]: JsonValue } => {
  const output: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(input).sort()) {
    const value = input[key];
    if (value !== undefined) output[key] = canonicalizeJson(value);
  }
  return output;
};

export const canonicalizeJson = (value: JsonValue): JsonValue => {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new StructuredError(
        "CORE_NON_FINITE_NUMBER",
        "Canonical JSON does not permit non-finite numbers.",
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value !== null && typeof value === "object") {
    return canonicalizeObject(value);
  }
  return value;
};

export const canonicalJson = (value: JsonValue): string =>
  JSON.stringify(canonicalizeJson(value));

export interface DigestProvider {
  readonly algorithm: "sha256";
  digest(data: string | Uint8Array): Digest;
}

export class NodeSha256DigestProvider implements DigestProvider {
  readonly algorithm = "sha256" as const;

  digest(data: string | Uint8Array): Digest {
    const hash = createHash(this.algorithm);
    hash.update(data);
    return `sha256:${hash.digest("hex")}` as Digest;
  }
}

export const defaultDigestProvider: DigestProvider =
  new NodeSha256DigestProvider();

export const sha256 = (data: string | Uint8Array): Digest =>
  defaultDigestProvider.digest(data);

export const assertNever = (value: never, context = "exhaustive switch"): never => {
  throw new StructuredError(
    "CORE_NON_EXHAUSTIVE",
    `Unexpected value in ${context}`,
    String(value),
  );
};
