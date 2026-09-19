import ts from "@typescript/typescript6";
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
    case "never":
    case "unknown":
    case "void":
      return type.kind;
    case "null":
      return "null";
    case "list":
      return `Array<${renderType(type.element)}>`;
    case "record":
      return `{ ${Object.entries(type.fields)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, field]) => `${name}: ${renderType(field)}`)
        .join("; ")} }`;
    case "tuple":
      return `[${type.elements.map(renderType).join(", ")}]`;
    case "optional":
      return `${renderType(type.inner)} | undefined`;
    case "union":
      return type.options.map(renderType).join(" | ");
    case "intersection":
      return type.members.map(renderType).join(" & ");
    case "function":
      return `(${type.parameters
        .map((parameter, index) => `arg${index}: ${renderType(parameter)}`)
        .join(", ")}) => ${renderType(type.returns)}`;
    case "named":
      return type.symbolId.replace(/[^A-Za-z0-9_$]/gu, "_");
    case "generic":
      return `${renderType(type.base)}<${type.arguments
        .map(renderType)
        .join(", ")}>`;
    case "collection":
      if (type.collectionKind === "map" && type.key !== undefined) {
        return `Map<${renderType(type.key)}, ${renderType(type.value)}>`;
      }
      if (type.collectionKind === "set") {
        return `Set<${renderType(type.value)}>`;
      }
      return `Iterable<${renderType(type.value)}>`;
    case "type-variable":
      return type.name;
    case "result":
      return `{ ok: true; value: ${renderType(type.ok)} } | { ok: false; error: ${renderType(type.error)} }`;
    case "variant":
      return Object.entries(type.cases)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tag, payload]) =>
          payload === null
            ? `{ kind: ${JSON.stringify(tag)} }`
            : `{ kind: ${JSON.stringify(tag)}; value: ${renderType(payload)} }`,
        )
        .join(" | ");
    case "promise":
      return `Promise<${renderType(type.value)}>`;
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
    default:
      return err(
        new StructuredError(
          "TS_BACKEND_EXPRESSION_UNSUPPORTED",
          `TypeScript backend does not yet lower PIR expression kind ${expression.kind}.`,
        ),
      );
  }
};

const renderFunction = (fn: PirFunction): Result<string> => {
  if (fn.body === undefined) {
    return err(
      new StructuredError(
        "TS_BACKEND_STATEMENT_BODY_UNSUPPORTED",
        `TypeScript backend does not yet lower statement-bodied function ${fn.id}.`,
      ),
    );
  }
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
