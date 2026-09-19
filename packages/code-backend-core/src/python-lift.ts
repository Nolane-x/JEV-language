import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  validatePirProgram,
  type EffectSpec,
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
import {
  pythonAstNode,
  pythonAstNodes,
  type PythonAstNode,
} from "./python-ast.ts";
import { liftPythonAnnotation } from "./python-types.ts";

interface LiftContext {
  sourceId: string;
  functionIds: Map<string, string>;
  names: Map<string, string>;
  types: Map<string, PirType>;
  declaredLocals: Set<string>;
  typeVariables: Set<string>;
  sourceBindings: SourceBinding[];
}

const stringField = (
  node: PythonAstNode,
  key: string,
): string | undefined => {
  const value = node[key];
  return typeof value === "string" ? value : undefined;
};

const booleanField = (
  node: PythonAstNode,
  key: string,
): boolean | undefined => {
  const value = node[key];
  return typeof value === "boolean" ? value : undefined;
};

const sanitize = (value: string): string =>
  value.replace(/[^A-Za-z0-9_.-]/gu, "_");

const nodeBinding = (
  sourceId: string,
  node: PythonAstNode,
  existingName?: string,
): SourceBinding => ({
  sourceId,
  language: "python",
  ...(existingName === undefined ? {} : { existingName }),
  ...(typeof node._start === "number" ? { start: node._start } : {}),
  ...(typeof node._end === "number" ? { end: node._end } : {}),
});

const idFor = (
  kind: string,
  name: string,
  node: PythonAstNode,
): string =>
  `${kind}:${sanitize(name)}:${node._start ?? 0}`;

const literalType = (value: unknown): PirType => {
  if (value === null) return { kind: "null" };
  if (typeof value === "boolean") return { kind: "boolean" };
  if (typeof value === "number") return { kind: "number" };
  if (typeof value === "string") return { kind: "string" };
  return { kind: "unknown" };
};

const binaryOperator = (
  node: PythonAstNode | undefined,
):
  | Extract<PirExpression, { kind: "binary" }>["operator"]
  | undefined => {
  switch (node?._type) {
    case "Add":
      return "add";
    case "Sub":
      return "subtract";
    case "Mult":
      return "multiply";
    case "Div":
    case "FloorDiv":
      return "divide";
    case "Mod":
      return "modulo";
    case "Pow":
      return "power";
    default:
      return undefined;
  }
};

const comparisonOperator = (
  node: PythonAstNode | undefined,
):
  | Extract<PirExpression, { kind: "comparison" }>["operator"]
  | undefined => {
  switch (node?._type) {
    case "Eq":
      return "eq";
    case "NotEq":
      return "neq";
    case "Lt":
      return "lt";
    case "LtE":
      return "lte";
    case "Gt":
      return "gt";
    case "GtE":
      return "gte";
    case "Is":
    case "IsNot":
      return "identity";
    default:
      return undefined;
  }
};

const lookupName = (
  name: string,
  context: LiftContext,
): string | undefined =>
  context.names.get(name) ?? context.functionIds.get(name);

const liftExpression = (
  node: PythonAstNode,
  context: LiftContext,
): Result<PirExpression> => {
  switch (node._type) {
    case "Constant": {
      const value = node.value;
      if (
        value === null ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string"
      ) {
        return ok({
          kind: "literal",
          value,
          type: literalType(value),
        });
      }
      return err(
        new StructuredError(
          "PY_LIFT_LITERAL_UNSUPPORTED",
          "Python constant is outside the portable PIR literal subset.",
        ),
      );
    }

    case "Name": {
      const name = stringField(node, "id");
      if (name === undefined) {
        return err(
          new StructuredError(
            "PY_LIFT_NAME",
            "Python Name node is missing id.",
          ),
        );
      }
      const symbolId = lookupName(name, context);
      if (symbolId === undefined) {
        return err(
          new StructuredError(
            "PY_LIFT_UNKNOWN_NAME",
            `Python name is not declared in the supported lift scope: ${name}.`,
          ),
        );
      }
      return ok({
        kind: context.functionIds.get(name) === symbolId
          ? "symbol-ref"
          : "variable",
        symbolId,
      });
    }

    case "Attribute": {
      const object = pythonAstNode(node.value);
      const property = stringField(node, "attr");
      if (object === undefined || property === undefined) {
        return err(
          new StructuredError(
            "PY_LIFT_ATTRIBUTE",
            "Python attribute access is malformed.",
          ),
        );
      }
      const lifted = liftExpression(object, context);
      return lifted.ok
        ? ok({
            kind: "property",
            object: lifted.value,
            property,
          })
        : lifted;
    }

    case "Subscript": {
      const object = pythonAstNode(node.value);
      const index = pythonAstNode(node.slice);
      if (object === undefined || index === undefined) {
        return err(
          new StructuredError(
            "PY_LIFT_SUBSCRIPT",
            "Python subscript requires object and index.",
          ),
        );
      }
      const left = liftExpression(object, context);
      if (!left.ok) return left;
      const right = liftExpression(index, context);
      return right.ok
        ? ok({
            kind: "index-access",
            object: left.value,
            index: right.value,
          })
        : right;
    }

    case "Call": {
      const calleeNode = pythonAstNode(node.func);
      if (calleeNode === undefined) {
        return err(
          new StructuredError(
            "PY_LIFT_CALL",
            "Python Call node is missing callable.",
          ),
        );
      }
      const callee = liftExpression(calleeNode, context);
      if (!callee.ok) return callee;
      const args: PirExpression[] = [];
      for (const argument of pythonAstNodes(node.args)) {
        const lifted = liftExpression(argument, context);
        if (!lifted.ok) return lifted;
        args.push(lifted.value);
      }
      const keywords = pythonAstNodes(node.keywords);
      if (keywords.length > 0) {
        return err(
          new StructuredError(
            "PY_LIFT_KEYWORD_CALL_UNSUPPORTED",
            "Keyword-call lifting is not yet in the M13 portable subset.",
          ),
        );
      }
      return ok({
        kind: "call",
        callee: callee.value,
        arguments: args,
      });
    }

    case "UnaryOp": {
      const operandNode = pythonAstNode(node.operand);
      const operatorNode = pythonAstNode(node.op);
      if (operandNode === undefined || operatorNode === undefined) {
        return err(
          new StructuredError(
            "PY_LIFT_UNARY",
            "Python unary expression is malformed.",
          ),
        );
      }
      const operand = liftExpression(operandNode, context);
      if (!operand.ok) return operand;
      const operator =
        operatorNode._type === "Not"
          ? "not"
          : operatorNode._type === "USub"
            ? "negate"
            : operatorNode._type === "UAdd"
              ? "positive"
              : operatorNode._type === "Invert"
                ? "bit-not"
                : undefined;
      return operator === undefined
        ? err(
            new StructuredError(
              "PY_LIFT_UNARY_UNSUPPORTED",
              `Unsupported Python unary operator: ${operatorNode._type}.`,
            ),
          )
        : ok({
            kind: "unary",
            operator,
            operand: operand.value,
          });
    }

    case "BinOp": {
      const leftNode = pythonAstNode(node.left);
      const rightNode = pythonAstNode(node.right);
      const operator = binaryOperator(pythonAstNode(node.op));
      if (
        leftNode === undefined ||
        rightNode === undefined ||
        operator === undefined
      ) {
        return err(
          new StructuredError(
            "PY_LIFT_BINARY_UNSUPPORTED",
            "Python binary expression is outside the M13 subset.",
          ),
        );
      }
      const left = liftExpression(leftNode, context);
      if (!left.ok) return left;
      const right = liftExpression(rightNode, context);
      return right.ok
        ? ok({
            kind: "binary",
            operator,
            left: left.value,
            right: right.value,
          })
        : right;
    }

    case "BoolOp": {
      const operatorNode = pythonAstNode(node.op);
      const values = pythonAstNodes(node.values);
      const operator =
        operatorNode?._type === "And"
          ? "and"
          : operatorNode?._type === "Or"
            ? "or"
            : undefined;
      if (operator === undefined || values.length < 2) {
        return err(
          new StructuredError(
            "PY_LIFT_BOOL_OP",
            "Python boolean expression requires And/Or with at least two values.",
          ),
        );
      }
      const lifted: PirExpression[] = [];
      for (const value of values) {
        const result = liftExpression(value, context);
        if (!result.ok) return result;
        lifted.push(result.value);
      }
      return ok({ kind: "logical", operator, values: lifted });
    }

    case "Compare": {
      const leftNode = pythonAstNode(node.left);
      const operators = pythonAstNodes(node.ops);
      const comparators = pythonAstNodes(node.comparators);
      if (
        leftNode === undefined ||
        operators.length !== 1 ||
        comparators.length !== 1
      ) {
        return err(
          new StructuredError(
            "PY_LIFT_COMPARE_CHAIN_UNSUPPORTED",
            "M13 lifts one Python comparison at a time.",
          ),
        );
      }
      const operator = comparisonOperator(operators[0]);
      if (operator === undefined) {
        return err(
          new StructuredError(
            "PY_LIFT_COMPARE_UNSUPPORTED",
            `Unsupported Python comparison operator: ${operators[0]?._type ?? "unknown"}.`,
          ),
        );
      }
      const left = liftExpression(leftNode, context);
      if (!left.ok) return left;
      const right = liftExpression(comparators[0]!, context);
      return right.ok
        ? ok({
            kind: "comparison",
            operator,
            left: left.value,
            right: right.value,
          })
        : right;
    }

    case "IfExp": {
      const test = pythonAstNode(node.test);
      const body = pythonAstNode(node.body);
      const alternate = pythonAstNode(node.orelse);
      if (
        test === undefined ||
        body === undefined ||
        alternate === undefined
      ) {
        return err(
          new StructuredError(
            "PY_LIFT_IF_EXPRESSION",
            "Python conditional expression is malformed.",
          ),
        );
      }
      const condition = liftExpression(test, context);
      if (!condition.ok) return condition;
      const whenTrue = liftExpression(body, context);
      if (!whenTrue.ok) return whenTrue;
      const whenFalse = liftExpression(alternate, context);
      return whenFalse.ok
        ? ok({
            kind: "conditional",
            condition: condition.value,
            whenTrue: whenTrue.value,
            whenFalse: whenFalse.value,
          })
        : whenFalse;
    }

    case "Await": {
      const value = pythonAstNode(node.value);
      if (value === undefined) {
        return err(
          new StructuredError(
            "PY_LIFT_AWAIT",
            "Python await expression is missing its value.",
          ),
        );
      }
      const lifted = liftExpression(value, context);
      return lifted.ok
        ? ok({ kind: "await", value: lifted.value })
        : lifted;
    }

    case "List":
    case "Tuple":
    case "Set": {
      const elements: PirExpression[] = [];
      for (const element of pythonAstNodes(node.elts)) {
        const lifted = liftExpression(element, context);
        if (!lifted.ok) return lifted;
        elements.push(lifted.value);
      }
      return ok({
        kind: "collection",
        collectionKind:
          node._type === "List"
            ? "list"
            : node._type === "Tuple"
              ? "tuple"
              : "set",
        elements,
      });
    }

    case "Dict": {
      const keys = Array.isArray(node.keys) ? node.keys : [];
      const values = pythonAstNodes(node.values);
      if (keys.length !== values.length) {
        return err(
          new StructuredError(
            "PY_LIFT_DICT",
            "Python dict keys/values are misaligned.",
          ),
        );
      }
      const fields: Record<string, PirExpression> = {};
      for (let index = 0; index < keys.length; index += 1) {
        const key = pythonAstNode(keys[index]);
        const value = values[index];
        if (
          key?._type !== "Constant" ||
          typeof key.value !== "string" ||
          value === undefined
        ) {
          return err(
            new StructuredError(
              "PY_LIFT_DICT_KEY_UNSUPPORTED",
              "Portable PIR record lifting requires string-literal dict keys.",
            ),
          );
        }
        const lifted = liftExpression(value, context);
        if (!lifted.ok) return lifted;
        fields[key.value] = lifted.value;
      }
      return ok({ kind: "record", fields });
    }

    case "ListComp": {
      const generators = pythonAstNodes(node.generators);
      const element = pythonAstNode(node.elt);
      if (generators.length !== 1 || element === undefined) {
        return err(
          new StructuredError(
            "PY_LIFT_COMPREHENSION_UNSUPPORTED",
            "M13 lifts single-generator list comprehensions only.",
          ),
        );
      }
      const generator = generators[0]!;
      const target = pythonAstNode(generator.target);
      const iterator = pythonAstNode(generator.iter);
      const ifs = pythonAstNodes(generator.ifs);
      if (
        target?._type !== "Name" ||
        iterator === undefined ||
        booleanField(generator, "is_async") === true
      ) {
        return err(
          new StructuredError(
            "PY_LIFT_COMPREHENSION_TARGET",
            "Portable list comprehension requires a synchronous named target.",
          ),
        );
      }
      const name = stringField(target, "id");
      if (name === undefined) {
        return err(
          new StructuredError(
            "PY_LIFT_COMPREHENSION_NAME",
            "List comprehension target is missing its name.",
          ),
        );
      }
      const itemId = idFor("symbol", name, target);
      const nested: LiftContext = {
        ...context,
        names: new Map(context.names),
        types: new Map(context.types),
        declaredLocals: new Set(context.declaredLocals),
      };
      nested.names.set(name, itemId);
      nested.types.set(itemId, { kind: "unknown" });

      const collection = liftExpression(iterator, context);
      if (!collection.ok) return collection;
      const item: PirParameter = {
        id: itemId,
        name,
        type: { kind: "unknown" },
        sourceBinding: nodeBinding(context.sourceId, target, name),
      };

      if (
        ifs.length === 1 &&
        element._type === "Name" &&
        stringField(element, "id") === name
      ) {
        const predicate = liftExpression(ifs[0]!, nested);
        return predicate.ok
          ? ok({
              kind: "filter",
              collection: collection.value,
              item,
              predicate: predicate.value,
            })
          : predicate;
      }

      if (ifs.length === 0) {
        const mapper = liftExpression(element, nested);
        return mapper.ok
          ? ok({
              kind: "map",
              collection: collection.value,
              item,
              mapper: mapper.value,
              resultElementType: { kind: "unknown" },
            })
          : mapper;
      }

      return err(
        new StructuredError(
          "PY_LIFT_COMPREHENSION_SHAPE",
          "M13 maps either pure map or identity-plus-one-filter list comprehensions.",
        ),
      );
    }

    default:
      return err(
        new StructuredError(
          "PY_LIFT_EXPRESSION_UNSUPPORTED",
          `Unsupported Python expression node: ${node._type}.`,
        ),
      );
  }
};

const targetExpression = (
  node: PythonAstNode,
  context: LiftContext,
): Result<PirExpression> => {
  if (node._type === "Name") {
    const name = stringField(node, "id");
    const symbolId = name === undefined ? undefined : lookupName(name, context);
    return symbolId === undefined
      ? err(
          new StructuredError(
            "PY_LIFT_ASSIGN_TARGET",
            "Assignment target name is not declared.",
          ),
        )
      : ok({ kind: "variable", symbolId });
  }
  return liftExpression(node, context);
};

const declarationFromAssignment = (
  target: PythonAstNode,
  annotation: PythonAstNode | undefined,
  initializer: PythonAstNode | undefined,
  context: LiftContext,
): Result<PirStatement> => {
  const name = stringField(target, "id");
  if (target._type !== "Name" || name === undefined) {
    return err(
      new StructuredError(
        "PY_LIFT_DECLARATION_TARGET",
        "Portable Python declaration requires a named target.",
      ),
    );
  }

  const id = idFor("symbol", name, target);
  const type = liftPythonAnnotation(annotation, context.typeVariables);
  if (!type.ok) return type;

  const symbol: PirSymbol = {
    id,
    symbolKind: "variable",
    existingName: name,
    namingIntent: {
      preferredTerms: [name],
      style: "snake",
    },
    type: type.value,
    visibility: "internal",
    sourceBinding: nodeBinding(context.sourceId, target, name),
  };
  context.names.set(name, id);
  context.types.set(id, type.value);
  context.declaredLocals.add(name);
  context.sourceBindings.push(symbol.sourceBinding!);

  let liftedInitializer: PirExpression | undefined;
  if (initializer !== undefined) {
    const result = liftExpression(initializer, context);
    if (!result.ok) return result;
    liftedInitializer = result.value;
  }

  return ok({
    kind: "declare",
    symbol,
    type: type.value,
    ...(liftedInitializer === undefined
      ? {}
      : { initializer: liftedInitializer }),
  });
};

const liftStatementSequence = (
  nodes: readonly PythonAstNode[],
  context: LiftContext,
): Result<PirStatement[]> => {
  const statements: PirStatement[] = [];

  for (const node of nodes) {
    switch (node._type) {
      case "Return": {
        const valueNode = pythonAstNode(node.value);
        if (valueNode === undefined) {
          statements.push({ kind: "return" });
          break;
        }
        const value = liftExpression(valueNode, context);
        if (!value.ok) return value;
        statements.push({ kind: "return", value: value.value });
        break;
      }

      case "AnnAssign": {
        const target = pythonAstNode(node.target);
        const annotation = pythonAstNode(node.annotation);
        if (target === undefined) {
          return err(
            new StructuredError(
              "PY_LIFT_ANN_ASSIGN",
              "Annotated assignment is missing its target.",
            ),
          );
        }
        if (
          target._type === "Name" &&
          !context.declaredLocals.has(stringField(target, "id") ?? "")
        ) {
          const declaration = declarationFromAssignment(
            target,
            annotation,
            pythonAstNode(node.value),
            context,
          );
          if (!declaration.ok) return declaration;
          statements.push(declaration.value);
          break;
        }
        const left = targetExpression(target, context);
        if (!left.ok) return left;
        const valueNode = pythonAstNode(node.value);
        if (valueNode === undefined) {
          return err(
            new StructuredError(
              "PY_LIFT_ANN_ASSIGN_VALUE",
              "Re-assignment requires a value.",
            ),
          );
        }
        const right = liftExpression(valueNode, context);
        if (!right.ok) return right;
        statements.push({
          kind: "assign",
          target: left.value,
          value: right.value,
        });
        break;
      }

      case "Assign": {
        const targets = pythonAstNodes(node.targets);
        const valueNode = pythonAstNode(node.value);
        if (targets.length !== 1 || valueNode === undefined) {
          return err(
            new StructuredError(
              "PY_LIFT_ASSIGN_UNSUPPORTED",
              "M13 lifts single-target Python assignments.",
            ),
          );
        }
        const target = targets[0]!;
        const name =
          target._type === "Name" ? stringField(target, "id") : undefined;
        if (name !== undefined && !context.declaredLocals.has(name)) {
          const declaration = declarationFromAssignment(
            target,
            undefined,
            valueNode,
            context,
          );
          if (!declaration.ok) return declaration;
          statements.push(declaration.value);
          break;
        }
        const left = targetExpression(target, context);
        if (!left.ok) return left;
        const right = liftExpression(valueNode, context);
        if (!right.ok) return right;
        statements.push({
          kind: "assign",
          target: left.value,
          value: right.value,
        });
        break;
      }

      case "Expr": {
        const valueNode = pythonAstNode(node.value);
        if (valueNode === undefined) {
          return err(
            new StructuredError(
              "PY_LIFT_EXPR",
              "Python expression statement is malformed.",
            ),
          );
        }
        const expression = liftExpression(valueNode, context);
        if (!expression.ok) return expression;
        statements.push({
          kind: "expression",
          expression: expression.value,
        });
        break;
      }

      case "If": {
        const test = pythonAstNode(node.test);
        if (test === undefined) {
          return err(
            new StructuredError(
              "PY_LIFT_IF",
              "Python if statement is missing its condition.",
            ),
          );
        }
        const condition = liftExpression(test, context);
        if (!condition.ok) return condition;
        const then = liftStatementSequence(
          pythonAstNodes(node.body),
          {
            ...context,
            names: new Map(context.names),
            types: new Map(context.types),
            declaredLocals: new Set(context.declaredLocals),
          },
        );
        if (!then.ok) return then;
        const alternate = liftStatementSequence(
          pythonAstNodes(node.orelse),
          {
            ...context,
            names: new Map(context.names),
            types: new Map(context.types),
            declaredLocals: new Set(context.declaredLocals),
          },
        );
        if (!alternate.ok) return alternate;
        statements.push({
          kind: "if",
          condition: condition.value,
          then: then.value,
          ...(alternate.value.length === 0
            ? {}
            : { else: alternate.value }),
        });
        break;
      }

      case "While": {
        const test = pythonAstNode(node.test);
        if (test === undefined) {
          return err(
            new StructuredError(
              "PY_LIFT_WHILE",
              "Python while statement is missing its condition.",
            ),
          );
        }
        const condition = liftExpression(test, context);
        if (!condition.ok) return condition;
        const body = liftStatementSequence(
          pythonAstNodes(node.body),
          context,
        );
        if (!body.ok) return body;
        statements.push({
          kind: "loop",
          condition: condition.value,
          body: body.value,
        });
        break;
      }

      case "For": {
        const target = pythonAstNode(node.target);
        const iterator = pythonAstNode(node.iter);
        if (target?._type !== "Name" || iterator === undefined) {
          return err(
            new StructuredError(
              "PY_LIFT_FOR_TARGET",
              "Portable Python for-each requires a named target.",
            ),
          );
        }
        const name = stringField(target, "id");
        if (name === undefined) {
          return err(
            new StructuredError(
              "PY_LIFT_FOR_NAME",
              "For-each target is missing its name.",
            ),
          );
        }
        const item: PirParameter = {
          id: idFor("param", name, target),
          name,
          type: { kind: "unknown" },
          sourceBinding: nodeBinding(context.sourceId, target, name),
        };
        const collection = liftExpression(iterator, context);
        if (!collection.ok) return collection;
        const nested: LiftContext = {
          ...context,
          names: new Map(context.names),
          types: new Map(context.types),
          declaredLocals: new Set(context.declaredLocals),
        };
        nested.names.set(name, item.id);
        nested.types.set(item.id, item.type);
        const body = liftStatementSequence(
          pythonAstNodes(node.body),
          nested,
        );
        if (!body.ok) return body;
        statements.push({
          kind: "for-each",
          item,
          collection: collection.value,
          body: body.value,
        });
        break;
      }

      case "Try": {
        const body = liftStatementSequence(
          pythonAstNodes(node.body),
          context,
        );
        if (!body.ok) return body;
        const handlers = pythonAstNodes(node.handlers);
        if (handlers.length > 1) {
          return err(
            new StructuredError(
              "PY_LIFT_MULTI_EXCEPT_UNSUPPORTED",
              "M13 maps one Python except clause to the portable PIR catch clause.",
            ),
          );
        }
        let catchClause:
          | Extract<PirStatement, { kind: "try" }>["catch"]
          | undefined;
        if (handlers[0] !== undefined) {
          const handler = handlers[0]!;
          const name = stringField(handler, "name");
          const nested: LiftContext = {
            ...context,
            names: new Map(context.names),
            types: new Map(context.types),
            declaredLocals: new Set(context.declaredLocals),
          };
          let parameter: PirParameter | undefined;
          if (name !== undefined) {
            parameter = {
              id: idFor("param", name, handler),
              name,
              type: { kind: "unknown" },
              sourceBinding: nodeBinding(
                context.sourceId,
                handler,
                name,
              ),
            };
            nested.names.set(name, parameter.id);
            nested.types.set(parameter.id, parameter.type);
          }
          const catchBody = liftStatementSequence(
            pythonAstNodes(handler.body),
            nested,
          );
          if (!catchBody.ok) return catchBody;
          catchClause = {
            ...(parameter === undefined ? {} : { parameter }),
            body: catchBody.value,
          };
        }
        const finalBody = liftStatementSequence(
          pythonAstNodes(node.finalbody),
          context,
        );
        if (!finalBody.ok) return finalBody;
        statements.push({
          kind: "try",
          body: body.value,
          ...(catchClause === undefined ? {} : { catch: catchClause }),
          ...(finalBody.value.length === 0
            ? {}
            : { finally: finalBody.value }),
        });
        break;
      }

      case "Raise": {
        const exception = pythonAstNode(node.exc);
        if (exception === undefined) {
          return err(
            new StructuredError(
              "PY_LIFT_RERAISE_UNSUPPORTED",
              "Bare Python re-raise is outside the M13 portable subset.",
            ),
          );
        }
        if (exception._type === "Call") {
          const callee = pythonAstNode(exception.func);
          const args = pythonAstNodes(exception.args);
          if (
            callee?._type === "Name" &&
            stringField(callee, "id") === "Exception" &&
            args.length === 1
          ) {
            const value = liftExpression(args[0]!, context);
            if (!value.ok) return value;
            statements.push({
              kind: "throw",
              value: value.value,
            });
            break;
          }
        }
        const value = liftExpression(exception, context);
        if (!value.ok) return value;
        statements.push({ kind: "throw", value: value.value });
        break;
      }

      case "Assert": {
        const test = pythonAstNode(node.test);
        if (test === undefined) {
          return err(
            new StructuredError(
              "PY_LIFT_ASSERT",
              "Python assert statement is missing its condition.",
            ),
          );
        }
        const condition = liftExpression(test, context);
        if (!condition.ok) return condition;
        const messageNode = pythonAstNode(node.msg);
        const message =
          messageNode?._type === "Constant" &&
          typeof messageNode.value === "string"
            ? messageNode.value
            : undefined;
        statements.push({
          kind: "assert",
          condition: condition.value,
          ...(message === undefined ? {} : { message }),
        });
        break;
      }

      case "Break":
        statements.push({ kind: "break" });
        break;

      case "Continue":
        statements.push({ kind: "continue" });
        break;

      case "Pass":
        break;

      default:
        return err(
          new StructuredError(
            "PY_LIFT_STATEMENT_UNSUPPORTED",
            `Unsupported Python statement node: ${node._type}.`,
          ),
        );
    }
  }

  return ok(statements);
};

const usedTypeVariables = (
  types: readonly PirType[],
  known: ReadonlySet<string>,
): Array<Extract<PirType, { kind: "type-variable" }>> => {
  const names = new Set<string>();
  const visit = (type: PirType): void => {
    switch (type.kind) {
      case "type-variable":
        if (known.has(type.name)) names.add(type.name);
        break;
      case "list":
        visit(type.element);
        break;
      case "tuple":
        type.elements.forEach(visit);
        break;
      case "optional":
        visit(type.inner);
        break;
      case "union":
        type.options.forEach(visit);
        break;
      case "intersection":
        type.members.forEach(visit);
        break;
      case "function":
        type.parameters.forEach(visit);
        visit(type.returns);
        break;
      case "generic":
        visit(type.base);
        type.arguments.forEach(visit);
        break;
      case "collection":
        if (type.key !== undefined) visit(type.key);
        visit(type.value);
        break;
      case "result":
        visit(type.ok);
        visit(type.error);
        break;
      case "variant":
        Object.values(type.cases).forEach((value) => {
          if (value !== null) visit(value);
        });
        break;
      case "promise":
        visit(type.value);
        break;
      case "boolean":
      case "number":
      case "string":
      case "null":
      case "void":
      case "never":
      case "unknown":
      case "record":
      case "named":
        break;
    }
  };
  types.forEach(visit);
  return [...names]
    .sort()
    .map((name) => ({
      kind: "type-variable",
      id: `type:${name}`,
      name,
    }));
};

const effectsFor = (
  statements: readonly PirStatement[],
  asyncFunction: boolean,
): EffectSpec[] => {
  let throws = false;
  let writes = false;
  const visit = (items: readonly PirStatement[]): void => {
    for (const statement of items) {
      switch (statement.kind) {
        case "throw":
          throws = true;
          break;
        case "assign":
          if (
            statement.target.kind === "property" ||
            statement.target.kind === "field-access" ||
            statement.target.kind === "index-access"
          ) {
            writes = true;
          }
          break;
        case "if":
          visit(statement.then);
          visit(statement.else ?? []);
          break;
        case "loop":
        case "for-each":
        case "defer":
          visit(statement.body);
          break;
        case "match":
          statement.cases.forEach((entry) => visit(entry.body));
          visit(statement.default ?? []);
          break;
        case "try":
          visit(statement.body);
          visit(statement.catch?.body ?? []);
          visit(statement.finally ?? []);
          break;
        case "block":
          visit(statement.statements);
          break;
        default:
          break;
      }
    }
  };
  visit(statements);
  const effects: EffectSpec[] = [];
  if (writes) effects.push({ kind: "write-memory" });
  if (throws) effects.push({ kind: "throw" });
  if (asyncFunction) effects.push({ kind: "async" });
  if (effects.length === 0) effects.push({ kind: "pure" });
  return effects;
};

const argumentNodes = (functionNode: PythonAstNode): PythonAstNode[] => {
  const args = pythonAstNode(functionNode.args);
  if (args === undefined) return [];
  return [
    ...pythonAstNodes(args.posonlyargs),
    ...pythonAstNodes(args.args),
    ...pythonAstNodes(args.kwonlyargs),
  ];
};

const liftFunction = (
  node: PythonAstNode,
  base: LiftContext,
): Result<PirFunction> => {
  const name = stringField(node, "name");
  if (name === undefined) {
    return err(
      new StructuredError(
        "PY_LIFT_FUNCTION_NAME",
        "Python function is missing its name.",
      ),
    );
  }

  const local: LiftContext = {
    ...base,
    names: new Map(base.names),
    types: new Map(base.types),
    declaredLocals: new Set<string>(),
  };

  const parameters: PirParameter[] = [];
  for (const argument of argumentNodes(node)) {
    const parameterName = stringField(argument, "arg");
    if (parameterName === undefined) {
      return err(
        new StructuredError(
          "PY_LIFT_PARAMETER_NAME",
          "Python parameter is missing its name.",
        ),
      );
    }
    const type = liftPythonAnnotation(
      pythonAstNode(argument.annotation),
      base.typeVariables,
    );
    if (!type.ok) return type;
    const parameter: PirParameter = {
      id: idFor("param", `${name}:${parameterName}`, argument),
      name: parameterName,
      type: type.value,
      sourceBinding: nodeBinding(
        base.sourceId,
        argument,
        parameterName,
      ),
    };
    parameters.push(parameter);
    local.names.set(parameterName, parameter.id);
    local.types.set(parameter.id, parameter.type);
    local.declaredLocals.add(parameterName);
    base.sourceBindings.push(parameter.sourceBinding!);
  }

  const returnType = liftPythonAnnotation(
    pythonAstNode(node.returns),
    base.typeVariables,
  );
  if (!returnType.ok) return returnType;

  const statements = liftStatementSequence(
    pythonAstNodes(node.body),
    local,
  );
  if (!statements.ok) return statements;

  const asyncFunction = node._type === "AsyncFunctionDef";
  const functionId =
    base.functionIds.get(name) ?? idFor("function", name, node);
  const functionBinding = nodeBinding(base.sourceId, node, name);
  base.sourceBindings.push(functionBinding);

  const typeParameters = usedTypeVariables(
    [...parameters.map((parameter) => parameter.type), returnType.value],
    base.typeVariables,
  );

  return ok({
    kind: "function",
    id: functionId,
    name,
    parameters,
    returnType: returnType.value,
    ...(typeParameters.length === 0 ? {} : { typeParameters }),
    statements: statements.value,
    effects: effectsFor(statements.value, asyncFunction),
    ...(asyncFunction ? { async: true } : {}),
    visibility: name.startsWith("_") ? "private" : "public",
    sourceBinding: functionBinding,
  });
};

const detectTypeVariables = (
  body: readonly PythonAstNode[],
): Set<string> => {
  const values = new Set<string>();
  for (const node of body) {
    if (node._type !== "Assign") continue;
    const targets = pythonAstNodes(node.targets);
    const value = pythonAstNode(node.value);
    if (
      targets.length !== 1 ||
      targets[0]?._type !== "Name" ||
      value?._type !== "Call"
    ) {
      continue;
    }
    const callee = pythonAstNode(value.func);
    if (
      callee?._type === "Name" &&
      stringField(callee, "id") === "TypeVar"
    ) {
      const name = stringField(targets[0]!, "id");
      if (name !== undefined) values.add(name);
    }
  }
  return values;
};

const liftImports = (
  body: readonly PythonAstNode[],
): ImportIntent[] => {
  const imports: ImportIntent[] = [];
  for (const node of body) {
    if (node._type === "Import") {
      for (const alias of pythonAstNodes(node.names)) {
        const module = stringField(alias, "name");
        if (module !== undefined) imports.push({ module });
      }
    } else if (node._type === "ImportFrom") {
      const module =
        typeof node.module === "string" ? node.module : "";
      const symbols = pythonAstNodes(node.names)
        .map((alias) => stringField(alias, "name"))
        .filter((name): name is string => name !== undefined);
      imports.push({
        module,
        ...(symbols.length === 0 ? {} : { symbols }),
      });
    }
  }
  return imports;
};

export const liftPythonProgram = (
  parsed: ParsedSource<PythonAstNode>,
): Result<LiftResult> => {
  if (
    parsed.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    )
  ) {
    return err(
      new StructuredError(
        "PY_LIFT_PARSE_ERRORS",
        "Cannot lift Python source with parser diagnostics.",
      ),
    );
  }
  if (parsed.ast._type !== "Module") {
    return err(
      new StructuredError(
        "PY_LIFT_MODULE",
        "Python parser root must be a Module.",
      ),
    );
  }

  const body = pythonAstNodes(parsed.ast.body);
  const typeVariables = detectTypeVariables(body);
  const functionIds = new Map<string, string>();
  for (const node of body) {
    if (
      node._type !== "FunctionDef" &&
      node._type !== "AsyncFunctionDef"
    ) {
      continue;
    }
    const name = stringField(node, "name");
    if (name !== undefined) {
      functionIds.set(name, idFor("function", name, node));
    }
  }

  const sourceBindings: SourceBinding[] = [];
  const base: LiftContext = {
    sourceId: parsed.document.sourceId,
    functionIds,
    names: new Map<string, string>(),
    types: new Map<string, PirType>(),
    declaredLocals: new Set<string>(),
    typeVariables,
    sourceBindings,
  };

  const functions: PirFunction[] = [];
  for (const node of body) {
    if (
      node._type === "FunctionDef" ||
      node._type === "AsyncFunctionDef"
    ) {
      const lifted = liftFunction(node, base);
      if (!lifted.ok) return lifted;
      functions.push(lifted.value);
    }
  }

  const moduleId = `module:${sanitize(parsed.document.sourceId)}`;
  const moduleBinding: SourceBinding = {
    sourceId: parsed.document.sourceId,
    language: "python",
    start: 0,
    end: parsed.document.text.length,
  };
  const module: PirModule = {
    id: moduleId,
    kind: "module",
    nameIntent: {
      preferredTerms: [
        parsed.document.path?.split(/[\\/]/u).pop()?.replace(/\.py$/u, "") ??
          parsed.document.sourceId,
      ],
      style: "snake",
    },
    exports: functions
      .filter((fn) => !fn.name.startsWith("_"))
      .map((fn) => fn.id),
    imports: liftImports(body),
    declarations: functions.map((fn) => fn.id),
    sourceBinding: moduleBinding,
  };
  sourceBindings.unshift(moduleBinding);

  const program: PirProgram = {
    version: "1.0.0",
    modules: [module],
    functions,
    sourceBindings: sourceBindings.map((binding) =>
      structuredClone(binding),
    ),
    annotations: {
      backend: "python",
      dynamicTypes: true,
      optionalAnnotations: true,
    },
  };
  const valid = validatePirProgram(program);
  return valid.ok
    ? ok({
        program,
        sourceBindings,
        diagnostics: [],
      })
    : err(valid.error);
};
