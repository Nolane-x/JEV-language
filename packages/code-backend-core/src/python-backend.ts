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
  compilePythonDocument,
  parsePythonDocument,
  printPythonAst,
  type PythonAstNode,
} from "./python-ast.ts";
import { liftPythonProgram } from "./python-lift.ts";
import { lowerPirToPythonAst } from "./python-lower.ts";

export const pythonBackendManifest: ProgrammingBackendManifest = {
  id: "backend.python",
  version: "1.0.0",
  language: "python",
  extensions: [".py"],
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
    parserAdapter: "python-stdlib-ast",
    printerAdapter: "python-stdlib-ast-unparse",
    typecheckMode: "python-compile-dynamic",
    dynamicUnannotatedType: "unknown",
    staticAnnotations: "optional",
    recordLowering: "mapping-semantics",
    patchStrategy: "minimal-common-prefix-suffix",
  },
};

export class PythonProgrammingBackend
  implements ProgrammingBackend<PythonAstNode>
{
  readonly manifest = pythonBackendManifest;

  parse(
    document: SourceDocument,
  ): Result<ParsedSource<PythonAstNode>> {
    return parsePythonDocument(document);
  }

  lift(
    parsed: ParsedSource<PythonAstNode>,
  ): Result<LiftResult> {
    return liftPythonProgram(parsed);
  }

  lower(program: PirProgram): Result<LowerResult<PythonAstNode>> {
    return lowerPirToPythonAst(program);
  }

  print(lowered: LowerResult<PythonAstNode>): Result<string> {
    return printPythonAst(lowered.ast, "generated-python");
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
        "python-backend-lowering",
      ),
    );
  }

  typecheck(document: SourceDocument): TypecheckResult {
    return compilePythonDocument(document);
  }
}

export const createPythonBackend = (): Result<
  PythonProgrammingBackend
> => {
  const valid = validateProgrammingBackendManifest(
    pythonBackendManifest,
  );
  return valid.ok
    ? ok(new PythonProgrammingBackend())
    : err(valid.error);
};

export const formatPythonDocument = (
  document: SourceDocument,
): Result<string> => {
  const parsed = parsePythonDocument(document);
  if (!parsed.ok) return parsed;
  if (
    parsed.value.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    )
  ) {
    return ok(document.text);
  }
  return printPythonAst(parsed.value.ast, document.sourceId);
};
