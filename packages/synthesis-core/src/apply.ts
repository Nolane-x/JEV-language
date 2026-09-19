import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  validatePirProgram,
  type PirExpression,
  type PirProgram,
  type PirStatement,
} from "../../program-ir/src/index.ts";
import type { ExpansionCandidate } from "./model.ts";

interface ExpressionReplaceResult {
  expression: PirExpression;
  replacements: number;
}

const replaceInExpression = (
  expression: PirExpression,
  holeId: string,
  replacement: PirExpression,
): ExpressionReplaceResult => {
  if (expression.kind === "hole" && expression.id === holeId) {
    return {
      expression: structuredClone(replacement),
      replacements: 1,
    };
  }

  const one = (child: PirExpression): ExpressionReplaceResult =>
    replaceInExpression(child, holeId, replacement);

  switch (expression.kind) {
    case "property": {
      const object = one(expression.object);
      return {
        expression: { ...structuredClone(expression), object: object.expression },
        replacements: object.replacements,
      };
    }
    case "field-access": {
      const object = one(expression.object);
      return {
        expression: { ...structuredClone(expression), object: object.expression },
        replacements: object.replacements,
      };
    }
    case "index-access": {
      const object = one(expression.object);
      const index = one(expression.index);
      return {
        expression: {
          ...structuredClone(expression),
          object: object.expression,
          index: index.expression,
        },
        replacements: object.replacements + index.replacements,
      };
    }
    case "call": {
      const callee = one(expression.callee);
      let replacements = callee.replacements;
      const argumentsList = expression.arguments.map((argument) => {
        const result = one(argument);
        replacements += result.replacements;
        return result.expression;
      });
      return {
        expression: {
          ...structuredClone(expression),
          callee: callee.expression,
          arguments: argumentsList,
        },
        replacements,
      };
    }
    case "construct": {
      let replacements = 0;
      const argumentsList = expression.arguments.map((argument) => {
        const result = one(argument);
        replacements += result.replacements;
        return result.expression;
      });
      return {
        expression: {
          ...structuredClone(expression),
          arguments: argumentsList,
        },
        replacements,
      };
    }
    case "unary": {
      const operand = one(expression.operand);
      return {
        expression: {
          ...structuredClone(expression),
          operand: operand.expression,
        },
        replacements: operand.replacements,
      };
    }
    case "binary":
    case "comparison": {
      const left = one(expression.left);
      const right = one(expression.right);
      return {
        expression: {
          ...structuredClone(expression),
          left: left.expression,
          right: right.expression,
        },
        replacements: left.replacements + right.replacements,
      };
    }
    case "logical": {
      let replacements = 0;
      const values = expression.values.map((value) => {
        const result = one(value);
        replacements += result.replacements;
        return result.expression;
      });
      return {
        expression: { ...structuredClone(expression), values },
        replacements,
      };
    }
    case "conditional": {
      const condition = one(expression.condition);
      const whenTrue = one(expression.whenTrue);
      const whenFalse = one(expression.whenFalse);
      return {
        expression: {
          ...structuredClone(expression),
          condition: condition.expression,
          whenTrue: whenTrue.expression,
          whenFalse: whenFalse.expression,
        },
        replacements:
          condition.replacements +
          whenTrue.replacements +
          whenFalse.replacements,
      };
    }
    case "lambda": {
      const body = one(expression.body);
      return {
        expression: { ...structuredClone(expression), body: body.expression },
        replacements: body.replacements,
      };
    }
    case "await": {
      const value = one(expression.value);
      return {
        expression: { ...structuredClone(expression), value: value.expression },
        replacements: value.replacements,
      };
    }
    case "cast": {
      const value = one(expression.value);
      return {
        expression: { ...structuredClone(expression), value: value.expression },
        replacements: value.replacements,
      };
    }
    case "collection": {
      let replacements = 0;
      const elements = expression.elements.map((element) => {
        const result = one(element);
        replacements += result.replacements;
        return result.expression;
      });
      return {
        expression: { ...structuredClone(expression), elements },
        replacements,
      };
    }
    case "record": {
      let replacements = 0;
      const fields = Object.fromEntries(
        Object.entries(expression.fields).map(([name, value]) => {
          const result = one(value);
          replacements += result.replacements;
          return [name, result.expression];
        }),
      );
      return {
        expression: { ...structuredClone(expression), fields },
        replacements,
      };
    }
    case "match": {
      const value = one(expression.value);
      let replacements = value.replacements;
      const cases = expression.cases.map((entry) => {
        const result = one(entry.expression);
        replacements += result.replacements;
        return {
          ...structuredClone(entry),
          expression: result.expression,
        };
      });
      return {
        expression: {
          ...structuredClone(expression),
          value: value.expression,
          cases,
        },
        replacements,
      };
    }
    case "filter": {
      const collection = one(expression.collection);
      const predicate = one(expression.predicate);
      return {
        expression: {
          ...structuredClone(expression),
          collection: collection.expression,
          predicate: predicate.expression,
        },
        replacements: collection.replacements + predicate.replacements,
      };
    }
    case "map": {
      const collection = one(expression.collection);
      const mapper = one(expression.mapper);
      return {
        expression: {
          ...structuredClone(expression),
          collection: collection.expression,
          mapper: mapper.expression,
        },
        replacements: collection.replacements + mapper.replacements,
      };
    }
    case "hole":
    case "literal":
    case "variable":
    case "symbol-ref":
      return {
        expression: structuredClone(expression),
        replacements: 0,
      };
  }
};

interface StatementReplaceResult {
  statements: PirStatement[];
  replacements: number;
}

const replaceExpressionHolesInStatements = (
  statements: readonly PirStatement[],
  holeId: string,
  replacement: PirExpression,
): StatementReplaceResult => {
  let replacements = 0;

  const expression = (value: PirExpression): PirExpression => {
    const result = replaceInExpression(value, holeId, replacement);
    replacements += result.replacements;
    return result.expression;
  };

  const nested = (value: readonly PirStatement[]): PirStatement[] => {
    const result = replaceExpressionHolesInStatements(
      value,
      holeId,
      replacement,
    );
    replacements += result.replacements;
    return result.statements;
  };

  const mapped = statements.map((statement): PirStatement => {
    switch (statement.kind) {
      case "declare":
        return {
          ...structuredClone(statement),
          ...(statement.initializer === undefined
            ? {}
            : { initializer: expression(statement.initializer) }),
        };
      case "assign":
        return {
          ...structuredClone(statement),
          target: expression(statement.target),
          value: expression(statement.value),
        };
      case "expression":
        return {
          kind: "expression",
          expression: expression(statement.expression),
        };
      case "return":
        return {
          kind: "return",
          ...(statement.value === undefined
            ? {}
            : { value: expression(statement.value) }),
        };
      case "if":
        return {
          ...structuredClone(statement),
          condition: expression(statement.condition),
          then: nested(statement.then),
          ...(statement.else === undefined
            ? {}
            : { else: nested(statement.else) }),
        };
      case "loop":
        return {
          ...structuredClone(statement),
          ...(statement.condition === undefined
            ? {}
            : { condition: expression(statement.condition) }),
          body: nested(statement.body),
        };
      case "for-each":
        return {
          ...structuredClone(statement),
          collection: expression(statement.collection),
          body: nested(statement.body),
        };
      case "match":
        return {
          ...structuredClone(statement),
          value: expression(statement.value),
          cases: statement.cases.map((entry) => ({
            ...structuredClone(entry),
            body: nested(entry.body),
          })),
          ...(statement.default === undefined
            ? {}
            : { default: nested(statement.default) }),
        };
      case "try":
        return {
          ...structuredClone(statement),
          body: nested(statement.body),
          ...(statement.catch === undefined
            ? {}
            : {
                catch: {
                  ...structuredClone(statement.catch),
                  body: nested(statement.catch.body),
                },
              }),
          ...(statement.finally === undefined
            ? {}
            : { finally: nested(statement.finally) }),
        };
      case "throw":
        return {
          kind: "throw",
          value: expression(statement.value),
        };
      case "assert":
        return {
          ...structuredClone(statement),
          condition: expression(statement.condition),
        };
      case "defer":
        return {
          kind: "defer",
          body: nested(statement.body),
        };
      case "block":
        return {
          kind: "block",
          statements: nested(statement.statements),
        };
      case "break":
      case "continue":
      case "hole":
        return structuredClone(statement);
    }
  });

  return { statements: mapped, replacements };
};

const replaceStatementHole = (
  statements: readonly PirStatement[],
  holeId: string,
  replacement: readonly PirStatement[],
): StatementReplaceResult => {
  let replacements = 0;
  const output: PirStatement[] = [];

  const nested = (value: readonly PirStatement[]): PirStatement[] => {
    const result = replaceStatementHole(value, holeId, replacement);
    replacements += result.replacements;
    return result.statements;
  };

  for (const statement of statements) {
    if (statement.kind === "hole" && statement.holeId === holeId) {
      output.push(...replacement.map((entry) => structuredClone(entry)));
      replacements += 1;
      continue;
    }

    switch (statement.kind) {
      case "if":
        output.push({
          ...structuredClone(statement),
          then: nested(statement.then),
          ...(statement.else === undefined
            ? {}
            : { else: nested(statement.else) }),
        });
        break;
      case "loop":
        output.push({
          ...structuredClone(statement),
          body: nested(statement.body),
        });
        break;
      case "for-each":
        output.push({
          ...structuredClone(statement),
          body: nested(statement.body),
        });
        break;
      case "match":
        output.push({
          ...structuredClone(statement),
          cases: statement.cases.map((entry) => ({
            ...structuredClone(entry),
            body: nested(entry.body),
          })),
          ...(statement.default === undefined
            ? {}
            : { default: nested(statement.default) }),
        });
        break;
      case "try":
        output.push({
          ...structuredClone(statement),
          body: nested(statement.body),
          ...(statement.catch === undefined
            ? {}
            : {
                catch: {
                  ...structuredClone(statement.catch),
                  body: nested(statement.catch.body),
                },
              }),
          ...(statement.finally === undefined
            ? {}
            : { finally: nested(statement.finally) }),
        });
        break;
      case "defer":
        output.push({
          kind: "defer",
          body: nested(statement.body),
        });
        break;
      case "block":
        output.push({
          kind: "block",
          statements: nested(statement.statements),
        });
        break;
      default:
        output.push(structuredClone(statement));
        break;
    }
  }

  return { statements: output, replacements };
};

export const applyExpansionCandidate = (
  program: PirProgram,
  functionId: string,
  holeId: string,
  candidate: ExpansionCandidate,
): Result<PirProgram> => {
  const next = structuredClone(program);
  const fn = next.functions.find((value) => value.id === functionId);
  if (fn === undefined) {
    return err(
      new StructuredError(
        "SYNTH_TARGET_FUNCTION",
        `Target function was not found: ${functionId}.`,
      ),
    );
  }

  let replacements = 0;

  if (candidate.replacement.kind === "expression") {
    if (fn.body !== undefined) {
      const result = replaceInExpression(
        fn.body,
        holeId,
        candidate.replacement.value,
      );
      fn.body = result.expression;
      replacements += result.replacements;
    }
    if (fn.statements !== undefined) {
      const result = replaceExpressionHolesInStatements(
        fn.statements,
        holeId,
        candidate.replacement.value,
      );
      fn.statements = result.statements;
      replacements += result.replacements;
    }
  } else {
    if (fn.statements === undefined) {
      return err(
        new StructuredError(
          "SYNTH_STATEMENT_TARGET",
          "Statement replacement requires a statement-bodied target function.",
        ),
      );
    }
    const result = replaceStatementHole(
      fn.statements,
      holeId,
      candidate.replacement.value,
    );
    fn.statements = result.statements;
    replacements = result.replacements;
  }

  if (replacements === 0) {
    return err(
      new StructuredError(
        "SYNTH_HOLE_NOT_FOUND",
        `Hole ${holeId} was not found in target function ${functionId}.`,
      ),
    );
  }
  if (replacements > 1) {
    return err(
      new StructuredError(
        "SYNTH_HOLE_DUPLICATE_LOCATION",
        `Hole ${holeId} occurs in more than one program location.`,
      ),
    );
  }

  next.holes = [
    ...(next.holes ?? []).filter((hole) => hole.id !== holeId),
    ...candidate.newHoles.map((hole) => structuredClone(hole)),
  ].sort((a, b) => a.id.localeCompare(b.id));

  const valid = validatePirProgram(next);
  return valid.ok ? ok(next) : err(valid.error);
};
