import * as ts from "typescript";
import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  PirExpression,
  PirFunction,
  PirProgram,
  PirType,
} from "../../program-ir/src/index.ts";

const renderType = (type: PirType): string => {
  switch (type.kind) {
    case "boolean":
    case "number":
    case "string":
      return type.kind;
    case "list":
      return `Array<${renderType(type.element)}>`;
    case "record":
      return `{ ${Object.entries(type.fields)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, field]) => `${name}: ${renderType(field)}`)
        .join("; ")} }`;
  }
};

const renderExpression = (
  expression: PirExpression,
  names: Map<string, string>,
): Result<string> => {
  switch (expression.kind) {
    case "hole":
      return err(
        new StructuredError(
          "TS_BACKEND_UNFILLED_HOLE",
          `Cannot lower unfilled PIR hole ${expression.id}`,
        ),
      );
    case "variable": {
      const name = names.get(expression.symbolId);
      return name === undefined
        ? err(
            new StructuredError(
              "TS_BACKEND_UNKNOWN_SYMBOL",
              `Unknown symbol during lowering: ${expression.symbolId}`,
            ),
          )
        : ok(name);
    }
    case "property": {
      const object = renderExpression(expression.object, names);
      return object.ok
        ? ok(`${object.value}.${expression.property}`)
        : object;
    }
    case "filter": {
      const collection = renderExpression(expression.collection, names);
      if (!collection.ok) return collection;
      const nested = new Map(names);
      nested.set(expression.item.id, expression.item.name);
      const predicate = renderExpression(expression.predicate, nested);
      if (!predicate.ok) return predicate;
      return ok(
        `${collection.value}.filter((${expression.item.name}) => ${predicate.value})`,
      );
    }
  }
};

const renderFunction = (fn: PirFunction): Result<string> => {
  const names = new Map(fn.parameters.map((parameter) => [parameter.id, parameter.name]));
  const body = renderExpression(fn.body, names);
  if (!body.ok) return body;
  const parameters = fn.parameters
    .map((parameter) => `${parameter.name}: ${renderType(parameter.type)}`)
    .join(", ");
  return ok(
    `export function ${fn.name}(${parameters}): ${renderType(fn.returnType)} {\n  return ${body.value};\n}`,
  );
};

export const renderTypeScript = (program: PirProgram): Result<string> => {
  const rendered: string[] = [];
  for (const fn of program.functions) {
    const result = renderFunction(fn);
    if (!result.ok) return result;
    rendered.push(result.value);
  }
  return ok(`${rendered.join("\n\n")}\n`);
};

export const typecheckTypeScript = (source: string): string[] => {
  const fileName = "/virtual/jev-language-candidate.ts";
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  const baseReadFile = host.readFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);

  host.fileExists = (name) => name === fileName || baseFileExists(name);
  host.readFile = (name) => (name === fileName ? source : baseReadFile(name));
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === fileName
      ? ts.createSourceFile(name, source, languageVersion, true)
      : baseGetSourceFile(
          name,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        );

  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
};
