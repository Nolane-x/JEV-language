import ts from "@typescript/typescript6";
import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  validatePirProgram,
  type ImportIntent,
  type PirExpression,
  type PirFunction,
  type PirModule,
  type PirParameter,
  type PirProgram,
  type PirStatement,
  type PirSymbol,
  type PirType,
  type SourceBinding,
} from "../../program-ir/src/index.ts";
import type {
  LiftResult,
  ParsedSource,
} from "./backend.ts";
import { liftTypeScriptType } from "./typescript-types.ts";

interface LiftContext {
  source: ts.SourceFile;
  sourceId: string;
  functionIds: Map<string, string>;
  typeIds: Map<string, string>;
  names: Map<string, string>;
  types: Map<string, PirType>;
  typeParameters: ReadonlySet<string>;
}

const sanitize = (value: string): string =>
  value.replace(/[^A-Za-z0-9_$.-]/gu, "_");

const sourceBinding = (
  source: ts.SourceFile,
  sourceId: string,
  node: ts.Node,
  existingName?: string,
): SourceBinding => ({
  sourceId,
  language: "typescript",
  ...(existingName === undefined ? {} : { existingName }),
  start: node.getStart(source),
  end: node.getEnd(),
});

const idFor = (
  kind: string,
  name: string,
  node: ts.Node,
): string => `${kind}:${sanitize(name)}:${node.getStart()}`;

const hasModifier = (
  node: ts.Node,
  kind: ts.SyntaxKind,
): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === kind,
  );

const isExported = (node: ts.Node): boolean =>
  hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
  hasModifier(node, ts.SyntaxKind.DefaultKeyword);

const literalExpression = (
  node: ts.Expression,
): PirExpression | undefined => {
  if (ts.isNumericLiteral(node)) {
    return {
      kind: "literal",
      value: Number(node.text),
      type: { kind: "number" },
    };
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return {
      kind: "literal",
      value: node.text,
      type: { kind: "string" },
    };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return {
      kind: "literal",
      value: true,
      type: { kind: "boolean" },
    };
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return {
      kind: "literal",
      value: false,
      type: { kind: "boolean" },
    };
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return {
      kind: "literal",
      value: null,
      type: { kind: "null" },
    };
  }
  return undefined;
};

const binaryOperator = (
  kind: ts.SyntaxKind,
):
  | { kind: "binary"; operator: "add" | "subtract" | "multiply" | "divide" | "modulo" | "power" }
  | { kind: "comparison"; operator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "identity" }
  | { kind: "logical"; operator: "and" | "or" }
  | undefined => {
  switch (kind) {
    case ts.SyntaxKind.PlusToken:
      return { kind: "binary", operator: "add" };
    case ts.SyntaxKind.MinusToken:
      return { kind: "binary", operator: "subtract" };
    case ts.SyntaxKind.AsteriskToken:
      return { kind: "binary", operator: "multiply" };
    case ts.SyntaxKind.SlashToken:
      return { kind: "binary", operator: "divide" };
    case ts.SyntaxKind.PercentToken:
      return { kind: "binary", operator: "modulo" };
    case ts.SyntaxKind.AsteriskAsteriskToken:
      return { kind: "binary", operator: "power" };
    case ts.SyntaxKind.EqualsEqualsToken:
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return { kind: "comparison", operator: "eq" };
    case ts.SyntaxKind.ExclamationEqualsToken:
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return { kind: "comparison", operator: "neq" };
    case ts.SyntaxKind.LessThanToken:
      return { kind: "comparison", operator: "lt" };
    case ts.SyntaxKind.LessThanEqualsToken:
      return { kind: "comparison", operator: "lte" };
    case ts.SyntaxKind.GreaterThanToken:
      return { kind: "comparison", operator: "gt" };
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return { kind: "comparison", operator: "gte" };
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return { kind: "logical", operator: "and" };
    case ts.SyntaxKind.BarBarToken:
      return { kind: "logical", operator: "or" };
    default:
      return undefined;
  }
};

const resolveIdentifier = (
  name: string,
  context: LiftContext,
): string | undefined =>
  context.names.get(name) ??
  context.functionIds.get(name) ??
  context.typeIds.get(name);

const liftExpression = (
  node: ts.Expression,
  context: LiftContext,
): Result<PirExpression> => {
  const literal = literalExpression(node);
  if (literal !== undefined) return ok(literal);

  if (ts.isIdentifier(node)) {
    const symbolId = resolveIdentifier(node.text, context);
    return symbolId === undefined
      ? err(
          new StructuredError(
            "TS_LIFT_UNKNOWN_IDENTIFIER",
            `Identifier is not declared in the supported lift environment: ${node.text}.`,
          ),
        )
      : ok({
          kind: context.functionIds.get(node.text) === symbolId
            ? "symbol-ref"
            : "variable",
          symbolId,
        });
  }

  if (ts.isParenthesizedExpression(node)) {
    return liftExpression(node.expression, context);
  }

  if (ts.isPropertyAccessExpression(node)) {
    const object = liftExpression(node.expression, context);
    return object.ok
      ? ok({
          kind: "property",
          object: object.value,
          property: node.name.text,
        })
      : object;
  }

  if (ts.isElementAccessExpression(node)) {
    if (node.argumentExpression === undefined) {
      return err(
        new StructuredError(
          "TS_LIFT_INDEX_ARGUMENT",
          "Element access requires an explicit index expression.",
        ),
      );
    }
    const object = liftExpression(node.expression, context);
    if (!object.ok) return object;
    const index = liftExpression(node.argumentExpression, context);
    return index.ok
      ? ok({
          kind: "index-access",
          object: object.value,
          index: index.value,
        })
      : index;
  }

  if (ts.isCallExpression(node)) {
    const callee = liftExpression(node.expression, context);
    if (!callee.ok) return callee;
    const args: PirExpression[] = [];
    for (const argument of node.arguments) {
      const lifted = liftExpression(argument, context);
      if (!lifted.ok) return lifted;
      args.push(lifted.value);
    }
    return ok({
      kind: "call",
      callee: callee.value,
      arguments: args,
    });
  }

  if (ts.isConditionalExpression(node)) {
    const condition = liftExpression(node.condition, context);
    if (!condition.ok) return condition;
    const whenTrue = liftExpression(node.whenTrue, context);
    if (!whenTrue.ok) return whenTrue;
    const whenFalse = liftExpression(node.whenFalse, context);
    return whenFalse.ok
      ? ok({
          kind: "conditional",
          condition: condition.value,
          whenTrue: whenTrue.value,
          whenFalse: whenFalse.value,
        })
      : whenFalse;
  }

  if (ts.isAwaitExpression(node)) {
    const value = liftExpression(node.expression, context);
    return value.ok
      ? ok({ kind: "await", value: value.value })
      : value;
  }

  if (ts.isPrefixUnaryExpression(node)) {
    const operand = liftExpression(node.operand, context);
    if (!operand.ok) return operand;
    switch (node.operator) {
      case ts.SyntaxKind.ExclamationToken:
        return ok({
          kind: "unary",
          operator: "not",
          operand: operand.value,
        });
      case ts.SyntaxKind.MinusToken:
        return ok({
          kind: "unary",
          operator: "negate",
          operand: operand.value,
        });
      case ts.SyntaxKind.PlusToken:
        return ok({
          kind: "unary",
          operator: "positive",
          operand: operand.value,
        });
      case ts.SyntaxKind.TildeToken:
        return ok({
          kind: "unary",
          operator: "bit-not",
          operand: operand.value,
        });
    }
  }

  if (ts.isBinaryExpression(node)) {
    const operator = binaryOperator(node.operatorToken.kind);
    if (operator === undefined) {
      return err(
        new StructuredError(
          "TS_LIFT_BINARY_UNSUPPORTED",
          `Unsupported binary operator: ${ts.SyntaxKind[node.operatorToken.kind]}.`,
        ),
      );
    }
    const left = liftExpression(node.left, context);
    if (!left.ok) return left;
    const right = liftExpression(node.right, context);
    if (!right.ok) return right;
    if (operator.kind === "logical") {
      return ok({
        kind: "logical",
        operator: operator.operator,
        values: [left.value, right.value],
      });
    }
    return ok({
      kind: operator.kind,
      operator: operator.operator,
      left: left.value,
      right: right.value,
    } as PirExpression);
  }

  if (ts.isArrayLiteralExpression(node)) {
    const elements: PirExpression[] = [];
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) {
        return err(
          new StructuredError(
            "TS_LIFT_SPREAD_UNSUPPORTED",
            "Array spread is not part of the current M12 lift subset.",
          ),
        );
      }
      const lifted = liftExpression(element, context);
      if (!lifted.ok) return lifted;
      elements.push(lifted.value);
    }
    return ok({
      kind: "collection",
      collectionKind: "list",
      elements,
    });
  }

  if (ts.isObjectLiteralExpression(node)) {
    const fields: Record<string, PirExpression> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        return err(
          new StructuredError(
            "TS_LIFT_OBJECT_MEMBER_UNSUPPORTED",
            "Only object property assignments are supported in the M12 lift subset.",
          ),
        );
      }
      const value = liftExpression(property.initializer, context);
      if (!value.ok) return value;
      fields[property.name.getText(context.source).replace(/^['"]|['"]$/gu, "")] =
        value.value;
    }
    return ok({ kind: "record", fields });
  }

  if (ts.isArrowFunction(node)) {
    const nested = new Map(context.names);
    const parameters: PirParameter[] = [];
    for (const parameter of node.parameters) {
      if (!ts.isIdentifier(parameter.name)) {
        return err(
          new StructuredError(
            "TS_LIFT_PARAMETER_PATTERN",
            "Destructured parameters are not supported in the M12 lift subset.",
          ),
        );
      }
      const type = liftTypeScriptType(
        parameter.type,
        context.typeParameters,
      );
      if (!type.ok) return type;
      const id = idFor("param", parameter.name.text, parameter);
      nested.set(parameter.name.text, id);
      parameters.push({
        id,
        name: parameter.name.text,
        type: type.value,
        sourceBinding: sourceBinding(
          context.source,
          context.sourceId,
          parameter,
          parameter.name.text,
        ),
      });
    }
    if (!ts.isExpression(node.body)) {
      return err(
        new StructuredError(
          "TS_LIFT_ARROW_BLOCK_UNSUPPORTED",
          "Block-bodied arrows are not part of the current expression lift subset.",
        ),
      );
    }
    const body = liftExpression(node.body, {
      ...context,
      names: nested,
    });
    return body.ok
      ? ok({
          kind: "lambda",
          parameters,
          body: body.value,
          effects: [{ kind: "pure" }],
        })
      : body;
  }

  return err(
    new StructuredError(
      "TS_LIFT_EXPRESSION_UNSUPPORTED",
      `Unsupported TypeScript expression: ${ts.SyntaxKind[node.kind]}.`,
    ),
  );
};

const inferSimpleExpressionType = (
  expression: PirExpression,
  context: LiftContext,
): PirType => {
  switch (expression.kind) {
    case "literal":
      return expression.type;
    case "variable":
    case "symbol-ref":
      return context.types.get(expression.symbolId) ?? { kind: "unknown" };
    case "collection":
      return {
        kind: "list",
        element:
          expression.elementType ??
          (expression.elements[0] === undefined
            ? { kind: "unknown" }
            : inferSimpleExpressionType(expression.elements[0], context)),
      };
    case "record":
      return {
        kind: "record",
        fields: Object.fromEntries(
          Object.entries(expression.fields).map(([name, value]) => [
            name,
            inferSimpleExpressionType(value, context),
          ]),
        ),
      };
    case "comparison":
    case "logical":
      return { kind: "boolean" };
    case "unary":
      return expression.operator === "not"
        ? { kind: "boolean" }
        : inferSimpleExpressionType(expression.operand, context);
    case "binary":
      return inferSimpleExpressionType(expression.left, context);
    case "conditional":
      return inferSimpleExpressionType(expression.whenTrue, context);
    default:
      return { kind: "unknown" };
  }
};

const liftVariableStatement = (
  statement: ts.VariableStatement,
  context: LiftContext,
): Result<PirStatement[]> => {
  const output: PirStatement[] = [];
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) {
      return err(
        new StructuredError(
          "TS_LIFT_VARIABLE_PATTERN",
          "Destructured variable declarations are not supported in the M12 lift subset.",
        ),
      );
    }

    let initializer: PirExpression | undefined;
    if (declaration.initializer !== undefined) {
      const lifted = liftExpression(declaration.initializer, context);
      if (!lifted.ok) return lifted;
      initializer = lifted.value;
    }

    const annotated = declaration.type === undefined
      ? undefined
      : liftTypeScriptType(declaration.type, context.typeParameters);
    if (annotated !== undefined && !annotated.ok) return annotated;

    const type =
      annotated?.value ??
      (initializer === undefined
        ? { kind: "unknown" as const }
        : inferSimpleExpressionType(initializer, context));

    const name = declaration.name.text;
    const id = idFor("local", name, declaration);
    const symbol: PirSymbol = {
      id,
      symbolKind: "variable",
      existingName: name,
      namingIntent: { preferredTerms: [name] },
      type,
      visibility: "private",
      sourceBinding: sourceBinding(
        context.source,
        context.sourceId,
        declaration,
        name,
      ),
    };

    output.push({
      kind: "declare",
      symbol,
      type,
      ...(initializer === undefined ? {} : { initializer }),
    });
    context.names.set(name, id);
    context.types.set(id, type);
  }
  return ok(output);
};

const liftStatementList = (
  statements: readonly ts.Statement[],
  context: LiftContext,
): Result<PirStatement[]> => {
  const output: PirStatement[] = [];

  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      const lifted = liftVariableStatement(statement, context);
      if (!lifted.ok) return lifted;
      output.push(...lifted.value);
      continue;
    }

    if (ts.isReturnStatement(statement)) {
      if (statement.expression === undefined) {
        output.push({ kind: "return" });
      } else {
        const value = liftExpression(statement.expression, context);
        if (!value.ok) return value;
        output.push({ kind: "return", value: value.value });
      }
      continue;
    }

    if (ts.isIfStatement(statement)) {
      const condition = liftExpression(statement.expression, context);
      if (!condition.ok) return condition;
      const thenStatements = ts.isBlock(statement.thenStatement)
        ? statement.thenStatement.statements
        : [statement.thenStatement];
      const thenBody = liftStatementList(thenStatements, {
        ...context,
        names: new Map(context.names),
        types: new Map(context.types),
      });
      if (!thenBody.ok) return thenBody;
      let elseBody: PirStatement[] | undefined;
      if (statement.elseStatement !== undefined) {
        const sourceStatements = ts.isBlock(statement.elseStatement)
          ? statement.elseStatement.statements
          : [statement.elseStatement];
        const liftedElse = liftStatementList(sourceStatements, {
          ...context,
          names: new Map(context.names),
          types: new Map(context.types),
        });
        if (!liftedElse.ok) return liftedElse;
        elseBody = liftedElse.value;
      }
      output.push({
        kind: "if",
        condition: condition.value,
        then: thenBody.value,
        ...(elseBody === undefined ? {} : { else: elseBody }),
      });
      continue;
    }

    if (ts.isWhileStatement(statement)) {
      const condition = liftExpression(statement.expression, context);
      if (!condition.ok) return condition;
      const bodyStatements = ts.isBlock(statement.statement)
        ? statement.statement.statements
        : [statement.statement];
      const body = liftStatementList(bodyStatements, {
        ...context,
        names: new Map(context.names),
        types: new Map(context.types),
      });
      if (!body.ok) return body;
      output.push({
        kind: "loop",
        condition: condition.value,
        body: body.value,
      });
      continue;
    }

    if (ts.isForOfStatement(statement)) {
      if (
        !ts.isVariableDeclarationList(statement.initializer) ||
        statement.initializer.declarations.length !== 1
      ) {
        return err(
          new StructuredError(
            "TS_LIFT_FOR_OF_BINDING",
            "For-of lifting requires exactly one variable declaration.",
          ),
        );
      }
      const declaration = statement.initializer.declarations[0]!;
      if (!ts.isIdentifier(declaration.name)) {
        return err(
          new StructuredError(
            "TS_LIFT_FOR_OF_PATTERN",
            "Destructured for-of bindings are not supported.",
          ),
        );
      }
      const collection = liftExpression(statement.expression, context);
      if (!collection.ok) return collection;
      const collectionType = inferSimpleExpressionType(
        collection.value,
        context,
      );
      let resolvedItemType: PirType;
      if (collectionType.kind === "list") {
        resolvedItemType = collectionType.element;
      } else if (declaration.type === undefined) {
        resolvedItemType = { kind: "unknown" };
      } else {
        const liftedItemType = liftTypeScriptType(
          declaration.type,
          context.typeParameters,
        );
        if (!liftedItemType.ok) return liftedItemType;
        resolvedItemType = liftedItemType.value;
      }
      const itemId = idFor("local", declaration.name.text, declaration);
      const nested = {
        ...context,
        names: new Map(context.names),
        types: new Map(context.types),
      };
      nested.names.set(declaration.name.text, itemId);
      nested.types.set(itemId, resolvedItemType);
      const bodyStatements = ts.isBlock(statement.statement)
        ? statement.statement.statements
        : [statement.statement];
      const body = liftStatementList(bodyStatements, nested);
      if (!body.ok) return body;
      output.push({
        kind: "for-each",
        item: {
          id: itemId,
          name: declaration.name.text,
          type: resolvedItemType,
          sourceBinding: sourceBinding(
            context.source,
            context.sourceId,
            declaration,
            declaration.name.text,
          ),
        },
        collection: collection.value,
        body: body.value,
      });
      continue;
    }

    if (ts.isThrowStatement(statement)) {
      const value = liftExpression(statement.expression, context);
      if (!value.ok) return value;
      output.push({ kind: "throw", value: value.value });
      continue;
    }

    if (ts.isTryStatement(statement)) {
      const body = liftStatementList(statement.tryBlock.statements, {
        ...context,
        names: new Map(context.names),
        types: new Map(context.types),
      });
      if (!body.ok) return body;
      let catchClause:
        | { parameter?: PirParameter; body: PirStatement[] }
        | undefined;
      if (statement.catchClause !== undefined) {
        const nested = {
          ...context,
          names: new Map(context.names),
          types: new Map(context.types),
        };
        let parameter: PirParameter | undefined;
        const variable = statement.catchClause.variableDeclaration;
        if (variable !== undefined) {
          if (!ts.isIdentifier(variable.name)) {
            return err(
              new StructuredError(
                "TS_LIFT_CATCH_PATTERN",
                "Destructured catch bindings are not supported.",
              ),
            );
          }
          const type = variable.type === undefined
            ? ok<PirType>({ kind: "unknown" })
            : liftTypeScriptType(
                variable.type,
                context.typeParameters,
              );
          if (!type.ok) return type;
          const id = idFor("catch", variable.name.text, variable);
          parameter = {
            id,
            name: variable.name.text,
            type: type.value,
            sourceBinding: sourceBinding(
              context.source,
              context.sourceId,
              variable,
              variable.name.text,
            ),
          };
          nested.names.set(variable.name.text, id);
          nested.types.set(id, type.value);
        }
        const catchBody = liftStatementList(
          statement.catchClause.block.statements,
          nested,
        );
        if (!catchBody.ok) return catchBody;
        catchClause = {
          ...(parameter === undefined ? {} : { parameter }),
          body: catchBody.value,
        };
      }
      let finallyBody: PirStatement[] | undefined;
      if (statement.finallyBlock !== undefined) {
        const liftedFinally = liftStatementList(
          statement.finallyBlock.statements,
          {
            ...context,
            names: new Map(context.names),
            types: new Map(context.types),
          },
        );
        if (!liftedFinally.ok) return liftedFinally;
        finallyBody = liftedFinally.value;
      }
      output.push({
        kind: "try",
        body: body.value,
        ...(catchClause === undefined ? {} : { catch: catchClause }),
        ...(finallyBody === undefined ? {} : { finally: finallyBody }),
      });
      continue;
    }

    if (ts.isBlock(statement)) {
      const body = liftStatementList(statement.statements, {
        ...context,
        names: new Map(context.names),
        types: new Map(context.types),
      });
      if (!body.ok) return body;
      output.push({ kind: "block", statements: body.value });
      continue;
    }

    if (ts.isExpressionStatement(statement)) {
      if (
        ts.isBinaryExpression(statement.expression) &&
        statement.expression.operatorToken.kind ===
          ts.SyntaxKind.EqualsToken
      ) {
        const target = liftExpression(
          statement.expression.left,
          context,
        );
        if (!target.ok) return target;
        const value = liftExpression(
          statement.expression.right,
          context,
        );
        if (!value.ok) return value;
        output.push({
          kind: "assign",
          target: target.value,
          value: value.value,
        });
      } else {
        const expression = liftExpression(
          statement.expression,
          context,
        );
        if (!expression.ok) return expression;
        output.push({
          kind: "expression",
          expression: expression.value,
        });
      }
      continue;
    }

    if (ts.isBreakStatement(statement)) {
      output.push({ kind: "break" });
      continue;
    }
    if (ts.isContinueStatement(statement)) {
      output.push({ kind: "continue" });
      continue;
    }

    return err(
      new StructuredError(
        "TS_LIFT_STATEMENT_UNSUPPORTED",
        `Unsupported TypeScript statement: ${ts.SyntaxKind[statement.kind]}.`,
      ),
    );
  }

  return ok(output);
};

const typeParameterSet = (
  declaration: ts.FunctionDeclaration,
): Set<string> =>
  new Set(
    (declaration.typeParameters ?? []).map(
      (parameter) => parameter.name.text,
    ),
  );

const liftFunction = (
  declaration: ts.FunctionDeclaration,
  parsed: ParsedSource<ts.SourceFile>,
  functionIds: Map<string, string>,
  typeIds: Map<string, string>,
  functionTypes: Map<string, PirType>,
): Result<PirFunction> => {
  if (declaration.name === undefined || declaration.body === undefined) {
    return err(
      new StructuredError(
        "TS_LIFT_FUNCTION_DECLARATION",
        "M12 lift requires named function declarations with bodies.",
      ),
    );
  }

  const typeParameters = typeParameterSet(declaration);
  const parameters: PirParameter[] = [];
  const names = new Map<string, string>();
  const types = new Map<string, PirType>(functionTypes);

  for (const parameter of declaration.parameters) {
    if (!ts.isIdentifier(parameter.name)) {
      return err(
        new StructuredError(
          "TS_LIFT_PARAMETER_PATTERN",
          "Destructured function parameters are not supported in the current M12 subset.",
        ),
      );
    }
    const type = liftTypeScriptType(parameter.type, typeParameters);
    if (!type.ok) return type;
    const id = idFor(
      "param",
      `${declaration.name.text}.${parameter.name.text}`,
      parameter,
    );
    names.set(parameter.name.text, id);
    types.set(id, type.value);
    parameters.push({
      id,
      name: parameter.name.text,
      type: type.value,
      sourceBinding: sourceBinding(
        parsed.ast,
        parsed.document.sourceId,
        parameter,
        parameter.name.text,
      ),
    });
  }

  const declaredReturn = liftTypeScriptType(
    declaration.type,
    typeParameters,
  );
  if (!declaredReturn.ok) return declaredReturn;
  const isAsync = hasModifier(
    declaration,
    ts.SyntaxKind.AsyncKeyword,
  );
  const returnType =
    isAsync && declaredReturn.value.kind === "promise"
      ? declaredReturn.value.value
      : declaredReturn.value;

  const context: LiftContext = {
    source: parsed.ast,
    sourceId: parsed.document.sourceId,
    functionIds,
    typeIds,
    names,
    types,
    typeParameters,
  };

  const statements = liftStatementList(
    declaration.body.statements,
    context,
  );
  if (!statements.ok) return statements;

  const typeParameterModels: Array<
    Extract<PirType, { kind: "type-variable" }>
  > = [];
  for (const parameter of declaration.typeParameters ?? []) {
    let bound: PirType | undefined;
    if (parameter.constraint !== undefined) {
      const liftedBound = liftTypeScriptType(
        parameter.constraint,
        typeParameters,
      );
      if (!liftedBound.ok) return liftedBound;
      bound = liftedBound.value;
    }
    typeParameterModels.push({
      kind: "type-variable",
      id: `type:${parameter.name.text}`,
      name: parameter.name.text,
      ...(bound === undefined ? {} : { bound }),
    });
  }

  return ok({
    kind: "function",
    id: functionIds.get(declaration.name.text)!,
    name: declaration.name.text,
    parameters,
    returnType,
    ...(typeParameterModels.length === 0
      ? {}
      : { typeParameters: typeParameterModels }),
    statements: statements.value,
    effects: isAsync
      ? [{ kind: "async" }]
      : [{ kind: "pure" }],
    ...(isAsync ? { async: true } : {}),
    visibility: isExported(declaration) ? "public" : "internal",
    sourceBinding: sourceBinding(
      parsed.ast,
      parsed.document.sourceId,
      declaration,
      declaration.name.text,
    ),
  });
};

const liftImports = (
  source: ts.SourceFile,
): ImportIntent[] => {
  const imports: ImportIntent[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const symbols: string[] = [];
    const clause = statement.importClause;
    if (clause?.name !== undefined) symbols.push(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings !== undefined) {
      if (ts.isNamespaceImport(bindings)) {
        symbols.push(bindings.name.text);
      } else {
        for (const element of bindings.elements) {
          symbols.push(element.name.text);
        }
      }
    }
    imports.push({
      module: statement.moduleSpecifier.text,
      ...(symbols.length === 0 ? {} : { symbols }),
      ...(clause?.isTypeOnly === true ? { typeOnly: true } : {}),
    });
  }
  return imports;
};

const liftTypeSymbol = (
  declaration: ts.TypeAliasDeclaration | ts.InterfaceDeclaration,
  parsed: ParsedSource<ts.SourceFile>,
): Result<PirSymbol> => {
  const name = declaration.name.text;
  let type: PirType;

  if (ts.isTypeAliasDeclaration(declaration)) {
    const lifted = liftTypeScriptType(
      declaration.type,
      new Set(
        declaration.typeParameters?.map(
          (parameter) => parameter.name.text,
        ) ?? [],
      ),
    );
    if (!lifted.ok) return lifted;
    type = lifted.value;
  } else {
    const fields: Record<string, PirType> = {};
    for (const member of declaration.members) {
      if (
        !ts.isPropertySignature(member) ||
        member.name === undefined
      ) {
        return err(
          new StructuredError(
            "TS_LIFT_INTERFACE_MEMBER",
            "Only property signatures are supported in lifted interfaces.",
          ),
        );
      }
      const memberType = liftTypeScriptType(member.type);
      if (!memberType.ok) return memberType;
      fields[member.name.getText(parsed.ast)] =
        member.questionToken === undefined
          ? memberType.value
          : { kind: "optional", inner: memberType.value };
    }
    type = { kind: "record", fields };
  }

  return ok({
    id: `type:${name}`,
    symbolKind: "type",
    existingName: name,
    namingIntent: { preferredTerms: [name], style: "pascal" },
    type,
    visibility: isExported(declaration) ? "public" : "internal",
    sourceBinding: sourceBinding(
      parsed.ast,
      parsed.document.sourceId,
      declaration,
      name,
    ),
  });
};

export const liftTypeScriptProgram = (
  parsed: ParsedSource<ts.SourceFile>,
): Result<LiftResult> => {
  if (
    parsed.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    )
  ) {
    return err(
      new StructuredError(
        "TS_LIFT_PARSE_ERRORS",
        "Cannot lift a TypeScript source file with parse errors.",
      ),
    );
  }

  const functionDeclarations = parsed.ast.statements.filter(
    ts.isFunctionDeclaration,
  );
  const functionIds = new Map<string, string>();
  for (const declaration of functionDeclarations) {
    if (declaration.name === undefined) continue;
    functionIds.set(
      declaration.name.text,
      idFor("function", declaration.name.text, declaration),
    );
  }

  const typeIds = new Map<string, string>();
  const typeDeclarations = parsed.ast.statements.filter(
    (
      statement,
    ): statement is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement),
  );
  for (const declaration of typeDeclarations) {
    typeIds.set(declaration.name.text, `type:${declaration.name.text}`);
  }

  const functionTypes = new Map<string, PirType>();
  for (const declaration of functionDeclarations) {
    if (
      declaration.name === undefined ||
      !functionIds.has(declaration.name.text)
    ) {
      continue;
    }
    const typeParameters = typeParameterSet(declaration);
    const parameterTypes: PirType[] = [];
    for (const parameter of declaration.parameters) {
      const lifted = liftTypeScriptType(
        parameter.type,
        typeParameters,
      );
      if (!lifted.ok) return lifted;
      parameterTypes.push(lifted.value);
    }
    const liftedReturn = liftTypeScriptType(
      declaration.type,
      typeParameters,
    );
    if (!liftedReturn.ok) return liftedReturn;
    const isAsync = hasModifier(
      declaration,
      ts.SyntaxKind.AsyncKeyword,
    );
    const returns =
      isAsync && liftedReturn.value.kind === "promise"
        ? liftedReturn.value.value
        : liftedReturn.value;
    functionTypes.set(functionIds.get(declaration.name.text)!, {
      kind: "function",
      parameters: parameterTypes,
      returns,
      effects: isAsync
        ? [{ kind: "async" }]
        : [{ kind: "pure" }],
    });
  }

  const symbols: PirSymbol[] = [];
  for (const declaration of typeDeclarations) {
    const symbol = liftTypeSymbol(declaration, parsed);
    if (!symbol.ok) return symbol;
    symbols.push(symbol.value);
  }

  const functions: PirFunction[] = [];
  for (const declaration of functionDeclarations) {
    const fn = liftFunction(
      declaration,
      parsed,
      functionIds,
      typeIds,
      functionTypes,
    );
    if (!fn.ok) return fn;
    functions.push(fn.value);
  }

  const moduleId = `module:${sanitize(parsed.document.sourceId)}`;
  const declarations = [
    ...symbols.map((symbol) => symbol.id),
    ...functions.map((fn) => fn.id),
  ];
  const exports = [
    ...typeDeclarations
      .filter(isExported)
      .map((declaration) => `type:${declaration.name.text}`),
    ...functionDeclarations
      .filter(
        (declaration) =>
          declaration.name !== undefined && isExported(declaration),
      )
      .map(
        (declaration) =>
          functionIds.get(declaration.name!.text)!,
      ),
  ];
  const module: PirModule = {
    id: moduleId,
    kind: "module",
    nameIntent: {
      preferredTerms: [
        parsed.document.path ?? parsed.document.sourceId,
      ],
      style: "backend-default",
    },
    exports,
    imports: liftImports(parsed.ast),
    declarations,
    sourceBinding: {
      sourceId: parsed.document.sourceId,
      language: "typescript",
      start: 0,
      end: parsed.document.text.length,
    },
  };

  const program: PirProgram = {
    version: "1.0.0",
    modules: [module],
    symbols,
    functions,
    sourceBindings: [
      module.sourceBinding!,
      ...symbols
        .map((symbol) => symbol.sourceBinding)
        .filter(
          (binding): binding is SourceBinding =>
            binding !== undefined,
        ),
      ...functions
        .map((fn) => fn.sourceBinding)
        .filter(
          (binding): binding is SourceBinding =>
            binding !== undefined,
        ),
      ...functions.flatMap((fn) =>
        fn.parameters
          .map((parameter) => parameter.sourceBinding)
          .filter(
            (binding): binding is SourceBinding =>
              binding !== undefined,
          ),
      ),
    ],
  };

  const valid = validatePirProgram(program);
  if (!valid.ok) {
    return err(
      new StructuredError(
        "TS_LIFT_PIR_INVALID",
        `Lifted PIR failed validation: ${valid.error.code}: ${valid.error.message}`,
      ),
    );
  }

  return ok({
    program,
    sourceBindings: structuredClone(program.sourceBindings ?? []),
    diagnostics: [],
  });
};
