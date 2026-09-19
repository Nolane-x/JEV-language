import ts from "@typescript/typescript6";
import {
  err,
  ok,
  type Result,
} from "../../core-types/src/index.ts";
import type { PirProgram } from "../../program-ir/src/index.ts";
import {
  createMinimalTextPatch,
  validateProgrammingBackendManifest,
  type LiftResult,
  type LowerResult,
  type ParsedSource,
  type ProgrammingBackend,
  type ProgrammingBackendManifest,
  type SourceDocument,
  type SourcePatch,
  type TypecheckResult,
} from "./backend.ts";
import {
  parseTypeScriptDocument,
  typecheckTypeScriptDocument,
} from "./typescript-compiler.ts";
import { liftTypeScriptProgram } from "./typescript-lift.ts";
import {
  lowerPirToTypeScriptAst,
  printTypeScriptAst,
} from "./typescript-lower.ts";

export const typeScriptBackendManifest: ProgrammingBackendManifest = {
  id: "backend.typescript",
  version: "1.0.0",
  language: "typescript",
  extensions: [".ts", ".tsx"],
  capabilities: [
    "parse",
    "lift",
    "lower",
    "print",
    "patch",
    "diagnostics",
    "typecheck",
  ],
  pirVersion: "1.0.0",
  annotations: {
    compilerAdapter: "@typescript/typescript6",
    target: "ES2022",
    module: "ESNext",
    patchStrategy: "minimal-common-prefix-suffix",
  },
};

export class TypeScriptProgrammingBackend
  implements ProgrammingBackend<ts.SourceFile>
{
  readonly manifest = typeScriptBackendManifest;

  parse(
    document: SourceDocument,
  ): Result<ParsedSource<ts.SourceFile>> {
    return parseTypeScriptDocument(document);
  }

  lift(parsed: ParsedSource<ts.SourceFile>): Result<LiftResult> {
    return liftTypeScriptProgram(parsed);
  }

  lower(program: PirProgram): Result<LowerResult<ts.SourceFile>> {
    return lowerPirToTypeScriptAst(program);
  }

  print(lowered: LowerResult<ts.SourceFile>): Result<string> {
    return printTypeScriptAst(lowered);
  }

  patch(
    original: SourceDocument,
    program: PirProgram,
  ): Result<SourcePatch[]> {
    const lowered = this.lower(program);
    if (!lowered.ok) return lowered;
    const printed = this.print(lowered.value);
    if (!printed.ok) return printed;
    return ok(
      createMinimalTextPatch(
        original.sourceId,
        original.text,
        printed.value,
        "typescript-backend-lowering",
      ),
    );
  }

  typecheck(document: SourceDocument): TypecheckResult {
    return typecheckTypeScriptDocument(document);
  }
}

export const createTypeScriptBackend = (): Result<
  TypeScriptProgrammingBackend
> => {
  const valid = validateProgrammingBackendManifest(
    typeScriptBackendManifest,
  );
  return valid.ok
    ? ok(new TypeScriptProgrammingBackend())
    : err(valid.error);
};

export const formatTypeScriptDocument = (
  document: SourceDocument,
): Result<string> => {
  const parsed = parseTypeScriptDocument(document);
  if (!parsed.ok) return parsed;
  if (
    parsed.value.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    )
  ) {
    return ok(document.text);
  }

  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: false,
  });
  return ok(
    printer.printFile(parsed.value.ast).replace(/[ \t]+$/gmu, "") +
      "\n",
  );
};
