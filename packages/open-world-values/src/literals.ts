export interface ParsedNumericValue {
  kind: "numeric";
  raw: string;
  value: number;
  integer: boolean;
}

export interface ParsedQuantityValue {
  kind: "quantity";
  raw: string;
  amount: number;
  comparator: "exact" | "at-least" | "at-most" | "more-than" | "less-than";
  unitSurface?: string;
}

export interface ParsedTemporalLiteral {
  kind: "date" | "datetime" | "duration";
  raw: string;
  normalized: string;
}

export interface ParsedTypedLiteral {
  kind: "uuid" | "url" | "email" | "path" | "semver";
  raw: string;
  normalized: string;
}

export type DeterministicLiteral =
  | ParsedNumericValue
  | ParsedQuantityValue
  | ParsedTemporalLiteral
  | ParsedTypedLiteral;

const numericPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const semverPattern =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const isoDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const isoDurationPattern =
  /^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;

export const parseNumericLiteral = (
  input: string,
): ParsedNumericValue | undefined => {
  const raw = input.trim();
  if (!numericPattern.test(raw)) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return { kind: "numeric", raw, value, integer: Number.isInteger(value) };
};

export const parseQuantityLiteral = (
  input: string,
): ParsedQuantityValue | undefined => {
  const raw = input.trim();
  const match =
    /^(?:(exactly|at least|at most|more than|less than)\s+)?([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:\s+(.+?))?$/i.exec(
      raw,
    );
  if (!match) return undefined;
  const amount = Number(match[2]);
  if (!Number.isFinite(amount)) return undefined;
  const token = match[1]?.toLowerCase();
  const comparator: ParsedQuantityValue["comparator"] =
    token === "at least"
      ? "at-least"
      : token === "at most"
        ? "at-most"
        : token === "more than"
          ? "more-than"
          : token === "less than"
            ? "less-than"
            : "exact";
  return {
    kind: "quantity",
    raw,
    amount,
    comparator,
    ...(match[3] === undefined ? {} : { unitSurface: match[3] }),
  };
};

export const parseTemporalLiteral = (
  input: string,
): ParsedTemporalLiteral | undefined => {
  const raw = input.trim();
  if (isoDatePattern.test(raw)) {
    const date = new Date(`${raw}T00:00:00Z`);
    if (!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === raw) {
      return { kind: "date", raw, normalized: raw };
    }
    return undefined;
  }
  if (isoDateTimePattern.test(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.valueOf())) {
      return { kind: "datetime", raw, normalized: date.toISOString() };
    }
    return undefined;
  }
  if (isoDurationPattern.test(raw)) {
    return { kind: "duration", raw, normalized: raw.toUpperCase() };
  }
  return undefined;
};

export const parseTypedLiteral = (
  input: string,
): ParsedTypedLiteral | undefined => {
  const raw = input.trim();
  if (uuidPattern.test(raw)) {
    return { kind: "uuid", raw, normalized: raw.toLowerCase() };
  }
  const version = semverPattern.exec(raw);
  if (version) {
    const normalized = `${version[1]}.${version[2]}.${version[3]}${
      version[4] === undefined ? "" : `-${version[4]}`
    }`;
    return { kind: "semver", raw, normalized };
  }
  if (emailPattern.test(raw)) {
    const at = raw.lastIndexOf("@");
    return {
      kind: "email",
      raw,
      normalized: `${raw.slice(0, at)}@${raw.slice(at + 1).toLowerCase()}`,
    };
  }
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { kind: "url", raw, normalized: url.toString() };
    }
  } catch {
    // Not a URL; continue with deterministic path checks.
  }
  if (
    /^(?:[A-Za-z]:[\\/]|\/|\.\.?[\\/]).+/.test(raw) ||
    /^[^\0]+[\\/][^\0]+$/.test(raw)
  ) {
    return { kind: "path", raw, normalized: raw };
  }
  return undefined;
};

export const parseDeterministicLiteral = (
  input: string,
): DeterministicLiteral | undefined =>
  parseTemporalLiteral(input) ??
  parseTypedLiteral(input) ??
  parseQuantityLiteral(input) ??
  parseNumericLiteral(input);
