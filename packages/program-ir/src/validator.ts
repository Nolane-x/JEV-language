import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  samePirType,
  type EffectSpec,
  type PirExpression,
  type PirFunction,
  type PirProgram,
  type PirStatement,
  type PirType,
  type ProgramHole,
  type ProgramId,
  type SourceBinding,
} from "./model.ts";

type Scope = Map<ProgramId, PirType>;

interface InferOptions {
  allowAwait: boolean;
}

const idRequired = (id: string, code: string, what: string): Result<void> =>
  id.trim() === ""
    ? err(new StructuredError(code, `${what} id must be non-empty.`))
    : ok(undefined);

export const validateSourceBinding = (
  binding: SourceBinding,
): Result<void> => {
  if (binding.sourceId.trim() === "") {
    return err(
      new StructuredError(
        "PIR_SOURCE_BINDING_ID",
        "Source binding requires a non-empty sourceId.",
      ),
    );
  }
  if (
    (binding.start === undefined) !== (binding.end === undefined)
  ) {
    return err(
      new StructuredError(
        "PIR_SOURCE_BINDING_RANGE",
        "Source binding start/end must either both exist or both be absent.",
      ),
    );
  }
  if (
    binding.start !== undefined &&
    binding.end !== undefined &&
    (!Number.isInteger(binding.start) ||
      !Number.isInteger(binding.end) ||
      binding.start < 0 ||
      binding.end < binding.start)
  ) {
    return err(
      new StructuredError(
        "PIR_SOURCE_BINDING_RANGE",
        "Source binding offsets must be non-negative ordered integers.",
      ),
    );
  }
  if (
    binding.existingName !== undefined &&
    binding.existingName.trim() === ""
  ) {
    return err(
      new StructuredError(
        "PIR_SOURCE_BINDING_NAME",
        "Existing source names must not be empty.",
      ),
    );
  }
  return ok(undefined);
};

export const validatePirType = (type: PirType): Result<void> => {
  switch (type.kind) {
    case "boolean":
    case "number":
    case "string":
    case "null":
    case "void":
    case "never":
    case "unknown":
      return ok(undefined);
    case "list":
      return validatePirType(type.element);
    case "record":
      for (const [name, field] of Object.entries(type.fields)) {
        if (name.trim() === "") {
          return err(
            new StructuredError(
              "PIR_TYPE_RECORD_FIELD",
              "Record field names must be non-empty.",
            ),
          );
        }
        const valid = validatePirType(field);
        if (!valid.ok) return valid;
      }
      return ok(undefined);
    case "tuple":
      for (const element of type.elements) {
        const valid = validatePirType(element);
        if (!valid.ok) return valid;
      }
      return ok(undefined);
    case "optional":
      return validatePirType(type.inner);
    case "union":
    case "intersection": {
      const members =
        type.kind === "union" ? type.options : type.members;
      if (members.length < 2) {
        return err(
          new StructuredError(
            "PIR_TYPE_COMPOSITE_ARITY",
            `${type.kind} types require at least two members.`,
          ),
        );
      }
      for (const member of members) {
        const valid = validatePirType(member);
        if (!valid.ok) return valid;
      }
      return ok(undefined);
    }
    case "function":
      for (const parameter of type.parameters) {
        const valid = validatePirType(parameter);
        if (!valid.ok) return valid;
      }
      return validatePirType(type.returns);
    case "named":
      if (type.symbolId.trim() === "") {
        return err(
          new StructuredError(
            "PIR_TYPE_NAMED_ID",
            "Named type references require a non-empty symbol id.",
          ),
        );
      }
      for (const argument of type.typeArguments ?? []) {
        const valid = validatePirType(argument);
        if (!valid.ok) return valid;
      }
      return ok(undefined);
    case "generic": {
      const base = validatePirType(type.base);
      if (!base.ok) return base;
      if (type.arguments.length === 0) {
        return err(
          new StructuredError(
            "PIR_TYPE_GENERIC_ARITY",
            "Generic type applications require at least one argument.",
          ),
        );
      }
      for (const argument of type.arguments) {
        const valid = validatePirType(argument);
        if (!valid.ok) return valid;
      }
      return ok(undefined);
    }
    case "collection": {
      if (type.collectionKind === "map" && type.key === undefined) {
        return err(
          new StructuredError(
            "PIR_TYPE_MAP_KEY",
            "Map collection types require a key type.",
          ),
        );
      }
      if (type.collectionKind !== "map" && type.key !== undefined) {
        return err(
          new StructuredError(
            "PIR_TYPE_COLLECTION_KEY",
            "Only map collection types may declare key types.",
          ),
        );
      }
      if (type.key !== undefined) {
        const key = validatePirType(type.key);
        if (!key.ok) return key;
      }
      return validatePirType(type.value);
    }
    case "type-variable":
      if (type.id.trim() === "" || type.name.trim() === "") {
        return err(
          new StructuredError(
            "PIR_TYPE_VARIABLE_ID",
            "Type variables require non-empty ids and names.",
          ),
        );
      }
      return type.bound === undefined
        ? ok(undefined)
        : validatePirType(type.bound);
    case "result": {
      const success = validatePirType(type.ok);
      return success.ok ? validatePirType(type.error) : success;
    }
    case "variant":
      if (Object.keys(type.cases).length === 0) {
        return err(
          new StructuredError(
            "PIR_TYPE_VARIANT_EMPTY",
            "Variant types require at least one case.",
          ),
        );
      }
      for (const [tag, payload] of Object.entries(type.cases)) {
        if (tag.trim() === "") {
          return err(
            new StructuredError(
              "PIR_TYPE_VARIANT_TAG",
              "Variant case tags must be non-empty.",
            ),
          );
        }
        if (payload !== null) {
          const valid = validatePirType(payload);
          if (!valid.ok) return valid;
        }
      }
      return ok(undefined);
    case "promise":
      return validatePirType(type.value);
  }
};

const literalMatchesType = (
  value: unknown,
  type: PirType,
): boolean => {
  switch (type.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "null":
      return value === null;
    case "unknown":
      return true;
    case "optional":
      return value === null || literalMatchesType(value, type.inner);
    case "union":
      return type.options.some((member) => literalMatchesType(value, member));
    default:
      return true;
  }
};

const expectType = (
  actual: PirType,
  expected: PirType,
  code: string,
  message: string,
): Result<void> =>
  samePirType(actual, expected)
    ? ok(undefined)
    : err(new StructuredError(code, message));

export const inferPirExpressionType = (
  expression: PirExpression,
  scope: ReadonlyMap<ProgramId, PirType>,
  options: InferOptions = { allowAwait: true },
): Result<PirType> => {
  switch (expression.kind) {
    case "hole": {
      const valid = validatePirType(expression.expected);
      return valid.ok ? ok(expression.expected) : err(valid.error);
    }
    case "literal": {
      const valid = validatePirType(expression.type);
      if (!valid.ok) return err(valid.error);
      return literalMatchesType(expression.value, expression.type)
        ? ok(expression.type)
        : err(
            new StructuredError(
              "PIR_LITERAL_TYPE",
              "Literal value does not match its declared PIR type.",
            ),
          );
    }
    case "variable":
    case "symbol-ref": {
      const type = scope.get(expression.symbolId);
      return type === undefined
        ? err(
            new StructuredError(
              "PIR_UNKNOWN_SYMBOL",
              `Unknown PIR symbol: ${expression.symbolId}`,
            ),
          )
        : ok(type);
    }
    case "property":
    case "field-access": {
      const object = inferPirExpressionType(
        expression.object,
        scope,
        options,
      );
      if (!object.ok) return object;
      if (object.value.kind !== "record") {
        return err(
          new StructuredError(
            "PIR_PROPERTY_NON_RECORD",
            "Field access requires a record type.",
          ),
        );
      }
      const field =
        expression.kind === "property"
          ? expression.property
          : expression.field;
      const type = object.value.fields[field];
      return type === undefined
        ? err(
            new StructuredError(
              "PIR_PROPERTY_MISSING",
              `Record has no field ${field}.`,
            ),
          )
        : ok(type);
    }
    case "index-access": {
      const object = inferPirExpressionType(
        expression.object,
        scope,
        options,
      );
      if (!object.ok) return object;
      const index = inferPirExpressionType(
        expression.index,
        scope,
        options,
      );
      if (!index.ok) return index;
      if (object.value.kind === "list") {
        const valid = expectType(
          index.value,
          { kind: "number" },
          "PIR_INDEX_TYPE",
          "List indexing requires a numeric index.",
        );
        return valid.ok ? ok(object.value.element) : err(valid.error);
      }
      if (object.value.kind === "collection") {
        if (object.value.collectionKind !== "map") {
          return err(
            new StructuredError(
              "PIR_INDEX_COLLECTION",
              "Only map collection types support indexed lookup.",
            ),
          );
        }
        if (object.value.key === undefined) {
          return err(
            new StructuredError(
              "PIR_INDEX_MAP_KEY",
              "Map type is missing its key type.",
            ),
          );
        }
        const valid = expectType(
          index.value,
          object.value.key,
          "PIR_INDEX_TYPE",
          "Map index type does not match the declared key type.",
        );
        return valid.ok ? ok(object.value.value) : err(valid.error);
      }
      if (
        object.value.kind === "tuple" &&
        expression.index.kind === "literal" &&
        typeof expression.index.value === "number" &&
        Number.isInteger(expression.index.value)
      ) {
        const element = object.value.elements[expression.index.value];
        return element === undefined
          ? err(
              new StructuredError(
                "PIR_TUPLE_INDEX",
                "Tuple index is outside the tuple bounds.",
              ),
            )
          : ok(element);
      }
      return err(
        new StructuredError(
          "PIR_INDEX_NON_INDEXABLE",
          "Index access requires a list, tuple, or map type.",
        ),
      );
    }
    case "call": {
      const callee = inferPirExpressionType(
        expression.callee,
        scope,
        options,
      );
      if (!callee.ok) return callee;
      if (callee.value.kind !== "function") {
        return err(
          new StructuredError(
            "PIR_CALL_NON_FUNCTION",
            "Call expressions require a function-typed callee.",
          ),
        );
      }
      if (callee.value.parameters.length !== expression.arguments.length) {
        return err(
          new StructuredError(
            "PIR_CALL_ARITY",
            "Call argument count does not match the function type.",
          ),
        );
      }
      for (let index = 0; index < expression.arguments.length; index += 1) {
        const actual = inferPirExpressionType(
          expression.arguments[index]!,
          scope,
          options,
        );
        if (!actual.ok) return actual;
        const valid = expectType(
          actual.value,
          callee.value.parameters[index]!,
          "PIR_CALL_ARGUMENT_TYPE",
          `Call argument ${index} does not match its parameter type.`,
        );
        if (!valid.ok) return err(valid.error);
      }
      return ok(callee.value.returns);
    }
    case "construct":
      for (const argument of expression.arguments) {
        const valid = inferPirExpressionType(argument, scope, options);
        if (!valid.ok) return valid;
      }
      return validatePirType(expression.targetType).ok
        ? ok(expression.targetType)
        : err(
            new StructuredError(
              "PIR_CONSTRUCT_TYPE",
              "Construct expression has an invalid target type.",
            ),
          );
    case "unary": {
      const operand = inferPirExpressionType(
        expression.operand,
        scope,
        options,
      );
      if (!operand.ok) return operand;
      if (expression.operator === "not") {
        const valid = expectType(
          operand.value,
          { kind: "boolean" },
          "PIR_UNARY_TYPE",
          "Logical not requires a boolean operand.",
        );
        return valid.ok ? ok({ kind: "boolean" }) : err(valid.error);
      }
      const valid = expectType(
        operand.value,
        { kind: "number" },
        "PIR_UNARY_TYPE",
        "Numeric unary operators require a number operand.",
      );
      return valid.ok ? ok({ kind: "number" }) : err(valid.error);
    }
    case "binary": {
      const left = inferPirExpressionType(expression.left, scope, options);
      if (!left.ok) return left;
      const right = inferPirExpressionType(expression.right, scope, options);
      if (!right.ok) return right;
      if (
        expression.operator === "add" &&
        left.value.kind === "string" &&
        right.value.kind === "string"
      ) {
        return ok({ kind: "string" });
      }
      const leftNumber = expectType(
        left.value,
        { kind: "number" },
        "PIR_BINARY_TYPE",
        "Arithmetic binary operators require number operands.",
      );
      if (!leftNumber.ok) return err(leftNumber.error);
      const rightNumber = expectType(
        right.value,
        { kind: "number" },
        "PIR_BINARY_TYPE",
        "Arithmetic binary operators require number operands.",
      );
      return rightNumber.ok
        ? ok({ kind: "number" })
        : err(rightNumber.error);
    }
    case "comparison": {
      const left = inferPirExpressionType(expression.left, scope, options);
      if (!left.ok) return left;
      const right = inferPirExpressionType(expression.right, scope, options);
      if (!right.ok) return right;
      const valid = expectType(
        left.value,
        right.value,
        "PIR_COMPARISON_TYPE",
        "Comparison operands must have compatible types.",
      );
      return valid.ok ? ok({ kind: "boolean" }) : err(valid.error);
    }
    case "logical":
      if (expression.values.length < 2) {
        return err(
          new StructuredError(
            "PIR_LOGICAL_ARITY",
            "Logical expressions require at least two operands.",
          ),
        );
      }
      for (const value of expression.values) {
        const inferred = inferPirExpressionType(value, scope, options);
        if (!inferred.ok) return inferred;
        const valid = expectType(
          inferred.value,
          { kind: "boolean" },
          "PIR_LOGICAL_TYPE",
          "Logical expressions require boolean operands.",
        );
        if (!valid.ok) return err(valid.error);
      }
      return ok({ kind: "boolean" });
    case "conditional": {
      const condition = inferPirExpressionType(
        expression.condition,
        scope,
        options,
      );
      if (!condition.ok) return condition;
      const conditionType = expectType(
        condition.value,
        { kind: "boolean" },
        "PIR_CONDITIONAL_CONDITION",
        "Conditional expressions require a boolean condition.",
      );
      if (!conditionType.ok) return err(conditionType.error);
      const whenTrue = inferPirExpressionType(
        expression.whenTrue,
        scope,
        options,
      );
      if (!whenTrue.ok) return whenTrue;
      const whenFalse = inferPirExpressionType(
        expression.whenFalse,
        scope,
        options,
      );
      if (!whenFalse.ok) return whenFalse;
      const same = expectType(
        whenTrue.value,
        whenFalse.value,
        "PIR_CONDITIONAL_BRANCH_TYPE",
        "Conditional branches must have compatible types.",
      );
      return same.ok ? ok(whenTrue.value) : err(same.error);
    }
    case "lambda": {
      const nested = new Map(scope);
      for (const parameter of expression.parameters) {
        if (nested.has(parameter.id)) {
          return err(
            new StructuredError(
              "PIR_DUPLICATE_ID",
              `Duplicate lambda parameter id: ${parameter.id}.`,
            ),
          );
        }
        nested.set(parameter.id, parameter.type);
      }
      const body = inferPirExpressionType(
        expression.body,
        nested,
        options,
      );
      if (!body.ok) return body;
      return ok({
        kind: "function",
        parameters: expression.parameters.map((parameter) => parameter.type),
        returns: body.value,
        ...(expression.effects === undefined
          ? {}
          : { effects: structuredClone(expression.effects) }),
      });
    }
    case "await": {
      if (!options.allowAwait) {
        return err(
          new StructuredError(
            "PIR_AWAIT_NON_ASYNC",
            "Await expressions are only valid inside async functions.",
          ),
        );
      }
      const value = inferPirExpressionType(expression.value, scope, options);
      if (!value.ok) return value;
      return value.value.kind === "promise"
        ? ok(value.value.value)
        : err(
            new StructuredError(
              "PIR_AWAIT_TYPE",
              "Await expressions require a promise type.",
            ),
          );
    }
    case "cast": {
      const value = inferPirExpressionType(expression.value, scope, options);
      if (!value.ok) return value;
      const target = validatePirType(expression.targetType);
      return target.ok ? ok(expression.targetType) : err(target.error);
    }
    case "collection": {
      const inferred: PirType[] = [];
      for (const element of expression.elements) {
        const value = inferPirExpressionType(element, scope, options);
        if (!value.ok) return value;
        inferred.push(value.value);
      }
      if (expression.collectionKind === "tuple") {
        return ok({ kind: "tuple", elements: inferred });
      }
      const elementType = expression.elementType ?? inferred[0];
      if (elementType === undefined) {
        return err(
          new StructuredError(
            "PIR_COLLECTION_EMPTY_TYPE",
            "Empty non-tuple collections require an explicit element type.",
          ),
        );
      }
      for (const item of inferred) {
        if (!samePirType(item, elementType)) {
          return err(
            new StructuredError(
              "PIR_COLLECTION_ELEMENT_TYPE",
              "Collection elements must have compatible types.",
            ),
          );
        }
      }
      return expression.collectionKind === "list"
        ? ok({ kind: "list", element: elementType })
        : ok({
            kind: "collection",
            collectionKind: "set",
            value: elementType,
          });
    }
    case "record": {
      const fields: Record<string, PirType> = {};
      for (const [name, value] of Object.entries(expression.fields)) {
        const inferred = inferPirExpressionType(value, scope, options);
        if (!inferred.ok) return inferred;
        fields[name] = inferred.value;
      }
      return ok({ kind: "record", fields });
    }
    case "match":
      if (expression.cases.length === 0) {
        return err(
          new StructuredError(
            "PIR_MATCH_EMPTY",
            "Match expressions require at least one case.",
          ),
        );
      }
      {
        const value = inferPirExpressionType(expression.value, scope, options);
        if (!value.ok) return value;
        for (const branch of expression.cases) {
          const inferred = inferPirExpressionType(
            branch.expression,
            scope,
            options,
          );
          if (!inferred.ok) return inferred;
          if (!samePirType(inferred.value, expression.resultType)) {
            return err(
              new StructuredError(
                "PIR_MATCH_RESULT_TYPE",
                "Match expression branch does not match resultType.",
              ),
            );
          }
        }
        return ok(expression.resultType);
      }
    case "filter": {
      const collection = inferPirExpressionType(
        expression.collection,
        scope,
        options,
      );
      if (!collection.ok) return collection;
      if (collection.value.kind !== "list") {
        return err(
          new StructuredError(
            "PIR_FILTER_NON_LIST",
            "Filter requires a list collection.",
          ),
        );
      }
      if (!samePirType(collection.value.element, expression.item.type)) {
        return err(
          new StructuredError(
            "PIR_FILTER_ITEM_TYPE",
            "Filter item type does not match collection element type.",
          ),
        );
      }
      const nested = new Map(scope);
      nested.set(expression.item.id, expression.item.type);
      const predicate = inferPirExpressionType(
        expression.predicate,
        nested,
        options,
      );
      if (!predicate.ok) return predicate;
      if (predicate.value.kind !== "boolean") {
        return err(
          new StructuredError(
            "PIR_FILTER_PREDICATE",
            "Filter predicate must be boolean.",
          ),
        );
      }
      return ok(collection.value);
    }
    case "map": {
      const collection = inferPirExpressionType(
        expression.collection,
        scope,
        options,
      );
      if (!collection.ok) return collection;
      if (collection.value.kind !== "list") {
        return err(
          new StructuredError(
            "PIR_MAP_NON_LIST",
            "Map requires a list collection.",
          ),
        );
      }
      if (!samePirType(collection.value.element, expression.item.type)) {
        return err(
          new StructuredError(
            "PIR_MAP_ITEM_TYPE",
            "Map item type does not match collection element type.",
          ),
        );
      }
      const nested = new Map(scope);
      nested.set(expression.item.id, expression.item.type);
      const mapper = inferPirExpressionType(
        expression.mapper,
        nested,
        options,
      );
      if (!mapper.ok) return mapper;
      if (!samePirType(mapper.value, expression.resultElementType)) {
        return err(
          new StructuredError(
            "PIR_MAP_RESULT_TYPE",
            "Map expression result does not match resultElementType.",
          ),
        );
      }
      return ok({
        kind: "list",
        element: expression.resultElementType,
      });
    }
  }
};

interface StatementContext {
  returnType: PirType;
  allowAwait: boolean;
  loopDepth: number;
  holes?: ReadonlySet<string>;
}

const containsReturn = (statements: readonly PirStatement[]): boolean =>
  statements.some((statement) => {
    switch (statement.kind) {
      case "return":
        return true;
      case "if":
        return (
          containsReturn(statement.then) ||
          containsReturn(statement.else ?? [])
        );
      case "loop":
      case "for-each":
      case "defer":
        return containsReturn(statement.body);
      case "block":
        return containsReturn(statement.statements);
      case "match":
        return (
          statement.cases.some((entry) => containsReturn(entry.body)) ||
          containsReturn(statement.default ?? [])
        );
      case "try":
        return (
          containsReturn(statement.body) ||
          containsReturn(statement.catch?.body ?? []) ||
          containsReturn(statement.finally ?? [])
        );
      default:
        return false;
    }
  });

const containsStatementHole = (
  statements: readonly PirStatement[],
): boolean =>
  statements.some((statement) => {
    if (statement.kind === "hole") return true;
    switch (statement.kind) {
      case "if":
        return (
          containsStatementHole(statement.then) ||
          containsStatementHole(statement.else ?? [])
        );
      case "loop":
      case "for-each":
      case "defer":
        return containsStatementHole(statement.body);
      case "match":
        return (
          statement.cases.some((entry) => containsStatementHole(entry.body)) ||
          containsStatementHole(statement.default ?? [])
        );
      case "try":
        return (
          containsStatementHole(statement.body) ||
          containsStatementHole(statement.catch?.body ?? []) ||
          containsStatementHole(statement.finally ?? [])
        );
      case "block":
        return containsStatementHole(statement.statements);
      default:
        return false;
    }
  });

const validateStatementSequence = (
  statements: readonly PirStatement[],
  scope: Scope,
  context: StatementContext,
): Result<void> => {
  for (const statement of statements) {
    switch (statement.kind) {
      case "declare": {
        const id = idRequired(
          statement.symbol.id,
          "PIR_SYMBOL_ID",
          "Declared symbol",
        );
        if (!id.ok) return id;
        if (scope.has(statement.symbol.id)) {
          return err(
            new StructuredError(
              "PIR_DUPLICATE_ID",
              `Duplicate symbol in scope: ${statement.symbol.id}.`,
            ),
          );
        }
        const type = validatePirType(statement.type);
        if (!type.ok) return type;
        if (
          statement.symbol.type !== undefined &&
          !samePirType(statement.symbol.type, statement.type)
        ) {
          return err(
            new StructuredError(
              "PIR_SYMBOL_TYPE",
              "Declared symbol type conflicts with declaration type.",
            ),
          );
        }
        if (statement.initializer !== undefined) {
          const value = inferPirExpressionType(
            statement.initializer,
            scope,
            { allowAwait: context.allowAwait },
          );
          if (!value.ok) return value;
          if (!samePirType(value.value, statement.type)) {
            return err(
              new StructuredError(
                "PIR_DECLARE_INITIALIZER_TYPE",
                "Declaration initializer does not match the declared type.",
              ),
            );
          }
        }
        scope.set(statement.symbol.id, statement.type);
        break;
      }
      case "assign": {
        const target = inferPirExpressionType(
          statement.target,
          scope,
          { allowAwait: context.allowAwait },
        );
        if (!target.ok) return target;
        const value = inferPirExpressionType(
          statement.value,
          scope,
          { allowAwait: context.allowAwait },
        );
        if (!value.ok) return value;
        if (!samePirType(target.value, value.value)) {
          return err(
            new StructuredError(
              "PIR_ASSIGN_TYPE",
              "Assignment value does not match target type.",
            ),
          );
        }
        break;
      }
      case "expression": {
        const value = inferPirExpressionType(
          statement.expression,
          scope,
          { allowAwait: context.allowAwait },
        );
        if (!value.ok) return value;
        break;
      }
      case "return": {
        if (statement.value === undefined) {
          if (context.returnType.kind !== "void") {
            return err(
              new StructuredError(
                "PIR_RETURN_MISSING",
                "Non-void function return requires a value.",
              ),
            );
          }
          break;
        }
        const value = inferPirExpressionType(
          statement.value,
          scope,
          { allowAwait: context.allowAwait },
        );
        if (!value.ok) return value;
        if (!samePirType(value.value, context.returnType)) {
          return err(
            new StructuredError(
              "PIR_RETURN_TYPE",
              "Return statement does not match the function return type.",
            ),
          );
        }
        break;
      }
      case "if": {
        const condition = inferPirExpressionType(
          statement.condition,
          scope,
          { allowAwait: context.allowAwait },
        );
        if (!condition.ok) return condition;
        if (condition.value.kind !== "boolean") {
          return err(
            new StructuredError(
              "PIR_IF_CONDITION",
              "If statement condition must be boolean.",
            ),
          );
        }
        const thenResult = validateStatementSequence(
          statement.then,
          new Map(scope),
          context,
        );
        if (!thenResult.ok) return thenResult;
        const elseResult = validateStatementSequence(
          statement.else ?? [],
          new Map(scope),
          context,
        );
        if (!elseResult.ok) return elseResult;
        break;
      }
      case "loop": {
        if (statement.condition !== undefined) {
          const condition = inferPirExpressionType(
            statement.condition,
            scope,
            { allowAwait: context.allowAwait },
          );
          if (!condition.ok) return condition;
          if (condition.value.kind !== "boolean") {
            return err(
              new StructuredError(
                "PIR_LOOP_CONDITION",
                "Loop condition must be boolean.",
              ),
            );
          }
        }
        const body = validateStatementSequence(
          statement.body,
          new Map(scope),
          { ...context, loopDepth: context.loopDepth + 1 },
        );
        if (!body.ok) return body;
        break;
      }
      case "for-each": {
        const collection = inferPirExpressionType(
          statement.collection,
          scope,
          { allowAwait: context.allowAwait },
        );
        if (!collection.ok) return collection;
        const element =
          collection.value.kind === "list"
            ? collection.value.element
            : collection.value.kind === "collection" &&
                (collection.value.collectionKind === "set" ||
                  collection.value.collectionKind === "iterable")
              ? collection.value.value
              : undefined;
        if (element === undefined) {
          return err(
            new StructuredError(
              "PIR_FOREACH_COLLECTION",
              "For-each requires a list, set, or iterable collection.",
            ),
          );
        }
        if (!samePirType(element, statement.item.type)) {
          return err(
            new StructuredError(
              "PIR_FOREACH_ITEM_TYPE",
              "For-each item type does not match collection element type.",
            ),
          );
        }
        const nested = new Map(scope);
        nested.set(statement.item.id, statement.item.type);
        const body = validateStatementSequence(
          statement.body,
          nested,
          { ...context, loopDepth: context.loopDepth + 1 },
        );
        if (!body.ok) return body;
        break;
      }
      case "match": {
        const value = inferPirExpressionType(
          statement.value,
          scope,
          { allowAwait: context.allowAwait },
        );
        if (!value.ok) return value;
        if (statement.cases.length === 0 && statement.default === undefined) {
          return err(
            new StructuredError(
              "PIR_MATCH_EMPTY",
              "Match statement requires at least one case or default.",
            ),
          );
        }
        for (const branch of statement.cases) {
          const valid = validateStatementSequence(
            branch.body,
            new Map(scope),
            context,
          );
          if (!valid.ok) return valid;
        }
        const fallback = validateStatementSequence(
          statement.default ?? [],
          new Map(scope),
          context,
        );
        if (!fallback.ok) return fallback;
        break;
      }
      case "try": {
        const body = validateStatementSequence(
          statement.body,
          new Map(scope),
          context,
        );
        if (!body.ok) return body;
        if (statement.catch !== undefined) {
          const catchScope = new Map(scope);
          if (statement.catch.parameter !== undefined) {
            catchScope.set(
              statement.catch.parameter.id,
              statement.catch.parameter.type,
            );
          }
          const catchBody = validateStatementSequence(
            statement.catch.body,
            catchScope,
            context,
          );
          if (!catchBody.ok) return catchBody;
        }
        const finallyBody = validateStatementSequence(
          statement.finally ?? [],
          new Map(scope),
          context,
        );
        if (!finallyBody.ok) return finallyBody;
        break;
      }
      case "throw": {
        const value = inferPirExpressionType(
          statement.value,
          scope,
          { allowAwait: context.allowAwait },
        );
        if (!value.ok) return value;
        break;
      }
      case "assert": {
        const condition = inferPirExpressionType(
          statement.condition,
          scope,
          { allowAwait: context.allowAwait },
        );
        if (!condition.ok) return condition;
        if (condition.value.kind !== "boolean") {
          return err(
            new StructuredError(
              "PIR_ASSERT_CONDITION",
              "Assert condition must be boolean.",
            ),
          );
        }
        break;
      }
      case "break":
      case "continue":
        if (context.loopDepth < 1) {
          return err(
            new StructuredError(
              "PIR_LOOP_CONTROL_CONTEXT",
              `${statement.kind} is only valid inside a loop.`,
            ),
          );
        }
        break;
      case "defer": {
        const body = validateStatementSequence(
          statement.body,
          new Map(scope),
          context,
        );
        if (!body.ok) return body;
        break;
      }
      case "block": {
        const block = validateStatementSequence(
          statement.statements,
          new Map(scope),
          context,
        );
        if (!block.ok) return block;
        break;
      }
      case "hole":
        if (
          context.holes !== undefined &&
          !context.holes.has(statement.holeId)
        ) {
          return err(
            new StructuredError(
              "PIR_HOLE_NOT_FOUND",
              `Statement references undeclared hole ${statement.holeId}.`,
            ),
          );
        }
        break;
    }
  }
  return ok(undefined);
};

const validateEffects = (
  effects: readonly EffectSpec[] | undefined,
): Result<void> => {
  const values = effects ?? [];
  const keys = new Set<string>();
  for (const effect of values) {
    const key = JSON.stringify(effect);
    if (keys.has(key)) {
      return err(
        new StructuredError(
          "PIR_EFFECT_DUPLICATE",
          "Function effects must not contain duplicate entries.",
        ),
      );
    }
    keys.add(key);
  }
  if (
    values.some((effect) => effect.kind === "pure") &&
    values.some((effect) => effect.kind !== "pure")
  ) {
    return err(
      new StructuredError(
        "PIR_EFFECT_PURE_CONFLICT",
        "A pure function cannot also declare effectful operations.",
      ),
    );
  }
  return ok(undefined);
};

const validateHole = (hole: ProgramHole): Result<void> => {
  if (hole.id.trim() === "") {
    return err(
      new StructuredError("PIR_HOLE_ID", "Program holes require an id."),
    );
  }
  if (hole.expectedType !== undefined) {
    const type = validatePirType(hole.expectedType);
    if (!type.ok) return type;
  }
  for (const value of [
    hole.budget.maxExpansions,
    hole.budget.maxDepth,
    hole.budget.maxCost,
  ]) {
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < 0)
    ) {
      return err(
        new StructuredError(
          "PIR_HOLE_BUDGET",
          "Hole budgets must contain non-negative finite limits.",
        ),
      );
    }
  }
  return hole.sourceBinding === undefined
    ? ok(undefined)
    : validateSourceBinding(hole.sourceBinding);
};

const validateFunction = (
  fn: PirFunction,
  globalScope: ReadonlyMap<ProgramId, PirType>,
  holes: ReadonlySet<string> | undefined,
): Result<void> => {
  if (fn.id.trim() === "" || fn.name.trim() === "") {
    return err(
      new StructuredError(
        "PIR_FUNCTION_ID",
        "PIR functions require non-empty ids and names.",
      ),
    );
  }
  const returnType = validatePirType(fn.returnType);
  if (!returnType.ok) return returnType;
  const effects = validateEffects(fn.effects);
  if (!effects.ok) return effects;
  if (
    fn.async === true &&
    !(fn.effects ?? []).some((effect) => effect.kind === "async")
  ) {
    return err(
      new StructuredError(
        "PIR_ASYNC_EFFECT",
        "Async functions must declare the async effect.",
      ),
    );
  }

  const scope = new Map(globalScope);
  for (const typeParameter of fn.typeParameters ?? []) {
    const valid = validatePirType(typeParameter);
    if (!valid.ok) return valid;
  }
  for (const parameter of fn.parameters) {
    if (parameter.id.trim() === "" || parameter.name.trim() === "") {
      return err(
        new StructuredError(
          "PIR_PARAMETER_ID",
          "Function parameters require non-empty ids and names.",
        ),
      );
    }
    if (scope.has(parameter.id)) {
      return err(
        new StructuredError(
          "PIR_DUPLICATE_ID",
          `Duplicate parameter id in function ${fn.id}: ${parameter.id}.`,
        ),
      );
    }
    const type = validatePirType(parameter.type);
    if (!type.ok) return type;
    if (parameter.sourceBinding !== undefined) {
      const binding = validateSourceBinding(parameter.sourceBinding);
      if (!binding.ok) return binding;
    }
    scope.set(parameter.id, parameter.type);
  }

  if (fn.body !== undefined && fn.statements !== undefined) {
    return err(
      new StructuredError(
        "PIR_FUNCTION_BODY_CONFLICT",
        "A function must use either an expression body or statement body, not both.",
      ),
    );
  }
  if (fn.body === undefined && fn.statements === undefined) {
    return err(
      new StructuredError(
        "PIR_FUNCTION_BODY_MISSING",
        "A concrete PIR function requires a body.",
      ),
    );
  }

  if (fn.body !== undefined) {
    const body = inferPirExpressionType(fn.body, scope, {
      allowAwait: fn.async === true,
    });
    if (!body.ok) return body;
    if (!samePirType(body.value, fn.returnType)) {
      return err(
        new StructuredError(
          "PIR_RETURN_TYPE",
          `Function ${fn.name} body does not match its return type.`,
        ),
      );
    }
  }

  if (fn.statements !== undefined) {
    const body = validateStatementSequence(
      fn.statements,
      scope,
      {
        returnType: fn.returnType,
        allowAwait: fn.async === true,
        loopDepth: 0,
        ...(holes === undefined ? {} : { holes }),
      },
    );
    if (!body.ok) return body;
    if (
      fn.returnType.kind !== "void" &&
      fn.returnType.kind !== "never" &&
      !containsReturn(fn.statements) &&
      !containsStatementHole(fn.statements)
    ) {
      return err(
        new StructuredError(
          "PIR_RETURN_MISSING",
          `Function ${fn.name} has no return statement.`,
        ),
      );
    }
  }

  if (fn.contract !== undefined) {
    const contractEffects = validateEffects(fn.contract.effects);
    if (!contractEffects.ok) return contractEffects;
    for (const required of fn.contract.effects ?? []) {
      if (
        !(fn.effects ?? []).some(
          (actual) => JSON.stringify(actual) === JSON.stringify(required),
        )
      ) {
        return err(
          new StructuredError(
            "PIR_CONTRACT_EFFECT",
            "Function contract declares an effect absent from the function effect set.",
          ),
        );
      }
    }
    if (fn.contract.provenance.length === 0) {
      return err(
        new StructuredError(
          "PIR_CONTRACT_PROVENANCE",
          "Function contracts require explicit provenance.",
        ),
      );
    }
  }

  return fn.sourceBinding === undefined
    ? ok(undefined)
    : validateSourceBinding(fn.sourceBinding);
};

export const validatePirProgram = (program: PirProgram): Result<void> => {
  if (program.version.trim() === "") {
    return err(
      new StructuredError(
        "PIR_VERSION",
        "PIR program version must be non-empty.",
      ),
    );
  }

  const globalIds = new Set<string>();
  const claim = (id: string, what: string): Result<void> => {
    if (id.trim() === "") {
      return err(
        new StructuredError(
          "PIR_ID_REQUIRED",
          `${what} id must be non-empty.`,
        ),
      );
    }
    if (globalIds.has(id)) {
      return err(
        new StructuredError(
          "PIR_DUPLICATE_ID",
          `Duplicate PIR id: ${id}.`,
        ),
      );
    }
    globalIds.add(id);
    return ok(undefined);
  };

  const globalScope: Scope = new Map();
  for (const fn of program.functions) {
    const owned = claim(fn.id, "Function");
    if (!owned.ok) return owned;
    globalScope.set(fn.id, {
      kind: "function",
      parameters: fn.parameters.map((parameter) => parameter.type),
      returns: fn.returnType,
      ...(fn.effects === undefined
        ? {}
        : { effects: structuredClone(fn.effects) }),
    });
  }

  for (const symbol of program.symbols ?? []) {
    const owned = claim(symbol.id, "Symbol");
    if (!owned.ok) return owned;
    if (symbol.type !== undefined) {
      const type = validatePirType(symbol.type);
      if (!type.ok) return type;
      globalScope.set(symbol.id, symbol.type);
    }
    if (symbol.sourceBinding !== undefined) {
      const binding = validateSourceBinding(symbol.sourceBinding);
      if (!binding.ok) return binding;
    }
  }

  for (const module of program.modules ?? []) {
    const owned = claim(module.id, "Module");
    if (!owned.ok) return owned;
    if (module.sourceBinding !== undefined) {
      const binding = validateSourceBinding(module.sourceBinding);
      if (!binding.ok) return binding;
    }
  }

  const holeIds = new Set<string>();
  for (const hole of program.holes ?? []) {
    if (holeIds.has(hole.id)) {
      return err(
        new StructuredError(
          "PIR_DUPLICATE_ID",
          `Duplicate PIR hole id: ${hole.id}.`,
        ),
      );
    }
    holeIds.add(hole.id);
    const valid = validateHole(hole);
    if (!valid.ok) return valid;
  }

  for (const fn of program.functions) {
    const valid = validateFunction(
      fn,
      globalScope,
      program.holes === undefined ? undefined : holeIds,
    );
    if (!valid.ok) return valid;
  }

  const knownRefs = new Set(globalIds);
  for (const fn of program.functions) {
    for (const parameter of fn.parameters) knownRefs.add(parameter.id);
  }
  for (const hole of program.holes ?? []) {
    for (const scopeSymbol of hole.scopeSymbols) {
      if (!knownRefs.has(scopeSymbol)) {
        return err(
          new StructuredError(
            "PIR_HOLE_SCOPE_SYMBOL",
            `Hole ${hole.id} references unknown scope symbol ${scopeSymbol}.`,
          ),
        );
      }
    }
  }

  for (const module of program.modules ?? []) {
    for (const ref of [...module.exports, ...module.declarations]) {
      if (!knownRefs.has(ref)) {
        return err(
          new StructuredError(
            "PIR_MODULE_REFERENCE",
            `Module ${module.id} references unknown declaration ${ref}.`,
          ),
        );
      }
    }
    for (const imported of module.imports) {
      if (imported.module.trim() === "") {
        return err(
          new StructuredError(
            "PIR_IMPORT_MODULE",
            "Import intents require a non-empty module specifier.",
          ),
        );
      }
    }
  }

  for (const binding of program.sourceBindings ?? []) {
    const valid = validateSourceBinding(binding);
    if (!valid.ok) return valid;
  }

  return ok(undefined);
};
