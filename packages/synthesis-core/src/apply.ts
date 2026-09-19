import {
  err,
  ok,
  StructuredError,
  validatePirProgram,
  type PirExpression,
  type PirProgram,
  type Result,
} from "../../program-ir/src/index.ts";
import type { ExpansionCandidate } from "./model.ts";

const replaceInExpression = (
  expression: PirExpression,
  holeId: string,
  replacement: PirExpression,
): { expression: PirExpression; replaced: boolean } => {
  if (expression.kind === "hole" && expression.id === holeId) {
    return { expression: structuredClone(replacement), replaced: true };
  }

  const one = (
    child: PirExpression,
  ): { child: PirExpression; replaced: boolean } => {
    const result = replaceInExpression(child, holeId, replacement);
    return { child: result.expression, replaced: result.replaced };
  };

  switch (expression.kind) {
    case "property": {
      const result = one(expression.object);
      return {
        expression: { ...structuredClone(expression), object: result.child },
        replaced: result.replaced,
      };
    }
    case "field-access": {
      const result = one(expression.object);
      return {
        expression: { ...structuredClone(expression), object: result.child },
        replaced: result.replaced,
      };
    }
    case "index-access": {
      const object = one(expression.object);
      const index = one(expression.index);
      return {
        expression: {
          ...structuredClone(expression),
          object: object.child,
          index: index.child,
        },
        replaced: object.replaced || index.replaced,
      };
    }
    case "call": {
      const callee = one(expression.callee);
      let replaced = callee.replaced;
      const args = expression.arguments.map((argument) => {
        const result = one(argument);
        replaced ||= result.replaced;
        return result.child;
      });
      return {
        expression: {
          ...structuredClone(expression),
          callee: callee.child,
          arguments: args,
        },
        replaced,
      };
    }
    case "construct": {
      let replaced = false;
      const args = expression.arguments.map((argument) => {
        const result = one(argument);
        replaced ||= result.replaced;
        return result.child;
      });
      return {
        expression: { ...structuredClone(expression), arguments: args },
        replaced,
      };
    }
    case "unary": {
      const result = one(expression.operand);
      return {
        expression: { ...structuredClone(expression), operand: result.child },
        replaced: result.replaced,
      };
    }
    case "binary":
    case "comparison": {
      const left = one(expression.left);
      const right = one(expression.right);
      return {
        expression: {
          ...structuredClone(expression),
          left: left.child,
          right: right.child,
        },
        replaced: left.replaced || right.replaced,
      };
    }
    case "logical": {
      let replaced = false;
      const values = expression.values.map((value) => {
        const result = one(value);
        replaced ||= result.replaced;
        return result.child;
      });
      return {
        expression: { ...structuredClone(expression), values },
        replaced,
      };
    }
    case "conditional": {
      const condition = one(expression.condition);
      const whenTrue = one(expression.whenTrue);
      const whenFalse = one(expression.whenFalse);
      return {
        expression: {
          ...structuredClone(expression),
          condition: condition.child,
          whenTrue: whenTrue.child,
          whenFalse: whenFalse.child,
        },
        replaced:
          condition.replaced || whenTrue.replaced || whenFalse.replaced,
      };
    }
    case "lambda": {
      const body = one(expression.body);
      return {
        expression: { ...structuredClone(expression), body: body.child },
        replaced: body.replaced,
      };
    }
    case "await": {
      const value = one(expression.value);
      return {
        expression: { ...structuredClone(expression), value: value.child },
        replaced: value.replaced,
      };
    }
    case "cast": {
      const value = one(expression.value);
      return {
        expression: { ...structuredClone(expression), value: value.child },
        replaced: value.replaced,
      };
    }
    case "collection": {
      let replaced = false;
      const elements = expression.elements.map((element) => {
        const result = one(element);
        replaced ||= result.replaced;
        return result.child;
      });
      return {
        expression: { ...structuredClone(expression), elements },
        replaced,
      };
    }
    case "record": {
      let replaced = false;
      const fields = Object.fromEntries(
        Object.entries(expression.fields).map(([name, value]) => {
          const result = one(value);
          replaced ||= result.replaced;
          return [name, result.child];
        }),
      );
      return {
        expression: { ...structuredClone(expression), fields },
        replaced,
      };
    }
    case "match": {
      const value = one(expression.value);
      let replaced = value.replaced;
      const cases = expression.cases.map((entry) => {
        const result = one(entry.expression);
        replaced ||= result.replaced;
        return { ...structuredClone(entry), expression: result.child };
      });
      return {
        expression: {
          ...structuredClone(expression),
          value: value.child,
          cases,
        },
        replaced,
      };
    }
    case "filter": {
      const collection = one(expression.collection);
      const predicate = one(expression.predicate);
      return {
        expression: {
          ...structuredClone(expression),
          collection: collection.child,
          predicate: predicate.child,
        },
        replaced: collection.replaced || predicate.replaced,
      };
    }
    case "map": {
      const collection = one(expression.collection);
      const mapper = one(expression.mapper);
      return {
        expression: {
          ...structuredClone(expression),
          collection: collection.child,
          mapper: mapper.child,
        },
        replaced: collection.replaced || mapper.replaced,
      };
    }
    case "hole":
    case "literal":
    case "variable":
    case "symbol-ref":
      return { expression: structuredClone(expression), replaced: false };
  }
};

export const applyExpansionCandidate = (
  program: PirProgram,
  functionId: string,
  holeId: string,
  candidate: ExpansionCandidate,
): Result<PirProgram> => {
  const next = structuredClone(program);
  const fn = next.functions.find((value) => value.id === functionId);
  if (fn === undefined || fn.body === undefined) {
    return err(
      new StructuredError(
        "SYNTH_TARGET_FUNCTION",
        "Synthesis expansion requires an expression-bodied target function.",
      ),
    );
  }

  const replaced = replaceInExpression(
    fn.body,
    holeId,
    candidate.replacement,
  );
  if (!replaced.replaced) {
    return err(
      new StructuredError(
        "SYNTH_HOLE_NOT_FOUND",
        `Hole ${holeId} was not found in target function ${functionId}.`,
      ),
    );
  }
  fn.body = replaced.expression;

  next.holes = [
    ...(next.holes ?? []).filter((hole) => hole.id !== holeId),
    ...candidate.newHoles.map((hole) => structuredClone(hole)),
  ].sort((a, b) => a.id.localeCompare(b.id));

  const valid = validatePirProgram(next);
  return valid.ok ? ok(next) : err(valid.error);
};
