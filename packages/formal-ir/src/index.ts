import {
  err,
  ok,
  StructuredError,
  canonicalJson,
  type JsonValue,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type {
  SemanticRef,
  SemanticValue,
} from "../../semantic-graph/src/index.ts";

export type DataIr =
  | { kind: "null"; semanticRef?: SemanticRef }
  | { kind: "boolean"; value: boolean; semanticRef?: SemanticRef }
  | { kind: "number"; value: number; semanticRef?: SemanticRef; unit?: SemanticId }
  | { kind: "string"; value: SemanticValue; semanticRef?: SemanticRef }
  | { kind: "binary-ref"; ref: SemanticRef; mediaType?: string }
  | { kind: "array"; items: DataIr[]; semanticRef?: SemanticRef }
  | {
      kind: "object";
      fields: Array<{ key: string; value: DataIr; required?: boolean }>;
      semanticRef?: SemanticRef;
    }
  | {
      kind: "tagged-union";
      tag: string;
      value: DataIr;
      semanticRef?: SemanticRef;
    };

export type PrimitiveSchemaType =
  | "null"
  | "boolean"
  | "integer"
  | "number"
  | "string"
  | "binary"
  | "any";

export type SchemaConstraint =
  | { kind: "min"; value: number }
  | { kind: "max"; value: number }
  | { kind: "min-length"; value: number }
  | { kind: "max-length"; value: number }
  | { kind: "pattern"; value: string }
  | { kind: "multiple-of"; value: number }
  | { kind: "semantic"; predicate: SemanticRef };

export type SchemaIr =
  | {
      kind: "primitive";
      type: PrimitiveSchemaType;
      description?: string;
      constraints?: SchemaConstraint[];
    }
  | { kind: "nullable"; inner: SchemaIr }
  | { kind: "optional"; inner: SchemaIr }
  | { kind: "array"; items: SchemaIr; minItems?: number; maxItems?: number }
  | { kind: "tuple"; items: SchemaIr[]; rest?: SchemaIr }
  | {
      kind: "object";
      fields: Array<{
        name: string;
        schema: SchemaIr;
        required: boolean;
        description?: string;
      }>;
      additionalProperties?: boolean | SchemaIr;
    }
  | { kind: "record"; key: SchemaIr; value: SchemaIr }
  | { kind: "enum"; values: Array<string | number | boolean | null> }
  | { kind: "union"; alternatives: SchemaIr[] }
  | { kind: "intersection"; members: SchemaIr[] }
  | { kind: "reference"; ref: string };

export type QueryMode = "read" | "mutation";

export type QueryExpr =
  | { kind: "field"; path: string[]; sourceAlias?: string }
  | { kind: "parameter"; name: string }
  | { kind: "literal"; value: DataIr }
  | {
      kind: "operator";
      operator:
        | "eq"
        | "neq"
        | "lt"
        | "lte"
        | "gt"
        | "gte"
        | "and"
        | "or"
        | "not"
        | "in"
        | "contains"
        | "starts-with"
        | "ends-with"
        | "is-null";
      args: QueryExpr[];
    }
  | { kind: "function"; name: string; args: QueryExpr[] };

export interface QuerySource {
  id: string;
  kind: "named" | "semantic" | "subquery";
  name?: string;
  semanticRef?: SemanticRef;
  subquery?: QueryIr;
  alias?: string;
}

export interface QueryJoin {
  kind: "inner" | "left" | "right" | "full";
  source: QuerySource;
  on: QueryExpr;
}

export interface QueryProjection {
  expression: QueryExpr;
  alias?: string;
}

export interface QueryOrdering {
  expression: QueryExpr;
  direction: "asc" | "desc";
  nulls?: "first" | "last";
}

export interface QueryMutation {
  kind: "insert" | "update" | "delete";
  target: QuerySource;
  values?: Array<{ field: string; value: QueryExpr }>;
  filter?: QueryExpr;
}

export interface QueryIr {
  id: string;
  mode: QueryMode;
  source?: QuerySource;
  projection?: QueryProjection[];
  filter?: QueryExpr;
  joins?: QueryJoin[];
  groupBy?: QueryExpr[];
  aggregations?: QueryProjection[];
  orderBy?: QueryOrdering[];
  limit?: number;
  offset?: number;
  parameters?: Array<{ name: string; schema?: SchemaIr }>;
  mutation?: QueryMutation;
  annotations?: Record<string, JsonValue>;
}

export type LogicTerm =
  | {
      kind: "variable";
      name: string;
      semanticRef?: SemanticRef;
    }
  | {
      kind: "constant";
      value: SemanticValue;
    }
  | {
      kind: "function";
      function: SemanticId;
      args: LogicTerm[];
    };

export type LogicIr =
  | { kind: "proposition-ref"; ref: SemanticRef }
  | { kind: "boolean"; value: boolean }
  | { kind: "not"; value: LogicIr }
  | { kind: "and"; values: LogicIr[] }
  | { kind: "or"; values: LogicIr[] }
  | { kind: "implies"; antecedent: LogicIr; consequent: LogicIr }
  | { kind: "iff"; left: LogicIr; right: LogicIr }
  | {
      kind: "predicate";
      predicate: SemanticId;
      args: Array<{
        role?: SemanticId;
        value: SemanticValue | LogicTerm;
      }>;
    }
  | {
      kind: "comparison";
      operator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
      left: LogicTerm;
      right: LogicTerm;
    }
  | {
      kind: "quantifier";
      quantifier: "forall" | "exists";
      variable: string;
      domain?: SchemaIr;
      body: LogicIr;
    }
  | {
      kind: "modal";
      operator: "necessary" | "possible" | "permitted" | "required" | "forbidden";
      body: LogicIr;
    };

export type MathIr =
  | { kind: "constant"; value: number; unit?: SemanticId }
  | { kind: "symbol"; name: string; semanticRef?: SemanticRef }
  | { kind: "sum"; terms: MathIr[] }
  | { kind: "product"; factors: MathIr[] }
  | { kind: "power"; base: MathIr; exponent: MathIr }
  | { kind: "fraction"; numerator: MathIr; denominator: MathIr }
  | { kind: "function"; name: string; args: MathIr[] }
  | {
      kind: "relation";
      relation: "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
      left: MathIr;
      right: MathIr;
    }
  | { kind: "set"; values: MathIr[] }
  | { kind: "interval"; lower?: MathIr; upper?: MathIr; lowerClosed: boolean; upperClosed: boolean }
  | { kind: "vector"; values: MathIr[] }
  | { kind: "matrix"; rows: MathIr[][] }
  | { kind: "limit"; variable: string; toward: MathIr; expression: MathIr }
  | { kind: "derivative"; variable: string; expression: MathIr; order?: number }
  | { kind: "integral"; variable: string; expression: MathIr; lower?: MathIr; upper?: MathIr }
  | { kind: "quantified"; quantifier: "forall" | "exists"; variable: string; body: LogicIr };

const nonNegativeInteger = (value: number | undefined): boolean =>
  value === undefined || (Number.isInteger(value) && value >= 0);

export const validateSchemaIr = (schema: SchemaIr): Result<SchemaIr> => {
  const visit = (node: SchemaIr, path: string): StructuredError | undefined => {
    switch (node.kind) {
      case "primitive":
        for (const constraint of node.constraints ?? []) {
          if (
            (constraint.kind === "min-length" ||
              constraint.kind === "max-length") &&
            (!Number.isInteger(constraint.value) || constraint.value < 0)
          ) {
            return new StructuredError(
              "FORMAL_SCHEMA_CONSTRAINT",
              `Invalid non-negative integer constraint at ${path}.`,
            );
          }
          if (
            constraint.kind === "multiple-of" &&
            (!Number.isFinite(constraint.value) || constraint.value === 0)
          ) {
            return new StructuredError(
              "FORMAL_SCHEMA_CONSTRAINT",
              `multiple-of must be finite and non-zero at ${path}.`,
            );
          }
        }
        return undefined;
      case "nullable":
      case "optional":
        return visit(node.inner, `${path}.inner`);
      case "array":
        if (
          !nonNegativeInteger(node.minItems) ||
          !nonNegativeInteger(node.maxItems) ||
          (node.minItems !== undefined &&
            node.maxItems !== undefined &&
            node.minItems > node.maxItems)
        ) {
          return new StructuredError(
            "FORMAL_SCHEMA_ARRAY_BOUNDS",
            `Invalid array bounds at ${path}.`,
          );
        }
        return visit(node.items, `${path}.items`);
      case "tuple":
        if (node.items.length === 0 && node.rest === undefined) {
          return new StructuredError(
            "FORMAL_SCHEMA_EMPTY_TUPLE",
            `Tuple must define items or rest at ${path}.`,
          );
        }
        for (let i = 0; i < node.items.length; i += 1) {
          const error = visit(node.items[i]!, `${path}.items[${i}]`);
          if (error) return error;
        }
        return node.rest === undefined
          ? undefined
          : visit(node.rest, `${path}.rest`);
      case "object": {
        const names = new Set<string>();
        for (const field of node.fields) {
          if (field.name.trim() === "" || names.has(field.name)) {
            return new StructuredError(
              "FORMAL_SCHEMA_FIELD",
              `Object schema contains an empty or duplicate field at ${path}.`,
            );
          }
          names.add(field.name);
          const error = visit(field.schema, `${path}.${field.name}`);
          if (error) return error;
        }
        if (
          typeof node.additionalProperties === "object" &&
          node.additionalProperties !== null
        ) {
          return visit(node.additionalProperties, `${path}.*`);
        }
        return undefined;
      }
      case "record": {
        const keyError = visit(node.key, `${path}.key`);
        return keyError ?? visit(node.value, `${path}.value`);
      }
      case "enum":
        if (node.values.length === 0) {
          return new StructuredError(
            "FORMAL_SCHEMA_EMPTY_ENUM",
            `Enum cannot be empty at ${path}.`,
          );
        }
        return undefined;
      case "union":
      case "intersection": {
        const members =
          node.kind === "union" ? node.alternatives : node.members;
        if (members.length < 2) {
          return new StructuredError(
            "FORMAL_SCHEMA_COMPOSITION",
            `${node.kind} requires at least two members at ${path}.`,
          );
        }
        for (let i = 0; i < members.length; i += 1) {
          const error = visit(members[i]!, `${path}[${i}]`);
          if (error) return error;
        }
        return undefined;
      }
      case "reference":
        return node.ref.trim() === ""
          ? new StructuredError(
              "FORMAL_SCHEMA_REFERENCE",
              `Schema reference is empty at ${path}.`,
            )
          : undefined;
    }
  };

  const error = visit(schema, "$");
  return error === undefined ? ok(structuredClone(schema)) : err(error);
};

export const validateDataIr = (value: DataIr): Result<DataIr> => {
  const visit = (node: DataIr, path: string): StructuredError | undefined => {
    switch (node.kind) {
      case "number":
        return Number.isFinite(node.value)
          ? undefined
          : new StructuredError(
              "FORMAL_DATA_NUMBER",
              `Data IR number must be finite at ${path}.`,
            );
      case "array":
        for (let i = 0; i < node.items.length; i += 1) {
          const error = visit(node.items[i]!, `${path}[${i}]`);
          if (error) return error;
        }
        return undefined;
      case "object": {
        const keys = new Set<string>();
        for (const field of node.fields) {
          if (field.key.trim() === "" || keys.has(field.key)) {
            return new StructuredError(
              "FORMAL_DATA_OBJECT_KEY",
              `Object contains an empty or duplicate key at ${path}.`,
            );
          }
          keys.add(field.key);
          const error = visit(field.value, `${path}.${field.key}`);
          if (error) return error;
        }
        return undefined;
      }
      case "tagged-union":
        return node.tag.trim() === ""
          ? new StructuredError(
              "FORMAL_DATA_TAG",
              `Tagged union tag cannot be empty at ${path}.`,
            )
          : visit(node.value, `${path}.value`);
      case "null":
      case "boolean":
      case "string":
      case "binary-ref":
        return undefined;
    }
  };

  const error = visit(value, "$");
  return error === undefined ? ok(structuredClone(value)) : err(error);
};

const validateQueryExpr = (
  expr: QueryExpr,
  path: string,
): StructuredError | undefined => {
  switch (expr.kind) {
    case "field":
      return expr.path.length === 0 || expr.path.some((part) => part.trim() === "")
        ? new StructuredError(
            "FORMAL_QUERY_FIELD",
            `Query field path is empty at ${path}.`,
          )
        : undefined;
    case "parameter":
      return expr.name.trim() === ""
        ? new StructuredError(
            "FORMAL_QUERY_PARAMETER",
            `Query parameter name is empty at ${path}.`,
          )
        : undefined;
    case "literal": {
      const valid = validateDataIr(expr.value);
      return valid.ok ? undefined : valid.error;
    }
    case "operator":
      if (expr.args.length === 0) {
        return new StructuredError(
          "FORMAL_QUERY_OPERATOR_ARITY",
          `Query operator ${expr.operator} has no arguments at ${path}.`,
        );
      }
      for (let i = 0; i < expr.args.length; i += 1) {
        const error = validateQueryExpr(expr.args[i]!, `${path}.args[${i}]`);
        if (error) return error;
      }
      return undefined;
    case "function":
      if (expr.name.trim() === "") {
        return new StructuredError(
          "FORMAL_QUERY_FUNCTION",
          `Query function name is empty at ${path}.`,
        );
      }
      for (let i = 0; i < expr.args.length; i += 1) {
        const error = validateQueryExpr(expr.args[i]!, `${path}.args[${i}]`);
        if (error) return error;
      }
      return undefined;
  }
};

const validateQuerySource = (
  source: QuerySource,
  path: string,
): StructuredError | undefined => {
  if (source.id.trim() === "") {
    return new StructuredError(
      "FORMAL_QUERY_SOURCE_ID",
      `Query source id is empty at ${path}.`,
    );
  }
  if (source.alias !== undefined && source.alias.trim() === "") {
    return new StructuredError(
      "FORMAL_QUERY_SOURCE_ALIAS",
      `Query source alias is empty at ${path}.`,
    );
  }

  switch (source.kind) {
    case "named":
      return source.name === undefined || source.name.trim() === ""
        ? new StructuredError(
            "FORMAL_QUERY_SOURCE_NAMED",
            `Named query source is missing its name at ${path}.`,
          )
        : undefined;
    case "semantic":
      return source.semanticRef === undefined
        ? new StructuredError(
            "FORMAL_QUERY_SOURCE_SEMANTIC",
            `Semantic query source is missing its semantic reference at ${path}.`,
          )
        : undefined;
    case "subquery":
      if (source.subquery === undefined) {
        return new StructuredError(
          "FORMAL_QUERY_SOURCE_SUBQUERY",
          `Subquery source is missing its query at ${path}.`,
        );
      }
      {
        const nested = validateQueryIr(source.subquery);
        return nested.ok ? undefined : nested.error;
      }
  }
};

export const validateQueryIr = (query: QueryIr): Result<QueryIr> => {
  if (query.id.trim() === "") {
    return err(new StructuredError("FORMAL_QUERY_ID", "Query id is required."));
  }
  if (query.source !== undefined) {
    const sourceError = validateQuerySource(query.source, "$.source");
    if (sourceError) return err(sourceError);
  }
  for (let index = 0; index < (query.joins ?? []).length; index += 1) {
    const join = query.joins![index]!;
    const sourceError = validateQuerySource(
      join.source,
      `$.joins[${index}].source`,
    );
    if (sourceError) return err(sourceError);
  }
  if (query.mutation !== undefined) {
    const targetError = validateQuerySource(
      query.mutation.target,
      "$.mutation.target",
    );
    if (targetError) return err(targetError);

    const values = query.mutation.values ?? [];
    if (
      (query.mutation.kind === "insert" ||
        query.mutation.kind === "update") &&
      values.length === 0
    ) {
      return err(
        new StructuredError(
          "FORMAL_QUERY_MUTATION_VALUES",
          `${query.mutation.kind} mutation requires at least one field value.`,
        ),
      );
    }
    if (
      query.mutation.kind === "delete" &&
      query.mutation.values !== undefined
    ) {
      return err(
        new StructuredError(
          "FORMAL_QUERY_DELETE_VALUES",
          "Delete mutation cannot carry assignment values.",
        ),
      );
    }
    const fieldNames = new Set<string>();
    for (const value of values) {
      if (
        value.field.trim() === "" ||
        fieldNames.has(value.field)
      ) {
        return err(
          new StructuredError(
            "FORMAL_QUERY_MUTATION_FIELD",
            "Mutation fields must be unique and non-empty.",
          ),
        );
      }
      fieldNames.add(value.field);
    }
  }
  if (query.mode === "read" && query.mutation !== undefined) {
    return err(
      new StructuredError(
        "FORMAL_QUERY_READ_MUTATION",
        "A read query cannot contain mutation semantics.",
      ),
    );
  }
  if (query.mode === "mutation" && query.mutation === undefined) {
    return err(
      new StructuredError(
        "FORMAL_QUERY_MUTATION_MISSING",
        "Mutation mode requires an explicit mutation object.",
      ),
    );
  }
  if (!nonNegativeInteger(query.limit) || !nonNegativeInteger(query.offset)) {
    return err(
      new StructuredError(
        "FORMAL_QUERY_BOUNDS",
        "Query limit and offset must be non-negative integers.",
      ),
    );
  }

  const expressions: QueryExpr[] = [];
  if (query.filter) expressions.push(query.filter);
  for (const item of query.projection ?? []) expressions.push(item.expression);
  for (const item of query.aggregations ?? []) expressions.push(item.expression);
  for (const item of query.groupBy ?? []) expressions.push(item);
  for (const item of query.orderBy ?? []) expressions.push(item.expression);
  for (const join of query.joins ?? []) expressions.push(join.on);
  if (query.mutation?.filter) expressions.push(query.mutation.filter);
  for (const value of query.mutation?.values ?? []) expressions.push(value.value);

  for (let i = 0; i < expressions.length; i += 1) {
    const error = validateQueryExpr(expressions[i]!, `$.expr[${i}]`);
    if (error) return err(error);
  }

  const parameterNames = new Set<string>();
  for (const parameter of query.parameters ?? []) {
    if (parameter.name.trim() === "" || parameterNames.has(parameter.name)) {
      return err(
        new StructuredError(
          "FORMAL_QUERY_PARAMETER",
          "Query parameters must have unique non-empty names.",
        ),
      );
    }
    parameterNames.add(parameter.name);
    if (parameter.schema !== undefined) {
      const valid = validateSchemaIr(parameter.schema);
      if (!valid.ok) return err(valid.error);
    }
  }

  return ok(structuredClone(query));
};

const logicTermKinds = new Set(["variable", "constant", "function"]);

const isLogicTerm = (
  value: SemanticValue | LogicTerm,
): value is LogicTerm => logicTermKinds.has(value.kind);

const validateLogicTerm = (
  term: LogicTerm,
  path: string,
): StructuredError | undefined => {
  switch (term.kind) {
    case "variable":
      return term.name.trim() === ""
        ? new StructuredError(
            "FORMAL_LOGIC_TERM_VARIABLE",
            `Logic variable name is empty at ${path}.`,
          )
        : undefined;
    case "constant":
      return undefined;
    case "function":
      if (term.function.trim() === "") {
        return new StructuredError(
          "FORMAL_LOGIC_TERM_FUNCTION",
          `Logic function identifier is empty at ${path}.`,
        );
      }
      for (let index = 0; index < term.args.length; index += 1) {
        const error = validateLogicTerm(
          term.args[index]!,
          `${path}.args[${index}]`,
        );
        if (error) return error;
      }
      return undefined;
  }
};

export const validateLogicIr = (logic: LogicIr): Result<LogicIr> => {
  const visit = (node: LogicIr, path: string): StructuredError | undefined => {
    switch (node.kind) {
      case "proposition-ref":
      case "boolean":
        return undefined;
      case "not":
        return visit(node.value, `${path}.not`);
      case "and":
      case "or":
        if (node.values.length < 2) {
          return new StructuredError(
            "FORMAL_LOGIC_ARITY",
            `${node.kind} requires at least two operands at ${path}.`,
          );
        }
        for (let i = 0; i < node.values.length; i += 1) {
          const error = visit(node.values[i]!, `${path}[${i}]`);
          if (error) return error;
        }
        return undefined;
      case "implies": {
        const left = visit(node.antecedent, `${path}.antecedent`);
        return left ?? visit(node.consequent, `${path}.consequent`);
      }
      case "iff": {
        const left = visit(node.left, `${path}.left`);
        return left ?? visit(node.right, `${path}.right`);
      }
      case "predicate":
        if (node.args.length === 0) {
          return new StructuredError(
            "FORMAL_LOGIC_PREDICATE_ARITY",
            `Predicate requires at least one argument at ${path}.`,
          );
        }
        for (let index = 0; index < node.args.length; index += 1) {
          const value = node.args[index]!.value;
          if (isLogicTerm(value)) {
            const error = validateLogicTerm(
              value,
              `${path}.args[${index}].value`,
            );
            if (error) return error;
          }
        }
        return undefined;
      case "comparison": {
        const left = validateLogicTerm(node.left, `${path}.left`);
        return left ?? validateLogicTerm(node.right, `${path}.right`);
      }
      case "quantifier":
        if (node.variable.trim() === "") {
          return new StructuredError(
            "FORMAL_LOGIC_VARIABLE",
            `Quantified variable is empty at ${path}.`,
          );
        }
        if (node.domain !== undefined) {
          const domain = validateSchemaIr(node.domain);
          if (!domain.ok) return domain.error;
        }
        return visit(node.body, `${path}.body`);
      case "modal":
        return visit(node.body, `${path}.body`);
    }
  };

  const error = visit(logic, "$");
  return error === undefined ? ok(structuredClone(logic)) : err(error);
};

export const validateMathIr = (math: MathIr): Result<MathIr> => {
  const visit = (node: MathIr, path: string): StructuredError | undefined => {
    switch (node.kind) {
      case "constant":
        return Number.isFinite(node.value)
          ? undefined
          : new StructuredError(
              "FORMAL_MATH_NUMBER",
              `Math constant must be finite at ${path}.`,
            );
      case "symbol":
        return node.name.trim() === ""
          ? new StructuredError(
              "FORMAL_MATH_SYMBOL",
              `Math symbol name is empty at ${path}.`,
            )
          : undefined;
      case "sum":
        if (node.terms.length < 2) {
          return new StructuredError(
            "FORMAL_MATH_ARITY",
            `Sum requires at least two terms at ${path}.`,
          );
        }
        for (let i = 0; i < node.terms.length; i += 1) {
          const error = visit(node.terms[i]!, `${path}.terms[${i}]`);
          if (error) return error;
        }
        return undefined;
      case "product":
        if (node.factors.length < 2) {
          return new StructuredError(
            "FORMAL_MATH_ARITY",
            `Product requires at least two factors at ${path}.`,
          );
        }
        for (let i = 0; i < node.factors.length; i += 1) {
          const error = visit(node.factors[i]!, `${path}.factors[${i}]`);
          if (error) return error;
        }
        return undefined;
      case "power": {
        const left = visit(node.base, `${path}.base`);
        return left ?? visit(node.exponent, `${path}.exponent`);
      }
      case "fraction": {
        const left = visit(node.numerator, `${path}.numerator`);
        return left ?? visit(node.denominator, `${path}.denominator`);
      }
      case "function":
        if (node.name.trim() === "") {
          return new StructuredError(
            "FORMAL_MATH_FUNCTION",
            `Math function name is empty at ${path}.`,
          );
        }
        for (let i = 0; i < node.args.length; i += 1) {
          const error = visit(node.args[i]!, `${path}.args[${i}]`);
          if (error) return error;
        }
        return undefined;
      case "relation": {
        const left = visit(node.left, `${path}.left`);
        return left ?? visit(node.right, `${path}.right`);
      }
      case "set":
      case "vector": {
        const values = node.values;
        for (let i = 0; i < values.length; i += 1) {
          const error = visit(values[i]!, `${path}[${i}]`);
          if (error) return error;
        }
        return undefined;
      }
      case "interval": {
        const lower =
          node.lower === undefined ? undefined : visit(node.lower, `${path}.lower`);
        return (
          lower ??
          (node.upper === undefined
            ? undefined
            : visit(node.upper, `${path}.upper`))
        );
      }
      case "matrix":
        if (
          node.rows.length === 0 ||
          node.rows[0] === undefined ||
          node.rows[0].length === 0 ||
          node.rows.some((row) => row.length !== node.rows[0]!.length)
        ) {
          return new StructuredError(
            "FORMAL_MATH_MATRIX_SHAPE",
            `Matrix must be non-empty and rectangular at ${path}.`,
          );
        }
        for (let row = 0; row < node.rows.length; row += 1) {
          for (let col = 0; col < node.rows[row]!.length; col += 1) {
            const error = visit(
              node.rows[row]![col]!,
              `${path}.rows[${row}][${col}]`,
            );
            if (error) return error;
          }
        }
        return undefined;
      case "limit": {
        if (node.variable.trim() === "") {
          return new StructuredError(
            "FORMAL_MATH_VARIABLE",
            `Limit variable is empty at ${path}.`,
          );
        }
        const toward = visit(node.toward, `${path}.toward`);
        return toward ?? visit(node.expression, `${path}.expression`);
      }
      case "derivative":
        if (
          node.variable.trim() === "" ||
          (node.order !== undefined &&
            (!Number.isInteger(node.order) || node.order < 1))
        ) {
          return new StructuredError(
            "FORMAL_MATH_DERIVATIVE",
            `Derivative variable/order is invalid at ${path}.`,
          );
        }
        return visit(node.expression, `${path}.expression`);
      case "integral": {
        if (node.variable.trim() === "") {
          return new StructuredError(
            "FORMAL_MATH_VARIABLE",
            `Integral variable is empty at ${path}.`,
          );
        }
        const expression = visit(node.expression, `${path}.expression`);
        if (expression) return expression;
        const lower =
          node.lower === undefined ? undefined : visit(node.lower, `${path}.lower`);
        return (
          lower ??
          (node.upper === undefined
            ? undefined
            : visit(node.upper, `${path}.upper`))
        );
      }
      case "quantified": {
        if (node.variable.trim() === "") {
          return new StructuredError(
            "FORMAL_MATH_VARIABLE",
            `Quantified variable is empty at ${path}.`,
          );
        }
        const logic = validateLogicIr(node.body);
        return logic.ok ? undefined : logic.error;
      }
    }
  };

  const error = visit(math, "$");
  return error === undefined ? ok(structuredClone(math)) : err(error);
};


export type CommandArgument =
  | { kind: "literal"; value: SemanticValue }
  | { kind: "path"; value: SemanticValue }
  | { kind: "flag"; name: string }
  | { kind: "option"; name: string; value?: SemanticValue }
  | { kind: "subcommand"; name: string }
  | { kind: "opaque"; value: SemanticValue };

export interface CommandIr {
  executable: SemanticValue;
  args: CommandArgument[];
  cwd?: SemanticValue;
  env?: Array<{ name: string; value: SemanticValue }>;
  stdin?: SemanticValue;
  expectedEffects?: SemanticRef[];
  annotations?: Record<string, JsonValue>;
}

export const validateCommandIr = (
  command: CommandIr,
): Result<CommandIr> => {
  if (
    command.executable.kind !== "string" &&
    command.executable.kind !== "enum" &&
    command.executable.kind !== "ref"
  ) {
    return err(
      new StructuredError(
        "FORMAL_COMMAND_EXECUTABLE",
        "Command executable must be a string-like semantic value or reference.",
      ),
    );
  }

  const environmentNames = new Set<string>();
  for (const binding of command.env ?? []) {
    if (binding.name.trim() === "" || environmentNames.has(binding.name)) {
      return err(
        new StructuredError(
          "FORMAL_COMMAND_ENV",
          "Command environment names must be unique and non-empty.",
        ),
      );
    }
    environmentNames.add(binding.name);
  }

  for (const argument of command.args) {
    if (
      (argument.kind === "flag" ||
        argument.kind === "subcommand" ||
        argument.kind === "option") &&
      argument.name.trim() === ""
    ) {
      return err(
        new StructuredError(
          "FORMAL_COMMAND_ARGUMENT",
          "Command flag, option, and subcommand names must be non-empty.",
        ),
      );
    }
  }

  return ok(structuredClone(command));
};


const renderValidated = <T>(
  validation: Result<T>,
): Result<string> => {
  if (!validation.ok) return err(validation.error);
  try {
    return ok(canonicalJson(validation.value as unknown as JsonValue));
  } catch (error) {
    return err(
      new StructuredError(
        "FORMAL_RENDER_UNSERIALIZABLE",
        error instanceof Error
          ? error.message
          : "Validated formal IR could not be serialized canonically.",
      ),
    );
  }
};

export const renderDataIr = (value: DataIr): Result<string> =>
  renderValidated(validateDataIr(value));

export const renderSchemaIr = (schema: SchemaIr): Result<string> =>
  renderValidated(validateSchemaIr(schema));

export const renderQueryIr = (query: QueryIr): Result<string> =>
  renderValidated(validateQueryIr(query));

export const renderLogicIr = (logic: LogicIr): Result<string> =>
  renderValidated(validateLogicIr(logic));

export const renderMathIr = (math: MathIr): Result<string> =>
  renderValidated(validateMathIr(math));

export const renderCommandIr = (command: CommandIr): Result<string> =>
  renderValidated(validateCommandIr(command));

export * from "./solver.ts";
