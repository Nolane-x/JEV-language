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
  PirPattern,
  PirProgram,
  PirStatement,
  PirSymbol,
  SourceBinding,
} from "../../program-ir/src/index.ts";
import type { LowerResult } from "./backend.ts";
import { lowerPirType } from "./typescript-types.ts";

const sanitizeIdentifier = (value: string): string => {
  const sanitized = value.replace(/[^A-Za-z0-9_$]/gu, "_");
  return /^[A-Za-z_$]/u.test(sanitized) ? sanitized : `_${sanitized}`;
};

const symbolName = (symbol: PirSymbol): string =>
  sanitizeIdentifier(
    symbol.existingName ??
      symbol.namingIntent?.preferredTerms?.[0] ??
      symbol.id,
  );

const binaryToken = (
  operator: Extract<PirExpression, { kind: "binary" }>["operator"],
): ts.BinaryOperator => {
  switch (operator) {
    case "add":
      return ts.SyntaxKind.PlusToken;
    case "subtract":
      return ts.SyntaxKind.MinusToken;
    case "multiply":
      return ts.SyntaxKind.AsteriskToken;
    case "divide":
      return ts.SyntaxKind.SlashToken;
    case "modulo":
      return ts.SyntaxKind.PercentToken;
    case "power":
      return ts.SyntaxKind.AsteriskAsteriskToken;
  }
};

const comparisonToken = (
  operator: Extract<PirExpression, { kind: "comparison" }>["operator"],
): ts.BinaryOperator => {
  switch (operator) {
    case "eq":
      return ts.SyntaxKind.EqualsEqualsEqualsToken;
    case "neq":
      return ts.SyntaxKind.ExclamationEqualsEqualsToken;
    case "lt":
      return ts.SyntaxKind.LessThanToken;
    case "lte":
      return ts.SyntaxKind.LessThanEqualsToken;
    case "gt":
      return ts.SyntaxKind.GreaterThanToken;
    case "gte":
      return ts.SyntaxKind.GreaterThanEqualsToken;
    case "identity":
      return ts.SyntaxKind.EqualsEqualsEqualsToken;
  }
};

const logicalToken = (
  operator: Extract<PirExpression, { kind: "logical" }>["operator"],
): ts.BinaryOperator =>
  operator === "and"
    ? ts.SyntaxKind.AmpersandAmpersandToken
    : operator === "or"
      ? ts.SyntaxKind.BarBarToken
      : ts.SyntaxKind.CaretToken;

const literalNode = (value: unknown): ts.Expression => {
  if (value === null) return ts.factory.createNull();
  if (typeof value === "string") {
    return ts.factory.createStringLiteral(value);
  }
  if (typeof value === "number") {
    return ts.factory.createNumericLiteral(value);
  }
  if (typeof value === "boolean") {
    return value ? ts.factory.createTrue() : ts.factory.createFalse();
  }
  if (Array.isArray(value)) {
    return ts.factory.createArrayLiteralExpression(
      value.map(literalNode),
      false,
    );
  }
  if (typeof value === "object") {
    return ts.factory.createObjectLiteralExpression(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, entry]) =>
          ts.factory.createPropertyAssignment(
            ts.factory.createStringLiteral(name),
            literalNode(entry),
          ),
        ),
      false,
    );
  }
  return ts.factory.createIdentifier("undefined");
};

interface LowerContext {
  names: Map<string, string>;
}

const nameOf = (
  id: string,
  context: LowerContext,
): Result<string> => {
  const name = context.names.get(id);
  return name === undefined
    ? err(
        new StructuredError(
          "TS_LOWER_UNKNOWN_SYMBOL",
          `No TypeScript name is available for PIR symbol ${id}.`,
        ),
      )
    : ok(name);
};

const lowerExpression = (
  expression: PirExpression,
  context: LowerContext,
): Result<ts.Expression> => {
  switch (expression.kind) {
    case "hole":
      return err(
        new StructuredError(
          "TS_LOWER_UNFILLED_HOLE",
          `Cannot lower unfilled PIR hole ${expression.id}.`,
        ),
      );
    case "literal":
      return ok(literalNode(expression.value));
    case "variable":
    case "symbol-ref": {
      const name = nameOf(expression.symbolId, context);
      return name.ok
        ? ok(ts.factory.createIdentifier(name.value))
        : name;
    }
    case "property":
    case "field-access": {
      const object = lowerExpression(expression.object, context);
      if (!object.ok) return object;
      const property =
        expression.kind === "property"
          ? expression.property
          : expression.field;
      return ok(
        ts.factory.createPropertyAccessExpression(
          object.value,
          sanitizeIdentifier(property),
        ),
      );
    }
    case "index-access": {
      const object = lowerExpression(expression.object, context);
      if (!object.ok) return object;
      const index = lowerExpression(expression.index, context);
      return index.ok
        ? ok(
            ts.factory.createElementAccessExpression(
              object.value,
              index.value,
            ),
          )
        : index;
    }
    case "call": {
      const callee = lowerExpression(expression.callee, context);
      if (!callee.ok) return callee;
      const args: ts.Expression[] = [];
      for (const argument of expression.arguments) {
        const lowered = lowerExpression(argument, context);
        if (!lowered.ok) return lowered;
        args.push(lowered.value);
      }
      return ok(
        ts.factory.createCallExpression(
          callee.value,
          undefined,
          args,
        ),
      );
    }
    case "construct": {
      if (expression.targetType.kind !== "named") {
        return err(
          new StructuredError(
            "TS_LOWER_CONSTRUCT_TYPE",
            "TypeScript constructor lowering currently requires a named target type.",
          ),
        );
      }
      const target = expression.targetType.symbolId.startsWith("type:")
        ? expression.targetType.symbolId.slice(5)
        : expression.targetType.symbolId;
      const args: ts.Expression[] = [];
      for (const argument of expression.arguments) {
        const lowered = lowerExpression(argument, context);
        if (!lowered.ok) return lowered;
        args.push(lowered.value);
      }
      return ok(
        ts.factory.createNewExpression(
          ts.factory.createIdentifier(sanitizeIdentifier(target)),
          expression.targetType.typeArguments?.map(lowerPirType),
          args,
        ),
      );
    }
    case "unary": {
      const operand = lowerExpression(expression.operand, context);
      if (!operand.ok) return operand;
      switch (expression.operator) {
        case "not":
          return ok(
            ts.factory.createPrefixUnaryExpression(
              ts.SyntaxKind.ExclamationToken,
              operand.value,
            ),
          );
        case "negate":
          return ok(
            ts.factory.createPrefixUnaryExpression(
              ts.SyntaxKind.MinusToken,
              operand.value,
            ),
          );
        case "positive":
          return ok(
            ts.factory.createPrefixUnaryExpression(
              ts.SyntaxKind.PlusToken,
              operand.value,
            ),
          );
        case "bit-not":
          return ok(
            ts.factory.createPrefixUnaryExpression(
              ts.SyntaxKind.TildeToken,
              operand.value,
            ),
          );
      }
    }
    case "binary": {
      const left = lowerExpression(expression.left, context);
      if (!left.ok) return left;
      const right = lowerExpression(expression.right, context);
      return right.ok
        ? ok(
            ts.factory.createBinaryExpression(
              left.value,
              binaryToken(expression.operator),
              right.value,
            ),
          )
        : right;
    }
    case "comparison": {
      const left = lowerExpression(expression.left, context);
      if (!left.ok) return left;
      const right = lowerExpression(expression.right, context);
      return right.ok
        ? ok(
            ts.factory.createBinaryExpression(
              left.value,
              comparisonToken(expression.operator),
              right.value,
            ),
          )
        : right;
    }
    case "logical": {
      if (expression.values.length === 0) {
        return err(
          new StructuredError(
            "TS_LOWER_LOGICAL_EMPTY",
            "Logical PIR expressions require at least one operand.",
          ),
        );
      }
      const lowered: ts.Expression[] = [];
      for (const value of expression.values) {
        const item = lowerExpression(value, context);
        if (!item.ok) return item;
        lowered.push(item.value);
      }
      let current = lowered[0]!;
      for (const value of lowered.slice(1)) {
        current = ts.factory.createBinaryExpression(
          current,
          logicalToken(expression.operator),
          value,
        );
      }
      return ok(current);
    }
    case "conditional": {
      const condition = lowerExpression(expression.condition, context);
      if (!condition.ok) return condition;
      const whenTrue = lowerExpression(expression.whenTrue, context);
      if (!whenTrue.ok) return whenTrue;
      const whenFalse = lowerExpression(expression.whenFalse, context);
      return whenFalse.ok
        ? ok(
            ts.factory.createConditionalExpression(
              condition.value,
              ts.factory.createToken(ts.SyntaxKind.QuestionToken),
              whenTrue.value,
              ts.factory.createToken(ts.SyntaxKind.ColonToken),
              whenFalse.value,
            ),
          )
        : whenFalse;
    }
    case "lambda": {
      const nested: LowerContext = {
        names: new Map(context.names),
      };
      const parameters = expression.parameters.map((parameter) => {
        const name = sanitizeIdentifier(parameter.name);
        nested.names.set(parameter.id, name);
        return ts.factory.createParameterDeclaration(
          undefined,
          undefined,
          name,
          undefined,
          lowerPirType(parameter.type),
          undefined,
        );
      });
      const body = lowerExpression(expression.body, nested);
      return body.ok
        ? ok(
            ts.factory.createArrowFunction(
              undefined,
              undefined,
              parameters,
              undefined,
              ts.factory.createToken(
                ts.SyntaxKind.EqualsGreaterThanToken,
              ),
              body.value,
            ),
          )
        : body;
    }
    case "await": {
      const value = lowerExpression(expression.value, context);
      return value.ok
        ? ok(ts.factory.createAwaitExpression(value.value))
        : value;
    }
    case "cast": {
      const value = lowerExpression(expression.value, context);
      return value.ok
        ? ok(
            ts.factory.createAsExpression(
              value.value,
              lowerPirType(expression.targetType),
            ),
          )
        : value;
    }
    case "collection": {
      const elements: ts.Expression[] = [];
      for (const element of expression.elements) {
        const lowered = lowerExpression(element, context);
        if (!lowered.ok) return lowered;
        elements.push(lowered.value);
      }
      if (expression.collectionKind === "set") {
        return ok(
          ts.factory.createNewExpression(
            ts.factory.createIdentifier("Set"),
            undefined,
            [ts.factory.createArrayLiteralExpression(elements)],
          ),
        );
      }
      return ok(
        ts.factory.createArrayLiteralExpression(
          elements,
          false,
        ),
      );
    }
    case "record": {
      const fields: ts.ObjectLiteralElementLike[] = [];
      for (const [name, value] of Object.entries(expression.fields).sort(
        ([a], [b]) => a.localeCompare(b),
      )) {
        const lowered = lowerExpression(value, context);
        if (!lowered.ok) return lowered;
        fields.push(
          ts.factory.createPropertyAssignment(
            ts.factory.createStringLiteral(name),
            lowered.value,
          ),
        );
      }
      return ok(ts.factory.createObjectLiteralExpression(fields, true));
    }
    case "match":
      return err(
        new StructuredError(
          "TS_LOWER_MATCH_EXPRESSION_UNSUPPORTED",
          "Expression-level PIR match lowering is not part of the current M12 TypeScript subset.",
        ),
      );
    case "filter": {
      const collection = lowerExpression(expression.collection, context);
      if (!collection.ok) return collection;
      const nested: LowerContext = {
        names: new Map(context.names),
      };
      const itemName = sanitizeIdentifier(expression.item.name);
      nested.names.set(expression.item.id, itemName);
      const predicate = lowerExpression(expression.predicate, nested);
      if (!predicate.ok) return predicate;
      return ok(
        ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(
            collection.value,
            "filter",
          ),
          undefined,
          [
            ts.factory.createArrowFunction(
              undefined,
              undefined,
              [
                ts.factory.createParameterDeclaration(
                  undefined,
                  undefined,
                  itemName,
                  undefined,
                  lowerPirType(expression.item.type),
                  undefined,
                ),
              ],
              undefined,
              ts.factory.createToken(
                ts.SyntaxKind.EqualsGreaterThanToken,
              ),
              predicate.value,
            ),
          ],
        ),
      );
    }
    case "map": {
      const collection = lowerExpression(expression.collection, context);
      if (!collection.ok) return collection;
      const nested: LowerContext = {
        names: new Map(context.names),
      };
      const itemName = sanitizeIdentifier(expression.item.name);
      nested.names.set(expression.item.id, itemName);
      const mapper = lowerExpression(expression.mapper, nested);
      if (!mapper.ok) return mapper;
      return ok(
        ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(
            collection.value,
            "map",
          ),
          undefined,
          [
            ts.factory.createArrowFunction(
              undefined,
              undefined,
              [
                ts.factory.createParameterDeclaration(
                  undefined,
                  undefined,
                  itemName,
                  undefined,
                  lowerPirType(expression.item.type),
                  undefined,
                ),
              ],
              undefined,
              ts.factory.createToken(
                ts.SyntaxKind.EqualsGreaterThanToken,
              ),
              mapper.value,
            ),
          ],
        ),
      );
    }
  }
};

const lowerPatternExpression = (
  pattern: PirPattern,
  subject: ts.Expression,
): Result<ts.Expression> => {
  switch (pattern.kind) {
    case "wildcard":
      return ok(ts.factory.createTrue());
    case "literal":
      return ok(
        ts.factory.createBinaryExpression(
          subject,
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          literalNode(pattern.value),
        ),
      );
    case "variant":
      return ok(
        ts.factory.createBinaryExpression(
          ts.factory.createPropertyAccessExpression(subject, "kind"),
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.factory.createStringLiteral(pattern.tag),
        ),
      );
    case "type":
      return err(
        new StructuredError(
          "TS_LOWER_TYPE_PATTERN_UNSUPPORTED",
          "Runtime lowering of PIR type patterns requires an explicit runtime type strategy.",
        ),
      );
  }
};

const lowerStatementList = (
  statements: readonly PirStatement[],
  context: LowerContext,
): Result<ts.Statement[]> => {
  const output: ts.Statement[] = [];

  for (const statement of statements) {
    switch (statement.kind) {
      case "declare": {
        const name = symbolName(statement.symbol);
        context.names.set(statement.symbol.id, name);
        const initializer =
          statement.initializer === undefined
            ? undefined
            : lowerExpression(statement.initializer, context);
        if (initializer !== undefined && !initializer.ok) {
          return initializer;
        }
        output.push(
          ts.factory.createVariableStatement(
            undefined,
            ts.factory.createVariableDeclarationList(
              [
                ts.factory.createVariableDeclaration(
                  name,
                  undefined,
                  lowerPirType(statement.type),
                  initializer?.value,
                ),
              ],
              ts.NodeFlags.Let,
            ),
          ),
        );
        break;
      }
      case "assign": {
        const target = lowerExpression(statement.target, context);
        if (!target.ok) return target;
        const value = lowerExpression(statement.value, context);
        if (!value.ok) return value;
        output.push(
          ts.factory.createExpressionStatement(
            ts.factory.createBinaryExpression(
              target.value,
              ts.SyntaxKind.EqualsToken,
              value.value,
            ),
          ),
        );
        break;
      }
      case "expression": {
        const expression = lowerExpression(statement.expression, context);
        if (!expression.ok) return expression;
        output.push(ts.factory.createExpressionStatement(expression.value));
        break;
      }
      case "return": {
        const value =
          statement.value === undefined
            ? undefined
            : lowerExpression(statement.value, context);
        if (value !== undefined && !value.ok) return value;
        output.push(
          ts.factory.createReturnStatement(value?.value),
        );
        break;
      }
      case "if": {
        const condition = lowerExpression(statement.condition, context);
        if (!condition.ok) return condition;
        const thenBody = lowerStatementList(statement.then, {
          names: new Map(context.names),
        });
        if (!thenBody.ok) return thenBody;
        const elseBody =
          statement.else === undefined
            ? undefined
            : lowerStatementList(statement.else, {
                names: new Map(context.names),
              });
        if (elseBody !== undefined && !elseBody.ok) return elseBody;
        output.push(
          ts.factory.createIfStatement(
            condition.value,
            ts.factory.createBlock(thenBody.value, true),
            elseBody === undefined
              ? undefined
              : ts.factory.createBlock(elseBody.value, true),
          ),
        );
        break;
      }
      case "loop": {
        const condition =
          statement.condition === undefined
            ? ok<ts.Expression>(ts.factory.createTrue())
            : lowerExpression(statement.condition, context);
        if (!condition.ok) return condition;
        const body = lowerStatementList(statement.body, {
          names: new Map(context.names),
        });
        if (!body.ok) return body;
        output.push(
          ts.factory.createWhileStatement(
            condition.value,
            ts.factory.createBlock(body.value, true),
          ),
        );
        break;
      }
      case "for-each": {
        const collection = lowerExpression(statement.collection, context);
        if (!collection.ok) return collection;
        const nested: LowerContext = {
          names: new Map(context.names),
        };
        const itemName = sanitizeIdentifier(statement.item.name);
        nested.names.set(statement.item.id, itemName);
        const body = lowerStatementList(statement.body, nested);
        if (!body.ok) return body;
        output.push(
          ts.factory.createForOfStatement(
            undefined,
            ts.factory.createVariableDeclarationList(
              [
                ts.factory.createVariableDeclaration(
                  itemName,
                  undefined,
                  lowerPirType(statement.item.type),
                  undefined,
                ),
              ],
              ts.NodeFlags.Const,
            ),
            collection.value,
            ts.factory.createBlock(body.value, true),
          ),
        );
        break;
      }
      case "match": {
        const subject = lowerExpression(statement.value, context);
        if (!subject.ok) return subject;
        const clauses: ts.CaseOrDefaultClause[] = [];
        for (const entry of statement.cases) {
          if (entry.pattern.kind === "wildcard") {
            const body = lowerStatementList(entry.body, {
              names: new Map(context.names),
            });
            if (!body.ok) return body;
            clauses.push(
              ts.factory.createDefaultClause(body.value),
            );
            continue;
          }
          if (entry.pattern.kind !== "literal") {
            return err(
              new StructuredError(
                "TS_LOWER_MATCH_PATTERN_UNSUPPORTED",
                "Statement match lowering currently supports literal or wildcard patterns only.",
              ),
            );
          }
          const body = lowerStatementList(entry.body, {
            names: new Map(context.names),
          });
          if (!body.ok) return body;
          clauses.push(
            ts.factory.createCaseClause(
              literalNode(entry.pattern.value),
              body.value,
            ),
          );
        }
        if (statement.default !== undefined) {
          const body = lowerStatementList(statement.default, {
            names: new Map(context.names),
          });
          if (!body.ok) return body;
          clauses.push(ts.factory.createDefaultClause(body.value));
        }
        output.push(
          ts.factory.createSwitchStatement(
            subject.value,
            ts.factory.createCaseBlock(clauses),
          ),
        );
        break;
      }
      case "try": {
        const body = lowerStatementList(statement.body, {
          names: new Map(context.names),
        });
        if (!body.ok) return body;
        let catchClause: ts.CatchClause | undefined;
        if (statement.catch !== undefined) {
          const nested: LowerContext = {
            names: new Map(context.names),
          };
          let variable: ts.VariableDeclaration | undefined;
          if (statement.catch.parameter !== undefined) {
            const name = sanitizeIdentifier(statement.catch.parameter.name);
            nested.names.set(statement.catch.parameter.id, name);
            variable = ts.factory.createVariableDeclaration(
              name,
              undefined,
              lowerPirType(statement.catch.parameter.type),
              undefined,
            );
          }
          const catchBody = lowerStatementList(
            statement.catch.body,
            nested,
          );
          if (!catchBody.ok) return catchBody;
          catchClause = ts.factory.createCatchClause(
            variable,
            ts.factory.createBlock(catchBody.value, true),
          );
        }
        const finallyBody =
          statement.finally === undefined
            ? undefined
            : lowerStatementList(statement.finally, {
                names: new Map(context.names),
              });
        if (finallyBody !== undefined && !finallyBody.ok) {
          return finallyBody;
        }
        output.push(
          ts.factory.createTryStatement(
            ts.factory.createBlock(body.value, true),
            catchClause,
            finallyBody === undefined
              ? undefined
              : ts.factory.createBlock(finallyBody.value, true),
          ),
        );
        break;
      }
      case "throw": {
        const value = lowerExpression(statement.value, context);
        if (!value.ok) return value;
        output.push(ts.factory.createThrowStatement(value.value));
        break;
      }
      case "assert": {
        const condition = lowerExpression(statement.condition, context);
        if (!condition.ok) return condition;
        output.push(
          ts.factory.createIfStatement(
            ts.factory.createPrefixUnaryExpression(
              ts.SyntaxKind.ExclamationToken,
              condition.value,
            ),
            ts.factory.createBlock(
              [
                ts.factory.createThrowStatement(
                  ts.factory.createNewExpression(
                    ts.factory.createIdentifier("Error"),
                    undefined,
                    [
                      ts.factory.createStringLiteral(
                        statement.message ?? "Assertion failed",
                      ),
                    ],
                  ),
                ),
              ],
              true,
            ),
          ),
        );
        break;
      }
      case "break":
        output.push(ts.factory.createBreakStatement());
        break;
      case "continue":
        output.push(ts.factory.createContinueStatement());
        break;
      case "defer":
        return err(
          new StructuredError(
            "TS_LOWER_DEFER_UNSUPPORTED",
            "PIR defer/resource-finalization requires a dedicated TypeScript lowering strategy.",
          ),
        );
      case "block": {
        const body = lowerStatementList(statement.statements, {
          names: new Map(context.names),
        });
        if (!body.ok) return body;
        output.push(ts.factory.createBlock(body.value, true));
        break;
      }
      case "hole":
        return err(
          new StructuredError(
            "TS_LOWER_UNFILLED_HOLE",
            `Cannot lower unfilled statement hole ${statement.holeId}.`,
          ),
        );
    }
  }

  return ok(output);
};

const exportModifiers = (
  fn: PirFunction,
  exported: boolean,
): ts.Modifier[] => [
  ...(exported || fn.visibility === "public"
    ? [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)]
    : []),
  ...(fn.async === true
    ? [ts.factory.createModifier(ts.SyntaxKind.AsyncKeyword)]
    : []),
];

const lowerFunction = (
  fn: PirFunction,
  root: LowerContext,
  exported: boolean,
): Result<ts.FunctionDeclaration> => {
  const context: LowerContext = {
    names: new Map(root.names),
  };
  const parameters = fn.parameters.map((parameter) => {
    const name = sanitizeIdentifier(parameter.name);
    context.names.set(parameter.id, name);
    return ts.factory.createParameterDeclaration(
      undefined,
      undefined,
      name,
      undefined,
      lowerPirType(parameter.type),
      undefined,
    );
  });

  const typeParameters = fn.typeParameters?.map((parameter) =>
    ts.factory.createTypeParameterDeclaration(
      undefined,
      parameter.name,
      parameter.bound === undefined
        ? undefined
        : lowerPirType(parameter.bound),
      undefined,
    ),
  );

  let body: ts.Block;
  if (fn.body !== undefined) {
    const expression = lowerExpression(fn.body, context);
    if (!expression.ok) return expression;
    body = ts.factory.createBlock(
      [ts.factory.createReturnStatement(expression.value)],
      true,
    );
  } else if (fn.statements !== undefined) {
    const statements = lowerStatementList(fn.statements, context);
    if (!statements.ok) return statements;
    body = ts.factory.createBlock(statements.value, true);
  } else {
    return err(
      new StructuredError(
        "TS_LOWER_FUNCTION_BODY",
        `Function ${fn.id} has no lowerable body.`,
      ),
    );
  }

  const declaredReturnType =
    fn.async === true
      ? ts.factory.createTypeReferenceNode("Promise", [
          lowerPirType(fn.returnType),
        ])
      : lowerPirType(fn.returnType);

  return ok(
    ts.factory.createFunctionDeclaration(
      exportModifiers(fn, exported),
      undefined,
      sanitizeIdentifier(fn.name),
      typeParameters,
      parameters,
      declaredReturnType,
      body,
    ),
  );
};

const lowerTypeSymbol = (
  symbol: PirSymbol,
  exported: boolean,
): ts.Statement | undefined => {
  if (symbol.symbolKind !== "type" || symbol.type === undefined) {
    return undefined;
  }
  return ts.factory.createTypeAliasDeclaration(
    exported || symbol.visibility === "public"
      ? [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)]
      : undefined,
    symbolName(symbol),
    undefined,
    lowerPirType(symbol.type),
  );
};

const lowerImports = (
  program: PirProgram,
): ts.ImportDeclaration[] => {
  const module = program.modules?.[0];
  if (module === undefined) return [];
  return module.imports.map((entry) => {
    const symbols = entry.symbols ?? [];
    const clause =
      symbols.length === 0
        ? undefined
        : ts.factory.createImportClause(
            entry.typeOnly === true,
            undefined,
            ts.factory.createNamedImports(
              symbols.map((symbol) =>
                ts.factory.createImportSpecifier(
                  false,
                  undefined,
                  ts.factory.createIdentifier(
                    sanitizeIdentifier(symbol),
                  ),
                ),
              ),
            ),
          );
    return ts.factory.createImportDeclaration(
      undefined,
      clause,
      ts.factory.createStringLiteral(entry.module),
      undefined,
    );
  });
};

export const lowerPirToTypeScriptAst = (
  program: PirProgram,
): Result<LowerResult<ts.SourceFile>> => {
  const root: LowerContext = {
    names: new Map<string, string>(),
  };

  for (const symbol of program.symbols ?? []) {
    root.names.set(symbol.id, symbolName(symbol));
  }
  for (const fn of program.functions) {
    root.names.set(fn.id, sanitizeIdentifier(fn.name));
  }

  const statements: ts.Statement[] = [
    ...lowerImports(program),
  ];
  const exportedRefs = new Set(
    (program.modules ?? []).flatMap((module) => module.exports),
  );

  for (const symbol of program.symbols ?? []) {
    const lowered = lowerTypeSymbol(
      symbol,
      exportedRefs.has(symbol.id),
    );
    if (lowered !== undefined) statements.push(lowered);
  }

  for (const fn of program.functions) {
    const lowered = lowerFunction(
      fn,
      root,
      exportedRefs.has(fn.id),
    );
    if (!lowered.ok) return lowered;
    statements.push(lowered.value);
  }

  const seed = ts.createSourceFile(
    "generated.ts",
    "",
    ts.ScriptTarget.ES2022,
    false,
    ts.ScriptKind.TS,
  );
  const ast = ts.factory.updateSourceFile(
    seed,
    statements,
  );

  const bindings = (program.sourceBindings ?? [])
    .map((binding) => structuredClone(binding))
    .filter((binding): binding is SourceBinding => binding !== undefined);

  return ok({
    ast,
    sourceBindings: bindings,
    diagnostics: [],
  });
};

export const printTypeScriptAst = (
  lowered: LowerResult<ts.SourceFile>,
): Result<string> => {
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: false,
  });
  return ok(
    printer.printFile(lowered.ast).replace(/[ \t]+$/gmu, "") + "\n",
  );
};
