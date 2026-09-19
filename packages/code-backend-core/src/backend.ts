import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  PirProgram,
  SourceBinding,
} from "../../program-ir/src/index.ts";

export type BackendCapability =
  | "parse"
  | "lift"
  | "lower"
  | "print"
  | "patch"
  | "diagnostics"
  | "typecheck";

export interface ProgrammingBackendManifest {
  id: string;
  version: string;
  language: string;
  extensions: string[];
  capabilities: BackendCapability[];
  pirVersion: string;
  annotations?: Record<string, JsonValue>;
}

export interface SourceDocument {
  sourceId: string;
  language: string;
  text: string;
  version?: string;
  path?: string;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface NormalizedCompilerDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  sourceId?: string;
  start?: number;
  length?: number;
  line?: number;
  column?: number;
  category?: string;
}

export interface ParsedSource<Ast> {
  document: SourceDocument;
  ast: Ast;
  diagnostics: NormalizedCompilerDiagnostic[];
}

export interface LiftResult {
  program: PirProgram;
  sourceBindings: SourceBinding[];
  diagnostics: NormalizedCompilerDiagnostic[];
}

export interface LowerResult<Ast> {
  ast: Ast;
  sourceBindings: SourceBinding[];
  diagnostics: NormalizedCompilerDiagnostic[];
}

export interface SourcePatch {
  sourceId: string;
  start: number;
  end: number;
  replacement: string;
  reason: string;
}

export interface TypecheckResult {
  ok: boolean;
  diagnostics: NormalizedCompilerDiagnostic[];
}

export interface ProgrammingBackend<Ast> {
  readonly manifest: ProgrammingBackendManifest;
  parse(document: SourceDocument): Result<ParsedSource<Ast>>;
  lift(parsed: ParsedSource<Ast>): Result<LiftResult>;
  lower(program: PirProgram): Result<LowerResult<Ast>>;
  print(lowered: LowerResult<Ast>): Result<string>;
  patch(
    original: SourceDocument,
    program: PirProgram,
  ): Result<SourcePatch[]>;
  typecheck(document: SourceDocument): TypecheckResult;
}

const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export const validateProgrammingBackendManifest = (
  manifest: ProgrammingBackendManifest,
): Result<ProgrammingBackendManifest> => {
  if (
    manifest.id.trim() === "" ||
    manifest.language.trim() === "" ||
    manifest.pirVersion.trim() === ""
  ) {
    return err(
      new StructuredError(
        "BACKEND_MANIFEST_REQUIRED",
        "Backend manifest id, language, and PIR version are required.",
      ),
    );
  }
  if (!semver.test(manifest.version)) {
    return err(
      new StructuredError(
        "BACKEND_MANIFEST_VERSION",
        "Backend manifest version must be semver.",
      ),
    );
  }
  if (
    manifest.extensions.length === 0 ||
    manifest.extensions.some(
      (extension) =>
        !extension.startsWith(".") || extension.trim().length < 2,
    )
  ) {
    return err(
      new StructuredError(
        "BACKEND_MANIFEST_EXTENSION",
        "Backend manifest requires at least one dot-prefixed source extension.",
      ),
    );
  }

  const capabilities = new Set(manifest.capabilities);
  if (capabilities.size !== manifest.capabilities.length) {
    return err(
      new StructuredError(
        "BACKEND_MANIFEST_CAPABILITY_DUPLICATE",
        "Backend capabilities must be unique.",
      ),
    );
  }
  for (const required of [
    "parse",
    "lift",
    "lower",
    "print",
    "patch",
    "diagnostics",
    "typecheck",
  ] as const) {
    if (!capabilities.has(required)) {
      return err(
        new StructuredError(
          "BACKEND_MANIFEST_CAPABILITY_MISSING",
          `Backend manifest is missing required capability ${required}.`,
        ),
      );
    }
  }

  return ok(structuredClone(manifest));
};

export const createMinimalTextPatch = (
  sourceId: string,
  previous: string,
  next: string,
  reason = "backend-lowering",
): SourcePatch[] => {
  if (previous === next) return [];

  let prefix = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (
    prefix < maxPrefix &&
    previous.charCodeAt(prefix) === next.charCodeAt(prefix)
  ) {
    prefix += 1;
  }

  let suffix = 0;
  const previousRemaining = previous.length - prefix;
  const nextRemaining = next.length - prefix;
  const maxSuffix = Math.min(previousRemaining, nextRemaining);
  while (
    suffix < maxSuffix &&
    previous.charCodeAt(previous.length - 1 - suffix) ===
      next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  return [
    {
      sourceId,
      start: prefix,
      end: previous.length - suffix,
      replacement: next.slice(prefix, next.length - suffix),
      reason,
    },
  ];
};

export const applySourcePatches = (
  document: SourceDocument,
  patches: readonly SourcePatch[],
): Result<SourceDocument> => {
  const sorted = [...patches].sort(
    (a, b) => b.start - a.start || b.end - a.end,
  );

  let lastStart = document.text.length + 1;
  for (const patch of sorted) {
    if (
      patch.sourceId !== document.sourceId ||
      !Number.isInteger(patch.start) ||
      !Number.isInteger(patch.end) ||
      patch.start < 0 ||
      patch.end < patch.start ||
      patch.end > document.text.length
    ) {
      return err(
        new StructuredError(
          "BACKEND_PATCH_RANGE",
          "Source patch has an invalid source id or text range.",
        ),
      );
    }
    if (patch.end > lastStart) {
      return err(
        new StructuredError(
          "BACKEND_PATCH_OVERLAP",
          "Source patches must not overlap.",
        ),
      );
    }
    lastStart = patch.start;
  }

  let text = document.text;
  for (const patch of sorted) {
    text =
      text.slice(0, patch.start) +
      patch.replacement +
      text.slice(patch.end);
  }

  return ok({
    ...structuredClone(document),
    text,
  });
};
