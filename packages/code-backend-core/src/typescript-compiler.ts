import ts from "@typescript/typescript6";
import {
  ok,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  NormalizedCompilerDiagnostic,
  ParsedSource,
  SourceDocument,
  TypecheckResult,
} from "./backend.ts";

const diagnosticSeverity = (
  category: ts.DiagnosticCategory,
): NormalizedCompilerDiagnostic["severity"] => {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    case ts.DiagnosticCategory.Message:
    case ts.DiagnosticCategory.Suggestion:
      return "info";
  }
};

export const normalizeTypeScriptDiagnostic = (
  diagnostic: ts.Diagnostic,
  fallbackSourceId?: string,
): NormalizedCompilerDiagnostic => {
  const sourceId = diagnostic.file?.fileName ?? fallbackSourceId;
  let line: number | undefined;
  let column: number | undefined;
  if (diagnostic.file !== undefined && diagnostic.start !== undefined) {
    const position = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start,
    );
    line = position.line + 1;
    column = position.character + 1;
  }

  return {
    code: `TS${diagnostic.code}`,
    severity: diagnosticSeverity(diagnostic.category),
    message: ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n",
    ),
    ...(sourceId === undefined ? {} : { sourceId }),
    ...(diagnostic.start === undefined
      ? {}
      : { start: diagnostic.start }),
    ...(diagnostic.length === undefined
      ? {}
      : { length: diagnostic.length }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    category: ts.DiagnosticCategory[diagnostic.category],
  };
};

export const parseTypeScriptDocument = (
  document: SourceDocument,
): Result<ParsedSource<ts.SourceFile>> => {
  const fileName = document.path ?? `/virtual/${document.sourceId}.ts`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    noLib: true,
    noResolve: true,
  };
  const host = ts.createCompilerHost(options);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  const baseReadFile = host.readFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);

  host.fileExists = (name) =>
    name === fileName || baseFileExists(name);
  host.readFile = (name) =>
    name === fileName ? document.text : baseReadFile(name);
  host.getSourceFile = (
    name,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) =>
    name === fileName
      ? ts.createSourceFile(
          name,
          document.text,
          languageVersion,
          true,
          ts.ScriptKind.TS,
        )
      : baseGetSourceFile(
          name,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        );

  const program = ts.createProgram([fileName], options, host);
  const ast = program.getSourceFile(fileName);
  if (ast === undefined) {
    return ok({
      document: structuredClone(document),
      ast: ts.createSourceFile(
        fileName,
        document.text,
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.TS,
      ),
      diagnostics: [
        {
          code: "TS_PARSE_SOURCE_MISSING",
          severity: "error",
          message: "TypeScript parser did not produce a source file.",
          sourceId: document.sourceId,
        },
      ],
    });
  }

  const diagnostics = program
    .getSyntacticDiagnostics(ast)
    .map((diagnostic) =>
      normalizeTypeScriptDiagnostic(
        diagnostic,
        document.sourceId,
      ),
    );

  return ok({
    document: structuredClone(document),
    ast,
    diagnostics,
  });
};

const compilerOptions: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
};

export const typecheckTypeScriptDocument = (
  document: SourceDocument,
): TypecheckResult => {
  const fileName = document.path ?? `/virtual/${document.sourceId}.ts`;
  const host = ts.createCompilerHost(compilerOptions);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  const baseReadFile = host.readFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);

  host.fileExists = (name) =>
    name === fileName || baseFileExists(name);
  host.readFile = (name) =>
    name === fileName ? document.text : baseReadFile(name);
  host.getSourceFile = (
    name,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) =>
    name === fileName
      ? ts.createSourceFile(
          name,
          document.text,
          languageVersion,
          true,
          ts.ScriptKind.TS,
        )
      : baseGetSourceFile(
          name,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        );

  const program = ts.createProgram(
    [fileName],
    compilerOptions,
    host,
  );
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) =>
      normalizeTypeScriptDiagnostic(
        diagnostic,
        document.sourceId,
      ),
    );

  return {
    ok: diagnostics.every(
      (diagnostic) => diagnostic.severity !== "error",
    ),
    diagnostics,
  };
};
