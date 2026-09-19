import {
  canonicalJson,
  type JsonValue,
} from "../../core-types/src/index.ts";
import type {
  PirExpression,
  PirFunction,
  PirProgram,
  PirStatement,
  PirType,
} from "../../program-ir/src/index.ts";

const typeProjection = (type: PirType): JsonValue => {
  switch (type.kind) {
    case "boolean":
    case "number":
    case "string":
    case "null":
    case "void":
    case "never":
    case "unknown":
      return { kind: type.kind };
    case "record":
      return {
        kind: "record",
        fields: Object.fromEntries(
          Object.entries(type.fields)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, field]) => [name, typeProjection(field)]),
        ),
      };
    case "list":
      return {
        kind: "list",
        element: typeProjection(type.element),
      };
    case "tuple":
      return {
        kind: "tuple",
        elements: type.elements.map(typeProjection),
      };
    case "optional":
      return {
        kind: "optional",
        inner: typeProjection(type.inner),
      };
    case "union":
      return {
        kind: "union",
        options: type.options.map(typeProjection),
      };
    case "intersection":
      return {
        kind: "intersection",
        members: type.members.map(typeProjection),
      };
    case "function":
      return {
        kind: "function",
        parameters: type.parameters.map(typeProjection),
        returns: typeProjection(type.returns),
      };
    case "named":
      return {
        kind: "named",
        name: type.symbolId.replace(/^type:/u, ""),
        typeArguments: (type.typeArguments ?? []).map(typeProjection),
      };
    case "generic":
      return {
        kind: "generic",
        base: typeProjection(type.base),
        arguments: type.arguments.map(typeProjection),
      };
    case "collection":
      return {
        kind: "collection",
        collectionKind: type.collectionKind,
        ...(type.key === undefined
          ? {}
          : { key: typeProjection(type.key) }),
        value: typeProjection(type.value),
      };
    case "type-variable":
      return {
        kind: "type-variable",
        name: type.name,
        ...(type.bound === undefined
          ? {}
          : { bound: typeProjection(type.bound) }),
      };
    case "result":
      return {
        kind: "result",
        ok: typeProjection(type.ok),
        error: typeProjection(type.error),
      };
    case "variant":
      return {
        kind: "variant",
        cases: Object.fromEntries(
          Object.entries(type.cases)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, value]) => [
              name,
              value === null ? null : typeProjection(value),
            ]),
        ),
      };
    case "promise":
      return {
        kind: "promise",
        value: typeProjection(type.value),
      };
  }
};

interface ProjectionContext {
  names: Map<string, string>;
}

const expressionProjection = (
  expression: PirExpression,
  context: ProjectionContext,
): JsonValue => {
  const ref = (id: string): string =>
    context.names.get(id) ?? id.replace(/^[^:]+:/u, "");

  switch (expression.kind) {
    case "hole":
      return {
        kind: "hole",
        expected: typeProjection(expression.expected),
      };
    case "literal":
      return {
        kind: "literal",
        value: expression.value,
        type: typeProjection(expression.type),
      };
    case "variable":
    case "symbol-ref":
      return { kind: "ref", name: ref(expression.symbolId) };
    case "property":
      return {
        kind: "property",
        object: expressionProjection(expression.object, context),
        property: expression.property,
      };
    case "field-access":
      return {
        kind: "property",
        object: expressionProjection(expression.object, context),
        property: expression.field,
      };
    case "index-access": {
      const object = expressionProjection(expression.object, context);
      const index = expressionProjection(expression.index, context);
      if (
        typeof index === "object" &&
        index !== null &&
        !Array.isArray(index) &&
        index.kind === "literal" &&
        typeof index.value === "string"
      ) {
        return {
          kind: "property",
          object,
          property: index.value,
        };
      }
      return { kind: "index", object, index };
    }
    case "call":
      return {
        kind: "call",
        callee: expressionProjection(expression.callee, context),
        arguments: expression.arguments.map((argument) =>
          expressionProjection(argument, context),
        ),
      };
    case "construct":
      return {
        kind: "construct",
        targetType: typeProjection(expression.targetType),
        arguments: expression.arguments.map((argument) =>
          expressionProjection(argument, context),
        ),
      };
    case "unary":
      return {
        kind: "unary",
        operator: expression.operator,
        operand: expressionProjection(expression.operand, context),
      };
    case "binary":
    case "comparison":
      return {
        kind: expression.kind,
        operator: expression.operator,
        left: expressionProjection(expression.left, context),
        right: expressionProjection(expression.right, context),
      };
    case "logical":
      return {
        kind: "logical",
        operator: expression.operator,
        values: expression.values.map((value) =>
          expressionProjection(value, context),
        ),
      };
    case "conditional":
      return {
        kind: "conditional",
        condition: expressionProjection(expression.condition, context),
        whenTrue: expressionProjection(expression.whenTrue, context),
        whenFalse: expressionProjection(expression.whenFalse, context),
      };
    case "lambda": {
      const nested = { names: new Map(context.names) };
      for (const parameter of expression.parameters) {
        nested.names.set(parameter.id, parameter.name);
      }
      return {
        kind: "lambda",
        parameters: expression.parameters.map((parameter) => ({
          name: parameter.name,
          type: typeProjection(parameter.type),
        })),
        body: expressionProjection(expression.body, nested),
      };
    }
    case "await":
      return {
        kind: "await",
        value: expressionProjection(expression.value, context),
      };
    case "cast":
      return {
        kind: "cast",
        value: expressionProjection(expression.value, context),
        targetType: typeProjection(expression.targetType),
      };
    case "collection":
      return {
        kind: "collection",
        collectionKind: expression.collectionKind,
        elements: expression.elements.map((element) =>
          expressionProjection(element, context),
        ),
      };
    case "record":
      return {
        kind: "record",
        fields: Object.fromEntries(
          Object.entries(expression.fields)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, value]) => [
              name,
              expressionProjection(value, context),
            ]),
        ),
      };
    case "match":
      return {
        kind: "match",
        value: expressionProjection(expression.value, context),
        cases: expression.cases.map((entry) => ({
          pattern: entry.pattern.kind,
          expression: expressionProjection(entry.expression, context),
        })),
      };
    case "filter": {
      const nested = { names: new Map(context.names) };
      nested.names.set(expression.item.id, expression.item.name);
      return {
        kind: "filter",
        collection: expressionProjection(expression.collection, context),
        item: expression.item.name,
        predicate: expressionProjection(expression.predicate, nested),
      };
    }
    case "map": {
      const nested = { names: new Map(context.names) };
      nested.names.set(expression.item.id, expression.item.name);
      return {
        kind: "map",
        collection: expressionProjection(expression.collection, context),
        item: expression.item.name,
        mapper: expressionProjection(expression.mapper, nested),
      };
    }
  }
};

const statementProjection = (
  statement: PirStatement,
  context: ProjectionContext,
): JsonValue => {
  switch (statement.kind) {
    case "declare":
      context.names.set(statement.symbol.id, statement.symbol.existingName ??
        statement.symbol.namingIntent?.preferredTerms?.[0] ??
        statement.symbol.id);
      return {
        kind: "declare",
        name: context.names.get(statement.symbol.id)!,
        type: typeProjection(statement.type),
        ...(statement.initializer === undefined
          ? {}
          : {
              initializer: expressionProjection(
                statement.initializer,
                context,
              ),
            }),
      };
    case "assign":
      return {
        kind: "assign",
        target: expressionProjection(statement.target, context),
        value: expressionProjection(statement.value, context),
      };
    case "expression":
      return {
        kind: "expression",
        expression: expressionProjection(statement.expression, context),
      };
    case "return":
      return {
        kind: "return",
        ...(statement.value === undefined
          ? {}
          : { value: expressionProjection(statement.value, context) }),
      };
    case "if":
      return {
        kind: "if",
        condition: expressionProjection(statement.condition, context),
        then: statement.then.map((item) =>
          statementProjection(item, context),
        ),
        else: (statement.else ?? []).map((item) =>
          statementProjection(item, context),
        ),
      };
    case "loop":
      return {
        kind: "loop",
        ...(statement.condition === undefined
          ? {}
          : {
              condition: expressionProjection(
                statement.condition,
                context,
              ),
            }),
        body: statement.body.map((item) =>
          statementProjection(item, context),
        ),
      };
    case "for-each": {
      const nested = { names: new Map(context.names) };
      nested.names.set(statement.item.id, statement.item.name);
      return {
        kind: "for-each",
        item: statement.item.name,
        collection: expressionProjection(statement.collection, context),
        body: statement.body.map((item) =>
          statementProjection(item, nested),
        ),
      };
    }
    case "match":
      return {
        kind: "match-statement",
        value: expressionProjection(statement.value, context),
        cases: statement.cases.map((entry) => ({
          pattern: entry.pattern.kind,
          body: entry.body.map((item) =>
            statementProjection(item, context),
          ),
        })),
      };
    case "try":
      return {
        kind: "try",
        body: statement.body.map((item) =>
          statementProjection(item, context),
        ),
        catch: (statement.catch?.body ?? []).map((item) =>
          statementProjection(item, context),
        ),
        finally: (statement.finally ?? []).map((item) =>
          statementProjection(item, context),
        ),
      };
    case "throw":
      return {
        kind: "throw",
        value: expressionProjection(statement.value, context),
      };
    case "assert":
      return {
        kind: "assert",
        condition: expressionProjection(statement.condition, context),
        ...(statement.message === undefined
          ? {}
          : { message: statement.message }),
      };
    case "break":
    case "continue":
      return { kind: statement.kind };
    case "defer":
      return {
        kind: "defer",
        body: statement.body.map((item) =>
          statementProjection(item, context),
        ),
      };
    case "block":
      return {
        kind: "block",
        statements: statement.statements.map((item) =>
          statementProjection(item, context),
        ),
      };
    case "hole":
      return { kind: "hole-statement" };
  }
};

const functionProjection = (
  fn: PirFunction,
  globalNames: Map<string, string>,
): JsonValue => {
  const context: ProjectionContext = {
    names: new Map(globalNames),
  };
  for (const parameter of fn.parameters) {
    context.names.set(parameter.id, parameter.name);
  }

  const statements =
    fn.body !== undefined
      ? [
          {
            kind: "return",
            value: expressionProjection(fn.body, context),
          } as JsonValue,
        ]
      : (fn.statements ?? []).map((statement) =>
          statementProjection(statement, context),
        );

  return {
    name: fn.name,
    parameters: fn.parameters.map((parameter) => ({
      name: parameter.name,
      type: typeProjection(parameter.type),
    })),
    returnType: typeProjection(fn.returnType),
    async: fn.async === true,
    typeParameters: (fn.typeParameters ?? []).map((type) => type.name),
    statements,
  };
};

export interface PortableProgramSemantics {
  functions: JsonValue[];
}

export const projectPortableProgramSemantics = (
  program: PirProgram,
): PortableProgramSemantics => {
  const globalNames = new Map<string, string>(
    program.functions.map((fn) => [fn.id, fn.name]),
  );
  for (const symbol of program.symbols ?? []) {
    globalNames.set(
      symbol.id,
      symbol.existingName ??
        symbol.namingIntent?.preferredTerms?.[0] ??
        symbol.id,
    );
  }

  return {
    functions: [...program.functions]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((fn) => functionProjection(fn, globalNames)),
  };
};

export const portableProgramSemanticsDigest = (
  program: PirProgram,
): string =>
  canonicalJson(
    projectPortableProgramSemantics(program) as unknown as JsonValue,
  );
