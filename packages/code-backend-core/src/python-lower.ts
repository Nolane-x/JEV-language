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
  PirType,
  SourceBinding,
} from "../../program-ir/src/index.ts";
import type { LowerResult } from "./backend.ts";
import type { PythonAstNode } from "./python-ast.ts";
import { lowerPirTypeToPythonAnnotation } from "./python-types.ts";

const sanitizeIdentifier = (value: string): string => {
  const normalized = value.replace(/[^A-Za-z0-9_]/gu, "_");
  return /^[A-Za-z_]/u.test(normalized)
    ? normalized
    : `_${normalized}`;
};

const nameNode = (
  id: string,
  ctx: "Load" | "Store" = "Load",
): PythonAstNode => ({
  _type: "Name",
  id,
  ctx: { _type: ctx },
});

const constantNode = (
  value: string | number | boolean | null,
): PythonAstNode => ({
  _type: "Constant",
  value,
  kind: null,
});

const argumentsNode = (
  args: PythonAstNode[],
): PythonAstNode => ({
  _type: "arguments",
  posonlyargs: [],
  args,
  vararg: null,
  kwonlyargs: [],
  kw_defaults: [],
  kwarg: null,
  defaults: [],
});

const argNode = (
  name: string,
  annotation: PythonAstNode | undefined,
): PythonAstNode => ({
  _type: "arg",
  arg: name,
  ...(annotation === undefined ? {} : { annotation }),
  type_comment: null,
});

const callNode = (
  callee: PythonAstNode,
  args: PythonAstNode[],
): PythonAstNode => ({
  _type: "Call",
  func: callee,
  args,
  keywords: [],
});

const symbolName = (symbol: PirSymbol): string =>
  sanitizeIdentifier(
    symbol.existingName ??
      symbol.namingIntent?.preferredTerms?.[0] ??
      symbol.id,
  );

interface LowerContext {
  names: Map<string, string>;
  types: Map<string, PirType>;
}

const nameOf = (
  id: string,
  context: LowerContext,
): Result<string> => {
  const name = context.names.get(id);
  return name === undefined
    ? err(
        new StructuredError(
          "PY_LOWER_UNKNOWN_SYMBOL",
          `No Python name is available for PIR symbol ${id}.`,
        ),
      )
    : ok(name);
};

const typeOfExpression = (
  expression: PirExpression,
  context: LowerContext,
): PirType | undefined => {
  switch (expression.kind) {
    case "variable":
    case "symbol-ref":
      return context.types.get(expression.symbolId);
    case "literal":
      return expression.type;
    case "cast":
      return expression.targetType;
    case "collection":
      return expression.collectionKind === "list"
        ? {
            kind: "list",
            element: expression.elementType ?? { kind: "unknown" },
          }
        : expression.collectionKind === "tuple"
          ? {
              kind: "tuple",
              elements: expression.elements.map(
                (element) =>
                  typeOfExpression(element, context) ?? {
                    kind: "unknown",
                  },
              ),
            }
          : {
              kind: "collection",
              collectionKind: "set",
              value:
                expression.elementType ?? { kind: "unknown" },
            };
    case "map":
      return {
        kind: "list",
        element: expression.resultElementType,
      };
    default:
      return undefined;
  }
};

const lowerLiteral = (value: unknown): Result<PythonAstNode> => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return ok(constantNode(value));
  }
  if (Array.isArray(value)) {
    const elements: PythonAstNode[] = [];
    for (const item of value) {
      const lowered = lowerLiteral(item);
      if (!lowered.ok) return lowered;
      elements.push(lowered.value);
    }
    return ok({
      _type: "List",
      elts: elements,
      ctx: { _type: "Load" },
    });
  }
  if (typeof value === "object") {
    const keys: PythonAstNode[] = [];
    const values: PythonAstNode[] = [];
    for (const [name, item] of Object.entries(
      value as Record<string, unknown>,
    ).sort(([a], [b]) => a.localeCompare(b))) {
      const lowered = lowerLiteral(item);
      if (!lowered.ok) return lowered;
      keys.push(constantNode(name));
      values.push(lowered.value);
    }
    return ok({
      _type: "Dict",
      keys,
      values,
    });
  }
  return err(
    new StructuredError(
      "PY_LOWER_LITERAL_UNSUPPORTED",
      "PIR literal is outside Python portable literal subset.",
    ),
  );
};

const lowerBinaryOperator = (
  operator: Extract<PirExpression, { kind: "binary" }>["operator"],
): PythonAstNode => {
  switch (operator) {
    case "add":
      return { _type: "Add" };
    case "subtract":
      return { _type: "Sub" };
    case "multiply":
      return { _type: "Mult" };
    case "divide":
      return { _type: "Div" };
    case "modulo":
      return { _type: "Mod" };
    case "power":
      return { _type: "Pow" };
  }
};

const lowerComparisonOperator = (
  operator: Extract<PirExpression, { kind: "comparison" }>["operator"],
): PythonAstNode => {
  switch (operator) {
    case "eq":
      return { _type: "Eq" };
    case "neq":
      return { _type: "NotEq" };
    case "lt":
      return { _type: "Lt" };
    case "lte":
      return { _type: "LtE" };
    case "gt":
      return { _type: "Gt" };
    case "gte":
      return { _type: "GtE" };
    case "identity":
      return { _type: "Is" };
  }
};

const lowerExpression = (
  expression: PirExpression,
  context: LowerContext,
): Result<PythonAstNode> => {
  switch (expression.kind) {
    case "hole":
      return err(
        new StructuredError(
          "PY_LOWER_UNFILLED_HOLE",
          `Cannot lower unfilled PIR hole ${expression.id}.`,
        ),
      );

    case "literal":
      return lowerLiteral(expression.value);

    case "variable":
    case "symbol-ref": {
      const name = nameOf(expression.symbolId, context);
      return name.ok ? ok(nameNode(name.value)) : name;
    }

    case "property":
    case "field-access": {
      const object = lowerExpression(expression.object, context);
      if (!object.ok) return object;
      const property =
        expression.kind === "property"
          ? expression.property
          : expression.field;
      const objectType = typeOfExpression(expression.object, context);
      if (objectType?.kind === "record") {
        return ok({
          _type: "Subscript",
          value: object.value,
          slice: constantNode(property),
          ctx: { _type: "Load" },
        });
      }
      return ok({
        _type: "Attribute",
        value: object.value,
        attr: sanitizeIdentifier(property),
        ctx: { _type: "Load" },
      });
    }

    case "index-access": {
      const object = lowerExpression(expression.object, context);
      if (!object.ok) return object;
      const index = lowerExpression(expression.index, context);
      return index.ok
        ? ok({
            _type: "Subscript",
            value: object.value,
            slice: index.value,
            ctx: { _type: "Load" },
          })
        : index;
    }

    case "call": {
      const callee = lowerExpression(expression.callee, context);
      if (!callee.ok) return callee;
      const args: PythonAstNode[] = [];
      for (const argument of expression.arguments) {
        const lowered = lowerExpression(argument, context);
        if (!lowered.ok) return lowered;
        args.push(lowered.value);
      }
      return ok(callNode(callee.value, args));
    }

    case "construct": {
      if (expression.targetType.kind !== "named") {
        return err(
          new StructuredError(
            "PY_LOWER_CONSTRUCT_TYPE",
            "Python constructor lowering requires a named target type.",
          ),
        );
      }
      const args: PythonAstNode[] = [];
      for (const argument of expression.arguments) {
        const lowered = lowerExpression(argument, context);
        if (!lowered.ok) return lowered;
        args.push(lowered.value);
      }
      return ok(
        callNode(
          nameNode(
            sanitizeIdentifier(
              expression.targetType.symbolId.replace(/^type:/u, ""),
            ),
          ),
          args,
        ),
      );
    }

    case "unary": {
      const operand = lowerExpression(expression.operand, context);
      if (!operand.ok) return operand;
      const op =
        expression.operator === "not"
          ? "Not"
          : expression.operator === "negate"
            ? "USub"
            : expression.operator === "positive"
              ? "UAdd"
              : "Invert";
      return ok({
        _type: "UnaryOp",
        op: { _type: op },
        operand: operand.value,
      });
    }

    case "binary": {
      const left = lowerExpression(expression.left, context);
      if (!left.ok) return left;
      const right = lowerExpression(expression.right, context);
      return right.ok
        ? ok({
            _type: "BinOp",
            left: left.value,
            op: lowerBinaryOperator(expression.operator),
            right: right.value,
          })
        : right;
    }

    case "comparison": {
      const left = lowerExpression(expression.left, context);
      if (!left.ok) return left;
      const right = lowerExpression(expression.right, context);
      return right.ok
        ? ok({
            _type: "Compare",
            left: left.value,
            ops: [lowerComparisonOperator(expression.operator)],
            comparators: [right.value],
          })
        : right;
    }

    case "logical": {
      if (expression.operator === "xor") {
        return err(
          new StructuredError(
            "PY_LOWER_BOOLEAN_XOR_UNSUPPORTED",
            "Python bool-op AST has no direct short-circuit XOR equivalent.",
          ),
        );
      }
      const values: PythonAstNode[] = [];
      for (const value of expression.values) {
        const lowered = lowerExpression(value, context);
        if (!lowered.ok) return lowered;
        values.push(lowered.value);
      }
      return ok({
        _type: "BoolOp",
        op: {
          _type: expression.operator === "and" ? "And" : "Or",
        },
        values,
      });
    }

    case "conditional": {
      const condition = lowerExpression(expression.condition, context);
      if (!condition.ok) return condition;
      const whenTrue = lowerExpression(expression.whenTrue, context);
      if (!whenTrue.ok) return whenTrue;
      const whenFalse = lowerExpression(
        expression.whenFalse,
        context,
      );
      return whenFalse.ok
        ? ok({
            _type: "IfExp",
            test: condition.value,
            body: whenTrue.value,
            orelse: whenFalse.value,
          })
        : whenFalse;
    }

    case "lambda": {
      const nested: LowerContext = {
        names: new Map(context.names),
        types: new Map(context.types),
      };
      const args: PythonAstNode[] = [];
      for (const parameter of expression.parameters) {
        const name = sanitizeIdentifier(parameter.name);
        nested.names.set(parameter.id, name);
        nested.types.set(parameter.id, parameter.type);
        args.push(
          argNode(
            name,
            parameter.type.kind === "unknown"
              ? undefined
              : lowerPirTypeToPythonAnnotation(parameter.type),
          ),
        );
      }
      const body = lowerExpression(expression.body, nested);
      return body.ok
        ? ok({
            _type: "Lambda",
            args: argumentsNode(args),
            body: body.value,
          })
        : body;
    }

    case "await": {
      const value = lowerExpression(expression.value, context);
      return value.ok
        ? ok({ _type: "Await", value: value.value })
        : value;
    }

    case "cast":
      // Python is dynamically typed; casts in portable PIR are erased at
      // runtime rather than importing JavaScript-style conversion rules.
      return lowerExpression(expression.value, context);

    case "collection": {
      const elements: PythonAstNode[] = [];
      for (const element of expression.elements) {
        const lowered = lowerExpression(element, context);
        if (!lowered.ok) return lowered;
        elements.push(lowered.value);
      }
      return ok({
        _type:
          expression.collectionKind === "list"
            ? "List"
            : expression.collectionKind === "tuple"
              ? "Tuple"
              : "Set",
        elts: elements,
        ctx: { _type: "Load" },
      });
    }

    case "record": {
      const keys: PythonAstNode[] = [];
      const values: PythonAstNode[] = [];
      for (const [name, value] of Object.entries(expression.fields).sort(
        ([a], [b]) => a.localeCompare(b),
      )) {
        const lowered = lowerExpression(value, context);
        if (!lowered.ok) return lowered;
        keys.push(constantNode(name));
        values.push(lowered.value);
      }
      return ok({ _type: "Dict", keys, values });
    }

    case "match":
      return err(
        new StructuredError(
          "PY_LOWER_MATCH_EXPRESSION_UNSUPPORTED",
          "Python has statement pattern matching but no direct expression match equivalent.",
        ),
      );

    case "filter":
    case "map": {
      const collection = lowerExpression(expression.collection, context);
      if (!collection.ok) return collection;
      const itemName = sanitizeIdentifier(expression.item.name);
      const nested: LowerContext = {
        names: new Map(context.names),
        types: new Map(context.types),
      };
      nested.names.set(expression.item.id, itemName);
      nested.types.set(expression.item.id, expression.item.type);
      const output =
        expression.kind === "filter"
          ? ok(nameNode(itemName))
          : lowerExpression(expression.mapper, nested);
      if (!output.ok) return output;
      const conditions: PythonAstNode[] = [];
      if (expression.kind === "filter") {
        const predicate = lowerExpression(
          expression.predicate,
          nested,
        );
        if (!predicate.ok) return predicate;
        conditions.push(predicate.value);
      }
      return ok({
        _type: "ListComp",
        elt: output.value,
        generators: [
          {
            _type: "comprehension",
            target: nameNode(itemName, "Store"),
            iter: collection.value,
            ifs: conditions,
            is_async: 0,
          },
        ],
      });
    }
  }
};

const lowerTarget = (
  expression: PirExpression,
  context: LowerContext,
): Result<PythonAstNode> => {
  const lowered = lowerExpression(expression, context);
  if (!lowered.ok) return lowered;
  if (lowered.value._type === "Name") {
    return ok({
      ...lowered.value,
      ctx: { _type: "Store" },
    });
  }
  if (
    lowered.value._type === "Attribute" ||
    lowered.value._type === "Subscript"
  ) {
    return ok({
      ...lowered.value,
      ctx: { _type: "Store" },
    });
  }
  return err(
    new StructuredError(
      "PY_LOWER_ASSIGN_TARGET",
      "PIR assignment target cannot be represented as a Python store target.",
    ),
  );
};

const lowerPattern = (
  pattern: PirPattern,
): Result<PythonAstNode> => {
  switch (pattern.kind) {
    case "wildcard":
      return ok({
        _type: "MatchAs",
        pattern: null,
        name: null,
      });
    case "literal": {
      const value = lowerLiteral(pattern.value);
      return value.ok
        ? ok({
            _type: "MatchValue",
            value: value.value,
          })
        : value;
    }
    case "variant":
    case "type":
      return err(
        new StructuredError(
          "PY_LOWER_PATTERN_UNSUPPORTED",
          `PIR pattern kind ${pattern.kind} is outside M13 subset.`,
        ),
      );
  }
};

const lowerStatements = (
  statements: readonly PirStatement[],
  context: LowerContext,
): Result<PythonAstNode[]> => {
  const output: PythonAstNode[] = [];

  for (const statement of statements) {
    switch (statement.kind) {
      case "declare": {
        const name = symbolName(statement.symbol);
        context.names.set(statement.symbol.id, name);
        context.types.set(statement.symbol.id, statement.type);
        const initializer =
          statement.initializer === undefined
            ? undefined
            : lowerExpression(statement.initializer, context);
        if (initializer !== undefined && !initializer.ok) {
          return initializer;
        }
        if (statement.type.kind === "unknown") {
          if (initializer === undefined) {
            output.push({
              _type: "AnnAssign",
              target: nameNode(name, "Store"),
              annotation: { _type: "Name", id: "object", ctx: { _type: "Load" } },
              value: null,
              simple: 1,
            });
          } else {
            output.push({
              _type: "Assign",
              targets: [nameNode(name, "Store")],
              value: initializer.value,
              type_comment: null,
            });
          }
        } else {
          output.push({
            _type: "AnnAssign",
            target: nameNode(name, "Store"),
            annotation: lowerPirTypeToPythonAnnotation(statement.type),
            value: initializer?.value ?? null,
            simple: 1,
          });
        }
        break;
      }

      case "assign": {
        const target = lowerTarget(statement.target, context);
        if (!target.ok) return target;
        const value = lowerExpression(statement.value, context);
        if (!value.ok) return value;
        output.push({
          _type: "Assign",
          targets: [target.value],
          value: value.value,
          type_comment: null,
        });
        break;
      }

      case "expression": {
        const expression = lowerExpression(
          statement.expression,
          context,
        );
        if (!expression.ok) return expression;
        output.push({
          _type: "Expr",
          value: expression.value,
        });
        break;
      }

      case "return": {
        if (statement.value === undefined) {
          output.push({ _type: "Return", value: null });
        } else {
          const value = lowerExpression(statement.value, context);
          if (!value.ok) return value;
          output.push({ _type: "Return", value: value.value });
        }
        break;
      }

      case "if": {
        const condition = lowerExpression(
          statement.condition,
          context,
        );
        if (!condition.ok) return condition;
        const then = lowerStatements(statement.then, {
          names: new Map(context.names),
          types: new Map(context.types),
        });
        if (!then.ok) return then;
        const alternate = lowerStatements(statement.else ?? [], {
          names: new Map(context.names),
          types: new Map(context.types),
        });
        if (!alternate.ok) return alternate;
        output.push({
          _type: "If",
          test: condition.value,
          body:
            then.value.length === 0
              ? [{ _type: "Pass" }]
              : then.value,
          orelse: alternate.value,
        });
        break;
      }

      case "loop": {
        const condition =
          statement.condition === undefined
            ? ok(constantNode(true))
            : lowerExpression(statement.condition, context);
        if (!condition.ok) return condition;
        const body = lowerStatements(statement.body, context);
        if (!body.ok) return body;
        output.push({
          _type: "While",
          test: condition.value,
          body:
            body.value.length === 0
              ? [{ _type: "Pass" }]
              : body.value,
          orelse: [],
        });
        break;
      }

      case "for-each": {
        const collection = lowerExpression(
          statement.collection,
          context,
        );
        if (!collection.ok) return collection;
        const nested: LowerContext = {
          names: new Map(context.names),
          types: new Map(context.types),
        };
        const itemName = sanitizeIdentifier(statement.item.name);
        nested.names.set(statement.item.id, itemName);
        nested.types.set(statement.item.id, statement.item.type);
        const body = lowerStatements(statement.body, nested);
        if (!body.ok) return body;
        output.push({
          _type: "For",
          target: nameNode(itemName, "Store"),
          iter: collection.value,
          body:
            body.value.length === 0
              ? [{ _type: "Pass" }]
              : body.value,
          orelse: [],
          type_comment: null,
        });
        break;
      }

      case "match": {
        const value = lowerExpression(statement.value, context);
        if (!value.ok) return value;
        const cases: PythonAstNode[] = [];
        for (const entry of statement.cases) {
          const pattern = lowerPattern(entry.pattern);
          if (!pattern.ok) return pattern;
          const body = lowerStatements(entry.body, context);
          if (!body.ok) return body;
          cases.push({
            _type: "match_case",
            pattern: pattern.value,
            guard: null,
            body:
              body.value.length === 0
                ? [{ _type: "Pass" }]
                : body.value,
          });
        }
        output.push({
          _type: "Match",
          subject: value.value,
          cases,
        });
        break;
      }

      case "try": {
        const body = lowerStatements(statement.body, context);
        if (!body.ok) return body;
        const handlers: PythonAstNode[] = [];
        if (statement.catch !== undefined) {
          const nested: LowerContext = {
            names: new Map(context.names),
            types: new Map(context.types),
          };
          let name: string | null = null;
          if (statement.catch.parameter !== undefined) {
            name = sanitizeIdentifier(
              statement.catch.parameter.name,
            );
            nested.names.set(statement.catch.parameter.id, name);
            nested.types.set(
              statement.catch.parameter.id,
              statement.catch.parameter.type,
            );
          }
          const catchBody = lowerStatements(
            statement.catch.body,
            nested,
          );
          if (!catchBody.ok) return catchBody;
          handlers.push({
            _type: "ExceptHandler",
            type: nameNode("Exception"),
            name,
            body:
              catchBody.value.length === 0
                ? [{ _type: "Pass" }]
                : catchBody.value,
          });
        }
        const finalBody = lowerStatements(
          statement.finally ?? [],
          context,
        );
        if (!finalBody.ok) return finalBody;
        output.push({
          _type: "Try",
          body:
            body.value.length === 0
              ? [{ _type: "Pass" }]
              : body.value,
          handlers,
          orelse: [],
          finalbody: finalBody.value,
        });
        break;
      }

      case "throw": {
        const value = lowerExpression(statement.value, context);
        if (!value.ok) return value;
        output.push({
          _type: "Raise",
          exc: callNode(nameNode("Exception"), [value.value]),
          cause: null,
        });
        break;
      }

      case "assert": {
        const condition = lowerExpression(
          statement.condition,
          context,
        );
        if (!condition.ok) return condition;
        output.push({
          _type: "Assert",
          test: condition.value,
          msg:
            statement.message === undefined
              ? null
              : constantNode(statement.message),
        });
        break;
      }

      case "break":
        output.push({ _type: "Break" });
        break;

      case "continue":
        output.push({ _type: "Continue" });
        break;

      case "defer":
        return err(
          new StructuredError(
            "PY_LOWER_DEFER_UNSUPPORTED",
            "Python has no direct portable defer statement.",
          ),
        );

      case "block": {
        const nested = lowerStatements(
          statement.statements,
          context,
        );
        if (!nested.ok) return nested;
        output.push(...nested.value);
        break;
      }

      case "hole":
        return err(
          new StructuredError(
            "PY_LOWER_UNFILLED_HOLE",
            `Cannot lower statement hole ${statement.holeId}.`,
          ),
        );
    }
  }

  return ok(output);
};

const functionNames = (
  program: PirProgram,
): Map<string, string> =>
  new Map(
    program.functions.map((fn) => [
      fn.id,
      sanitizeIdentifier(fn.name),
    ]),
  );

const lowerFunction = (
  fn: PirFunction,
  base: LowerContext,
): Result<PythonAstNode> => {
  const nested: LowerContext = {
    names: new Map(base.names),
    types: new Map(base.types),
  };
  const parameters: PythonAstNode[] = [];
  for (const parameter of fn.parameters) {
    const name = sanitizeIdentifier(parameter.name);
    nested.names.set(parameter.id, name);
    nested.types.set(parameter.id, parameter.type);
    parameters.push(
      argNode(
        name,
        parameter.type.kind === "unknown"
          ? undefined
          : lowerPirTypeToPythonAnnotation(parameter.type),
      ),
    );
  }

  let body: PythonAstNode[];
  if (fn.body !== undefined) {
    const expression = lowerExpression(fn.body, nested);
    if (!expression.ok) return expression;
    body = [{ _type: "Return", value: expression.value }];
  } else {
    const statements = lowerStatements(
      fn.statements ?? [],
      nested,
    );
    if (!statements.ok) return statements;
    body =
      statements.value.length === 0
        ? [{ _type: "Pass" }]
        : statements.value;
  }

  return ok({
    _type: fn.async === true ? "AsyncFunctionDef" : "FunctionDef",
    name: sanitizeIdentifier(fn.name),
    args: argumentsNode(parameters),
    body,
    decorator_list: [],
    returns:
      fn.returnType.kind === "unknown"
        ? null
        : lowerPirTypeToPythonAnnotation(fn.returnType),
    type_comment: null,
  });
};

const typeVariablePrelude = (
  program: PirProgram,
): PythonAstNode[] => {
  const names = new Set<string>();
  for (const fn of program.functions) {
    for (const type of fn.typeParameters ?? []) names.add(type.name);
  }
  if (names.size === 0) return [];

  return [
    {
      _type: "ImportFrom",
      module: "typing",
      names: [
        {
          _type: "alias",
          name: "TypeVar",
          asname: null,
        },
      ],
      level: 0,
    },
    ...[...names].sort().map((name) => ({
      _type: "Assign",
      targets: [nameNode(sanitizeIdentifier(name), "Store")],
      value: callNode(nameNode("TypeVar"), [constantNode(name)]),
      type_comment: null,
    })),
  ];
};

export const lowerPirToPythonAst = (
  program: PirProgram,
): Result<LowerResult<PythonAstNode>> => {
  const names = functionNames(program);
  const types = new Map<string, PirType>();
  for (const fn of program.functions) {
    types.set(fn.id, {
      kind: "function",
      parameters: fn.parameters.map((parameter) => parameter.type),
      returns: fn.returnType,
      effects: fn.effects,
    });
  }
  for (const symbol of program.symbols ?? []) {
    names.set(symbol.id, symbolName(symbol));
    if (symbol.type !== undefined) types.set(symbol.id, symbol.type);
  }

  const context: LowerContext = { names, types };
  const body: PythonAstNode[] = [...typeVariablePrelude(program)];

  for (const module of program.modules ?? []) {
    for (const imported of module.imports) {
      if (imported.symbols === undefined) {
        body.push({
          _type: "Import",
          names: [
            {
              _type: "alias",
              name: imported.module,
              asname: null,
            },
          ],
        });
      } else {
        body.push({
          _type: "ImportFrom",
          module: imported.module,
          names: imported.symbols.map((name) => ({
            _type: "alias",
            name,
            asname: null,
          })),
          level: 0,
        });
      }
    }
  }

  for (const fn of program.functions) {
    const lowered = lowerFunction(fn, context);
    if (!lowered.ok) return lowered;
    body.push(lowered.value);
  }

  const sourceBindings: SourceBinding[] = [
    ...(program.sourceBindings ?? []),
    ...program.functions
      .map((fn) => fn.sourceBinding)
      .filter(
        (binding): binding is SourceBinding =>
          binding !== undefined,
      ),
  ].map((binding) => structuredClone(binding));

  return ok({
    ast: {
      _type: "Module",
      body,
      type_ignores: [],
    },
    sourceBindings,
    diagnostics: [],
  });
};
