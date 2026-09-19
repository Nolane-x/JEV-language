import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  PirExpression,
  PirFunction,
  PirStatement,
  ProgramId,
} from "./model.ts";

export type PirCfgTerminator =
  | "fallthrough"
  | "branch"
  | "loop"
  | "return"
  | "throw";

export interface PirCfgBlock {
  id: string;
  statements: PirStatement[];
  successors: string[];
  terminator: PirCfgTerminator;
}

export interface PirCfg {
  functionId: ProgramId;
  entry: string;
  blocks: PirCfgBlock[];
  exits: string[];
}

class CfgBuilder {
  readonly blocks: PirCfgBlock[] = [];
  #counter = 0;

  create(): PirCfgBlock {
    const block: PirCfgBlock = {
      id: `cfg:block:${this.#counter++}`,
      statements: [],
      successors: [],
      terminator: "fallthrough",
    };
    this.blocks.push(block);
    return block;
  }

  get(id: string): PirCfgBlock {
    const block = this.blocks.find((entry) => entry.id === id);
    if (block === undefined) {
      throw new StructuredError(
        "PIR_CFG_INTERNAL_BLOCK",
        `CFG builder lost block ${id}.`,
      );
    }
    return block;
  }

  connect(from: string, to: string): void {
    const block = this.get(from);
    if (!block.successors.includes(to)) block.successors.push(to);
  }
}

const appendTo = (
  builder: CfgBuilder,
  ids: readonly string[],
  statement: PirStatement,
): void => {
  for (const id of ids) {
    builder.get(id).statements.push(structuredClone(statement));
  }
};

const lowerSequence = (
  builder: CfgBuilder,
  statements: readonly PirStatement[],
  incoming: string[],
): string[] => {
  let current = [...incoming];

  for (const statement of statements) {
    if (current.length === 0) break;

    switch (statement.kind) {
      case "return":
        appendTo(builder, current, statement);
        for (const id of current) {
          builder.get(id).terminator = "return";
        }
        current = [];
        break;
      case "throw":
        appendTo(builder, current, statement);
        for (const id of current) {
          builder.get(id).terminator = "throw";
        }
        current = [];
        break;
      case "if": {
        const joins: string[] = [];
        for (const id of current) {
          const controller = builder.get(id);
          controller.statements.push(structuredClone(statement));
          controller.terminator = "branch";

          const thenEntry = builder.create();
          const elseEntry = builder.create();
          const join = builder.create();
          builder.connect(id, thenEntry.id);
          builder.connect(id, elseEntry.id);

          const thenExits = lowerSequence(
            builder,
            statement.then,
            [thenEntry.id],
          );
          const elseExits = lowerSequence(
            builder,
            statement.else ?? [],
            [elseEntry.id],
          );
          for (const exit of [...thenExits, ...elseExits]) {
            builder.connect(exit, join.id);
          }
          joins.push(join.id);
        }
        current = joins;
        break;
      }
      case "loop": {
        const afterBlocks: string[] = [];
        for (const id of current) {
          const controller = builder.get(id);
          controller.statements.push(structuredClone(statement));
          controller.terminator = "loop";
          const bodyEntry = builder.create();
          const after = builder.create();
          builder.connect(id, bodyEntry.id);
          builder.connect(id, after.id);
          const bodyExits = lowerSequence(
            builder,
            statement.body,
            [bodyEntry.id],
          );
          for (const exit of bodyExits) builder.connect(exit, id);
          afterBlocks.push(after.id);
        }
        current = afterBlocks;
        break;
      }
      case "for-each": {
        const afterBlocks: string[] = [];
        for (const id of current) {
          const controller = builder.get(id);
          controller.statements.push(structuredClone(statement));
          controller.terminator = "loop";
          const bodyEntry = builder.create();
          const after = builder.create();
          builder.connect(id, bodyEntry.id);
          builder.connect(id, after.id);
          const bodyExits = lowerSequence(
            builder,
            statement.body,
            [bodyEntry.id],
          );
          for (const exit of bodyExits) builder.connect(exit, id);
          afterBlocks.push(after.id);
        }
        current = afterBlocks;
        break;
      }
      case "match": {
        const joins: string[] = [];
        for (const id of current) {
          const controller = builder.get(id);
          controller.statements.push(structuredClone(statement));
          controller.terminator = "branch";
          const join = builder.create();
          const branches = [
            ...statement.cases.map((entry) => entry.body),
            ...(statement.default === undefined
              ? []
              : [statement.default]),
          ];
          if (branches.length === 0) {
            builder.connect(id, join.id);
          }
          for (const branch of branches) {
            const entry = builder.create();
            builder.connect(id, entry.id);
            const exits = lowerSequence(builder, branch, [entry.id]);
            for (const exit of exits) builder.connect(exit, join.id);
          }
          joins.push(join.id);
        }
        current = joins;
        break;
      }
      case "try": {
        const joins: string[] = [];
        for (const id of current) {
          const controller = builder.get(id);
          controller.statements.push(structuredClone(statement));
          controller.terminator = "branch";
          const bodyEntry = builder.create();
          const catchEntry =
            statement.catch === undefined ? undefined : builder.create();
          const finallyEntry =
            statement.finally === undefined ? undefined : builder.create();
          const join = builder.create();

          builder.connect(id, bodyEntry.id);
          if (catchEntry !== undefined) builder.connect(id, catchEntry.id);

          const bodyExits = lowerSequence(
            builder,
            statement.body,
            [bodyEntry.id],
          );
          const catchExits =
            catchEntry === undefined || statement.catch === undefined
              ? []
              : lowerSequence(
                  builder,
                  statement.catch.body,
                  [catchEntry.id],
                );

          const preFinal = [...bodyExits, ...catchExits];
          if (finallyEntry !== undefined && statement.finally !== undefined) {
            for (const exit of preFinal) builder.connect(exit, finallyEntry.id);
            const finallyExits = lowerSequence(
              builder,
              statement.finally,
              [finallyEntry.id],
            );
            for (const exit of finallyExits) builder.connect(exit, join.id);
          } else {
            for (const exit of preFinal) builder.connect(exit, join.id);
          }
          joins.push(join.id);
        }
        current = joins;
        break;
      }
      case "block":
        current = lowerSequence(builder, statement.statements, current);
        break;
      default:
        appendTo(builder, current, statement);
        break;
    }
  }

  return current;
};

export const lowerFunctionToCfg = (
  fn: PirFunction,
): Result<PirCfg> => {
  if (fn.body === undefined && fn.statements === undefined) {
    return err(
      new StructuredError(
        "PIR_CFG_BODY_MISSING",
        "Cannot derive a CFG for a function without a body.",
      ),
    );
  }
  if (fn.body !== undefined && fn.statements !== undefined) {
    return err(
      new StructuredError(
        "PIR_CFG_BODY_CONFLICT",
        "Cannot derive a CFG from two simultaneous function body forms.",
      ),
    );
  }

  const builder = new CfgBuilder();
  const entry = builder.create();
  const statements: PirStatement[] =
    fn.statements ??
    (fn.body === undefined
      ? []
      : [{ kind: "return", value: structuredClone(fn.body) }]);
  const exits = lowerSequence(builder, statements, [entry.id]);

  return ok({
    functionId: fn.id,
    entry: entry.id,
    blocks: builder.blocks.map((block) => ({
      ...structuredClone(block),
      successors: [...block.successors].sort(),
    })),
    exits: [...new Set(exits)].sort(),
  });
};

export interface PirDefUseFact {
  symbolId: ProgramId;
  definitions: string[];
  uses: string[];
}

interface DefUseAccumulator {
  definitions: Map<ProgramId, Set<string>>;
  uses: Map<ProgramId, Set<string>>;
}

const record = (
  map: Map<ProgramId, Set<string>>,
  symbolId: ProgramId,
  location: string,
): void => {
  const values = map.get(symbolId) ?? new Set<string>();
  values.add(location);
  map.set(symbolId, values);
};

const walkExpression = (
  expression: PirExpression,
  location: string,
  acc: DefUseAccumulator,
): void => {
  switch (expression.kind) {
    case "variable":
    case "symbol-ref":
      record(acc.uses, expression.symbolId, location);
      return;
    case "property":
    case "field-access":
      walkExpression(expression.object, `${location}/object`, acc);
      return;
    case "index-access":
      walkExpression(expression.object, `${location}/object`, acc);
      walkExpression(expression.index, `${location}/index`, acc);
      return;
    case "call":
      walkExpression(expression.callee, `${location}/callee`, acc);
      expression.arguments.forEach((argument, index) =>
        walkExpression(argument, `${location}/arg:${index}`, acc),
      );
      return;
    case "construct":
      expression.arguments.forEach((argument, index) =>
        walkExpression(argument, `${location}/arg:${index}`, acc),
      );
      return;
    case "unary":
      walkExpression(expression.operand, `${location}/operand`, acc);
      return;
    case "binary":
    case "comparison":
      walkExpression(expression.left, `${location}/left`, acc);
      walkExpression(expression.right, `${location}/right`, acc);
      return;
    case "logical":
      expression.values.forEach((value, index) =>
        walkExpression(value, `${location}/value:${index}`, acc),
      );
      return;
    case "conditional":
      walkExpression(expression.condition, `${location}/condition`, acc);
      walkExpression(expression.whenTrue, `${location}/true`, acc);
      walkExpression(expression.whenFalse, `${location}/false`, acc);
      return;
    case "lambda":
      expression.parameters.forEach((parameter) =>
        record(acc.definitions, parameter.id, `${location}/lambda-param`),
      );
      walkExpression(expression.body, `${location}/lambda-body`, acc);
      return;
    case "await":
      walkExpression(expression.value, `${location}/await`, acc);
      return;
    case "cast":
      walkExpression(expression.value, `${location}/cast`, acc);
      return;
    case "collection":
      expression.elements.forEach((value, index) =>
        walkExpression(value, `${location}/element:${index}`, acc),
      );
      return;
    case "record":
      Object.entries(expression.fields).forEach(([name, value]) =>
        walkExpression(value, `${location}/field:${name}`, acc),
      );
      return;
    case "match":
      walkExpression(expression.value, `${location}/match-value`, acc);
      expression.cases.forEach((entry, index) =>
        walkExpression(
          entry.expression,
          `${location}/case:${index}`,
          acc,
        ),
      );
      return;
    case "filter":
      walkExpression(expression.collection, `${location}/collection`, acc);
      record(acc.definitions, expression.item.id, `${location}/item`);
      walkExpression(expression.predicate, `${location}/predicate`, acc);
      return;
    case "map":
      walkExpression(expression.collection, `${location}/collection`, acc);
      record(acc.definitions, expression.item.id, `${location}/item`);
      walkExpression(expression.mapper, `${location}/mapper`, acc);
      return;
    case "hole":
    case "literal":
      return;
  }
};

const walkStatements = (
  statements: readonly PirStatement[],
  path: string,
  acc: DefUseAccumulator,
): void => {
  statements.forEach((statement, index) => {
    const location = `${path}/stmt:${index}:${statement.kind}`;
    switch (statement.kind) {
      case "declare":
        record(acc.definitions, statement.symbol.id, location);
        if (statement.initializer !== undefined) {
          walkExpression(statement.initializer, `${location}/init`, acc);
        }
        break;
      case "assign":
        if (
          statement.target.kind === "variable" ||
          statement.target.kind === "symbol-ref"
        ) {
          record(acc.definitions, statement.target.symbolId, location);
        } else {
          walkExpression(statement.target, `${location}/target`, acc);
        }
        walkExpression(statement.value, `${location}/value`, acc);
        break;
      case "expression":
        walkExpression(statement.expression, location, acc);
        break;
      case "return":
        if (statement.value !== undefined) {
          walkExpression(statement.value, location, acc);
        }
        break;
      case "if":
        walkExpression(statement.condition, `${location}/condition`, acc);
        walkStatements(statement.then, `${location}/then`, acc);
        walkStatements(statement.else ?? [], `${location}/else`, acc);
        break;
      case "loop":
        if (statement.condition !== undefined) {
          walkExpression(statement.condition, `${location}/condition`, acc);
        }
        walkStatements(statement.body, `${location}/body`, acc);
        break;
      case "for-each":
        walkExpression(statement.collection, `${location}/collection`, acc);
        record(acc.definitions, statement.item.id, `${location}/item`);
        walkStatements(statement.body, `${location}/body`, acc);
        break;
      case "match":
        walkExpression(statement.value, `${location}/value`, acc);
        statement.cases.forEach((entry, caseIndex) =>
          walkStatements(
            entry.body,
            `${location}/case:${caseIndex}`,
            acc,
          ),
        );
        walkStatements(statement.default ?? [], `${location}/default`, acc);
        break;
      case "try":
        walkStatements(statement.body, `${location}/try`, acc);
        if (statement.catch?.parameter !== undefined) {
          record(
            acc.definitions,
            statement.catch.parameter.id,
            `${location}/catch-param`,
          );
        }
        walkStatements(
          statement.catch?.body ?? [],
          `${location}/catch`,
          acc,
        );
        walkStatements(
          statement.finally ?? [],
          `${location}/finally`,
          acc,
        );
        break;
      case "throw":
        walkExpression(statement.value, location, acc);
        break;
      case "assert":
        walkExpression(statement.condition, location, acc);
        break;
      case "defer":
        walkStatements(statement.body, `${location}/defer`, acc);
        break;
      case "block":
        walkStatements(statement.statements, `${location}/block`, acc);
        break;
      case "break":
      case "continue":
      case "hole":
        break;
    }
  });
};

export const analyzeDefUse = (
  fn: PirFunction,
): PirDefUseFact[] => {
  const acc: DefUseAccumulator = {
    definitions: new Map(),
    uses: new Map(),
  };

  fn.parameters.forEach((parameter) =>
    record(acc.definitions, parameter.id, "function-entry"),
  );

  if (fn.body !== undefined) {
    walkExpression(fn.body, "expression-body", acc);
  } else {
    walkStatements(fn.statements ?? [], "function-body", acc);
  }

  const ids = new Set([
    ...acc.definitions.keys(),
    ...acc.uses.keys(),
  ]);
  return [...ids]
    .sort()
    .map((symbolId) => ({
      symbolId,
      definitions: [...(acc.definitions.get(symbolId) ?? [])].sort(),
      uses: [...(acc.uses.get(symbolId) ?? [])].sort(),
    }));
};
